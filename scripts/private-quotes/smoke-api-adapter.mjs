#!/usr/bin/env node

import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { Wallet } from "ethers";

import { ApiReceiptStore } from "../../app/receipt-store-api.js";
import { ReceiptRoles } from "../../app/receipt-types.js";
import { createReceiptApiMiddleware } from "../../app/mock-receipt-api-plugin.cjs";
import { createReceiptAccessGrantToken } from "../../app/mock-receipt-grants.cjs";
import { MockReceiptService } from "../../app/mock-receipt-service.cjs";
import { createPaymentLedgerAdapter } from "../../app/payment-ledger.cjs";
import {
  FileReceiptRegistry,
  createReceiptRegistryAdapter,
} from "../../app/mock-receipt-registry.cjs";
import {
  FileReceiptGrantChallengeRegistry,
  createReceiptGrantChallengeRegistryAdapter,
} from "../../app/mock-receipt-challenge-registry.cjs";
import { MemoryJsonStateStore } from "../../app/mock-receipt-state-store.cjs";
import { HttpJsonStateStore } from "../../app/mock-receipt-http-state-store.cjs";
import { hashPaymentIntent, hashRequestId } from "../../app/payment-intent-signature.cjs";

function createViewerToken(role, viewer, chainId = "31337") {
  return `receipt-viewer:${role}:${String(viewer).toLowerCase()}:${chainId}`;
}

const MERCHANT_WALLET = new Wallet(
  "0x1000000000000000000000000000000000000000000000000000000000000001",
);
const PAYER_WALLET = new Wallet(
  "0x2000000000000000000000000000000000000000000000000000000000000002",
);

const PAYMENT_INTENT_TYPES = {
  PaymentIntent: [
    { name: "challengeId", type: "string" },
    { name: "requestId", type: "string" },
    { name: "receiptId", type: "string" },
    { name: "quoteId", type: "string" },
    { name: "merchantId", type: "string" },
    { name: "terminalId", type: "string" },
    { name: "payer", type: "address" },
    { name: "merchant", type: "address" },
    { name: "token", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "currency", type: "string" },
    { name: "decimals", type: "uint8" },
    { name: "permitHash", type: "string" },
    { name: "sessionId", type: "string" },
    { name: "deviceFingerprintHash", type: "string" },
    { name: "issuedAtMs", type: "uint256" },
    { name: "expiresAtMs", type: "uint256" },
  ],
};

function createSampleReceipt() {
  return {
    quoteId: "quote-smoke-api",
    merchant: MERCHANT_WALLET.address,
    payer: PAYER_WALLET.address,
    status: "Settled",
    settledAt: 1713537600000,
    txHash: "0xcafebabecafebabecafebabecafebabecafebabecafebabecafebabecafebabe",
    paymentLink: "/pay.html?id=quote-smoke-api",
    amount: "88.50",
    currency: "USDC",
  };
}

function createInMemoryFetch(options = {}) {
  const middleware = createReceiptApiMiddleware(options);

  return async function inMemoryFetch(input, init = {}) {
    const requestUrl = new URL(String(input));
    const requestHeaders = new Headers(init.headers || {});
    const requestBody = typeof init.body === "string" ? init.body : "";
    const request = Readable.from(requestBody ? [Buffer.from(requestBody)] : []);

    request.method = String(init.method || "GET").toUpperCase();
    request.url = `${requestUrl.pathname}${requestUrl.search}`;
    request.headers = Object.fromEntries(
      Array.from(requestHeaders.entries()).map(([key, value]) => [key.toLowerCase(), value]),
    );

    return new Promise((resolve, reject) => {
      const responseHeaders = new Headers();
      const responseChunks = [];
      const response = {
        statusCode: 200,
        setHeader(name, value) {
          responseHeaders.set(name, String(value));
        },
        end(chunk = "") {
          if (chunk) {
            responseChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
          }

          resolve(
            new Response(Buffer.concat(responseChunks), {
              status: this.statusCode || 200,
              headers: responseHeaders,
            }),
          );
        },
        write(chunk = "") {
          responseChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
        },
      };

      middleware(request, response, () => {
        response.statusCode = 404;
        response.setHeader("Content-Type", "application/json; charset=utf-8");
        response.end(JSON.stringify({ error: "Not found" }));
      }).catch(reject);
    });
  };
}

