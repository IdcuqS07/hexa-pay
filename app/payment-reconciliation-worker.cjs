const { ethers } = require("ethers");
const {
  createPaymentReconciliationStoreAdapter,
} = require("./payment-reconciliation-store.cjs");

function nowMs() {
  return Date.now();
}

function normalizeString(value) {
  return String(value || "").trim();
}

function normalizePositiveInteger(value, fallback = 0) {
  return Math.max(0, Number.parseInt(String(value || fallback), 10) || 0);
}

function normalizeLowerString(value) {
  return normalizeString(value).toLowerCase();
}

function normalizeBoolean(value, fallback = false) {
  if (value === undefined || value === null) {
    return Boolean(fallback);
  }

  return value === true || value === "1" || value === 1;
}

function nowIso() {
  return new Date().toISOString();
}

function buildPaymentSettlementId({ chainId, executorAddress, intentHash, requestIdHash } = {}) {
  const normalizedExecutorAddress = normalizeString(executorAddress);
  const normalizedIntentHash = normalizeString(intentHash);
  const normalizedRequestIdHash = normalizeString(requestIdHash);

  if (!normalizedExecutorAddress) {
    throw new Error("executorAddress is required");
  }
  if (!normalizedIntentHash) {
    throw new Error("intentHash is required");
  }
  if (!normalizedRequestIdHash) {
    throw new Error("requestIdHash is required");
  }

  return ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["uint256", "address", "bytes32", "bytes32"],
      [
        BigInt(String(chainId || 0)),
        ethers.getAddress(normalizedExecutorAddress),
        normalizedIntentHash,
        normalizedRequestIdHash,
      ],
    ),
  );
}

function tryBuildPaymentSettlementId(input = {}) {
  try {
    return buildPaymentSettlementId(input);
  } catch {
    return "";
  }
}

function buildReconciliationRecordId(candidate = {}, options = {}) {
  const settlementId = tryBuildPaymentSettlementId({
    chainId: options.chainId,
    executorAddress: options.executorAddress,
    intentHash: candidate.intentHash,
    requestIdHash: candidate.requestIdHash,
  });

  if (settlementId) {
    return {
      recordId: settlementId,
      settlementId,
    };
  }

  const requestId = normalizeString(candidate.requestId);
  if (requestId) {
    return {
      recordId: `request:${requestId}`,
      settlementId: "",
    };
  }

  const txHash = normalizeString(candidate.txHash);
  if (txHash) {
    return {
      recordId: `tx:${txHash}`,
      settlementId: "",
    };
  }

  return {
    recordId: `candidate:${nowMs()}`,
    settlementId: "",
  };
}

function normalizeRecordAttempt(previous = {}) {
  return normalizePositiveInteger(previous?.attemptCount, 0) + 1;
}

const RECONCILIATION_AUTHORITY = {
  accounting: "workflow_contract",
  orchestration: "payment_reconciliation_store",
  settlementSource: "executor_chain",
};

function isFinalReconciliationState(state = "") {
  const normalized = normalizeLowerString(state);
  return normalized === "recorded" || normalized === "applied";
}

function isRetryableExceptionReason(reason = "") {
  const normalized = normalizeLowerString(reason);
  if (!normalized) {
    return true;
  }

  return (
    normalized === "bridge_record_failed" ||
    normalized === "provider_error" ||
    normalized === "tx_receipt_missing" ||
    normalized === "executor_read_failed" ||
    normalized === "verification_failed_retryable"
  );
}

function createVerificationResult({
  ok = false,
  reason = "",
  verificationStatus = "",
  checks = {},
  retryable = false,
  verifiedAt = nowMs(),
  metadata = {},
} = {}) {
  return {
    ok: Boolean(ok),
    reason: normalizeString(reason),
    verificationStatus: normalizeString(
      verificationStatus || (ok ? "verified" : "failed"),
    ),
    checks: checks && typeof checks === "object" ? checks : {},
    retryable: Boolean(retryable),
    verifiedAt: Number(verifiedAt || nowMs()),
    metadata: metadata && typeof metadata === "object" ? metadata : {},
  };
}

