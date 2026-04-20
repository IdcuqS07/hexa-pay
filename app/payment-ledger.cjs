const path = require("path");
const {
  FileJsonStateStore,
  isJsonStateStore,
} = require("./mock-receipt-state-store.cjs");
const { createLazySharedInstance } = require('./lazy-shared-instance.cjs');
const { RedisJsonStateStore } = require("./mock-receipt-redis-state-store.cjs");

const PAYMENT_LEDGER_VERSION = 1;
const DEFAULT_PAYMENT_LEDGER_MODE = "file";
const DEFAULT_PAYMENT_LEDGER_PATH = path.resolve(
  process.cwd(),
  ".hexapay",
  "payment-ledger.json",
);

function cloneJsonValue(value) {
  if (value === null || value === undefined) {
    return null;
  }

  return JSON.parse(JSON.stringify(value));
}

function nowMs() {
  return Date.now();
}

function normalizeString(value) {
  return String(value || "");
}

function resolvePaymentLedgerMode(mode = "") {
  const normalizedMode = normalizeString(
    mode || process.env.HEXAPAY_PAYMENT_LEDGER_MODE || DEFAULT_PAYMENT_LEDGER_MODE,
  )
    .trim()
    .toLowerCase();

  if (normalizedMode === "memory" || normalizedMode === "redis") {
    return normalizedMode;
  }

  return "file";
}

function resolvePaymentLedgerStoreId(storeId = "") {
  return (
    normalizeString(
      storeId || process.env.HEXAPAY_PAYMENT_LEDGER_STORE_ID || "payments",
    ).trim() || "payments"
  );
}

function resolvePaymentLedgerKeyPrefix(keyPrefix = "") {
  return (
    normalizeString(
      keyPrefix || process.env.HEXAPAY_PAYMENT_LEDGER_KEY_PREFIX || "hexapay:payment-ledger",
    ).trim() || "hexapay:payment-ledger"
  );
}

function normalizeLowerString(value) {
  return normalizeString(value).trim().toLowerCase();
}

function normalizePositiveInteger(value, fallback = 0) {
  const normalized = Math.max(0, Number.parseInt(String(value || fallback), 10) || 0);
  return normalized;
}

function createPaymentLedgerStats() {
  return {
    totalCount: 0,
    challengeCount: 0,
    signedCount: 0,
    executingCount: 0,
    settledCount: 0,
    failedCount: 0,
    lastRequestId: "",
    lastIntentHash: "",
    lastTxHash: "",
    lastUpdatedAt: 0,
  };
}

function normalizeStoredStats(stats) {
  return {
    ...createPaymentLedgerStats(),
    ...(stats && typeof stats === "object" ? stats : {}),
  };
}

function normalizeLifecycleTimestamps(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  return {
    challengeAt: normalizePositiveInteger(source.challengeAt, 0),
    signedAt: normalizePositiveInteger(source.signedAt, 0),
    executingAt: normalizePositiveInteger(source.executingAt, 0),
    settledAt: normalizePositiveInteger(source.settledAt, 0),
    failedAt: normalizePositiveInteger(source.failedAt, 0),
  };
}

function normalizeRecord(record = {}) {
  const lifecycle = normalizeLifecycleTimestamps(record.lifecycle);

  return {
    source: "payment-intent",
    requestId: normalizeString(record.requestId),
    challengeId: normalizeString(record.challengeId),
    receiptId: normalizeString(record.receiptId),
    quoteId: normalizeString(record.quoteId),
    merchantId: normalizeString(record.merchantId),
    terminalId: normalizeString(record.terminalId),
    payer: normalizeString(record.payer),
    merchant: normalizeString(record.merchant),
    token: normalizeString(record.token),
    amount: normalizeString(record.amount),
    currency: normalizeString(record.currency),
    decimals: normalizePositiveInteger(record.decimals, 0),
    signer: normalizeString(record.signer),
    intentHash: normalizeString(record.intentHash),
    requestIdHash: normalizeString(record.requestIdHash),
    txHash: normalizeString(record.txHash),
    blockNumber: normalizePositiveInteger(record.blockNumber, 0),
    status: normalizeString(record.status || "challenge"),
    errorCode: normalizeString(record.errorCode),
    errorMessage: normalizeString(record.errorMessage),
    createdAt: normalizePositiveInteger(record.createdAt, lifecycle.challengeAt || nowMs()),
    updatedAt: normalizePositiveInteger(record.updatedAt, nowMs()),
    lifecycle,
  };
}

