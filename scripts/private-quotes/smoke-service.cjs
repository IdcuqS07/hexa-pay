#!/usr/bin/env node

const assert = require("node:assert/strict");
const os = require("os");
const path = require("path");
const { Wallet } = require("ethers");

const {
  MockReceiptService,
} = require("../../app/mock-receipt-service.cjs");
const {
  ReceiptRoles,
} = require("../../app/mock-receipt-policy.cjs");
const {
  createReceiptAccessGrantToken,
  parseReceiptAccessGrantToken,
  RECEIPT_GRANT_ISSUER,
} = require("../../app/mock-receipt-grants.cjs");
const {
  parseReceiptGrantChallengeToken,
  RECEIPT_CHALLENGE_ISSUER,
} = require("../../app/mock-receipt-challenges.cjs");
const {
  FileReceiptRegistry,
  StoreBackedReceiptRegistry,
} = require("../../app/mock-receipt-registry.cjs");
const {
  FileReceiptGrantChallengeRegistry,
  StoreBackedReceiptGrantChallengeRegistry,
} = require("../../app/mock-receipt-challenge-registry.cjs");
const {
  MemoryJsonStateStore,
} = require("../../app/mock-receipt-state-store.cjs");

function createViewerToken(role, viewer, chainId = "31337") {
  return `receipt-viewer:${role}:${String(viewer).toLowerCase()}:${chainId}`;
}

const MERCHANT_WALLET = new Wallet(
  "0x1000000000000000000000000000000000000000000000000000000000000001",
);
const PAYER_WALLET = new Wallet(
  "0x2000000000000000000000000000000000000000000000000000000000000002",
);

function createSampleReceipt() {
  return {
    quoteId: "quote-smoke-service",
    merchant: MERCHANT_WALLET.address,
    payer: PAYER_WALLET.address,
    status: "Settled",
    settledAt: 1713537000000,
    txHash: "0xfeedfacefeedfacefeedfacefeedfacefeedfacefeedfacefeedfacefeedface",
    paymentLink: "/pay.html?id=quote-smoke-service",
    amount: "1250",
    currency: "USDC",
  };
}

function reloadReceiptTokenParsers() {
  [
    "../../app/mock-receipt-grants.cjs",
    "../../app/mock-receipt-challenges.cjs",
    "../../app/mock-receipt-issuer.cjs",
  ].forEach((modulePath) => {
    delete require.cache[require.resolve(modulePath)];
  });

  return {
    parseGrantAfterReload: require("../../app/mock-receipt-grants.cjs").parseReceiptAccessGrantToken,
    parseChallengeAfterReload:
      require("../../app/mock-receipt-challenges.cjs").parseReceiptGrantChallengeToken,
  };
}

async function issueSignedGrant(service, receipt, role, wallet) {
  const accessContext = {
    token: createViewerToken(role, wallet.address),
  };
  const challengeResult = await service.issueReceiptGrantChallenge(
    receipt.quoteId,
    role,
    accessContext,
  );

  assert.equal(challengeResult.status, "ok");
  assert.ok(challengeResult.challengeToken);
  assert.ok(challengeResult.message);
  assert.equal(parseReceiptGrantChallengeToken(challengeResult.challengeToken)?.issuer, RECEIPT_CHALLENGE_ISSUER.issuer);
  assert.equal(parseReceiptGrantChallengeToken(challengeResult.challengeToken)?.keyId, RECEIPT_CHALLENGE_ISSUER.keyId);

  const challengeSignature = await wallet.signMessage(challengeResult.message);
  const grantResult = await service.issueReceiptGrant(receipt.quoteId, role, {
    ...accessContext,
    challengeToken: challengeResult.challengeToken,
    challengeSignature,
  });

  return {
    challengeResult,
    challengeSignature,
    grantResult,
  };
}

function assertAllowedResult(result, expectedVisibility) {
  assert.equal(result.status, "ok");
  assert.equal(result.statusCode, 200);
  assert.ok(result.receipt);
  assert.equal(result.receipt.visibility, expectedVisibility);
}

class ConflictOnceStateStore extends MemoryJsonStateStore {
  constructor(options = {}) {
    super(options);
    this.conflictsRemaining = 1;
  }

