const {
  createReceiptAccessPolicy,
  evaluateReceiptAccess,
  evaluateViewerContext,
  projectReceipt,
  ReceiptRoles,
} = require("./mock-receipt-policy.cjs");
const {
  createReceiptGrantChallengeMessage,
  createReceiptGrantChallengeToken,
  parseReceiptGrantChallengeToken,
  verifyReceiptGrantChallengeSignature,
} = require("./mock-receipt-challenges.cjs");
const { createReceiptAccessGrantToken } = require("./mock-receipt-grants.cjs");
const {
  MemoryReceiptRegistry,
  sharedMockReceiptRegistry,
} = require("./mock-receipt-registry.cjs");
const {
  MemoryReceiptGrantChallengeRegistry,
  sharedMockReceiptGrantChallengeRegistry,
} = require("./mock-receipt-challenge-registry.cjs");

const RECEIPT_CANONICAL_SCHEMA_VERSION = 3;
const RECEIPT_PROJECTION_SCHEMA_VERSION = 1;
const RECEIPT_SOURCE_OF_TRUTH = {
  mode: "mock-api",
  authority: "vite-mock-service",
  readiness: "shared-adapter-ready",
};

function normalizeReceipt(receipt) {
  if (!receipt || typeof receipt !== "object") {
    return null;
  }

  const quoteId = String(receipt.quoteId || "");

  if (!quoteId) {
    return null;
  }

  return {
    id: String(receipt.id || `receipt:${quoteId}`),
    quoteId,
    merchant: String(receipt.merchant || ""),
    payer: String(receipt.payer || ""),
    status: String(receipt.status || "Settled"),
    settledAt: Number(receipt.settledAt || 0) || Date.now(),
    txHash: String(receipt.txHash || ""),
    paymentLink: String(receipt.paymentLink || ""),
    amount: receipt.amount ?? null,
    currency: String(receipt.currency || "ETH"),
    access: {
      merchant: String(receipt.access?.merchant || "full"),
      payer: String(receipt.access?.payer || "full"),
      auditor: String(receipt.access?.auditor || "limited"),
    },
    meta: {
      version: RECEIPT_CANONICAL_SCHEMA_VERSION,
      schemaVersion: RECEIPT_CANONICAL_SCHEMA_VERSION,
      recordType: "canonical-receipt",
      projectionVersion: RECEIPT_PROJECTION_SCHEMA_VERSION,
      createdAt: Number(receipt.meta?.createdAt || Date.now()),
      source: String(receipt.meta?.source || "bootstrap"),
      sourceOfTruth: {
        ...(receipt.meta?.sourceOfTruth && typeof receipt.meta.sourceOfTruth === "object"
          ? receipt.meta.sourceOfTruth
          : {}),
        ...RECEIPT_SOURCE_OF_TRUTH,
      },
      eventRef: {
        ...(receipt.meta?.eventRef && typeof receipt.meta.eventRef === "object"
          ? receipt.meta.eventRef
          : {}),
        kind: "quote-settled",
        txHash: String(receipt.txHash || ""),
        settledAt: Number(receipt.settledAt || 0) || Date.now(),
      },
    },
  };
}

function sortReceipts(receipts) {
  return [...receipts].sort((left, right) => Number(right.settledAt) - Number(left.settledAt));
}

function createDeniedResult(decision) {
  return {
    status: "denied",
    statusCode: 403,
    error: "Receipt access denied.",
    code: decision.code,
    accessPolicy: createReceiptAccessPolicy(decision),
  };
}

function createNotFoundResult() {
  return {
    status: "not_found",
    statusCode: 404,
    error: "Receipt not found",
  };
}

function createCustomDeniedResult(role, code, reason, requiredContext = ["accessToken"]) {
  return {
    status: "denied",
    statusCode: 403,
    error: "Receipt access denied.",
    code,
    accessPolicy: createReceiptAccessPolicy({
      status: "denied",
      role,
      effect: "denied",
      code,
      reason,
      requiredContext,
    }),
  };
}

function isReceiptRegistryAdapter(adapter) {
  return (
    adapter &&
    typeof adapter === "object" &&
    typeof adapter.save === "function" &&
    typeof adapter.get === "function" &&
    typeof adapter.values === "function" &&
    typeof adapter.snapshot === "function" &&
    typeof adapter.clear === "function"
  );
}