async function main() {
  const previousDebugState = process.env.MOCK_RECEIPT_ALLOW_DEBUG_STATE;
  process.env.MOCK_RECEIPT_ALLOW_DEBUG_STATE = "1";
  const receiptRegistryFilePath = path.join(
    os.tmpdir(),
    `hexapay-receipt-api-registry-${process.pid}-${Date.now()}.json`,
  );
  const registryFilePath = path.join(
    os.tmpdir(),
    `hexapay-receipt-api-challenges-${process.pid}-${Date.now()}.json`,
  );
  const receiptRegistryAdapter = new FileReceiptRegistry({
    filePath: receiptRegistryFilePath,
  });
  const challengeRegistryAdapter = new FileReceiptGrantChallengeRegistry({
    filePath: registryFilePath,
  });
  const paymentLedgerAdapter = createPaymentLedgerAdapter({
    mode: "memory",
  });
  const receiptService = new MockReceiptService({
    receiptRegistryAdapter,
    challengeRegistryAdapter,
  });
  const previousPaymentEnv = {
    rpc: process.env.ARB_SEPOLIA_RPC_URL,
    key: process.env.HEXAPAY_EXECUTOR_PRIVATE_KEY,
    contract: process.env.HEXAPAY_EXECUTOR_CONTRACT_ADDRESS,
    chainId: process.env.HEXAPAY_CHAIN_ID,
  };
  process.env.ARB_SEPOLIA_RPC_URL = process.env.ARB_SEPOLIA_RPC_URL || "http://example.invalid";
  process.env.HEXAPAY_EXECUTOR_PRIVATE_KEY =
    process.env.HEXAPAY_EXECUTOR_PRIVATE_KEY ||
    "0x3000000000000000000000000000000000000000000000000000000000000003";
  process.env.HEXAPAY_EXECUTOR_CONTRACT_ADDRESS =
    process.env.HEXAPAY_EXECUTOR_CONTRACT_ADDRESS ||
    "0xD3cBE1F9A84E96DF340bef7b9D2B7C466Eb29d55";
  process.env.HEXAPAY_CHAIN_ID = process.env.HEXAPAY_CHAIN_ID || "421614";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = createInMemoryFetch({
    receiptRegistryAdapter: new FileReceiptRegistry({
      filePath: receiptRegistryFilePath,
    }),
    challengeRegistryAdapter: new FileReceiptGrantChallengeRegistry({
      filePath: registryFilePath,
    }),
    paymentLedger: paymentLedgerAdapter,
    paymentExecutor: {
      async execute({ intentHash, requestIdHash, token, payer, merchant, amount }) {
        return {
          txHash: `0x${"42".repeat(32)}`,
          blockNumber: 424242,
          status: 1,
          intentHash,
          requestIdHash,
          token,
          payer,
          merchant,
          amount,
        };
      },
    },
  });

  try {
    const baseUrl = "http://receipt.test";
    const payerStore = new ApiReceiptStore({
      baseUrl,
      accessContextResolver: ({ role }) => ({
        token: createViewerToken(role, PAYER_WALLET.address),
        permitHash: role === ReceiptRoles.PAYER ? "0xpermit456" : "",
        publicKey: role === ReceiptRoles.PAYER ? "0xpublic456" : "",
        signGrantChallenge:
          role === ReceiptRoles.PAYER
            ? async (message) => PAYER_WALLET.signMessage(String(message || ""))
            : null,
      }),
    });
    const merchantStore = new ApiReceiptStore({
      baseUrl,
      accessContextResolver: ({ role }) => ({
        token: createViewerToken(role, MERCHANT_WALLET.address),
        signGrantChallenge:
          role === ReceiptRoles.MERCHANT
            ? async (message) => MERCHANT_WALLET.signMessage(String(message || ""))
            : null,
      }),
    });
    const auditorStore = new ApiReceiptStore({
      baseUrl,
      accessContextResolver: ({ role }) => ({
        token: createViewerToken(role, "0xAUDITOR0000000000000000000000000000000001"),
      }),
    });
    const anonymousPayerStore = new ApiReceiptStore({
      baseUrl,
      accessContextResolver: ({ role }) => ({
        token: createViewerToken(role, "anonymous"),
      }),
    });
    const wrongMerchantStore = new ApiReceiptStore({
      baseUrl,
      accessContextResolver: ({ role }) => ({
        token: createViewerToken(role, "0xWRONG000000000000000000000000000000000001"),
      }),
    });
    const tamperedGrantStore = new ApiReceiptStore({
      baseUrl,
      accessContextResolver: ({ role }) => ({
        token: createViewerToken(role, MERCHANT_WALLET.address),
        grant: createReceiptAccessGrantToken({
          role,
          viewer: MERCHANT_WALLET.address,
          quoteId: "quote-other",
          chainId: "31337",
        }),
        signGrantChallenge:
          role === ReceiptRoles.MERCHANT
            ? async (message) => MERCHANT_WALLET.signMessage(String(message || ""))
            : null,
      }),
    });
    const anonymousStore = new ApiReceiptStore({ baseUrl });

    const savedReceipt = await payerStore.saveReceipt(createSampleReceipt());
    assert.ok(savedReceipt);
    assert.equal(savedReceipt.quoteId, "quote-smoke-api");
    assert.equal(savedReceipt.meta.sourceOfTruth.mode, "mock-api");
    const directStoredReceipt = await receiptService.getReceiptByQuoteId(
      "quote-smoke-api",
      ReceiptRoles.AUDITOR,
      {
        token: createViewerToken(
          ReceiptRoles.AUDITOR,
          "0xAUDITOR0000000000000000000000000000000001",
        ),
      },
    );
    assert.equal(directStoredReceipt.status, "ok");
    assert.equal(directStoredReceipt.receipt.quoteId, "quote-smoke-api");

    const replayChallengeUrl = new URL("/api/receipts/quote-smoke-api/challenge", baseUrl);
    replayChallengeUrl.searchParams.set("role", ReceiptRoles.MERCHANT);
    const replayChallengeResponse = await fetch(replayChallengeUrl.toString(), {
      method: "POST",
      headers: {
        Accept: "application/json",
        "x-receipt-access-token": createViewerToken(ReceiptRoles.MERCHANT, MERCHANT_WALLET.address),
      },
    });
    const replayChallengePayload = await replayChallengeResponse.json();
    assert.equal(replayChallengeResponse.status, 200);
    assert.ok(replayChallengePayload.challengeToken);
    assert.ok(replayChallengePayload.message);

    const replaySignature = await MERCHANT_WALLET.signMessage(replayChallengePayload.message);
    const replayGrantUrl = new URL("/api/receipts/quote-smoke-api/grant", baseUrl);
    replayGrantUrl.searchParams.set("role", ReceiptRoles.MERCHANT);
    const firstReplayGrantResponse = await fetch(replayGrantUrl.toString(), {
      method: "POST",
      headers: {
        Accept: "application/json",
        "x-receipt-access-token": createViewerToken(ReceiptRoles.MERCHANT, MERCHANT_WALLET.address),
        "x-receipt-challenge-token": replayChallengePayload.challengeToken,
        "x-receipt-challenge-signature": replaySignature,
      },
    });
    const firstReplayGrantPayload = await firstReplayGrantResponse.json();
    assert.equal(firstReplayGrantResponse.status, 200);
    assert.ok(firstReplayGrantPayload.grant);

    const secondReplayGrantResponse = await fetch(replayGrantUrl.toString(), {
      method: "POST",
      headers: {
        Accept: "application/json",
        "x-receipt-access-token": createViewerToken(ReceiptRoles.MERCHANT, MERCHANT_WALLET.address),
        "x-receipt-challenge-token": replayChallengePayload.challengeToken,
        "x-receipt-challenge-signature": replaySignature,
      },
    });
    const secondReplayGrantPayload = await secondReplayGrantResponse.json();
    assert.equal(secondReplayGrantResponse.status, 403);
    assert.equal(secondReplayGrantPayload.code, "receipt-challenge-consumed");

    const merchantProjection = await merchantStore.getReceiptByQuoteId(
      "quote-smoke-api",
      ReceiptRoles.MERCHANT,
    );
    assert.equal(merchantProjection.visibility, "full");
    assert.equal(merchantProjection.accessBridge.permit.state, "bridge-ready");
    assert.equal(merchantProjection.accessBridge.grantBinding.state, "matched");
    assert.equal(merchantProjection.amount, null);
    assert.equal(merchantProjection.paymentLink, "/pay.html?id=quote-smoke-api");

    const payerProjection = await payerStore.getReceiptByQuoteId(
      "quote-smoke-api",
      ReceiptRoles.PAYER,
    );
    assert.equal(payerProjection.visibility, "full");
    assert.equal(payerProjection.accessBridge.permit.state, "attached");
    assert.equal(payerProjection.accessBridge.permit.hash, "0xpermit456");
    assert.equal(payerProjection.amount, "88.50");
    assert.equal(payerProjection.readModel.canonical.sourceOfTruth.mode, "mock-api");

    const challengeDebugUrl = new URL("/api/receipts/_debug/challenges", baseUrl);
    challengeDebugUrl.searchParams.set("records", "1");
    const challengeDebugResponse = await fetch(challengeDebugUrl.toString(), {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    });
    const challengeDebugPayload = await challengeDebugResponse.json();
    assert.equal(challengeDebugResponse.status, 200);
    assert.equal(challengeDebugPayload.storage?.kind, "file");
    assert.equal(challengeDebugPayload.storage?.path, registryFilePath);
    assert.equal(challengeDebugPayload.summary.issuedCount, 3);
    assert.equal(challengeDebugPayload.summary.consumedCount, 3);
    assert.equal(challengeDebugPayload.summary.deniedConsumedCount, 1);
    assert.equal(challengeDebugPayload.summary.activeCount, 0);
    assert.equal(challengeDebugPayload.summary.consumedRetainedCount, 3);
    assert.equal(challengeDebugPayload.records.length, 3);
    const directSnapshot = await receiptService.getReceiptGrantChallengeSnapshot({
      includeRecords: true,
    });
    assert.equal(directSnapshot.summary.issuedCount, challengeDebugPayload.summary.issuedCount);
    assert.equal(directSnapshot.storage?.kind, "file");
    assert.equal(directSnapshot.storage?.path, registryFilePath);
    assert.equal(directSnapshot.summary.consumedCount, challengeDebugPayload.summary.consumedCount);
    assert.equal(
      directSnapshot.summary.deniedConsumedCount,
      challengeDebugPayload.summary.deniedConsumedCount,
    );
    assert.equal(directSnapshot.records.length, challengeDebugPayload.records.length);

    const receiptDebugUrl = new URL("/api/receipts/_debug/registry", baseUrl);
    receiptDebugUrl.searchParams.set("records", "1");
    const receiptDebugResponse = await fetch(receiptDebugUrl.toString(), {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    });
    const receiptDebugPayload = await receiptDebugResponse.json();
    assert.equal(receiptDebugResponse.status, 200);
    assert.equal(receiptDebugPayload.storage?.kind, "file");
    assert.equal(receiptDebugPayload.storage?.path, receiptRegistryFilePath);
    assert.equal(receiptDebugPayload.summary.retainedCount, 1);
    assert.equal(receiptDebugPayload.summary.savedCount, 1);
    assert.equal(receiptDebugPayload.summary.lastSavedQuoteId, "quote-smoke-api");
    assert.equal(receiptDebugPayload.records.length, 1);
    const directReceiptSnapshot = await receiptService.getReceiptRegistrySnapshot({
      includeRecords: true,
    });
    assert.equal(directReceiptSnapshot.storage?.kind, "file");
    assert.equal(directReceiptSnapshot.storage?.path, receiptRegistryFilePath);
    assert.equal(
      directReceiptSnapshot.summary.retainedCount,
      receiptDebugPayload.summary.retainedCount,
    );
    assert.equal(
      directReceiptSnapshot.summary.savedCount,
      receiptDebugPayload.summary.savedCount,
    );
    assert.equal(directReceiptSnapshot.records.length, receiptDebugPayload.records.length);

    const auditorProjection = await auditorStore.getReceiptByQuoteId(
      "quote-smoke-api",
      ReceiptRoles.AUDITOR,
    );
    assert.equal(auditorProjection.visibility, "limited");
    assert.equal(auditorProjection.amount, null);
    assert.equal(auditorProjection.fieldDisclosure.payer.state, "masked");

    const listProjection = await merchantStore.listReceipts(ReceiptRoles.MERCHANT);
    assert.equal(listProjection.length, 1);
    assert.equal(listProjection[0].quoteId, "quote-smoke-api");
    assert.equal(listProjection[0].paymentLink, null);
    assert.equal(listProjection[0].accessBridge.grantBinding.state, "missing");

    const emptyListProjection = await wrongMerchantStore.listReceipts(ReceiptRoles.MERCHANT);
    assert.equal(emptyListProjection.length, 0);

    await assert.rejects(
      anonymousStore.getReceiptByQuoteId("quote-smoke-api", ReceiptRoles.MERCHANT),
      (error) => {
        assert.equal(error.code, "viewer-context-required");
        assert.equal(error.statusCode, 403);
        assert.equal(error.accessPolicy?.status, "denied");
        return true;
      },
    );

    await assert.rejects(
      anonymousPayerStore.getReceiptByQuoteId("quote-smoke-api", ReceiptRoles.PAYER),
      (error) => {
        assert.equal(error.code, "participant-context-required");
        assert.equal(error.statusCode, 403);
        assert.equal(error.accessPolicy?.participantBinding?.state, "viewer-missing");
        return true;
      },
    );

    await assert.rejects(
      tamperedGrantStore.getReceiptByQuoteId("quote-smoke-api", ReceiptRoles.MERCHANT),
      (error) => {
        assert.equal(error.code, "receipt-grant-invalid");
        assert.equal(error.statusCode, 403);
        assert.equal(error.accessPolicy?.grantBinding?.state, "quote-mismatch");
        return true;
      },
    );

    const paymentChallengeResponse = await fetch(`${baseUrl}/api/payments/challenges`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        requestId: "payment-smoke-001",
        receiptId: "receipt-smoke-001",
        quoteId: "quote-smoke-api",
        merchantId: "merchant-test-001",
        terminalId: "terminal-test-001",
        amount: "1000000",
        currency: "USDC",
        payer: PAYER_WALLET.address,
        merchant: MERCHANT_WALLET.address,
      }),
    });
    const paymentChallengePayload = await paymentChallengeResponse.json();
    assert.equal(paymentChallengeResponse.status, 200);
    assert.equal(paymentChallengePayload.ok, true);
    assert.equal(paymentChallengePayload.record.requestId, "payment-smoke-001");

    const paymentIntent = {
      challengeId: paymentChallengePayload.record.challengeId,
      requestId: paymentChallengePayload.record.requestId,
      receiptId: paymentChallengePayload.record.receiptId,
      quoteId: paymentChallengePayload.record.quoteId || "",
      merchantId: paymentChallengePayload.record.merchantId,
      terminalId: paymentChallengePayload.record.terminalId,
      payer: paymentChallengePayload.record.payer,
      merchant: paymentChallengePayload.record.merchant,
      token: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d",
      amount: String(paymentChallengePayload.record.amount),
      currency: paymentChallengePayload.record.currency,
      decimals: 6,
      permitHash: "",
      sessionId: "",
      deviceFingerprintHash: "",
      issuedAtMs: String(paymentChallengePayload.record.issuedAtMs),
      expiresAtMs: String(paymentChallengePayload.record.expiresAtMs),
    };
    const paymentSignature = await PAYER_WALLET.signTypedData(
      paymentChallengePayload.record.domain,
      PAYMENT_INTENT_TYPES,
      paymentIntent,
    );
    const paymentExecuteResponse = await fetch(`${baseUrl}/api/payments/execute`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        intent: paymentIntent,
        signature: paymentSignature,
      }),
    });
    const paymentExecutePayload = await paymentExecuteResponse.json();
    assert.equal(paymentExecuteResponse.status, 200);
    assert.equal(paymentExecutePayload.status, "executed");
    assert.equal(
      paymentExecutePayload.intentHash,
      hashPaymentIntent(paymentChallengePayload.record.domain, paymentIntent),
    );
    assert.equal(paymentExecutePayload.requestIdHash, hashRequestId(paymentIntent.requestId));

    const paymentListResponse = await fetch(
      `${baseUrl}/api/payments/list?wallet=${encodeURIComponent(PAYER_WALLET.address)}&limit=10`,
      {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
      },
    );
    const paymentListPayload = await paymentListResponse.json();
    assert.equal(paymentListResponse.status, 200);
    assert.equal(paymentListPayload.ok, true);
    assert.equal(paymentListPayload.summary.returnedCount, 1);
    assert.equal(paymentListPayload.records[0].requestId, paymentIntent.requestId);
    assert.equal(paymentListPayload.records[0].status, "settled");
    assert.equal(paymentListPayload.records[0].txHash, paymentExecutePayload.txHash);
    assert.equal(paymentListPayload.records[0].payer, PAYER_WALLET.address);
    assert.equal(paymentListPayload.records[0].merchant, MERCHANT_WALLET.address);

    const remoteBaseUrl = "http://receipt.remote";
    const remoteReceiptStateStore = new MemoryJsonStateStore({
      label: "remote-http",
    });
    const remoteChallengeStateStore = new MemoryJsonStateStore({
      label: "remote-http",
    });
    const remoteConflictStateStore = new MemoryJsonStateStore({
      label: "remote-http",
    });
    let remoteFetchImpl = null;
    const deferredRemoteFetch = (...args) => {
      if (!remoteFetchImpl) {
        throw new Error("Remote fetch is not ready.");
      }

      return remoteFetchImpl(...args);
    };
    const remoteReceiptService = new MockReceiptService({
      receiptRegistryAdapter: createReceiptRegistryAdapter({
        mode: "http",
        baseUrl: remoteBaseUrl,
        storeId: "registry-http",
        fetchImpl: deferredRemoteFetch,
      }),
      challengeRegistryAdapter: createReceiptGrantChallengeRegistryAdapter({
        mode: "http",
        baseUrl: remoteBaseUrl,
        storeId: "challenges-http",
        fetchImpl: deferredRemoteFetch,
      }),
    });
    remoteFetchImpl = createInMemoryFetch({
      receiptService: remoteReceiptService,
      stateStores: {
        "registry-http": remoteReceiptStateStore,
        "challenges-http": remoteChallengeStateStore,
        "cas-http": remoteConflictStateStore,
      },
    });
    const previousFetch = globalThis.fetch;
    globalThis.fetch = remoteFetchImpl;

    try {
      const remotePayerStore = new ApiReceiptStore({
        baseUrl: remoteBaseUrl,
        accessContextResolver: ({ role }) => ({
          token: createViewerToken(role, PAYER_WALLET.address),
          permitHash: role === ReceiptRoles.PAYER ? "0xpermit789" : "",
          publicKey: role === ReceiptRoles.PAYER ? "0xpublic789" : "",
          signGrantChallenge:
            role === ReceiptRoles.PAYER
              ? async (message) => PAYER_WALLET.signMessage(String(message || ""))
              : null,
        }),
      });
      const remoteMerchantStore = new ApiReceiptStore({
        baseUrl: remoteBaseUrl,
        accessContextResolver: ({ role }) => ({
          token: createViewerToken(role, MERCHANT_WALLET.address),
          signGrantChallenge:
            role === ReceiptRoles.MERCHANT
              ? async (message) => MERCHANT_WALLET.signMessage(String(message || ""))
              : null,
        }),
      });

      const remoteSavedReceipt = await remotePayerStore.saveReceipt({
        ...createSampleReceipt(),
        quoteId: "quote-smoke-http-store",
        paymentLink: "/pay.html?id=quote-smoke-http-store",
      });
      assert.equal(remoteSavedReceipt.quoteId, "quote-smoke-http-store");

      const remoteMerchantProjection = await remoteMerchantStore.getReceiptByQuoteId(
        "quote-smoke-http-store",
        ReceiptRoles.MERCHANT,
      );
      assert.equal(remoteMerchantProjection.visibility, "full");
      assert.equal(remoteMerchantProjection.paymentLink, "/pay.html?id=quote-smoke-http-store");
      assert.equal(remoteMerchantProjection.accessBridge.grantBinding.state, "matched");
      const remoteReceiptRegistrySnapshot = await remoteReceiptService.getReceiptRegistrySnapshot();
      const remoteChallengeRegistrySnapshot =
        await remoteReceiptService.getReceiptGrantChallengeSnapshot();
      assert.equal(remoteReceiptRegistrySnapshot.storage?.kind, "http");
      assert.equal(remoteReceiptRegistrySnapshot.storage?.storeId, "registry-http");
      assert.ok(remoteReceiptRegistrySnapshot.storage?.revision >= 1);
      assert.equal(remoteChallengeRegistrySnapshot.storage?.kind, "http");
      assert.equal(remoteChallengeRegistrySnapshot.storage?.storeId, "challenges-http");
      assert.ok(remoteChallengeRegistrySnapshot.storage?.revision >= 1);

      const remoteRegistryStateResponse = await remoteFetchImpl(
        `${remoteBaseUrl}/api/receipts/_state/registry-http`,
        {
          method: "GET",
          headers: {
            Accept: "application/json",
          },
        },
      );
      const remoteRegistryStatePayload = await remoteRegistryStateResponse.json();
      assert.equal(remoteRegistryStateResponse.status, 200);
      assert.equal(remoteRegistryStatePayload.store?.kind, "memory");
      assert.equal(remoteRegistryStatePayload.store?.label, "remote-http");
      assert.ok(remoteRegistryStatePayload.entry?.revision >= 1);
      assert.equal(remoteRegistryStatePayload.entry?.value?.stats?.savedCount, 1);
      assert.equal(
        remoteRegistryStatePayload.entry?.value?.records?.[0]?.quoteId,
        "quote-smoke-http-store",
      );

      const remoteChallengeStateResponse = await remoteFetchImpl(
        `${remoteBaseUrl}/api/receipts/_state/challenges-http`,
        {
          method: "GET",
          headers: {
            Accept: "application/json",
          },
        },
      );
      const remoteChallengeStatePayload = await remoteChallengeStateResponse.json();
      assert.equal(remoteChallengeStateResponse.status, 200);
      assert.equal(remoteChallengeStatePayload.store?.kind, "memory");
      assert.equal(remoteChallengeStatePayload.store?.label, "remote-http");
      assert.ok(remoteChallengeStatePayload.entry?.revision >= 1);
      assert.equal(remoteChallengeStatePayload.entry?.value?.stats?.issuedCount, 1);
      assert.equal(remoteChallengeStatePayload.entry?.value?.stats?.consumedCount, 1);

      const remoteConflictStore = new HttpJsonStateStore({
        baseUrl: remoteBaseUrl,
        storeId: "cas-http",
        fetchImpl: remoteFetchImpl,
      });
      const firstRemoteWrite = await remoteConflictStore.writeEntry(
        { hello: "remote" },
        { expectedRevision: 0 },
      );
      assert.equal(firstRemoteWrite.ok, true);
      assert.equal(firstRemoteWrite.revision, 1);
      const conflictingRemoteWrite = await remoteConflictStore.writeEntry(
        { hello: "conflict" },
        { expectedRevision: 0 },
      );
      assert.equal(conflictingRemoteWrite.ok, false);
      assert.equal(conflictingRemoteWrite.conflict, true);
      assert.equal(conflictingRemoteWrite.revision, 1);
    } finally {
      await remoteReceiptService.reset();
      globalThis.fetch = previousFetch;
    }

    console.log("Private Quotes API adapter smoke test passed.");
  } finally {
    globalThis.fetch = originalFetch;
    if (previousPaymentEnv.rpc == null) delete process.env.ARB_SEPOLIA_RPC_URL;
    else process.env.ARB_SEPOLIA_RPC_URL = previousPaymentEnv.rpc;
    if (previousPaymentEnv.key == null) delete process.env.HEXAPAY_EXECUTOR_PRIVATE_KEY;
    else process.env.HEXAPAY_EXECUTOR_PRIVATE_KEY = previousPaymentEnv.key;
    if (previousPaymentEnv.contract == null) delete process.env.HEXAPAY_EXECUTOR_CONTRACT_ADDRESS;
    else process.env.HEXAPAY_EXECUTOR_CONTRACT_ADDRESS = previousPaymentEnv.contract;
    if (previousPaymentEnv.chainId == null) delete process.env.HEXAPAY_CHAIN_ID;
    else process.env.HEXAPAY_CHAIN_ID = previousPaymentEnv.chainId;
    if (previousDebugState == null) {
      delete process.env.MOCK_RECEIPT_ALLOW_DEBUG_STATE;
    } else {
      process.env.MOCK_RECEIPT_ALLOW_DEBUG_STATE = previousDebugState;
    }
    await receiptRegistryAdapter.clear();
    await challengeRegistryAdapter.clear();
    await paymentLedgerAdapter.clear();
  }
}

main();