function normalizeStoredRecords(records) {
  if (!Array.isArray(records)) {
    return [];
  }

  return records
    .filter((record) => record && typeof record === "object" && normalizeString(record.requestId))
    .map((record) => normalizeRecord(record));
}

function serializeLedgerState(records, stats) {
  return {
    version: PAYMENT_LEDGER_VERSION,
    stats: normalizeStoredStats(stats),
    records: Array.from(records.values()).map((record) => cloneJsonValue(record)),
  };
}

function createLedgerStateFromValue(value) {
  const records = new Map();

  normalizeStoredRecords(value?.records).forEach((record) => {
    records.set(record.requestId, record);
  });

  return {
    records,
    stats: normalizeStoredStats(value?.stats),
  };
}

function buildStatusSummary(records) {
  const byStatus = {
    challenge: 0,
    signed: 0,
    executing: 0,
    settled: 0,
    failed: 0,
  };

  Array.from(records || []).forEach((record) => {
    const status = normalizeString(record?.status || "unknown");
    byStatus[status] = Number(byStatus[status] || 0) + 1;
  });

  return byStatus;
}

function rebuildStats(records) {
  const list = Array.from(records.values());
  const stats = createPaymentLedgerStats();
  const byStatus = buildStatusSummary(list);

  stats.totalCount = list.length;
  stats.challengeCount = Number(byStatus.challenge || 0);
  stats.signedCount = Number(byStatus.signed || 0);
  stats.executingCount = Number(byStatus.executing || 0);
  stats.settledCount = Number(byStatus.settled || 0);
  stats.failedCount = Number(byStatus.failed || 0);

  list.forEach((record) => {
    const updatedAt = normalizePositiveInteger(record.updatedAt, 0);
    if (updatedAt < stats.lastUpdatedAt) {
      return;
    }

    stats.lastUpdatedAt = updatedAt;
    stats.lastRequestId = normalizeString(record.requestId);
    stats.lastIntentHash = normalizeString(record.intentHash);
    stats.lastTxHash = normalizeString(record.txHash);
  });

  return stats;
}

function toSortedRecordList(records) {
  return Array.from(records.values()).sort((left, right) => {
    const rightUpdatedAt = Number(right?.updatedAt || 0);
    const leftUpdatedAt = Number(left?.updatedAt || 0);
    if (rightUpdatedAt !== leftUpdatedAt) {
      return rightUpdatedAt - leftUpdatedAt;
    }

    return normalizeString(right?.requestId).localeCompare(normalizeString(left?.requestId));
  });
}

function matchesWallet(record, wallet) {
  if (!wallet) return true;
  const needle = normalizeLowerString(wallet);
  if (!needle) return true;
  return (
    normalizeLowerString(record.payer) === needle ||
    normalizeLowerString(record.merchant) === needle
  );
}

function matchesMerchant(record, merchant) {
  if (!merchant) return true;
  const rawMerchant = normalizeString(merchant).trim();
  if (!rawMerchant) return true;

  return (
    normalizeLowerString(record.merchant) === normalizeLowerString(rawMerchant) ||
    normalizeString(record.merchantId) === rawMerchant
  );
}

function matchesPayer(record, payer) {
  if (!payer) return true;
  return normalizeLowerString(record.payer) === normalizeLowerString(payer);
}

function matchesStatus(record, status) {
  if (!status) return true;
  return normalizeString(record.status) === normalizeString(status);
}