function isReceiptGrantChallengeRegistryAdapter(adapter) {
  return (
    adapter &&
    typeof adapter === "object" &&
    typeof adapter.remember === "function" &&
    typeof adapter.get === "function" &&
    typeof adapter.consume === "function" &&
    typeof adapter.snapshot === "function" &&
    typeof adapter.clear === "function"
  );
}

class MockReceiptService {
  constructor({
    registry,
    receiptRegistryAdapter,
    challengeRegistry,
    challengeRegistryAdapter,
  } = {}) {
    this.receiptRegistryAdapter = isReceiptRegistryAdapter(receiptRegistryAdapter)
      ? receiptRegistryAdapter
      : new MemoryReceiptRegistry({
          records: registry instanceof Map ? registry : undefined,
        });
    this.challengeRegistryAdapter =
      isReceiptGrantChallengeRegistryAdapter(challengeRegistryAdapter)
        ? challengeRegistryAdapter
        : new MemoryReceiptGrantChallengeRegistry({
            records: challengeRegistry instanceof Map ? challengeRegistry : undefined,
          });
  }

  async pruneReceiptGrantChallenges(now = Date.now()) {
    return await Promise.resolve(this.challengeRegistryAdapter.prune(now));
  }

  async rememberReceiptGrantChallenge(challengeToken) {
    const parsedChallenge = parseReceiptGrantChallengeToken(challengeToken);

    if (!parsedChallenge?.raw) {
      return null;
    }

    return (
      (await Promise.resolve(this.challengeRegistryAdapter.remember(parsedChallenge))) ||
      parsedChallenge
    );
  }

  async getReceiptGrantChallengeRecord(challengeToken) {
    return await Promise.resolve(this.challengeRegistryAdapter.get(challengeToken));
  }

  async consumeReceiptGrantChallenge(challengeToken, context = {}, consumedAt = Date.now()) {
    return await Promise.resolve(
      this.challengeRegistryAdapter.consume(challengeToken, context, consumedAt),
    );
  }

  async markReceiptGrantChallengeDenial(code) {
    await Promise.resolve(this.challengeRegistryAdapter.markDenial(code));
  }

  async getReceiptGrantChallengeSnapshot({ includeRecords = false } = {}) {
    const snapshot = await Promise.resolve(
      this.challengeRegistryAdapter.snapshot({ includeRecords }),
    );
    return {
      ...snapshot,
      storage:
        typeof this.challengeRegistryAdapter.describe === "function"
          ? this.challengeRegistryAdapter.describe()
          : { kind: "custom" },
    };
  }

  async getReceiptRegistrySnapshot({ includeRecords = false } = {}) {
    const snapshot = await Promise.resolve(
      this.receiptRegistryAdapter.snapshot({ includeRecords }),
    );
    return {
      ...snapshot,
      storage:
        typeof this.receiptRegistryAdapter.describe === "function"
          ? this.receiptRegistryAdapter.describe()
          : { kind: "custom" },
    };
  }

  async saveReceipt(receipt) {
    const canonicalReceipt = normalizeReceipt(receipt);

    if (!canonicalReceipt) {
      return null;
    }

    return await Promise.resolve(this.receiptRegistryAdapter.save(canonicalReceipt));
  }

  async listReceipts(role = ReceiptRoles.MERCHANT, accessContext = {}) {
    const viewerEvaluation = evaluateViewerContext(role, accessContext);

    if (viewerEvaluation.decision.status !== "allowed") {
      return createDeniedResult(viewerEvaluation.decision);
    }

    const receipts = sortReceipts(await Promise.resolve(this.receiptRegistryAdapter.values()))
      .map((receipt) => {
        const decision = evaluateReceiptAccess(receipt, viewerEvaluation.viewerContext);
        return projectReceipt(receipt, viewerEvaluation.viewerContext, decision);
      })
      .filter(Boolean);

    return {
      status: "ok",
      statusCode: 200,
      receipts,
    };
  }