function createEvmExternalSettlementRecorder({
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

  async function sendRecordSettlement(candidate, attempt = 0) {
    try {
      const tx = await contract.recordExternalSettlementReceipt(
        candidate.invoiceId,
        candidate.intentHash,
        candidate.requestIdHash,
        candidate.txHash,
        candidate.payer,
        candidate.merchant,
        candidate.token,
        BigInt(String(candidate.amount || 0)),
      );
      const receipt = await tx.wait();

      return {
        ok: true,
        settlementId: candidate.settlementId,
        bridgeTxHash: tx.hash,
        bridgeBlockNumber: Number(receipt?.blockNumber || 0),
        recordedAt: nowMs(),
      };
    } catch (error) {
      if (attempt === 0 && isNonceConflictError(error)) {
        signer.reset();
        return sendRecordSettlement(candidate, attempt + 1);
      }

      throw error;
    }
  }

  return {
    async recordSettlement(candidate = {}) {
      const nextExecution = executionQueue.then(
        () => sendRecordSettlement(candidate),
        () => sendRecordSettlement(candidate),
      );
      executionQueue = nextExecution.catch(() => undefined);
      return nextExecution;
    },
  };
}

function createEvmPaymentReconciliationVerifier({
  rpcUrl,
  executorAddress,
  executorAbi,
  settlementTokenAddress,
  invoiceContextResolver,
  requireInvoiceContext = false,
  requireExactInvoiceAmount = false,
  retryableReceiptMissing = true,
} = {}) {
  if (!rpcUrl || !executorAddress) {
    throw new Error("rpcUrl and executorAddress are required");
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const executor = new ethers.Contract(
    executorAddress,
    executorAbi || [
      "function paymentRecords(bytes32 intentHash) view returns (bytes32 intentHash, bytes32 requestIdHash, address token, address payer, address merchant, uint256 amount, uint256 executedAt)",
    ],
    provider,
  );
  const normalizedSettlementToken = normalizeLowerString(settlementTokenAddress);

  async function readExecutorRecord(intentHash) {
    try {
      const record = await executor.paymentRecords(intentHash);

      return {
        ok: true,
        record: {
          intentHash: normalizeString(record.intentHash),
          requestIdHash: normalizeString(record.requestIdHash),
          token: normalizeString(record.token),
          payer: normalizeString(record.payer),
          merchant: normalizeString(record.merchant),
          amount: String(record.amount ?? ""),
          executedAt: Number(record.executedAt || 0),
        },
      };
    } catch (error) {
      return {
        ok: false,
        reason: "executor_read_failed",
        retryable: true,
        error,
      };
    }
  }

  return {
    async verifyCandidate(candidate = {}) {
      const checks = {
        executorRecord: false,
        txSuccess: false,
        tokenMatch: false,
        merchantMatch: false,
        payerMatch: false,
        amountMatch: false,
        invoiceContext: false,
      };

      const executorRecordResult = await readExecutorRecord(candidate.intentHash);
      if (!executorRecordResult.ok) {
        return createVerificationResult({
          ok: false,
          reason: executorRecordResult.reason,
          retryable: executorRecordResult.retryable,
          checks,
          metadata: {
            error: normalizeString(executorRecordResult.error?.message),
          },
        });
      }

      const executorRecord = executorRecordResult.record;
      if (!executorRecord.intentHash || executorRecord.executedAt <= 0) {
        return createVerificationResult({
          ok: false,
          reason: "executor_record_missing",
          checks,
        });
      }
      checks.executorRecord = true;

      let txReceipt = null;
      try {
        txReceipt = await provider.getTransactionReceipt(candidate.txHash);
      } catch (error) {
        return createVerificationResult({
          ok: false,
          reason: "provider_error",
          retryable: true,
          checks,
          metadata: {
            error: normalizeString(error?.message),
          },
        });
      }

      if (!txReceipt) {
        return createVerificationResult({
          ok: false,
          reason: "tx_receipt_missing",
          retryable: retryableReceiptMissing,
          checks,
        });
      }
      if (Number(txReceipt.status || 0) !== 1) {
        return createVerificationResult({
          ok: false,
          reason: "tx_not_successful",
          checks,
        });
      }
      checks.txSuccess = true;

      if (
        normalizeLowerString(candidate.requestIdHash) !== normalizeLowerString(executorRecord.requestIdHash)
      ) {
        return createVerificationResult({
          ok: false,
          reason: "request_id_hash_mismatch",
          checks,
        });
      }

      if (
        normalizeLowerString(candidate.token) !== normalizeLowerString(executorRecord.token) ||
        (normalizedSettlementToken &&
          normalizeLowerString(candidate.token) !== normalizedSettlementToken)
      ) {
        return createVerificationResult({
          ok: false,
          reason: "token_mismatch",
          checks,
        });
      }
      checks.tokenMatch = true;

      if (normalizeLowerString(candidate.merchant) !== normalizeLowerString(executorRecord.merchant)) {
        return createVerificationResult({
          ok: false,
          reason: "merchant_mismatch",
          checks,
        });
      }
      checks.merchantMatch = true;

      if (normalizeLowerString(candidate.payer) !== normalizeLowerString(executorRecord.payer)) {
        return createVerificationResult({
          ok: false,
          reason: "payer_mismatch",
          checks,
        });
      }
      checks.payerMatch = true;

      if (String(candidate.amount || "") !== String(executorRecord.amount || "")) {
        return createVerificationResult({
          ok: false,
          reason: "amount_mismatch",
          checks,
        });
      }
      checks.amountMatch = true;

      let invoiceContext = null;
      if (typeof invoiceContextResolver === "function") {
        try {
          invoiceContext = await Promise.resolve(invoiceContextResolver(candidate));
        } catch (error) {
          return createVerificationResult({
            ok: false,
            reason: "invoice_context_failed",
            retryable: true,
            checks,
            metadata: {
              error: normalizeString(error?.message),
            },
          });
        }
      }

      if (invoiceContext) {
        checks.invoiceContext = true;

        const invoiceMerchant = normalizeString(
          invoiceContext.merchant || invoiceContext.company || invoiceContext.recipient,
        );
        if (
          invoiceMerchant &&
          normalizeLowerString(invoiceMerchant) !== normalizeLowerString(candidate.merchant)
        ) {
          return createVerificationResult({
            ok: false,
            reason: "invoice_merchant_mismatch",
            checks,
          });
        }

        if (invoiceContext.payable === false) {
          return createVerificationResult({
            ok: false,
            reason: "invoice_not_payable",
            checks,
          });
        }

        const allowedPayers = Array.isArray(invoiceContext.allowedPayers)
          ? invoiceContext.allowedPayers.map((value) => normalizeLowerString(value))
          : [];
        const invoicePayer = normalizeLowerString(invoiceContext.payer);
        if (
          (invoicePayer || allowedPayers.length > 0) &&
          invoicePayer !== normalizeLowerString(candidate.payer) &&
          !allowedPayers.includes(normalizeLowerString(candidate.payer))
        ) {
          return createVerificationResult({
            ok: false,
            reason: "invoice_payer_mismatch",
            checks,
          });
        }

        const invoiceAmount = invoiceContext.amount ?? invoiceContext.expectedAmount;
        const invoiceMaxAmount = invoiceContext.maxAmount ?? invoiceAmount;
        if (invoiceAmount !== undefined && invoiceAmount !== null) {
          const candidateAmount = BigInt(String(candidate.amount || 0));
          const expectedAmount = BigInt(String(invoiceAmount));
          const maxAmount = BigInt(String(invoiceMaxAmount));

          if (requireExactInvoiceAmount && candidateAmount !== expectedAmount) {
            return createVerificationResult({
              ok: false,
              reason: "invoice_amount_mismatch",
              checks,
            });
          }

          if (!requireExactInvoiceAmount && candidateAmount > maxAmount) {
            return createVerificationResult({
              ok: false,
              reason: "invoice_amount_exceeds",
              checks,
            });
          }
        }
      } else if (requireInvoiceContext) {
        return createVerificationResult({
          ok: false,
          reason: "invoice_context_missing",
          checks,
        });
      }

      return createVerificationResult({
        ok: true,
        reason: checks.invoiceContext ? "verified" : "verified_without_invoice_context",
        checks,
        metadata: {
          txBlockNumber: Number(txReceipt.blockNumber || 0),
          executorExecutedAt: Number(executorRecord.executedAt || 0),
        },
      });
    },
  };
}

function createPaymentReconciliationWorker(options = {}) {
  const paymentLedger = options.paymentLedger || null;
  const reconciliationStore =
    options.reconciliationStore || createPaymentReconciliationStoreAdapter({ mode: "memory" });
  const recordHandler =
    options.recordHandler ||
    options.reconciliationRecorder ||
    options.recorder ||
    null;
  const verificationHandler =
    options.verificationHandler ||
    options.reconciliationVerifier ||
    options.verifier ||
    null;
  const chainId = Number(options.chainId || process.env.HEXAPAY_CHAIN_ID || 0);
  const executorAddress =
    normalizeString(options.executorAddress || process.env.HEXAPAY_EXECUTOR_CONTRACT_ADDRESS) || "";
  const retrySubmittedAfterMs = normalizePositiveInteger(
    options.retrySubmittedAfterMs || process.env.HEXAPAY_RECONCILIATION_RETRY_SUBMITTED_AFTER_MS,
    300000,
  );
  const retryExceptionAfterMs = normalizePositiveInteger(
    options.retryExceptionAfterMs || process.env.HEXAPAY_RECONCILIATION_RETRY_EXCEPTION_AFTER_MS,
    120000,
  );

  if (!paymentLedger) {
    throw new Error("paymentLedger is required");
  }

  async function listRecords(filters = {}) {
    if (!reconciliationStore?.list) {
      return {
        status: "ok",
        statusCode: 200,
        filters: {
          state: normalizeString(filters.state),
          recordId: normalizeString(filters.recordId),
          settlementId: normalizeString(filters.settlementId),
          requestId: normalizeString(filters.requestId),
          txHash: normalizeString(filters.txHash),
          invoiceId: normalizeString(filters.invoiceId),
          limit: normalizePositiveInteger(filters.limit, 0),
        },
        summary: {
          totalCount: 0,
          returnedCount: 0,
          byState: {},
          updatedAt: nowMs(),
        },
        authority: RECONCILIATION_AUTHORITY,
        records: [],
      };
    }

    const result = await Promise.resolve(reconciliationStore.list(filters));
    return {
      ...result,
      authority: RECONCILIATION_AUTHORITY,
    };
  }

  async function getSnapshot({ includeRecords = false } = {}) {
    if (!reconciliationStore?.snapshot) {
      return {
        status: "ok",
        statusCode: 200,
        summary: {
          totalCount: 0,
          byState: {},
          updatedAt: nowMs(),
        },
        authority: RECONCILIATION_AUTHORITY,
        records: [],
        storage: { kind: "memory" },
      };
    }

    const snapshot = await Promise.resolve(reconciliationStore.snapshot({ includeRecords }));
    return {
      ...snapshot,
      authority: RECONCILIATION_AUTHORITY,
      storage:
        typeof reconciliationStore.describe === "function"
          ? reconciliationStore.describe()
          : { kind: "custom" },
    };
  }

  async function verifyCandidate(candidate = {}) {
    if (!verificationHandler || typeof verificationHandler.verifyCandidate !== "function") {
      return createVerificationResult({
        ok: true,
        reason: "verification_not_configured",
        verificationStatus: "not_configured",
      });
    }

    const result = await Promise.resolve(verificationHandler.verifyCandidate(candidate));
    return createVerificationResult(result || {});
  }

  async function runOnce(filters = {}) {
    const candidateResult = await Promise.resolve(
      paymentLedger.listReconciliationCandidates({
        invoiceId: filters.invoiceId,
        limit: filters.limit,
        eligibleOnly: false,
      }),
    );
    const now = nowMs();
    const autoRecord = filters.autoRecord !== false;
    const retryExceptions = filters.retryExceptions !== false;
    const summary = {
      scannedCount: 0,
      observedCount: 0,
      eligibleCount: 0,
      submittedCount: 0,
      recordedCount: 0,
      appliedCount: 0,
      exceptionCount: 0,
      skippedCount: 0,
      updatedAt: now,
    };
    const records = [];

    for (const candidate of candidateResult.records || []) {
      summary.scannedCount += 1;
      const key = buildReconciliationRecordId(candidate, {
        chainId,
        executorAddress,
      });

      const observedRecord = await Promise.resolve(
        reconciliationStore.observeCandidate(candidate, {
          recordId: key.recordId,
          settlementId: key.settlementId,
          state: "observed",
          observedAt: now,
          lastSeenAt: now,
          updatedAt: now,
        }),
      );
      summary.observedCount += 1;

      const duplicateInvoiceTxRecord =
        typeof reconciliationStore.getByInvoiceTx === "function"
          ? await Promise.resolve(
              reconciliationStore.getByInvoiceTx(
                candidate.invoiceId,
                candidate.txHash,
                key.recordId,
              ),
            )
          : null;

      if (duplicateInvoiceTxRecord) {
        const duplicateStateAt = nowMs();
        const duplicateAttemptCount = normalizeRecordAttempt(observedRecord);
        const duplicateRecord = await Promise.resolve(
          reconciliationStore.markState(key.recordId, {
            state: "exception",
            reason: "duplicate_invoice_tx",
            verificationStatus: "failed",
            verificationReason: "duplicate_invoice_tx",
            duplicateRecordId: duplicateInvoiceTxRecord.recordId,
            settlementId: key.settlementId,
            attemptCount: duplicateAttemptCount,
            retryable: false,
            nextRetryAt: 0,
            stateAt: duplicateStateAt,
            updatedAt: duplicateStateAt,
          }),
        );
        summary.exceptionCount += 1;
        records.push(duplicateRecord);
        continue;
      }

      const existingAttemptCount = normalizeRecordAttempt(observedRecord);
      let finalRecord = observedRecord;
      const sourceReconciliationStatus = normalizeString(candidate.reconciliationStatus).toLowerCase();
      const sourceReason = normalizeString(candidate.reason || "eligible");
      const existingState = normalizeLowerString(observedRecord.reconciliationState);

      if (sourceReconciliationStatus === "applied") {
        finalRecord = await Promise.resolve(
          reconciliationStore.markState(key.recordId, {
            state: "applied",
            reason: "already_applied",
            settlementId: key.settlementId,
            attemptCount: existingAttemptCount,
            stateAt: now,
            updatedAt: now,
          }),
        );
        summary.appliedCount += 1;
        records.push(finalRecord);
        continue;
      }

      if (sourceReconciliationStatus === "recorded") {
        finalRecord = await Promise.resolve(
          reconciliationStore.markState(key.recordId, {
            state: "recorded",
            reason: "already_recorded",
            settlementId: key.settlementId,
            attemptCount: existingAttemptCount,
            stateAt: now,
            updatedAt: now,
          }),
        );
        summary.recordedCount += 1;
        records.push(finalRecord);
        continue;
      }

      if (existingState === "submitted") {
        const submittedAt = normalizePositiveInteger(observedRecord.lifecycle?.submittedAt, 0);
        if (submittedAt > 0 && now - submittedAt < retrySubmittedAfterMs) {
          summary.skippedCount += 1;
          records.push(observedRecord);
          continue;
        }
      }

      if (existingState === "exception" && !retryExceptions) {
        summary.skippedCount += 1;
        records.push(observedRecord);
        continue;
      }

      if (existingState === "exception") {
        const nextRetryAt = normalizePositiveInteger(observedRecord.nextRetryAt, 0);
        const retryableReason = isRetryableExceptionReason(
          observedRecord.lastErrorCode || observedRecord.reconciliationReason,
        );
        if ((nextRetryAt > 0 && now < nextRetryAt) || !retryableReason) {
          summary.skippedCount += 1;
          records.push(observedRecord);
          continue;
        }
      }

      if (isFinalReconciliationState(existingState)) {
        if (existingState === "applied") {
          summary.appliedCount += 1;
        } else {
          summary.recordedCount += 1;
        }
        records.push(observedRecord);
        continue;
      }

      const verificationResult = await verifyCandidate(candidate);
      if (!verificationResult.ok) {
        const exceptionAt = nowMs();
        finalRecord = await Promise.resolve(
          reconciliationStore.markState(key.recordId, {
            state: "exception",
            reason: normalizeString(verificationResult.reason) || sourceReason,
            verificationStatus: verificationResult.verificationStatus,
            verificationReason: normalizeString(verificationResult.reason),
            verificationCheckedAt: verificationResult.verifiedAt,
            settlementId: key.settlementId,
            attemptCount: existingAttemptCount,
            retryable: verificationResult.retryable,
            nextRetryAt: verificationResult.retryable ? exceptionAt + retryExceptionAfterMs : 0,
            lastErrorCode: normalizeString(verificationResult.reason),
            lastErrorMessage:
              normalizeString(verificationResult.metadata?.error) ||
              normalizeString(verificationResult.reason),
            stateAt: exceptionAt,
            updatedAt: exceptionAt,
          }),
        );
        summary.exceptionCount += 1;
        records.push(finalRecord);
        continue;
      }

      if (!candidate.eligible || !key.settlementId) {
        finalRecord = await Promise.resolve(
          reconciliationStore.markState(key.recordId, {
            state: "exception",
            reason: key.settlementId ? sourceReason : "invalid_settlement_identity",
            verificationStatus: verificationResult.verificationStatus,
            verificationReason: normalizeString(verificationResult.reason),
            verificationCheckedAt: verificationResult.verifiedAt,
            settlementId: key.settlementId,
            attemptCount: existingAttemptCount,
            retryable: false,
            nextRetryAt: 0,
            stateAt: now,
            updatedAt: now,
          }),
        );
        summary.exceptionCount += 1;
        records.push(finalRecord);
        continue;
      }

      finalRecord = await Promise.resolve(
        reconciliationStore.markState(key.recordId, {
          state: "eligible",
          reason: "eligible",
          verificationStatus: verificationResult.verificationStatus,
          verificationReason: normalizeString(verificationResult.reason),
          verificationCheckedAt: verificationResult.verifiedAt,
          settlementId: key.settlementId,
          attemptCount: existingAttemptCount,
          retryable: false,
          nextRetryAt: 0,
          stateAt: now,
          updatedAt: now,
        }),
      );
      summary.eligibleCount += 1;

      if (!autoRecord || !recordHandler || typeof recordHandler.recordSettlement !== "function") {
        records.push(finalRecord);
        continue;
      }

        finalRecord = await Promise.resolve(
          reconciliationStore.markState(key.recordId, {
            state: "submitted",
            reason: "bridge_submission_pending",
            verificationStatus: verificationResult.verificationStatus,
            verificationReason: normalizeString(verificationResult.reason),
            verificationCheckedAt: verificationResult.verifiedAt,
            settlementId: key.settlementId,
            attemptCount: existingAttemptCount,
            retryable: true,
            nextRetryAt: nowMs() + retrySubmittedAfterMs,
            stateAt: nowMs(),
            updatedAt: nowMs(),
          }),
        );
      summary.submittedCount += 1;

      try {
        const result = await Promise.resolve(
          recordHandler.recordSettlement({
            ...candidate,
            settlementId: key.settlementId,
          }),
        );
        const recordedAt = Number(result?.recordedAt || nowMs());

        finalRecord = await Promise.resolve(
          reconciliationStore.markState(key.recordId, {
            state: "recorded",
            reason: normalizeString(result?.reason) || "receipt_recorded",
            verificationStatus: verificationResult.verificationStatus,
            verificationReason: normalizeString(verificationResult.reason),
            verificationCheckedAt: verificationResult.verifiedAt,
            settlementId: normalizeString(result?.settlementId || key.settlementId),
            bridgeTxHash: normalizeString(result?.bridgeTxHash),
            bridgeBlockNumber: Number(result?.bridgeBlockNumber || 0),
            attemptCount: existingAttemptCount,
            retryable: false,
            nextRetryAt: 0,
            stateAt: recordedAt,
            updatedAt: recordedAt,
          }),
        );

        if (paymentLedger?.markReconciliationState) {
          await Promise.resolve(
            paymentLedger.markReconciliationState(candidate.requestId, {
              status: "recorded",
              reason: normalizeString(result?.reason) || "receipt_recorded",
              settlementId: normalizeString(result?.settlementId || key.settlementId),
              recordedAt,
              updatedAt: recordedAt,
            }),
          );
        }

        summary.recordedCount += 1;
      } catch (error) {
        finalRecord = await Promise.resolve(
          reconciliationStore.markState(key.recordId, {
            state: "exception",
            reason: normalizeString(error?.code) || "bridge_record_failed",
            verificationStatus: verificationResult.verificationStatus,
            verificationReason: normalizeString(verificationResult.reason),
            verificationCheckedAt: verificationResult.verifiedAt,
            settlementId: key.settlementId,
            attemptCount: existingAttemptCount,
            retryable: true,
            nextRetryAt: nowMs() + retryExceptionAfterMs,
            lastErrorCode: normalizeString(error?.code),
            lastErrorMessage: normalizeString(error?.message),
            stateAt: nowMs(),
            updatedAt: nowMs(),
          }),
        );
        summary.exceptionCount += 1;
      }

      records.push(finalRecord);
    }

    return {
      status: "ok",
      statusCode: 200,
      filters: {
        invoiceId: normalizeString(filters.invoiceId),
        limit: normalizePositiveInteger(filters.limit, 0),
        autoRecord,
        retryExceptions,
      },
      summary,
      authority: RECONCILIATION_AUTHORITY,
      records,
    };
  }

  return {
    buildSettlementId: buildPaymentSettlementId,
    chainId,
    executorAddress,
    getSnapshot,
    listRecords,
    paymentLedger,
    reconciliationStore,
    verifyCandidate,
    runOnce,
  };
}

module.exports = {
  buildPaymentSettlementId,
  createEvmExternalSettlementRecorder,
  createEvmPaymentReconciliationVerifier,
  createPaymentReconciliationWorker,
};
