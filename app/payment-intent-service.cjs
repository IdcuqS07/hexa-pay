const { ethers } = require("ethers");
const {
  buildIntentDomain,
  verifyIntentSignature,
  hashRequestId,
} = require("./payment-intent-signature.cjs");

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

function createMemoryExecutionDedupeStore() {
  const keys = new Map();

  return {
    async has(key) {
      return keys.has(String(key));
    },
    async put(key, value) {
      keys.set(String(key), value);
      return value;
    },
    async get(key) {
      return keys.get(String(key)) || null;
    },
  };
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
    options.executionDedupeStore || createMemoryExecutionDedupeStore();
  const executor = options.executor;
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

    return {
      challengeId: challengeToken,
      requestId: input.requestId,
      receiptId: input.receiptId,
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
  }

  async function executeSignedIntent({ intent, signature }) {
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
    if (await executionDedupeStore.has(dedupeKey)) {
      const error = new Error("Duplicate execution.");
      error.code = "duplicate_execution";
      throw error;
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

    if (!executor) {
      const error = new Error("No executor configured.");
      error.code = "executor_missing";
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
      if (typeof challengeRegistry.releaseConsume === "function") {
        await challengeRegistry.releaseConsume(intent.challengeId, consumeContext).catch(() => null);
      }
      throw error;
    }

    await executionDedupeStore.put(dedupeKey, {
      intentHash,
      requestIdHash,
      execution,
      createdAt: new Date().toISOString(),
    });

    const commitResult =
      typeof challengeRegistry.commitConsume === "function"
        ? await challengeRegistry.commitConsume(intent.challengeId, consumeContext)
        : reserveResult;

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

  return {
    domain,
    createChallenge,
    executeSignedIntent,
  };
}

module.exports = {
  createPaymentIntentService,
  createMemoryExecutionDedupeStore,
  createEvmExecutor,
};