  async getReceiptByQuoteId(quoteId, role = ReceiptRoles.MERCHANT, accessContext = {}) {
    const normalizedQuoteId = String(quoteId || "");

    if (!normalizedQuoteId) {
      return createNotFoundResult();
    }

    const receipt =
      (await Promise.resolve(this.receiptRegistryAdapter.get(normalizedQuoteId))) || null;

    if (!receipt) {
      return createNotFoundResult();
    }

    const viewerEvaluation = evaluateViewerContext(role, accessContext);

    if (viewerEvaluation.decision.status !== "allowed") {
      return createDeniedResult(viewerEvaluation.decision);
    }

    const decision = evaluateReceiptAccess(receipt, viewerEvaluation.viewerContext);

    if (decision.status !== "allowed") {
      return createDeniedResult(decision);
    }

    return {
      status: "ok",
      statusCode: 200,
      receipt: projectReceipt(receipt, viewerEvaluation.viewerContext, decision),
    };
  }

  async issueReceiptGrantChallenge(quoteId, role = ReceiptRoles.MERCHANT, accessContext = {}) {
    const normalizedQuoteId = String(quoteId || "");

    if (!normalizedQuoteId) {
      return createNotFoundResult();
    }

    const receipt =
      (await Promise.resolve(this.receiptRegistryAdapter.get(normalizedQuoteId))) || null;

    if (!receipt) {
      return createNotFoundResult();
    }

    const viewerEvaluation = evaluateViewerContext(role, accessContext);

    if (viewerEvaluation.decision.status !== "allowed") {
      return createDeniedResult(viewerEvaluation.decision);
    }

    const decision = evaluateReceiptAccess(receipt, viewerEvaluation.viewerContext);

    if (decision.status !== "allowed") {
      return createDeniedResult(decision);
    }

    if (decision.effect !== "full") {
      return {
        status: "ok",
        statusCode: 200,
        challengeToken: "",
        message: "",
      };
    }

    const challengeToken = createReceiptGrantChallengeToken({
      role: viewerEvaluation.viewerContext.role,
      viewer: viewerEvaluation.viewerContext.token.viewer,
      quoteId: normalizedQuoteId,
      chainId: viewerEvaluation.viewerContext.token.chainId || "offchain",
      actorId: viewerEvaluation.viewerContext.token.viewer || "",
      permitHash: accessContext.permitHash || "",
      sessionId: accessContext.sessionId || "",
      deviceFingerprint: accessContext.deviceFingerprint || "",
    });
    const rememberedChallenge = await this.rememberReceiptGrantChallenge(challengeToken);

    return {
      status: "ok",
      statusCode: 200,
      challengeToken: rememberedChallenge?.raw || challengeToken,
      message: createReceiptGrantChallengeMessage(rememberedChallenge?.raw || challengeToken),
    };
  }