class MemoryPaymentLedger {
  constructor({ records, stats } = {}) {
    this.records = records instanceof Map ? records : new Map();
    this.stats =
      stats && typeof stats === "object"
        ? {
            ...createPaymentLedgerStats(),
            ...stats,
          }
        : createPaymentLedgerStats();
  }

  describe() {
    return {
      kind: "memory",
    };
  }

  upsertRecord(requestId, patch = {}) {
    const normalizedRequestId = normalizeString(requestId).trim();
    if (!normalizedRequestId) {
      throw new Error("requestId is required for payment ledger updates.");
    }

    const previous = this.records.get(normalizedRequestId) || null;
    const createdAt = Number(previous?.createdAt || patch.createdAt || nowMs());
    const lifecycle = {
      ...normalizeLifecycleTimestamps(previous?.lifecycle),
      ...normalizeLifecycleTimestamps(patch.lifecycle),
    };
    const nextRecord = normalizeRecord({
      ...(previous || {}),
      ...patch,
      requestId: normalizedRequestId,
      createdAt,
      updatedAt: Number(patch.updatedAt || nowMs()),
      lifecycle,
    });

    this.records.set(normalizedRequestId, nextRecord);
    this.stats = rebuildStats(this.records);
    return cloneJsonValue(nextRecord);
  }

  rememberChallenge(challenge = {}) {
    return this.upsertRecord(challenge.requestId, {
      challengeId: challenge.challengeId,
      receiptId: challenge.receiptId,
      quoteId: challenge.quoteId,
      merchantId: challenge.merchantId,
      terminalId: challenge.terminalId,
      payer: challenge.payer,
      merchant: challenge.merchant,
      amount: challenge.amount,
      currency: challenge.currency,
      status: "challenge",
      lifecycle: {
        challengeAt: Number(challenge.issuedAtMs || nowMs()),
      },
      updatedAt: Number(challenge.issuedAtMs || nowMs()),
    });
  }

  markSigned(intent = {}, details = {}) {
    return this.upsertRecord(intent.requestId, {
      challengeId: intent.challengeId,
      receiptId: intent.receiptId,
      quoteId: intent.quoteId,
      merchantId: intent.merchantId,
      terminalId: intent.terminalId,
      payer: intent.payer,
      merchant: intent.merchant,
      token: intent.token,
      amount: intent.amount,
      currency: intent.currency,
      decimals: intent.decimals,
      signer: details.signer,
      intentHash: details.intentHash,
      requestIdHash: details.requestIdHash,
      status: "signed",
      lifecycle: {
        signedAt: Number(details.signedAt || nowMs()),
      },
      updatedAt: Number(details.signedAt || nowMs()),
    });
  }

  markExecuting(intent = {}, details = {}) {
    return this.upsertRecord(intent.requestId, {
      challengeId: intent.challengeId,
      receiptId: intent.receiptId,
      quoteId: intent.quoteId,
      merchantId: intent.merchantId,
      terminalId: intent.terminalId,
      payer: intent.payer,
      merchant: intent.merchant,
      token: intent.token,
      amount: intent.amount,
      currency: intent.currency,
      decimals: intent.decimals,
      signer: details.signer,
      intentHash: details.intentHash,
      requestIdHash: details.requestIdHash,
      status: "executing",
      lifecycle: {
        executingAt: Number(details.executingAt || nowMs()),
      },
      updatedAt: Number(details.executingAt || nowMs()),
    });
  }

  markSettled(intent = {}, execution = {}, details = {}) {
    return this.upsertRecord(intent.requestId, {
      challengeId: intent.challengeId,
      receiptId: intent.receiptId,
      quoteId: intent.quoteId,
      merchantId: intent.merchantId,
      terminalId: intent.terminalId,
      payer: intent.payer,
      merchant: intent.merchant,
      token: intent.token,
      amount: intent.amount,
      currency: intent.currency,
      decimals: intent.decimals,
      signer: details.signer,
      intentHash: details.intentHash,
      requestIdHash: details.requestIdHash,
      txHash: execution.txHash,
      blockNumber: Number(execution.blockNumber || 0),
      status: "settled",
      errorCode: "",
      errorMessage: "",
      lifecycle: {
        settledAt: Number(details.settledAt || nowMs()),
      },
      updatedAt: Number(details.settledAt || nowMs()),
    });
  }

