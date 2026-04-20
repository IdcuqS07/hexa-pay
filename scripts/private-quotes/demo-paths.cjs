#!/usr/bin/env node

const { Wallet } = require("ethers");

const {
  MockReceiptService,
} = require("../../app/mock-receipt-service.cjs");
const {
  ReceiptRoles,
} = require("../../app/mock-receipt-policy.cjs");

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
    quoteId: "quote-demo-001",
    merchant: MERCHANT_WALLET.address,
    payer: PAYER_WALLET.address,
    status: "Settled",
    settledAt: 1713538200000,
    txHash: "0x3000000000000000000000000000000000000000000000000000000000000003",
    paymentLink: "/pay.html?id=quote-demo-001",
    amount: "420.00",
    currency: "USDC",
  };
}

function formatReceiptSummary(label, result) {
  const receipt = result.receipt;

  return [
    `${label}: ${receipt.visibility}`,
    `  payer=${receipt.payer}`,
    `  amount=${receipt.amount ?? "withheld"}`,
    `  paymentLink=${receipt.paymentLink ?? "withheld"}`,
    `  disclosureMode=${receipt.disclosureMode}`,
    `  permitState=${receipt.accessBridge.permit.state}`,
    `  bindingState=${receipt.accessBridge.participantBinding.state}`,
    `  bindingMode=${receipt.accessBridge.participantBinding.mode}`,
    `  grantState=${receipt.accessBridge.grantBinding.state}`,
    `  maskedFields=${receipt.accessBridge.scopes.fields.masked.join(", ") || "-"}`,
    `  withheldFields=${receipt.accessBridge.scopes.fields.withheld.join(", ") || "-"}`,
    `  bootstrapFallback=${receipt.accessBridge.scopes.fields.bootstrapFallback.join(", ") || "-"}`,
  ].join("\n");
}

async function issueSignedGrant(service, quoteId, role, wallet) {
  const challengeResult = await service.issueReceiptGrantChallenge(quoteId, role, {
    token: createViewerToken(role, wallet.address),
  });
  const challengeSignature = await wallet.signMessage(challengeResult.message);

  return await service.issueReceiptGrant(quoteId, role, {
    token: createViewerToken(role, wallet.address),
    challengeToken: challengeResult.challengeToken,
    challengeSignature,
  });
}

async function main() {
  const service = new MockReceiptService();
  await service.saveReceipt(createSampleReceipt());
  const merchantGrant = await issueSignedGrant(
    service,
    "quote-demo-001",
    ReceiptRoles.MERCHANT,
    MERCHANT_WALLET,
  );
  const payerGrant = await issueSignedGrant(
    service,
    "quote-demo-001",
    ReceiptRoles.PAYER,
    PAYER_WALLET,
  );

  const merchantView = await service.getReceiptByQuoteId("quote-demo-001", ReceiptRoles.MERCHANT, {
    token: createViewerToken(ReceiptRoles.MERCHANT, MERCHANT_WALLET.address),
    grant: merchantGrant.grant,
  });
  const payerView = await service.getReceiptByQuoteId("quote-demo-001", ReceiptRoles.PAYER, {
    token: createViewerToken(ReceiptRoles.PAYER, PAYER_WALLET.address),
    grant: payerGrant.grant,
    permitHash: "0xdemo-permit",
    publicKey: "0xdemo-public-key",
  });
  const auditorView = await service.getReceiptByQuoteId("quote-demo-001", ReceiptRoles.AUDITOR, {
    token: createViewerToken(ReceiptRoles.AUDITOR, "0x3000000000000000000000000000000000000003"),
  });

  console.log("Private Quotes receipt projection demo");
  console.log("");
  console.log(formatReceiptSummary("merchant", merchantView));
  console.log("");
  console.log(formatReceiptSummary("payer", payerView));
  console.log("");
  console.log(formatReceiptSummary("auditor", auditorView));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
