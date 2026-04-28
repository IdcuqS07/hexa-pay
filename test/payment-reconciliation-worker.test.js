const { expect } = require("chai");
const {
  createPaymentReconciliationStoreAdapter,
} = require("../app/payment-reconciliation-store.cjs");
const {
  buildPaymentSettlementId,
  createPaymentReconciliationWorker,
} = require("../app/payment-reconciliation-worker.cjs");

describe("payment reconciliation worker", function () {
  const chainId = 421614;
  const executorAddress = "0xD3cBE1F9A84E96DF340bef7b9D2B7C466Eb29d55";
  const settlementToken = "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d";
  const invoiceId = `0x${"11".repeat(32)}`;
  const payer = "0x1A9f0C2c8C16BCa3Ebc9Bf9e0Cd8F9910f8f1f01";
  const merchant = "0x8a5338Bf5D0CB5F504eA6776453Bb0c6f630Dd90";
  const txHash = `0x${"42".repeat(32)}`;

  function createCandidate(overrides = {}) {
    const intentHash = overrides.intentHash || `0x${"aa".repeat(32)}`;
    const requestIdHash = overrides.requestIdHash || `0x${"bb".repeat(32)}`;

    return {
      requestId: overrides.requestId || "payment-worker-001",
      challengeId: overrides.challengeId || "challenge-worker-001",
      receiptId: overrides.receiptId || invoiceId,
      invoiceId: overrides.invoiceId || invoiceId,
      bindingSource: "receiptId",
      bindingStatus: "canonical",
      eligible: overrides.eligible === undefined ? true : overrides.eligible,
      reason: overrides.reason || "eligible",
      status: overrides.status || "settled",
      reconciliationStatus: overrides.reconciliationStatus || "",
      merchantId: overrides.merchantId || "merchant-001",
      terminalId: overrides.terminalId || "terminal-001",
      payer: overrides.payer || payer,
      merchant: overrides.merchant || merchant,
      token: overrides.token || settlementToken,
      amount: overrides.amount || "1000000",
      currency: overrides.currency || "USDC",
      intentHash,
      requestIdHash,
      txHash: overrides.txHash || txHash,
      blockNumber: overrides.blockNumber || 424242,
      settledAt: overrides.settledAt || Date.now(),
      updatedAt: overrides.updatedAt || Date.now(),
    };
  }

  function createLedger(candidates = []) {
    return {
      async listReconciliationCandidates() {
        return {
          status: "ok",
          statusCode: 200,
          summary: {
            totalInvoiceLinked: candidates.length,
            eligibleCount: candidates.filter((candidate) => candidate.eligible).length,
            returnedCount: candidates.length,
            updatedAt: Date.now(),
          },
          records: candidates,
        };
      },
      async markReconciliationState() {
        return true;
      },
    };
  }

  function createVerifier(result = {}) {
    return {
      async verifyCandidate() {
        return {
          ok: result.ok !== false,
          reason: result.reason || (result.ok === false ? "verification_failed" : "verified"),
          verificationStatus: result.verificationStatus || (result.ok === false ? "failed" : "verified"),
          verifiedAt: Date.now(),
          retryable: result.retryable === true,
          checks: {
            executorRecord: result.executorRecord !== false,
            txSuccess: result.txSuccess !== false,
            tokenMatch: result.tokenMatch !== false,
            merchantMatch: result.merchantMatch !== false,
            payerMatch: result.payerMatch !== false,
            amountMatch: result.amountMatch !== false,
          },
        };
      },
    };
  }

  it("does not resubmit settlements that are already recorded in the orchestration store", async function () {
    const candidate = createCandidate();
    const settlementId = buildPaymentSettlementId({
      chainId,
      executorAddress,
      intentHash: candidate.intentHash,
      requestIdHash: candidate.requestIdHash,
    });
    const reconciliationStore = createPaymentReconciliationStoreAdapter({ mode: "memory" });
    let recordCalls = 0;

    const worker = createPaymentReconciliationWorker({
      chainId,
      executorAddress,
      paymentLedger: createLedger([candidate]),
      reconciliationStore,
      verificationHandler: createVerifier(),
      recordHandler: {
        async recordSettlement() {
          recordCalls += 1;
          return {
            settlementId,
            reason: "receipt_recorded",
            bridgeTxHash: `0x${"55".repeat(32)}`,
            bridgeBlockNumber: 515151,
            recordedAt: Date.now(),
          };
        },
      },
    });

    const firstRun = await worker.runOnce();
    const secondRun = await worker.runOnce();
    const storedRecord = await reconciliationStore.getByRecordId(settlementId);

    expect(firstRun.summary.recordedCount).to.equal(1);
    expect(secondRun.summary.recordedCount).to.equal(1);
    expect(recordCalls).to.equal(1);
    expect(storedRecord.reconciliationState).to.equal("recorded");
  });

  it("blocks candidates before eligible when verification fails", async function () {
    const candidate = createCandidate({ token: "0x0000000000000000000000000000000000000001" });
    const worker = createPaymentReconciliationWorker({
      chainId,
      executorAddress,
      paymentLedger: createLedger([candidate]),
      reconciliationStore: createPaymentReconciliationStoreAdapter({ mode: "memory" }),
      verificationHandler: createVerifier({
        ok: false,
        reason: "token_mismatch",
        tokenMatch: false,
      }),
      recordHandler: {
        async recordSettlement() {
          throw new Error("should not record");
        },
      },
    });

    const result = await worker.runOnce();

    expect(result.summary.eligibleCount).to.equal(0);
    expect(result.summary.exceptionCount).to.equal(1);
    expect(result.records[0].reconciliationState).to.equal("exception");
    expect(result.records[0].verificationReason).to.equal("token_mismatch");
  });

  it("treats txHash + invoiceId as a backend duplicate key and flags later candidates", async function () {
    const firstCandidate = createCandidate({
      requestId: "payment-worker-dup-001",
      requestIdHash: `0x${"cc".repeat(32)}`,
      intentHash: `0x${"dd".repeat(32)}`,
    });
    const secondCandidate = createCandidate({
      requestId: "payment-worker-dup-002",
      requestIdHash: `0x${"ee".repeat(32)}`,
      intentHash: `0x${"ff".repeat(32)}`,
      txHash: firstCandidate.txHash,
      invoiceId: firstCandidate.invoiceId,
    });
    let recordCalls = 0;

    const worker = createPaymentReconciliationWorker({
      chainId,
      executorAddress,
      paymentLedger: createLedger([firstCandidate, secondCandidate]),
      reconciliationStore: createPaymentReconciliationStoreAdapter({ mode: "memory" }),
      verificationHandler: createVerifier(),
      recordHandler: {
        async recordSettlement(candidate) {
          recordCalls += 1;
          return {
            settlementId: buildPaymentSettlementId({
              chainId,
              executorAddress,
              intentHash: candidate.intentHash,
              requestIdHash: candidate.requestIdHash,
            }),
            reason: "receipt_recorded",
            bridgeTxHash: `0x${"66".repeat(32)}`,
            bridgeBlockNumber: 616161,
            recordedAt: Date.now(),
          };
        },
      },
    });

    const result = await worker.runOnce();
    const duplicateRecord = result.records.find(
      (record) => record.requestId === secondCandidate.requestId,
    );

    expect(recordCalls).to.equal(1);
    expect(result.summary.recordedCount).to.equal(1);
    expect(result.summary.exceptionCount).to.equal(1);
    expect(duplicateRecord.reconciliationState).to.equal("exception");
    expect(duplicateRecord.reconciliationReason).to.equal("duplicate_invoice_tx");
  });

  it("retries retryable exception records through the exception queue", async function () {
    const candidate = createCandidate({ requestId: "payment-worker-retry-001" });
    const reconciliationStore = createPaymentReconciliationStoreAdapter({ mode: "memory" });
    let recordCalls = 0;

    const worker = createPaymentReconciliationWorker({
      chainId,
      executorAddress,
      paymentLedger: createLedger([candidate]),
      reconciliationStore,
      verificationHandler: createVerifier(),
      retryExceptionAfterMs: 1,
      recordHandler: {
        async recordSettlement(candidateToRecord) {
          recordCalls += 1;
          if (recordCalls === 1) {
            const error = new Error("temporary bridge outage");
            error.code = "bridge_record_failed";
            throw error;
          }

          return {
            settlementId: buildPaymentSettlementId({
              chainId,
              executorAddress,
              intentHash: candidateToRecord.intentHash,
              requestIdHash: candidateToRecord.requestIdHash,
            }),
            reason: "receipt_recorded",
            bridgeTxHash: `0x${"77".repeat(32)}`,
            bridgeBlockNumber: 717171,
            recordedAt: Date.now(),
          };
        },
      },
    });

    const firstRun = await worker.runOnce();
    await new Promise((resolve) => setTimeout(resolve, 5));
    const secondRun = await worker.runOnce({ retryExceptions: true });

    expect(firstRun.summary.exceptionCount).to.equal(1);
    expect(secondRun.summary.recordedCount).to.equal(1);
    expect(recordCalls).to.equal(2);
    expect(secondRun.records[0].reconciliationState).to.equal("recorded");
  });
});
