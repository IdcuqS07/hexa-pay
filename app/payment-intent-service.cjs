const { ethers } = require("ethers");
const {
  buildIntentDomain,
  verifyIntentSignature,
  hashRequestId,
} = require("./payment-intent-signature.cjs");
const {
  createExecutionDedupeStore,
  createMemoryExecutionDedupeStore,
} = require("./payment-intent-dedupe-store.cjs");
const {
  assertInvoiceIntentBinding,
} = require("./payment-intent-invoice-binding.cjs");
const {
  createPaymentReconciliationWorker,
} = require("./payment-reconciliation-worker.cjs");

function nowMs() {
  return Date.now();
}

function requiredString(value, name) {
  const v = String(value || "").trim();
  if (!v) {
    throw new Error(`${name} is required`);
  }
  return v;
}

function normalizeExecutionKey(intent) {
  return `${intent.merchantId}:${intent.terminalId}:${intent.requestId}`;
}

function isDuplicateLedgerStatus(status) {
  return ["signed", "executing", "settled"].includes(String(status || "").toLowerCase());
}

function validateIntentAgainstChallengeRecord(intent = {}, challengeRecord = null) {
  if (!challengeRecord || typeof challengeRecord !== "object") {
    return;
  }

  const comparableFields = [
    "challengeId",
    "receiptId",
    "quoteId",
    "merchantId",
    "terminalId",
    "payer",
    "merchant",
    "amount",
    "currency",
  ];

  for (const field of comparableFields) {
    const challengeValue = String(challengeRecord[field] || "");
    const intentValue = String(intent[field] || "");

    if (String(challengeValue).toLowerCase() !== String(intentValue).toLowerCase()) {
      const error = new Error(`Intent ${field} does not match the issued challenge.`);
      error.code = "challenge_intent_mismatch";
      error.details = {
        field,
        challengeValue,
        intentValue,
      };
      throw error;
    }
  }
}

