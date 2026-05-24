const { expect } = require("chai");
const { Wallet, verifyTypedData } = require("ethers");

const {
  DEFAULT_PAYMENT_ASSET,
  HexaPaySdk,
} = require("../sdk/hexapay-sdk.cjs");
const { PAYMENT_INTENT_TYPES } = require("../app/payment-intent-signature.cjs");

describe("HexaPay SDK", function () {
  const payerWallet = new Wallet(
    "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  );
  const merchantAddress = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
  const executorAddress = "0xD3cBE1F9A84E96DF340bef7b9D2B7C466Eb29d55";

  it("creates an intent from the public challenge API", async function () {
    const calls = [];
    const sdk = new HexaPaySdk({
      baseUrl: "http://localhost:3000",
      fetch: async (url, init = {}) => {
        calls.push({
          url,
          init,
          body: JSON.parse(init.body || "{}"),
        });

        return {
          ok: true,
          status: 200,
          async json() {
            return {
              ok: true,
              record: {
                challengeId: "challenge-sdk-001",
                requestId: "req-sdk-001",
                receiptId: "invoice-001",
                source: "pos",
                merchantId: "merchant-001",
                terminalId: "terminal-001",
                amount: "1250000",
                currency: "USDC",
                payer: payerWallet.address,
                merchant: merchantAddress,
                sessionId: "sess-01",
                deviceFingerprintHash: "dev-01",
                issuedAtMs: 1712345678000,
                expiresAtMs: 1712345978000,
                domain: {
                  name: "HexaPay",
                  version: "1",
                  chainId: 421614,
                  verifyingContract: executorAddress,
                },
              },
            };
          },
        };
      },
      tokenAddress: DEFAULT_PAYMENT_ASSET.token,
      verifyingContract: executorAddress,
    });

    const created = await sdk.createIntent({
      requestId: "req-sdk-001",
      receiptId: "invoice-001",
      source: "pos",
      merchantId: "merchant-001",
      terminalId: "terminal-001",
      amount: "1.25",
      payer: payerWallet.address,
      merchant: merchantAddress,
      sessionId: "sess-01",
      deviceFingerprintHash: "dev-01",
    });

    expect(calls).to.have.length(1);
    expect(calls[0].url).to.equal("http://localhost:3000/api/payments/challenges");
    expect(calls[0].body.amount).to.equal("1250000");
    expect(calls[0].init.headers["x-session-id"]).to.equal("sess-01");
    expect(calls[0].init.headers["x-device-fingerprint-hash"]).to.equal("dev-01");
    expect(created.challenge.challengeId).to.equal("challenge-sdk-001");
    expect(created.intent.amount).to.equal("1250000");
    expect(created.intent.token).to.equal(DEFAULT_PAYMENT_ASSET.token);
    expect(created.intent.expiresAtMs).to.equal("1712345978000");
  });

  it("signs typed intents with an ethers signer", async function () {
    const sdk = new HexaPaySdk({
      verifyingContract: executorAddress,
    });
    const challenge = {
      challengeId: "challenge-sdk-002",
      requestId: "req-sdk-002",
      receiptId: "invoice-002",
      source: "pos",
      merchantId: "merchant-001",
      terminalId: "terminal-002",
      amount: "750000",
      currency: "USDC",
      payer: payerWallet.address,
      merchant: merchantAddress,
      issuedAtMs: 1712345678000,
      expiresAtMs: 1712345978000,
      domain: {
        name: "HexaPay",
        version: "1",
        chainId: 421614,
        verifyingContract: executorAddress,
      },
    };
    const intent = sdk.buildIntentFromChallenge(challenge);

    const signature = await sdk.signIntent(intent, payerWallet, {
      challenge,
    });
    const recovered = verifyTypedData(
      challenge.domain,
      PAYMENT_INTENT_TYPES,
      intent,
      signature,
    );

    expect(signature).to.match(/^0x[0-9a-f]+$/);
    expect(recovered).to.equal(payerWallet.address);
  });

  it("calls the verify endpoint for execution status lookups", async function () {
    const calls = [];
    const sdk = new HexaPaySdk({
      baseUrl: "http://localhost:3000",
      fetch: async (url, init = {}) => {
        calls.push({
          url,
          init,
          body: JSON.parse(init.body || "{}"),
        });

        return {
          ok: true,
          status: 200,
          async json() {
            return {
              ok: true,
              status: "verified",
              requestId: "req-sdk-003",
              ledger: {
                found: true,
                status: "settled",
              },
            };
          },
        };
      },
    });

    const result = await sdk.verifyPayment({
      requestId: "req-sdk-003",
    });

    expect(calls).to.have.length(1);
    expect(calls[0].url).to.equal("http://localhost:3000/api/payments/verify");
    expect(calls[0].body.requestId).to.equal("req-sdk-003");
    expect(result.ledger.status).to.equal("settled");
  });
});
