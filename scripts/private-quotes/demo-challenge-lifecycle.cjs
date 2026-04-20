#!/usr/bin/env node

const os = require("os");
const path = require("path");
const { Wallet } = require("ethers");

const {
  MockReceiptService,
} = require("../../app/mock-receipt-service.cjs");
const {
  FileReceiptGrantChallengeRegistry,
} = require("../../app/mock-receipt-challenge-registry.cjs");
const {
  ReceiptRoles,
} = require("../../app/mock-receipt-policy.cjs");

function createViewerToken(role, viewer, chainId = "31337") {
  return `receipt-viewer:${role}:${String(viewer).toLowerCase()}:${chainId}`;
}

const MERCHANT_WALLET = new Wallet(
  "0x1000000000000000000000000000000000000000000000000000000000000001",
);

function createSampleReceipt() {
  return {
    quoteId: "quote-challenge-demo",
    merchant: MERCHANT_WALLET.address,
    payer: "0x2000000000000000000000000000000000000002",
    status: "Settled",
    settledAt: 1713538600000,
    txHash: "0x4000000000000000000000000000000000000000000000000000000000000004",
    paymentLink: "/pay.html?id=quote-challenge-demo",
    amount: "101.25",
    currency: "USDC",
  };
}

function printSnapshot(label, snapshot) {
  const summary = snapshot.summary || {};

  console.log(label);
  if (snapshot.storage) {
    console.log(`  storage=${snapshot.storage.kind}${snapshot.storage.path ? `:${snapshot.storage.path}` : ""}`);
  }
  console.log(`  issued=${summary.issuedCount || 0}`);
  console.log(`  consumed=${summary.consumedCount || 0}`);
  console.log(`  deniedConsumed=${summary.deniedConsumedCount || 0}`);
  console.log(`  deniedUnrecognized=${summary.deniedUnrecognizedCount || 0}`);
  console.log(`  retained=${summary.retainedCount || 0}`);
  console.log(`  active=${summary.activeCount || 0}`);
  console.log(`  consumedRetained=${summary.consumedRetainedCount || 0}`);
  console.log(
    `  activeByRole=${JSON.stringify(summary.activeByRole || {}, null, 0)}`,
  );
}

async function main() {
  const registryFilePath = path.join(
    os.tmpdir(),
    `hexapay-challenge-demo-${process.pid}-${Date.now()}.json`,
  );
  const challengeRegistryAdapter = new FileReceiptGrantChallengeRegistry({
    filePath: registryFilePath,
  });
  const service = new MockReceiptService({
    challengeRegistryAdapter,
  });

  try {
    const receipt = await service.saveReceipt(createSampleReceipt());
    const accessContext = {
      token: createViewerToken(ReceiptRoles.MERCHANT, MERCHANT_WALLET.address),
    };

    console.log("Private Quotes challenge lifecycle demo");
    console.log("");
    printSnapshot(
      "initial",
      await service.getReceiptGrantChallengeSnapshot({ includeRecords: true }),
    );
    console.log("");

    const challenge = await service.issueReceiptGrantChallenge(
      receipt.quoteId,
      ReceiptRoles.MERCHANT,
      accessContext,
    );
    printSnapshot(
      "after challenge issue",
      await service.getReceiptGrantChallengeSnapshot({ includeRecords: true }),
    );
    console.log(`  challengeIssued=${Boolean(challenge.challengeToken)}`);
    console.log("");

    const challengeSignature = await MERCHANT_WALLET.signMessage(challenge.message);
    const grant = await service.issueReceiptGrant(receipt.quoteId, ReceiptRoles.MERCHANT, {
      ...accessContext,
      challengeToken: challenge.challengeToken,
      challengeSignature,
    });
    printSnapshot(
      "after grant consume",
      await service.getReceiptGrantChallengeSnapshot({ includeRecords: true }),
    );
    console.log(`  grantIssued=${Boolean(grant.grant)}`);
  } finally {
    await challengeRegistryAdapter.clear();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
