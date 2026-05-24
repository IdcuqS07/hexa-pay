const { expect } = require("chai");
const { Wallet } = require("ethers");

const { createPaymentLedgerAdapter } = require("../app/payment-ledger.cjs");
const { createPaymentIntentService } = require("../app/payment-intent-service.cjs");
const { PAYMENT_INTENT_TYPES } = require("../app/payment-intent-signature.cjs");

describe("payment intent service POS validation", function () {
  const payerWallet = new Wallet(
    "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  );
  const merchantAddress = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
  const paymentTokenAddress = "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d";

  function createChallengeRegistry() {
    const records = new Map();

    return {
      async remember(record) {
        records.set(record.raw, { ...record });
        return record;
      },
      async reserveConsume(token, context = {}) {
        const record = records.get(token);

        if (!record) {
          return {
            ok: false,
            code: "challenge_not_found",
          };
        }

        if (
          record.sessionId &&
          context.sessionId &&
          String(record.sessionId) !== String(context.sessionId)
        ) {
          return {
            ok: false,
            code: "session_mismatch",
          };
        }

        if (
          record.deviceFingerprint &&
          context.deviceFingerprint &&
          String(record.deviceFingerprint) !== String(context.deviceFingerprint)
        ) {
          return {
            ok: false,
            code: "device_mismatch",
          };
        }

        return {
          ok: true,
          code: "reserved",
        };
      },
      async commitConsume() {
        return {
          ok: true,
          code: "consumed",
        };
      },
      async releaseConsume() {
        return {
          ok: true,
          code: "released",
        };
      },
    };
  }

  function createExecutor() {
    return {
      async execute() {
        return {
          txHash: `0x${"12".repeat(32)}`,
          blockNumber: 424242,
          status: 1,
        };
      },
    };
  }

  function createPosChallengeInput(overrides = {}) {
    return {
      requestId: overrides.requestId || `req-pos-${Date.now()}`,
      receiptId: overrides.receiptId || "",
      quoteId: overrides.quoteId || "",
      source: overrides.source === undefined ? "pos" : overrides.source,
      merchantId: overrides.merchantId || "merchant-001",
      terminalId: overrides.terminalId || "terminal-front-01",
      amount: overrides.amount || "12500000",
      currency: overrides.currency || "USDC",
      payer: overrides.payer || payerWallet.address,
      merchant: overrides.merchant || merchantAddress,
      actorId: overrides.actorId || payerWallet.address,
      sessionId: overrides.sessionId === undefined ? "sess_terminal_front_01" : overrides.sessionId,
      deviceFingerprintHash:
        overrides.deviceFingerprintHash === undefined
          ? "dev_terminal_front_01"
          : overrides.deviceFingerprintHash,
    };
  }

  function createIntentFromChallenge(challenge, overrides = {}) {
    return {
      challengeId: challenge.challengeId,
      requestId: challenge.requestId,
      receiptId: challenge.receiptId || "",
      quoteId: challenge.quoteId || "",
      source: overrides.source === undefined ? challenge.source || "pos" : overrides.source,
      merchantId: challenge.merchantId,
      terminalId: challenge.terminalId,
      payer: challenge.payer,
      merchant: challenge.merchant,
      token: overrides.token || paymentTokenAddress,
      amount: String(overrides.amount || challenge.amount),
      currency: overrides.currency || challenge.currency,
      decimals: 6,
      permitHash: "",
      sessionId: overrides.sessionId === undefined ? challenge.sessionId || "" : overrides.sessionId,
      deviceFingerprintHash:
        overrides.deviceFingerprintHash === undefined
          ? challenge.deviceFingerprintHash || ""
          : overrides.deviceFingerprintHash,
      issuedAtMs: String(Date.now()),
      expiresAtMs: String(challenge.expiresAtMs),
    };
  }

  async function signIntent(service, intent) {
    return payerWallet.signTypedData(service.domain, PAYMENT_INTENT_TYPES, intent);
  }

  it("requires POS session and device binding when issuing a challenge", async function () {
    const service = createPaymentIntentService({
      chainId: 421614,
      verifyingContract: "0xD3cBE1F9A84E96DF340bef7b9D2B7C466Eb29d55",
      challengeRegistry: createChallengeRegistry(),
      paymentLedger: createPaymentLedgerAdapter({ mode: "memory" }),
      executor: createExecutor(),
    });

    await expect(
      service.createChallenge(
        createPosChallengeInput({
          sessionId: "",
        }),
      ),
    ).to.be.rejectedWith("challenge.sessionId is required");

    await expect(
      service.createChallenge(
        createPosChallengeInput({
          deviceFingerprintHash: "",
        }),
      ),
    ).to.be.rejectedWith("challenge.deviceFingerprintHash is required");
  });

  it("requires POS session binding when executing a signed intent", async function () {
    const service = createPaymentIntentService({
      chainId: 421614,
      verifyingContract: "0xD3cBE1F9A84E96DF340bef7b9D2B7C466Eb29d55",
      challengeRegistry: createChallengeRegistry(),
      paymentLedger: createPaymentLedgerAdapter({ mode: "memory" }),
      executor: createExecutor(),
    });

    const challenge = await service.createChallenge(createPosChallengeInput());
    const intent = createIntentFromChallenge(challenge, {
      sessionId: "",
    });
    const signature = await signIntent(service, intent);

    await expect(
      service.executeSignedIntent({
        intent,
        signature,
      }),
    ).to.be.rejectedWith("intent.sessionId is required");
  });

  it("persists POS source on settled payment records", async function () {
    const paymentLedger = createPaymentLedgerAdapter({ mode: "memory" });
    const service = createPaymentIntentService({
      chainId: 421614,
      verifyingContract: "0xD3cBE1F9A84E96DF340bef7b9D2B7C466Eb29d55",
      challengeRegistry: createChallengeRegistry(),
      paymentLedger,
      executor: createExecutor(),
    });

    const challenge = await service.createChallenge(createPosChallengeInput());
    const intent = createIntentFromChallenge(challenge);
    const signature = await signIntent(service, intent);

    const result = await service.executeSignedIntent({
      intent,
      signature,
    });
    const storedRecord = await paymentLedger.getByRequestId(intent.requestId);

    expect(result.ok).to.equal(true);
    expect(storedRecord.status).to.equal("settled");
    expect(storedRecord.intentSource).to.equal("pos");
    expect(storedRecord.txHash).to.equal(result.txHash);
  });

  it("filters payment history by request id for QR checkout tracking", async function () {
    const paymentLedger = createPaymentLedgerAdapter({ mode: "memory" });
    const service = createPaymentIntentService({
      chainId: 421614,
      verifyingContract: "0xD3cBE1F9A84E96DF340bef7b9D2B7C466Eb29d55",
      challengeRegistry: createChallengeRegistry(),
      paymentLedger,
      executor: createExecutor(),
    });

    const firstChallenge = await service.createChallenge(
      createPosChallengeInput({
        requestId: "req-pos-front-counter",
      }),
    );
    const firstIntent = createIntentFromChallenge(firstChallenge);
    const firstSignature = await signIntent(service, firstIntent);
    await service.executeSignedIntent({
      intent: firstIntent,
      signature: firstSignature,
    });

    const secondChallenge = await service.createChallenge(
      createPosChallengeInput({
        requestId: "req-pos-side-counter",
        sessionId: "sess_terminal_side_01",
        deviceFingerprintHash: "dev_terminal_side_01",
      }),
    );
    const secondIntent = createIntentFromChallenge(secondChallenge);
    const secondSignature = await signIntent(service, secondIntent);
    await service.executeSignedIntent({
      intent: secondIntent,
      signature: secondSignature,
    });

    const filtered = await service.listPayments({
      requestId: firstIntent.requestId,
    });

    expect(filtered.records).to.have.length(1);
    expect(filtered.records[0].requestId).to.equal(firstIntent.requestId);
    expect(filtered.records[0].status).to.equal("settled");
  });

  it("verifies a signed intent and reports settled ledger status", async function () {
    const paymentLedger = createPaymentLedgerAdapter({ mode: "memory" });
    const service = createPaymentIntentService({
      chainId: 421614,
      verifyingContract: "0xD3cBE1F9A84E96DF340bef7b9D2B7C466Eb29d55",
      challengeRegistry: createChallengeRegistry(),
      paymentLedger,
      executor: createExecutor(),
    });

    const challenge = await service.createChallenge(createPosChallengeInput());
    const intent = createIntentFromChallenge(challenge);
    const signature = await signIntent(service, intent);

    await service.executeSignedIntent({
      intent,
      signature,
    });

    const verification = await service.verifyPaymentIntent({
      intent,
      signature,
    });

    expect(verification.ok).to.equal(true);
    expect(verification.signature.valid).to.equal(true);
    expect(verification.signature.code).to.equal("ok");
    expect(verification.signature.signer).to.equal(payerWallet.address);
    expect(verification.ledger.found).to.equal(true);
    expect(verification.ledger.status).to.equal("settled");
    expect(verification.challenge.matches).to.equal(true);
    expect(verification.intentHash).to.match(/^0x[0-9a-f]{64}$/);
  });

  it("can verify execution status by request id without resubmitting the intent", async function () {
    const paymentLedger = createPaymentLedgerAdapter({ mode: "memory" });
    const service = createPaymentIntentService({
      chainId: 421614,
      verifyingContract: "0xD3cBE1F9A84E96DF340bef7b9D2B7C466Eb29d55",
      challengeRegistry: createChallengeRegistry(),
      paymentLedger,
      executor: createExecutor(),
    });

    const challenge = await service.createChallenge(createPosChallengeInput());
    const intent = createIntentFromChallenge(challenge);
    const signature = await signIntent(service, intent);

    await service.executeSignedIntent({
      intent,
      signature,
    });

    const verification = await service.verifyPaymentIntent({
      requestId: intent.requestId,
    });

    expect(verification.ok).to.equal(true);
    expect(verification.signature.valid).to.equal(null);
    expect(verification.signature.code).to.equal("missing_signature");
    expect(verification.ledger.found).to.equal(true);
    expect(verification.ledger.status).to.equal("settled");
    expect(verification.requestIdHash).to.match(/^0x[0-9a-f]{64}$/);
  });

  it("reports invalid signatures without executing the payment", async function () {
    const paymentLedger = createPaymentLedgerAdapter({ mode: "memory" });
    const service = createPaymentIntentService({
      chainId: 421614,
      verifyingContract: "0xD3cBE1F9A84E96DF340bef7b9D2B7C466Eb29d55",
      challengeRegistry: createChallengeRegistry(),
      paymentLedger,
      executor: createExecutor(),
    });

    const challenge = await service.createChallenge(createPosChallengeInput());
    const intent = createIntentFromChallenge(challenge);
    const signature = await signIntent(service, intent);
    const tamperedIntent = {
      ...intent,
      amount: "1",
    };

    const verification = await service.verifyPaymentIntent({
      intent: tamperedIntent,
      signature,
    });

    expect(verification.ok).to.equal(true);
    expect(verification.signature.valid).to.equal(false);
    expect(verification.signature.code).to.equal("signer_mismatch");
    expect(verification.ledger.found).to.equal(true);
    expect(verification.ledger.status).to.equal("challenge");
  });
});