  async readEntry() {
    return super.readEntry();
  }

  async writeEntry(value, options = {}) {
    if (this.conflictsRemaining > 0) {
      this.conflictsRemaining -= 1;
      const currentEntry = await this.readEntry();
      return {
        ok: false,
        conflict: true,
        ...currentEntry,
      };
    }

    return super.writeEntry(value, options);
  }

  async clearEntry(options = {}) {
    return super.clearEntry(options);
  }
}

async function main() {
  const receiptRegistryFilePath = path.join(
    os.tmpdir(),
    `hexapay-receipts-${process.pid}-${Date.now()}.json`,
  );
  const registryFilePath = path.join(
    os.tmpdir(),
    `hexapay-receipt-challenges-${process.pid}-${Date.now()}.json`,
  );
  const sharedReceiptRegistry = new FileReceiptRegistry({
    filePath: receiptRegistryFilePath,
  });
  const sharedChallengeRegistry = new FileReceiptGrantChallengeRegistry({
    filePath: registryFilePath,
  });
  const service = new MockReceiptService({
    receiptRegistryAdapter: sharedReceiptRegistry,
    challengeRegistryAdapter: sharedChallengeRegistry,
  });
  try {
    const receipt = await service.saveReceipt(createSampleReceipt());

    assert.ok(receipt);
    assert.equal(receipt.meta.schemaVersion, 3);
    assert.equal(receipt.meta.recordType, "canonical-receipt");
    assert.equal(receipt.meta.sourceOfTruth.mode, "mock-api");
    assert.equal(receipt.meta.eventRef.kind, "quote-settled");
    const receiptSnapshot = await service.getReceiptRegistrySnapshot({ includeRecords: true });
    assert.equal(receiptSnapshot.status, "ok");
    assert.equal(receiptSnapshot.storage?.kind, "file");
    assert.equal(receiptSnapshot.storage?.path, receiptRegistryFilePath);
    assert.ok(receiptSnapshot.storage?.revision >= 1);
    assert.equal(receiptSnapshot.summary.retainedCount, 1);
    assert.equal(receiptSnapshot.summary.savedCount, 1);
    assert.equal(receiptSnapshot.summary.lastSavedQuoteId, receipt.quoteId);
    assert.equal(receiptSnapshot.records.length, 1);
    assert.equal(receiptSnapshot.records[0].quoteId, receipt.quoteId);

    const merchantGrantIssued = await issueSignedGrant(
      service,
      receipt,
      ReceiptRoles.MERCHANT,
      MERCHANT_WALLET,
    );
    const merchantGrantResult = merchantGrantIssued.grantResult;
    assert.equal(merchantGrantResult.status, "ok");
    assert.ok(merchantGrantResult.grant);
    assert.equal(
      parseReceiptAccessGrantToken(merchantGrantResult.grant)?.issuer,
      RECEIPT_GRANT_ISSUER.issuer,
    );
    assert.equal(
      parseReceiptAccessGrantToken(merchantGrantResult.grant)?.keyId,
      RECEIPT_GRANT_ISSUER.keyId,
    );

    const payerGrantIssued = await issueSignedGrant(
      service,
      receipt,
      ReceiptRoles.PAYER,
      PAYER_WALLET,
    );
    const payerGrantResult = payerGrantIssued.grantResult;
    assert.equal(payerGrantResult.status, "ok");
    assert.ok(payerGrantResult.grant);

    const { parseGrantAfterReload, parseChallengeAfterReload } = reloadReceiptTokenParsers();
    assert.equal(parseGrantAfterReload(merchantGrantResult.grant)?.valid, true);
    assert.equal(
      parseChallengeAfterReload(merchantGrantIssued.challengeResult.challengeToken)?.valid,
      true,
    );

    const deniedConsumedChallenge = await service.issueReceiptGrant(
      "quote-smoke-service",
      ReceiptRoles.MERCHANT,
      {
        token: createViewerToken(ReceiptRoles.MERCHANT, receipt.merchant),
        challengeToken: merchantGrantIssued.challengeResult.challengeToken,
        challengeSignature: merchantGrantIssued.challengeSignature,
      },
    );
    assert.equal(deniedConsumedChallenge.status, "denied");
    assert.equal(deniedConsumedChallenge.code, "receipt-challenge-consumed");

    const consumedSnapshot = await service.getReceiptGrantChallengeSnapshot({
      includeRecords: true,
    });
    assert.equal(consumedSnapshot.status, "ok");
    assert.equal(consumedSnapshot.storage?.kind, "file");
    assert.equal(consumedSnapshot.storage?.path, registryFilePath);
    assert.ok(consumedSnapshot.storage?.revision >= 1);
    assert.equal(consumedSnapshot.summary.issuedCount, 2);
    assert.equal(consumedSnapshot.summary.consumedCount, 2);
    assert.equal(consumedSnapshot.summary.deniedConsumedCount, 1);
    assert.equal(consumedSnapshot.summary.activeCount, 0);
    assert.equal(consumedSnapshot.summary.consumedRetainedCount, 2);
    assert.equal(consumedSnapshot.records.length, 2);
    assert.ok(consumedSnapshot.records.every((record) => record.state === "consumed"));

    const mirroredService = new MockReceiptService({
      receiptRegistryAdapter: new FileReceiptRegistry({
        filePath: receiptRegistryFilePath,
      }),
      challengeRegistryAdapter: new FileReceiptGrantChallengeRegistry({
        filePath: registryFilePath,
      }),
    });
    const mirroredReceiptSnapshot = await mirroredService.getReceiptRegistrySnapshot({
      includeRecords: true,
    });
    assert.equal(mirroredReceiptSnapshot.storage?.kind, "file");
    assert.equal(mirroredReceiptSnapshot.storage?.path, receiptRegistryFilePath);
    assert.equal(mirroredReceiptSnapshot.storage?.revision, receiptSnapshot.storage?.revision);
    assert.equal(mirroredReceiptSnapshot.summary.retainedCount, 1);
    assert.equal(mirroredReceiptSnapshot.records.length, 1);
    assert.equal(mirroredReceiptSnapshot.records[0].quoteId, receipt.quoteId);
    const mirroredReceipt = await mirroredService.getReceiptByQuoteId(
      "quote-smoke-service",
      ReceiptRoles.MERCHANT,
      {
        token: createViewerToken(ReceiptRoles.MERCHANT, receipt.merchant),
        grant: merchantGrantResult.grant,
      },
    );
    assertAllowedResult(mirroredReceipt, "full");
    const mirroredSnapshot = await mirroredService.getReceiptGrantChallengeSnapshot({
      includeRecords: true,
    });
    assert.equal(mirroredSnapshot.storage?.kind, "file");
    assert.equal(mirroredSnapshot.storage?.path, registryFilePath);
    assert.equal(mirroredSnapshot.storage?.revision, consumedSnapshot.storage?.revision);
    assert.equal(mirroredSnapshot.summary.issuedCount, consumedSnapshot.summary.issuedCount);
    assert.equal(mirroredSnapshot.summary.consumedCount, consumedSnapshot.summary.consumedCount);
    assert.equal(mirroredSnapshot.records.length, consumedSnapshot.records.length);
    const mirroredDeniedConsumed = await mirroredService.issueReceiptGrant(
      "quote-smoke-service",
      ReceiptRoles.MERCHANT,
      {
        token: createViewerToken(ReceiptRoles.MERCHANT, receipt.merchant),
        challengeToken: merchantGrantIssued.challengeResult.challengeToken,
        challengeSignature: merchantGrantIssued.challengeSignature,
      },
    );
    assert.equal(mirroredDeniedConsumed.status, "denied");
    assert.equal(mirroredDeniedConsumed.code, "receipt-challenge-consumed");
    const mirroredPostDenySnapshot =
      await mirroredService.getReceiptGrantChallengeSnapshot();
    assert.equal(mirroredPostDenySnapshot.summary.deniedConsumedCount, 2);

    const sharedReceiptStateStore = new MemoryJsonStateStore({
      label: "shared-backend",
    });
    const sharedChallengeStateStore = new MemoryJsonStateStore({
      label: "shared-backend",
    });
    const backendWriterService = new MockReceiptService({
      receiptRegistryAdapter: new StoreBackedReceiptRegistry({
        stateStore: sharedReceiptStateStore,
      }),
      challengeRegistryAdapter: new StoreBackedReceiptGrantChallengeRegistry({
        stateStore: sharedChallengeStateStore,
      }),
    });
    const backendReaderService = new MockReceiptService({
      receiptRegistryAdapter: new StoreBackedReceiptRegistry({
        stateStore: sharedReceiptStateStore,
      }),
      challengeRegistryAdapter: new StoreBackedReceiptGrantChallengeRegistry({
        stateStore: sharedChallengeStateStore,
      }),
    });
    const backendReceipt = await backendWriterService.saveReceipt({
      ...createSampleReceipt(),
      quoteId: "quote-shared-store",
      paymentLink: "/pay.html?id=quote-shared-store",
    });
    const backendGrantIssued = await issueSignedGrant(
      backendWriterService,
      backendReceipt,
      ReceiptRoles.MERCHANT,
      MERCHANT_WALLET,
    );
    const backendReceiptSnapshot = await backendReaderService.getReceiptRegistrySnapshot({
      includeRecords: true,
    });
    assert.equal(backendReceiptSnapshot.storage?.kind, "memory");
    assert.equal(backendReceiptSnapshot.storage?.label, "shared-backend");
    assert.ok(backendReceiptSnapshot.storage?.revision >= 1);
    assert.equal(backendReceiptSnapshot.summary.retainedCount, 1);
    assert.equal(backendReceiptSnapshot.records[0].quoteId, "quote-shared-store");
    const backendChallengeSnapshot =
      await backendReaderService.getReceiptGrantChallengeSnapshot({
      includeRecords: true,
    });
    assert.equal(backendChallengeSnapshot.storage?.kind, "memory");
    assert.equal(backendChallengeSnapshot.storage?.label, "shared-backend");
    assert.ok(backendChallengeSnapshot.storage?.revision >= 1);
    assert.equal(backendChallengeSnapshot.summary.issuedCount, 1);
    assert.equal(backendChallengeSnapshot.summary.consumedCount, 1);
    const backendSharedView = await backendReaderService.getReceiptByQuoteId(
      "quote-shared-store",
      ReceiptRoles.MERCHANT,
      {
        token: createViewerToken(ReceiptRoles.MERCHANT, backendReceipt.merchant),
        grant: backendGrantIssued.grantResult.grant,
      },
    );
    assertAllowedResult(backendSharedView, "full");

    const conflictReceiptStateStore = new ConflictOnceStateStore({
      label: "conflict-retry",
    });
    const conflictReceiptRegistry = new StoreBackedReceiptRegistry({
      stateStore: conflictReceiptStateStore,
    });
    const conflictSavedReceipt = await conflictReceiptRegistry.save({
      ...createSampleReceipt(),
      quoteId: "quote-conflict-retry",
    });
    assert.equal(conflictSavedReceipt.quoteId, "quote-conflict-retry");
    const conflictReceiptSnapshot = await conflictReceiptRegistry.snapshot({
      includeRecords: true,
    });
    assert.equal(conflictReceiptSnapshot.records.length, 1);
    assert.equal(conflictReceiptSnapshot.records[0].quoteId, "quote-conflict-retry");
    assert.equal(conflictReceiptRegistry.describe().revision, 1);

    const merchantResult = await service.getReceiptByQuoteId(
      "quote-smoke-service",
      ReceiptRoles.MERCHANT,
      {
        token: createViewerToken(ReceiptRoles.MERCHANT, receipt.merchant),
        grant: merchantGrantResult.grant,
      },
    );
    assertAllowedResult(merchantResult, "full");
    assert.equal(merchantResult.receipt.amount, null);
    assert.equal(merchantResult.receipt.paymentLink, "/pay.html?id=quote-smoke-service");
    assert.equal(merchantResult.receipt.disclosureMode, "policy-enforced");
    assert.equal(merchantResult.receipt.fieldDisclosure.amount.classification, "permit-required");
    assert.equal(merchantResult.receipt.fieldDisclosure.amount.state, "withheld");
    assert.equal(
      merchantResult.receipt.fieldDisclosure.paymentLink.classification,
      "grant-required",
    );
    assert.equal(merchantResult.receipt.fieldDisclosure.paymentLink.state, "visible");
    assert.equal(merchantResult.receipt.accessBridge.permit.state, "bridge-ready");
    assert.equal(merchantResult.receipt.accessBridge.grantBinding.state, "matched");
    assert.equal(merchantResult.receipt.readModel.canonical.sourceOfTruth.mode, "mock-api");

    const payerResult = await service.getReceiptByQuoteId("quote-smoke-service", ReceiptRoles.PAYER, {
      token: createViewerToken(ReceiptRoles.PAYER, receipt.payer),
      grant: payerGrantResult.grant,
      permitHash: "0xpermit123",
      publicKey: "0xpublic123",
    });
    assertAllowedResult(payerResult, "full");
    assert.equal(payerResult.receipt.paymentLink, "/pay.html?id=quote-smoke-service");
    assert.equal(payerResult.receipt.amount, "1250");
    assert.equal(payerResult.receipt.accessBridge.permit.state, "attached");
    assert.equal(payerResult.receipt.accessBridge.permit.source, "provided");
    assert.equal(payerResult.receipt.accessBridge.grantBinding.state, "matched");
    assert.ok(payerResult.receipt.accessBridge.scopes.fields.permitRequired.includes("amount"));

    const auditorResult = await service.getReceiptByQuoteId(
      "quote-smoke-service",
      ReceiptRoles.AUDITOR,
      {
        token: createViewerToken(
          ReceiptRoles.AUDITOR,
          "0xAUDITOR0000000000000000000000000000000000",
        ),
      },
    );
    assertAllowedResult(auditorResult, "limited");
    assert.equal(auditorResult.receipt.amount, null);
    assert.equal(auditorResult.receipt.paymentLink, null);
    assert.equal(auditorResult.receipt.fieldDisclosure.payer.state, "masked");
    assert.equal(auditorResult.receipt.fieldDisclosure.amount.state, "withheld");
    assert.match(
      auditorResult.receipt.payer,
      new RegExp(`^${receipt.payer.slice(0, 6)}`, "i"),
    );

    const deniedMissingViewer = await service.getReceiptByQuoteId(
      "quote-smoke-service",
      ReceiptRoles.MERCHANT,
      {},
    );
    assert.equal(deniedMissingViewer.status, "denied");
    assert.equal(deniedMissingViewer.code, "viewer-context-required");
    assert.deepEqual(deniedMissingViewer.accessPolicy.requiredContext, ["accessToken"]);

    const deniedRoleMismatch = await service.getReceiptByQuoteId(
      "quote-smoke-service",
      ReceiptRoles.PAYER,
      {
        token: createViewerToken(ReceiptRoles.MERCHANT, receipt.merchant),
      },
    );
    assert.equal(deniedRoleMismatch.status, "denied");
    assert.equal(deniedRoleMismatch.code, "viewer-role-mismatch");

    const deniedAnonymousPayer = await service.getReceiptByQuoteId(
      "quote-smoke-service",
      ReceiptRoles.PAYER,
      {
        token: createViewerToken(ReceiptRoles.PAYER, "anonymous"),
      },
    );
    assert.equal(deniedAnonymousPayer.status, "denied");
    assert.equal(deniedAnonymousPayer.code, "participant-context-required");
    assert.equal(deniedAnonymousPayer.accessPolicy.participantBinding.state, "viewer-missing");

    const deniedParticipantMismatch = await service.getReceiptByQuoteId(
      "quote-smoke-service",
      ReceiptRoles.MERCHANT,
      {
        token: createViewerToken(
          ReceiptRoles.MERCHANT,
          "0xBAD0000000000000000000000000000000000BAD",
        ),
      },
    );
    assert.equal(deniedParticipantMismatch.status, "denied");
    assert.equal(deniedParticipantMismatch.code, "viewer-participant-mismatch");
    assert.equal(
      deniedParticipantMismatch.accessPolicy.participantBinding.state,
      "viewer-mismatch",
    );

    const deniedInvalidGrant = await service.getReceiptByQuoteId(
      "quote-smoke-service",
      ReceiptRoles.MERCHANT,
      {
        token: createViewerToken(ReceiptRoles.MERCHANT, receipt.merchant),
        grant: createReceiptAccessGrantToken({
          role: ReceiptRoles.MERCHANT,
          viewer: receipt.merchant,
          quoteId: "quote-other",
          chainId: "31337",
        }),
      },
    );
    assert.equal(deniedInvalidGrant.status, "denied");
    assert.equal(deniedInvalidGrant.code, "receipt-grant-invalid");
    assert.equal(deniedInvalidGrant.accessPolicy.grantBinding.state, "quote-mismatch");

    const deniedMissingGrantProof = await service.issueReceiptGrant(
      "quote-smoke-service",
      ReceiptRoles.MERCHANT,
      {
        token: createViewerToken(ReceiptRoles.MERCHANT, receipt.merchant),
      },
    );
    assert.equal(deniedMissingGrantProof.status, "denied");
    assert.equal(deniedMissingGrantProof.code, "receipt-grant-proof-required");

    const merchantChallenge = await service.issueReceiptGrantChallenge(
      "quote-smoke-service",
      ReceiptRoles.MERCHANT,
      {
        token: createViewerToken(ReceiptRoles.MERCHANT, receipt.merchant),
      },
    );
    assert.equal(merchantChallenge.status, "ok");
    assert.ok(merchantChallenge.challengeToken);
    assert.ok(merchantChallenge.message);

    const wrongSignature = await PAYER_WALLET.signMessage(merchantChallenge.message);
    const deniedChallengeSignature = await service.issueReceiptGrant(
      "quote-smoke-service",
      ReceiptRoles.MERCHANT,
      {
        token: createViewerToken(ReceiptRoles.MERCHANT, receipt.merchant),
        challengeToken: merchantChallenge.challengeToken,
        challengeSignature: wrongSignature,
      },
    );
    assert.equal(deniedChallengeSignature.status, "denied");
    assert.equal(deniedChallengeSignature.code, "receipt-challenge-signature-invalid");

    const staleService = new MockReceiptService();
    await staleService.saveReceipt(receipt);
    const deniedUnrecognizedChallenge = await staleService.issueReceiptGrant(
      "quote-smoke-service",
      ReceiptRoles.MERCHANT,
      {
        token: createViewerToken(ReceiptRoles.MERCHANT, receipt.merchant),
        challengeToken: merchantChallenge.challengeToken,
        challengeSignature: await MERCHANT_WALLET.signMessage(merchantChallenge.message),
      },
    );
    assert.equal(deniedUnrecognizedChallenge.status, "denied");
    assert.equal(deniedUnrecognizedChallenge.code, "receipt-challenge-unrecognized");
    const staleSnapshot = await staleService.getReceiptGrantChallengeSnapshot();
    assert.equal(staleSnapshot.summary.deniedUnrecognizedCount, 1);

    const listResult = await service.listReceipts(ReceiptRoles.MERCHANT, {
      token: createViewerToken(ReceiptRoles.MERCHANT, receipt.merchant),
    });
    assert.equal(listResult.status, "ok");
    assert.equal(listResult.receipts.length, 1);
    assert.equal(listResult.receipts[0].quoteId, "quote-smoke-service");
    assert.equal(listResult.receipts[0].paymentLink, null);
    assert.equal(listResult.receipts[0].amount, null);
    assert.equal(listResult.receipts[0].accessBridge.grantBinding.state, "missing");

    const emptyListResult = await service.listReceipts(ReceiptRoles.MERCHANT, {
      token: createViewerToken(
        ReceiptRoles.MERCHANT,
        "0xBAD0000000000000000000000000000000000BAD",
      ),
    });
    assert.equal(emptyListResult.status, "ok");
    assert.equal(emptyListResult.receipts.length, 0);

    console.log("Private Quotes service smoke test passed.");
  } finally {
    await sharedReceiptRegistry.clear();
    await sharedChallengeRegistry.clear();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