  markFailed(intent = {}, error = null, details = {}) {
    return this.upsertRecord(intent.requestId, {
      challengeId: intent.challengeId,
      receiptId: intent.receiptId,
      quoteId: intent.quoteId,
      merchantId: intent.merchantId,
      terminalId: intent.terminalId,
      payer: intent.payer,
      merchant: intent.merchant,
      token: intent.token,
      amount: intent.amount,
      currency: intent.currency,
      decimals: intent.decimals,
      signer: details.signer,
      intentHash: details.intentHash,
      requestIdHash: details.requestIdHash,
      status: "failed",
      errorCode: normalizeString(error?.code),
      errorMessage: normalizeString(error?.message),
      lifecycle: {
        failedAt: Number(details.failedAt || nowMs()),
      },
      updatedAt: Number(details.failedAt || nowMs()),
    });
  }

  getByRequestId(requestId) {
    const record = this.records.get(normalizeString(requestId).trim()) || null;
    return record ? cloneJsonValue(record) : null;
  }

  list(filters = {}) {
    const allRecords = toSortedRecordList(this.records).filter((record) => {
      return (
        matchesWallet(record, filters.wallet) &&
        matchesMerchant(record, filters.merchant) &&
        matchesPayer(record, filters.payer) &&
        matchesStatus(record, filters.status)
      );
    });

    const limit = normalizePositiveInteger(filters.limit, 0);
    const records = limit > 0 ? allRecords.slice(0, limit) : allRecords;

    return {
      status: "ok",
      statusCode: 200,
      filters: {
        wallet: normalizeString(filters.wallet),
        merchant: normalizeString(filters.merchant),
        payer: normalizeString(filters.payer),
        status: normalizeString(filters.status),
        limit,
      },
      summary: {
        totalCount: allRecords.length,
        returnedCount: records.length,
        byStatus: buildStatusSummary(allRecords),
        updatedAt: nowMs(),
      },
      records: records.map((record) => cloneJsonValue(record)),
    };
  }

  snapshot({ includeRecords = false } = {}) {
    const records = includeRecords ? toSortedRecordList(this.records) : [];

    return {
      status: "ok",
      statusCode: 200,
      summary: {
        ...this.stats,
        byStatus: buildStatusSummary(this.records.values()),
        updatedAt: nowMs(),
      },
      records: includeRecords ? records.map((record) => cloneJsonValue(record)) : [],
    };
  }

  clear() {
    this.records.clear();
    this.stats = createPaymentLedgerStats();
  }
}

class StoreBackedPaymentLedger extends MemoryPaymentLedger {
  constructor({ stateStore, records, stats } = {}) {
    super({ records, stats });
    this.stateStore = isJsonStateStore(stateStore) ? stateStore : null;
    this.stateRevision = 0;
  }

  describe() {
    return {
      ...(this.stateStore?.describe?.() || { kind: "custom" }),
      revision: this.stateRevision,
    };
  }

  async hydrateFromStore() {
    const entry =
      typeof this.stateStore?.readEntry === "function"
        ? await Promise.resolve(this.stateStore.readEntry())
        : {
            value: await Promise.resolve(this.stateStore?.read?.() || null),
            revision: 0,
          };
    const nextState = createLedgerStateFromValue(entry?.value || null);
    this.records = nextState.records;
    this.stats = nextState.stats;
    this.stateRevision = Math.max(0, Number(entry?.revision || 0));
  }

  async persistToStore() {
    if (!this.stateStore) {
      return true;
    }

    const payload = serializeLedgerState(this.records, this.stats);

    if (typeof this.stateStore.writeEntry === "function") {
      const result = await Promise.resolve(this.stateStore.writeEntry(payload, {
        expectedRevision: this.stateRevision,
      }));

      if (!result?.ok) {
        return false;
      }

      this.stateRevision = Math.max(0, Number(result.revision || 0));
      return true;
    }

    await Promise.resolve(this.stateStore.write(payload));
    this.stateRevision += 1;
    return true;
  }