function createEvmExecutor({
  rpcUrl,
  privateKey,
  contractAddress,
  abi,
}) {
  if (!rpcUrl || !privateKey || !contractAddress) {
    throw new Error("rpcUrl, privateKey, and contractAddress are required");
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const signer = new ethers.NonceManager(new ethers.Wallet(privateKey, provider));
  const contract = new ethers.Contract(contractAddress, abi, signer);
  let executionQueue = Promise.resolve();

  function isNonceConflictError(error) {
    const message = String(error?.message || "").toLowerCase();
    return (
      message.includes("nonce has already been used") ||
      message.includes("nonce too low") ||
      message.includes("replacement transaction underpriced")
    );
  }

  async function sendExecute(
    { intentHash, requestIdHash, token, payer, merchant, amount },
    attempt = 0,
  ) {
    try {
      const tx = await contract.executePayment(
        intentHash,
        requestIdHash,
        token,
        payer,
        merchant,
        amount,
      );
      const receipt = await tx.wait();
      return {
        txHash: tx.hash,
        blockNumber: receipt.blockNumber,
        status: receipt.status,
      };
    } catch (error) {
      if (attempt === 0 && isNonceConflictError(error)) {
        signer.reset();
        return sendExecute({ intentHash, requestIdHash, token, payer, merchant, amount }, attempt + 1);
      }
      throw error;
    }
  }

  return {
    async execute({ intentHash, requestIdHash, token, payer, merchant, amount }) {
      const nextExecution = executionQueue.then(
        () => sendExecute({ intentHash, requestIdHash, token, payer, merchant, amount }),
        () => sendExecute({ intentHash, requestIdHash, token, payer, merchant, amount }),
      );
      executionQueue = nextExecution.catch(() => undefined);
      return nextExecution;
    },
  };
}

function createPaymentIntentService(options = {}) {
  const challengeRegistry = options.challengeRegistry;
  const executionDedupeStore =
    options.executionDedupeStore || createExecutionDedupeStore();
  const executor = options.executor;
  const paymentLedger = options.paymentLedger || null;
  const paymentReconciliationWorker =
    options.reconciliationWorker ||
    (paymentLedger &&
    (options.reconciliationStore ||
      options.reconciliationRecorder ||
      options.recordHandler ||
      options.executorAddress)
      ? createPaymentReconciliationWorker({
          paymentLedger,
          reconciliationStore: options.reconciliationStore,
          reconciliationRecorder: options.reconciliationRecorder || options.recordHandler,
          chainId: options.chainId,
          executorAddress: options.executorAddress,
        })
      : null);
  const domain = buildIntentDomain({
    chainId: options.chainId,
    verifyingContract: options.verifyingContract,
    name: options.domainName,
    version: options.domainVersion,
  });

  if (!challengeRegistry) {
    throw new Error("challengeRegistry is required");
  }

  async function createChallenge(input = {}) {
    const binding = assertInvoiceIntentBinding({
      receiptId: input.receiptId,
      invoiceId: input.invoiceId,
    });
    const challengeToken = `challenge-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const issuedAt = Date.now();
    const expiresAt = issuedAt + 300000; // 5 minutes

    const challenge = await challengeRegistry.remember({
      raw: challengeToken,
      issuer: "hexapay",
      keyId: "payment-intent",
      role: "payer",
      viewer: input.actorId || input.payer,
      quoteId: input.quoteId || input.receiptId || "",
      chainId: String(options.chainId || "421614"),
      nonce: Math.random().toString(36).slice(2),
      actorId: input.actorId || input.payer,
      permitHash: input.permitHash || "",
      sessionId: input.sessionId || "",
      deviceFingerprint: input.deviceFingerprintHash || "",
      issuedAt,
      expiresAt,
    });

    const challengeRecord = {
      challengeId: challengeToken,
      requestId: input.requestId,
      receiptId: binding.receiptId,
      invoiceId: binding.invoiceId,
      quoteId: input.quoteId,
      merchantId: input.merchantId,
      terminalId: input.terminalId,
      amount: String(input.amount),
      currency: input.currency,
      payer: input.payer,
      merchant: input.merchant,
      issuedAtMs: issuedAt,
      expiresAtMs: expiresAt,
      domain,
    };

    if (paymentLedger?.rememberChallenge) {
      await Promise.resolve(paymentLedger.rememberChallenge(challengeRecord));
    }

    return challengeRecord;
  }

  async function executeSignedIntent({ intent, signature }) {
    const binding = assertInvoiceIntentBinding({
      receiptId: intent?.receiptId,
    });
    requiredString(intent?.challengeId, "intent.challengeId");
    requiredString(intent?.requestId, "intent.requestId");
    requiredString(intent?.merchantId, "intent.merchantId");
    requiredString(intent?.terminalId, "intent.terminalId");
    requiredString(intent?.currency, "intent.currency");
    requiredString(intent?.payer, "intent.payer");
    requiredString(intent?.merchant, "intent.merchant");
    requiredString(intent?.token, "intent.token");
    requiredString(intent?.amount, "intent.amount");

    const now = nowMs();

    if (Number(intent.expiresAtMs || 0) <= now) {
      const error = new Error("Intent expired.");
      error.code = "intent_expired";
      throw error;
    }

    const signatureResult = await verifyIntentSignature({
      domain,
      intent,
      signature,
      expectedPayer: intent.payer,
    });

    if (!signatureResult.ok) {
      const error = new Error("Invalid payment intent signature.");
      error.code = signatureResult.code || "invalid_signature";
      error.details = signatureResult;
      throw error;
    }

    const dedupeKey = normalizeExecutionKey(intent);
    const existingRecord = paymentLedger?.getByRequestId
      ? await Promise.resolve(paymentLedger.getByRequestId(intent.requestId))
      : null;
    validateIntentAgainstChallengeRecord(intent, existingRecord);
    const duplicateFromLedger = isDuplicateLedgerStatus(existingRecord?.status);
    let executionClaimed = false;

    if (!duplicateFromLedger && typeof executionDedupeStore.claim === "function") {
      const claimResult = await executionDedupeStore.claim(dedupeKey, {
        requestId: intent.requestId,
        merchantId: intent.merchantId,
        terminalId: intent.terminalId,
        payer: intent.payer,
      });

      if (!claimResult?.ok) {
        const error = new Error("Duplicate execution.");
        error.code = "duplicate_execution";
        error.details = {
          existingRecord: existingRecord || claimResult?.record || null,
        };
        throw error;
      }

      executionClaimed = true;
    }

    if (!executionClaimed && ((await executionDedupeStore.has(dedupeKey)) || duplicateFromLedger)) {
      const error = new Error("Duplicate execution.");
      error.code = "duplicate_execution";
      if (existingRecord) {
        error.details = {
          existingRecord,
        };
      }
      throw error;
    }

    if (paymentLedger?.markSigned) {
      await Promise.resolve(
        paymentLedger.markSigned(intent, {
          signer: signatureResult.signer,
          intentHash: signatureResult.intentHash,
          requestIdHash: hashRequestId(intent.requestId),
          signedAt: now,
          invoiceId: binding.invoiceId,
        }),
      );
    }

    const consumeContext = {
      actorId: intent.actorId || intent.payer || null,
      permitHash: intent.permitHash || null,
      sessionId: intent.sessionId || null,
      deviceFingerprint: intent.deviceFingerprintHash || null,
    };

    const reserveResult =
      typeof challengeRegistry.reserveConsume === "function"
        ? await challengeRegistry.reserveConsume(intent.challengeId, consumeContext)
        : await challengeRegistry.consume(intent.challengeId, consumeContext);

    if (!reserveResult || !reserveResult.ok) {
      const error = new Error("Challenge consume failed.");
      error.code = reserveResult?.code || "challenge_consume_failed";
      error.details = reserveResult || null;
      throw error;
    }

    const intentHash = signatureResult.intentHash;
    const requestIdHash = hashRequestId(intent.requestId);

    if (paymentLedger?.markExecuting) {
      await Promise.resolve(
        paymentLedger.markExecuting(intent, {
          signer: signatureResult.signer,
          intentHash,
          requestIdHash,
          executingAt: nowMs(),
          invoiceId: binding.invoiceId,
        }),
      );
    }

    if (!executor) {
      const error = new Error("No executor configured.");
      error.code = "executor_missing";
      if (executionClaimed && typeof executionDedupeStore.release === "function") {
        await executionDedupeStore.release(dedupeKey).catch(() => null);
      }
      if (paymentLedger?.markFailed) {
        await Promise.resolve(
          paymentLedger.markFailed(intent, error, {
            signer: signatureResult.signer,
            intentHash,
            requestIdHash,
            failedAt: nowMs(),
            invoiceId: binding.invoiceId,
          }),
        );
      }
      throw error;
    }

    let execution;

    try {
      execution = await executor.execute({
        intentHash,
        requestIdHash,
        token: ethers.getAddress(intent.token),
        payer: ethers.getAddress(intent.payer),
        merchant: ethers.getAddress(intent.merchant),
        amount: intent.amount,
      });
    } catch (error) {
      if (executionClaimed && typeof executionDedupeStore.release === "function") {
        await executionDedupeStore.release(dedupeKey).catch(() => null);
      }
      if (typeof challengeRegistry.releaseConsume === "function") {
        await challengeRegistry.releaseConsume(intent.challengeId, consumeContext).catch(() => null);
      }
      if (paymentLedger?.markFailed) {
        await Promise.resolve(
          paymentLedger.markFailed(intent, error, {
            signer: signatureResult.signer,
            intentHash,
            requestIdHash,
            failedAt: nowMs(),
            invoiceId: binding.invoiceId,
          }),
        );
      }
      throw error;
    }

    if (typeof executionDedupeStore.finalize === "function") {
      await executionDedupeStore.finalize(dedupeKey, {
        intentHash,
        requestIdHash,
        execution,
        createdAt: new Date().toISOString(),
      });
    } else {
      await executionDedupeStore.put(dedupeKey, {
        intentHash,
        requestIdHash,
        execution,
        createdAt: new Date().toISOString(),
      });
    }

    const commitResult =
      typeof challengeRegistry.commitConsume === "function"
        ? await challengeRegistry.commitConsume(intent.challengeId, consumeContext)
        : reserveResult;

    if (paymentLedger?.markSettled) {
      await Promise.resolve(
        paymentLedger.markSettled(intent, execution, {
          signer: signatureResult.signer,
          intentHash,
          requestIdHash,
          settledAt: nowMs(),
          invoiceId: binding.invoiceId,
        }),
      );
    }

    return {
      ok: true,
      status: "executed",
      signer: signatureResult.signer,
      intentHash,
      requestIdHash,
      txHash: execution.txHash,
      blockNumber: execution.blockNumber,
      challengeStatus: commitResult?.code || "consumed",
    };
  }

  async function listPayments(filters = {}) {
    if (paymentLedger?.list) {
      return await Promise.resolve(paymentLedger.list(filters));
    }

    return {
      status: "ok",
      statusCode: 200,
      filters: {
        wallet: String(filters.wallet || ""),
        merchant: String(filters.merchant || ""),
        payer: String(filters.payer || ""),
        status: String(filters.status || ""),
        invoiceId: String(filters.invoiceId || ""),
        limit: Math.max(0, Number.parseInt(String(filters.limit || 0), 10) || 0),
      },
      summary: {
        totalCount: 0,
        returnedCount: 0,
        byStatus: {},
        updatedAt: Date.now(),
      },
      records: [],
    };
  }

  async function listReconciliationCandidates(filters = {}) {
    if (paymentLedger?.listReconciliationCandidates) {
      return await Promise.resolve(paymentLedger.listReconciliationCandidates(filters));
    }

    return {
      status: "ok",
      statusCode: 200,
      filters: {
        invoiceId: String(filters.invoiceId || ""),
        limit: Math.max(0, Number.parseInt(String(filters.limit || 0), 10) || 0),
        eligibleOnly: filters.eligibleOnly !== false,
      },
      summary: {
        totalInvoiceLinked: 0,
        eligibleCount: 0,
        returnedCount: 0,
        updatedAt: Date.now(),
      },
      records: [],
    };
  }

  async function getPaymentLedgerSnapshot({ includeRecords = false } = {}) {
    if (paymentLedger?.snapshot) {
      const snapshot = await Promise.resolve(paymentLedger.snapshot({ includeRecords }));
      return {
        ...snapshot,
        storage:
          typeof paymentLedger.describe === "function"
            ? paymentLedger.describe()
            : { kind: "custom" },
      };
    }

    return {
      status: "ok",
      statusCode: 200,
      summary: {
        totalCount: 0,
        returnedCount: 0,
        byStatus: {},
        updatedAt: Date.now(),
      },
      records: [],
      storage: { kind: "memory" },
    };
  }

  async function listReconciliationRecords(filters = {}) {
    if (paymentReconciliationWorker?.listRecords) {
      return await Promise.resolve(paymentReconciliationWorker.listRecords(filters));
    }

    return {
      status: "ok",
      statusCode: 200,
      filters: {
        wallet: String(filters.wallet || ""),
        merchant: String(filters.merchant || ""),
        payer: String(filters.payer || ""),
        state: String(filters.state || ""),
        recordId: String(filters.recordId || ""),
        settlementId: String(filters.settlementId || ""),
        requestId: String(filters.requestId || ""),
        txHash: String(filters.txHash || ""),
        invoiceId: String(filters.invoiceId || ""),
        limit: Math.max(0, Number.parseInt(String(filters.limit || 0), 10) || 0),
      },
      summary: {
        totalCount: 0,
        returnedCount: 0,
        byState: {},
        updatedAt: Date.now(),
      },
      authority: {
        accounting: "workflow_contract",
        orchestration: "payment_reconciliation_store",
        settlementSource: "executor_chain",
      },
      records: [],
    };
  }

  async function runReconciliation(filters = {}) {
    if (paymentReconciliationWorker?.runOnce) {
      return await Promise.resolve(paymentReconciliationWorker.runOnce(filters));
    }

    return {
      status: "ok",
      statusCode: 200,
      filters: {
        invoiceId: String(filters.invoiceId || ""),
        limit: Math.max(0, Number.parseInt(String(filters.limit || 0), 10) || 0),
        autoRecord: filters.autoRecord !== false,
        retryExceptions: filters.retryExceptions !== false,
      },
      summary: {
        scannedCount: 0,
        observedCount: 0,
        eligibleCount: 0,
        submittedCount: 0,
        recordedCount: 0,
        appliedCount: 0,
        exceptionCount: 0,
        skippedCount: 0,
        updatedAt: Date.now(),
      },
      authority: {
        accounting: "workflow_contract",
        orchestration: "payment_reconciliation_store",
        settlementSource: "executor_chain",
      },
      records: [],
    };
  }

  async function getPaymentReconciliationSnapshot({ includeRecords = false } = {}) {
    if (paymentReconciliationWorker?.getSnapshot) {
      return await Promise.resolve(paymentReconciliationWorker.getSnapshot({ includeRecords }));
    }

    return {
      status: "ok",
      statusCode: 200,
      summary: {
        totalCount: 0,
        byState: {},
        updatedAt: Date.now(),
      },
      authority: {
        accounting: "workflow_contract",
        orchestration: "payment_reconciliation_store",
        settlementSource: "executor_chain",
      },
      records: [],
      storage: { kind: "memory" },
    };
  }

  return {
    domain,
    createChallenge,
    executeSignedIntent,
    listPayments,
    listReconciliationCandidates,
    listReconciliationRecords,
    runReconciliation,
    getPaymentLedgerSnapshot,
    getPaymentReconciliationSnapshot,
    paymentLedger,
    paymentReconciliationWorker,
  };
}

module.exports = {
  createPaymentIntentService,
  createMemoryExecutionDedupeStore,
  createEvmExecutor,
};