  async issueReceiptGrant(quoteId, role = ReceiptRoles.MERCHANT, accessContext = {}) {
    const normalizedQuoteId = String(quoteId || "");

    if (!normalizedQuoteId) {
      return createNotFoundResult();
    }

    const receipt =
      (await Promise.resolve(this.receiptRegistryAdapter.get(normalizedQuoteId))) || null;

    if (!receipt) {
      return createNotFoundResult();
    }

    const viewerEvaluation = evaluateViewerContext(role, accessContext);

    if (viewerEvaluation.decision.status !== "allowed") {
      return createDeniedResult(viewerEvaluation.decision);
    }

    const decision = evaluateReceiptAccess(receipt, viewerEvaluation.viewerContext);

    if (decision.status !== "allowed") {
      return createDeniedResult(decision);
    }

    if (decision.effect !== "full") {
      return {
        status: "ok",
        statusCode: 200,
        grant: "",
      };
    }

    const challengeVerification = verifyReceiptGrantChallengeSignature({
      challengeToken: accessContext.challengeToken,
      challengeSignature: accessContext.challengeSignature,
      expectedViewer: viewerEvaluation.viewerContext.token.viewer,
    });

    if (!accessContext.challengeToken || !accessContext.challengeSignature) {
      return createCustomDeniedResult(
        viewerEvaluation.viewerContext.role,
        "receipt-grant-proof-required",
        "A signed receipt grant challenge is required before this grant can be issued.",
        ["challengeToken", "challengeSignature"],
      );
    }

    if (challengeVerification.parsedChallenge?.expired) {
      return createCustomDeniedResult(
        viewerEvaluation.viewerContext.role,
        "receipt-challenge-expired",
        "Receipt grant challenge has expired.",
        ["challengeToken"],
      );
    }

    if (!challengeVerification.parsedChallenge?.valid) {
      return createCustomDeniedResult(
        viewerEvaluation.viewerContext.role,
        "receipt-challenge-invalid",
        "Receipt grant challenge is invalid.",
        ["challengeToken"],
      );
    }

    if (!challengeVerification.valid) {
      return createCustomDeniedResult(
        viewerEvaluation.viewerContext.role,
        "receipt-challenge-signature-invalid",
        "Receipt grant challenge signature does not match the viewer wallet.",
        ["challengeSignature"],
      );
    }

    if (String(challengeVerification.parsedChallenge.role || "") !== viewerEvaluation.viewerContext.role) {
      return createCustomDeniedResult(
        viewerEvaluation.viewerContext.role,
        "receipt-challenge-role-mismatch",
        "Receipt grant challenge role does not match the requested projection role.",
        ["challengeToken"],
      );
    }

    if (
      String(challengeVerification.parsedChallenge.quoteId || "") !== normalizedQuoteId ||
      String(challengeVerification.parsedChallenge.chainId || "") !==
        String(viewerEvaluation.viewerContext.token.chainId || "")
    ) {
      return createCustomDeniedResult(
        viewerEvaluation.viewerContext.role,
        "receipt-challenge-context-mismatch",
        "Receipt grant challenge does not match the requested quote context.",
        ["challengeToken"],
      );
    }

    const challengeRecord = await this.getReceiptGrantChallengeRecord(
      challengeVerification.parsedChallenge.raw,
    );

    if (!challengeRecord) {
      await this.markReceiptGrantChallengeDenial("receipt-challenge-unrecognized");
      return createCustomDeniedResult(
        viewerEvaluation.viewerContext.role,
        "receipt-challenge-unrecognized",
        "Receipt grant challenge was not issued by the active service session.",
        ["challengeToken"],
      );
    }

    if (Number(challengeRecord.consumedAt || 0) > 0) {
      await this.markReceiptGrantChallengeDenial("receipt-challenge-consumed");
      return createCustomDeniedResult(
        viewerEvaluation.viewerContext.role,
        "receipt-challenge-consumed",
        "Receipt grant challenge has already been used. Request a fresh challenge.",
        ["challengeToken"],
      );
    }

    if (
      String(challengeRecord.role || "") !== viewerEvaluation.viewerContext.role ||
      String(challengeRecord.viewer || "") !==
        String(viewerEvaluation.viewerContext.token.viewer || "") ||
      String(challengeRecord.quoteId || "") !== normalizedQuoteId ||
      String(challengeRecord.chainId || "") !==
        String(viewerEvaluation.viewerContext.token.chainId || "") ||
      String(challengeRecord.nonce || "") !==
        String(challengeVerification.parsedChallenge.nonce || "")
    ) {
      return createCustomDeniedResult(
        viewerEvaluation.viewerContext.role,
        "receipt-challenge-context-mismatch",
        "Receipt grant challenge state does not match the requested quote context.",
        ["challengeToken"],
      );
    }

    await this.consumeReceiptGrantChallenge(
      challengeVerification.parsedChallenge.raw,
      {
        actorId: viewerEvaluation.viewerContext.token.viewer || "",
        permitHash: accessContext.permitHash || "",
        sessionId: accessContext.sessionId || "",
        deviceFingerprint: accessContext.deviceFingerprint || "",
      },
    );

    return {
      status: "ok",
      statusCode: 200,
      grant: createReceiptAccessGrantToken({
        role: viewerEvaluation.viewerContext.role,
        viewer: viewerEvaluation.viewerContext.token.viewer,
        quoteId: normalizedQuoteId,
        chainId: viewerEvaluation.viewerContext.token.chainId || "offchain",
      }),
    };
  }

  async reset() {
    await Promise.resolve(this.receiptRegistryAdapter.clear());
    await Promise.resolve(this.challengeRegistryAdapter.clear());
  }
}

const sharedMockReceiptService = new MockReceiptService({
  receiptRegistryAdapter: sharedMockReceiptRegistry,
  challengeRegistryAdapter: sharedMockReceiptGrantChallengeRegistry,
});

module.exports = {
  MockReceiptService,
  sharedMockReceiptRegistry,
  sharedMockReceiptGrantChallengeRegistry,
  sharedMockReceiptService,
};