  async clearInStore() {
    if (!this.stateStore) {
      this.stateRevision = 0;
      return true;
    }

    if (typeof this.stateStore.clearEntry === "function") {
      const result = await Promise.resolve(this.stateStore.clearEntry({
        expectedRevision: this.stateRevision,
      }));

      if (!result?.ok) {
        return false;
      }

      this.stateRevision = Math.max(0, Number(result.revision || 0));
      return true;
    }

    await Promise.resolve(this.stateStore.clear());
    this.stateRevision = 0;
    return true;
  }

  async mutateWithRetry(mutator, maxAttempts = 3) {
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      await this.hydrateFromStore();
      const result = mutator();

      if (await this.persistToStore()) {
        return result;
      }
    }

    throw new Error("Payment ledger write conflict could not be resolved.");
  }

  async rememberChallenge(challenge) {
    return this.mutateWithRetry(() => super.rememberChallenge(challenge));
  }

  async markSigned(intent, details) {
    return this.mutateWithRetry(() => super.markSigned(intent, details));
  }

  async markExecuting(intent, details) {
    return this.mutateWithRetry(() => super.markExecuting(intent, details));
  }

  async markSettled(intent, execution, details) {
    return this.mutateWithRetry(() => super.markSettled(intent, execution, details));
  }

  async markFailed(intent, error, details) {
    return this.mutateWithRetry(() => super.markFailed(intent, error, details));
  }

  async getByRequestId(requestId) {
    await this.hydrateFromStore();
    return super.getByRequestId(requestId);
  }

  async list(filters = {}) {
    await this.hydrateFromStore();
    return super.list(filters);
  }

  async snapshot({ includeRecords = false } = {}) {
    await this.hydrateFromStore();
    return super.snapshot({ includeRecords });
  }

  async clear() {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await this.hydrateFromStore();
      super.clear();

      if (await this.clearInStore()) {
        this.stateRevision = 0;
        return;
      }
    }

    throw new Error("Payment ledger clear conflict could not be resolved.");
  }
}

class FilePaymentLedger extends StoreBackedPaymentLedger {
  constructor({ filePath, stateStore, records, stats } = {}) {
    super({
      stateStore:
        stateStore ||
        new FileJsonStateStore({
          filePath: path.resolve(String(filePath || DEFAULT_PAYMENT_LEDGER_PATH)),
        }),
      records,
      stats,
    });
  }
}

function createPaymentLedgerAdapter(options = {}) {
  if (isJsonStateStore(options.stateStore)) {
    return new StoreBackedPaymentLedger(options);
  }

  const mode = resolvePaymentLedgerMode(options.mode);

  if (mode === "memory") {
    return new MemoryPaymentLedger(options);
  }

  if (mode === "redis") {
    return new StoreBackedPaymentLedger({
      ...options,
      stateStore: new RedisJsonStateStore({
        redis: options.redis,
        storeId: resolvePaymentLedgerStoreId(options.storeId),
        keyPrefix: resolvePaymentLedgerKeyPrefix(options.keyPrefix),
      }),
    });
  }

  return new FilePaymentLedger(options);
}

const {
  getInstance: getSharedPaymentLedger,
  shared: sharedPaymentLedger,
} = createLazySharedInstance(() => createPaymentLedgerAdapter());

module.exports = {
  DEFAULT_PAYMENT_LEDGER_MODE,
  DEFAULT_PAYMENT_LEDGER_PATH,
  FilePaymentLedger,
  MemoryPaymentLedger,
  StoreBackedPaymentLedger,
  createPaymentLedgerAdapter,
  createPaymentLedgerStats,
  getSharedPaymentLedger,
  resolvePaymentLedgerKeyPrefix,
  resolvePaymentLedgerMode,
  resolvePaymentLedgerStoreId,
  sharedPaymentLedger,
};
