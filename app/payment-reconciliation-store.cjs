const path = require("path");
const {
  FileJsonStateStore,
  isJsonStateStore,
} = require("./mock-receipt-state-store.cjs");
const { createLazySharedInstance } = require("./lazy-shared-instance.cjs");
const { RedisJsonStateStore } = require("./mock-receipt-redis-state-store.cjs");
const { normalizeCanonicalInvoiceId } = require("./payment-intent-invoice-binding.cjs");

const PAYMENT_RECONCILIATION_STORE_VERSION = 1;
const DEFAULT_PAYMENT_RECONCILIATION_MODE = "file";
const DEFAULT_PAYMENT_RECONCILIATION_PATH = path.resolve(
  process.cwd(),
  ".hexapay",
  "payment-reconciliation.json",
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

function normalizeLowerString(value) {
  return normalizeString(value).trim().toLowerCase();
}

function normalizePositiveInteger(value, fallback = 0) {
  return Math.max(0, Number.parseInt(String(value || fallback), 10) || 0);
}

function normalizeState(value) {
  const normalized = normalizeLowerString(value);
  if (
    normalized === "observed" ||
    normalized === "eligible" ||
    normalized === "submitted" ||
    normalized === "recorded" ||
    normalized === "applied" ||
    normalized === "exception"
  ) {
    return normalized;
  }

  return "observed";
}

function resolvePaymentReconciliationMode(mode = "") {
  const normalizedMode = normalizeString(
    mode ||
      process.env.HEXAPAY_PAYMENT_RECONCILIATION_MODE ||
      DEFAULT_PAYMENT_RECONCILIATION_MODE,
  )
    .trim()
    .toLowerCase();

  if (normalizedMode === "memory" || normalizedMode === "redis") {
    return normalizedMode;
  }

  return "file";
}

function resolvePaymentReconciliationStoreId(storeId = "") {
  return (
    normalizeString(
      storeId || process.env.HEXAPAY_PAYMENT_RECONCILIATION_STORE_ID || "payment-reconciliation",
    ).trim() || "payment-reconciliation"
  );
}

function resolvePaymentReconciliationKeyPrefix(keyPrefix = "") {
  return (
    normalizeString(
      keyPrefix ||
        process.env.HEXAPAY_PAYMENT_RECONCILIATION_KEY_PREFIX ||
        "hexapay:payment-reconciliation",
    ).trim() || "hexapay:payment-reconciliation"
  );
}

function createPaymentReconciliationStats() {
  return {
    totalCount: 0,
    observedCount: 0,
    eligibleCount: 0,
    submittedCount: 0,
    recordedCount: 0,
    appliedCount: 0,
    exceptionCount: 0,
    lastRecordId: "",
    lastSettlementId: "",
    lastUpdatedAt: 0,
  };
}

function normalizeStoredStats(stats) {
  return {
    ...createPaymentReconciliationStats(),
    ...(stats && typeof stats === "object" ? stats : {}),
  };
}

function normalizeLifecycle(value = {}) {
  const source = value && typeof value === "object" ? value : {};

  return {
    observedAt: normalizePositiveInteger(source.observedAt, 0),
    eligibleAt: normalizePositiveInteger(source.eligibleAt, 0),
    submittedAt: normalizePositiveInteger(source.submittedAt, 0),
    recordedAt: normalizePositiveInteger(source.recordedAt, 0),
    appliedAt: normalizePositiveInteger(source.appliedAt, 0),
    exceptionAt: normalizePositiveInteger(source.exceptionAt, 0),
    lastSeenAt: normalizePositiveInteger(source.lastSeenAt, 0),
  };
}

function normalizeRecord(record = {}) {
  const lifecycle = normalizeLifecycle(record.lifecycle);
  const invoiceId = normalizeCanonicalInvoiceId(record.invoiceId) || normalizeString(record.invoiceId);

  return {
    recordId: normalizeString(record.recordId),
    settlementId: normalizeString(record.settlementId),
    requestId: normalizeString(record.requestId),
    challengeId: normalizeString(record.challengeId),
    receiptId: normalizeString(record.receiptId),
    invoiceId,
    merchantId: normalizeString(record.merchantId),
    terminalId: normalizeString(record.terminalId),
    payer: normalizeString(record.payer),
    merchant: normalizeString(record.merchant),
    token: normalizeString(record.token),
    amount: normalizeString(record.amount),
    currency: normalizeString(record.currency),
    intentHash: normalizeString(record.intentHash),
    requestIdHash: normalizeString(record.requestIdHash),
    txHash: normalizeString(record.txHash),
    blockNumber: normalizePositiveInteger(record.blockNumber, 0),
    paymentStatus: normalizeString(record.paymentStatus),
    sourceReconciliationStatus: normalizeString(record.sourceReconciliationStatus),
    sourceCandidateReason: normalizeString(record.sourceCandidateReason),
    reconciliationState: normalizeState(record.reconciliationState || record.state),
    reconciliationReason: normalizeString(record.reconciliationReason || record.reason),
    verificationStatus: normalizeString(record.verificationStatus),
    verificationReason: normalizeString(record.verificationReason),
    verificationCheckedAt: normalizePositiveInteger(record.verificationCheckedAt, 0),
    retryable: Boolean(record.retryable),
    nextRetryAt: normalizePositiveInteger(record.nextRetryAt, 0),
    duplicateRecordId: normalizeString(record.duplicateRecordId),
    bridgeTxHash: normalizeString(record.bridgeTxHash),
    bridgeBlockNumber: normalizePositiveInteger(record.bridgeBlockNumber, 0),
    attemptCount: normalizePositiveInteger(record.attemptCount, 0),
    lastErrorCode: normalizeString(record.lastErrorCode),
    lastErrorMessage: normalizeString(record.lastErrorMessage),
    createdAt: normalizePositiveInteger(record.createdAt, lifecycle.observedAt || nowMs()),
    updatedAt: normalizePositiveInteger(record.updatedAt, nowMs()),
    lifecycle,
  };
}

function normalizeStoredRecords(records) {
  if (!Array.isArray(records)) {
    return [];
  }

  return records
    .filter((record) => record && typeof record === "object" && normalizeString(record.recordId))
    .map((record) => normalizeRecord(record));
}

function serializeStoreState(records, stats) {
  return {
    version: PAYMENT_RECONCILIATION_STORE_VERSION,
    stats: normalizeStoredStats(stats),
    records: Array.from(records.values()).map((record) => cloneJsonValue(record)),
  };
}

function createStoreStateFromValue(value) {
  const records = new Map();

  normalizeStoredRecords(value?.records).forEach((record) => {
    records.set(record.recordId, record);
  });

  return {
    records,
    stats: normalizeStoredStats(value?.stats),
  };
}

function buildStateSummary(records) {
  const byState = {
    observed: 0,
    eligible: 0,
    submitted: 0,
    recorded: 0,
    applied: 0,
    exception: 0,
  };

  Array.from(records || []).forEach((record) => {
    const state = normalizeState(record?.reconciliationState);
    byState[state] += 1;
  });

  return byState;
}

function rebuildStats(records) {
  const list = Array.from(records.values());
  const stats = createPaymentReconciliationStats();
  const byState = buildStateSummary(list);

  stats.totalCount = list.length;
  stats.observedCount = Number(byState.observed || 0);
  stats.eligibleCount = Number(byState.eligible || 0);
  stats.submittedCount = Number(byState.submitted || 0);
  stats.recordedCount = Number(byState.recorded || 0);
  stats.appliedCount = Number(byState.applied || 0);
  stats.exceptionCount = Number(byState.exception || 0);

  list.forEach((record) => {
    const updatedAt = normalizePositiveInteger(record.updatedAt, 0);
    if (updatedAt < stats.lastUpdatedAt) {
      return;
    }

    stats.lastUpdatedAt = updatedAt;
    stats.lastRecordId = normalizeString(record.recordId);
    stats.lastSettlementId = normalizeString(record.settlementId);
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

    return normalizeString(right?.recordId).localeCompare(normalizeString(left?.recordId));
  });
}

function matchesState(record, state) {
  if (!state) return true;
  return normalizeState(record.reconciliationState) === normalizeState(state);
}

function matchesRecordId(record, recordId) {
  if (!recordId) return true;
  return normalizeString(record.recordId) === normalizeString(recordId);
}

function matchesSettlementId(record, settlementId) {
  if (!settlementId) return true;
  return normalizeString(record.settlementId).toLowerCase() === normalizeString(settlementId).toLowerCase();
}

function matchesRequestId(record, requestId) {
  if (!requestId) return true;
  return normalizeString(record.requestId) === normalizeString(requestId);
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

function matchesTxHash(record, txHash) {
  if (!txHash) return true;
  return normalizeLowerString(record.txHash) === normalizeLowerString(txHash);
}

function matchesInvoiceId(record, invoiceId) {
  if (!invoiceId) return true;
  const needle = normalizeCanonicalInvoiceId(invoiceId);
  if (!needle) {
    return false;
  }

  return normalizeLowerString(record.invoiceId) === normalizeLowerString(needle);
}

class MemoryPaymentReconciliationStore {
  constructor({ records, stats } = {}) {
    this.records = records instanceof Map ? records : new Map();
    this.stats =
      stats && typeof stats === "object"
        ? {
            ...createPaymentReconciliationStats(),
            ...stats,
          }
        : createPaymentReconciliationStats();
  }

  describe() {
    return {
      kind: "memory",
    };
  }

  upsertRecord(recordId, patch = {}) {
    const normalizedRecordId = normalizeString(recordId).trim();
    if (!normalizedRecordId) {
      throw new Error("recordId is required for payment reconciliation updates.");
    }

    const previous = this.records.get(normalizedRecordId) || null;
    const createdAt = Number(previous?.createdAt || patch.createdAt || nowMs());
    const lifecycle = {
      ...normalizeLifecycle(previous?.lifecycle),
      ...normalizeLifecycle(patch.lifecycle),
    };
    const nextRecord = normalizeRecord({
      ...(previous || {}),
      ...patch,
      recordId: normalizedRecordId,
      createdAt,
      updatedAt: Number(patch.updatedAt || nowMs()),
      lifecycle,
    });

    this.records.set(normalizedRecordId, nextRecord);
    this.stats = rebuildStats(this.records);
    return cloneJsonValue(nextRecord);
  }

  observeCandidate(candidate = {}, details = {}) {
    const observedAt = Number(details.observedAt || nowMs());
    const recordId = normalizeString(
      details.recordId || candidate.recordId || candidate.settlementId || candidate.requestId,
    ).trim();

    if (!recordId) {
      throw new Error("recordId is required to observe a reconciliation candidate.");
    }

    const previous = this.records.get(recordId) || null;
    const requestedState = normalizeState(details.state || "observed");
    const previousState = normalizeState(previous?.reconciliationState || "observed");
    const nextState = previous ? previousState : requestedState;

    return this.upsertRecord(recordId, {
      settlementId: details.settlementId || candidate.settlementId,
      requestId: candidate.requestId,
      challengeId: candidate.challengeId,
      receiptId: candidate.receiptId,
      invoiceId: candidate.invoiceId,
      merchantId: candidate.merchantId,
      terminalId: candidate.terminalId,
      payer: candidate.payer,
      merchant: candidate.merchant,
      token: candidate.token,
      amount: candidate.amount,
      currency: candidate.currency,
      intentHash: candidate.intentHash,
      requestIdHash: candidate.requestIdHash,
      txHash: candidate.txHash,
      blockNumber: Number(candidate.blockNumber || 0),
      paymentStatus: candidate.status,
      sourceReconciliationStatus: candidate.reconciliationStatus,
      sourceCandidateReason: candidate.reason,
      reconciliationState: nextState,
      reconciliationReason:
        normalizeString(details.reason) ||
        normalizeString(candidate.reason) ||
        normalizeString(previous?.reconciliationReason),
      lifecycle: {
        observedAt: Number(previous?.lifecycle?.observedAt || observedAt),
        lastSeenAt: Number(details.lastSeenAt || observedAt),
      },
      updatedAt: Number(details.updatedAt || observedAt),
    });
  }

  markState(recordId, details = {}) {
    const previous = this.records.get(normalizeString(recordId).trim()) || null;
    if (!previous) {
      throw new Error("Reconciliation record not found.");
    }

    const nextState = normalizeState(details.state || previous.reconciliationState);
    const stateAt = Number(details.stateAt || nowMs());
    const lifecycle = {
      lastSeenAt: Number(details.lastSeenAt || stateAt),
    };

    if (nextState === "eligible" && !previous.lifecycle?.eligibleAt) {
      lifecycle.eligibleAt = stateAt;
    }
    if (nextState === "submitted" && !previous.lifecycle?.submittedAt) {
      lifecycle.submittedAt = stateAt;
    }
    if (nextState === "recorded" && !previous.lifecycle?.recordedAt) {
      lifecycle.recordedAt = stateAt;
    }
    if (nextState === "applied" && !previous.lifecycle?.appliedAt) {
      lifecycle.appliedAt = stateAt;
    }
    if (nextState === "exception" && !previous.lifecycle?.exceptionAt) {
      lifecycle.exceptionAt = stateAt;
    }

    return this.upsertRecord(recordId, {
      reconciliationState: nextState,
      reconciliationReason:
        normalizeString(details.reason) || normalizeString(previous.reconciliationReason),
      settlementId: details.settlementId || previous.settlementId,
      verificationStatus: details.verificationStatus || previous.verificationStatus,
      verificationReason: details.verificationReason || previous.verificationReason,
      verificationCheckedAt: Number(
        details.verificationCheckedAt || previous.verificationCheckedAt || 0,
      ),
      retryable:
        details.retryable === undefined ? Boolean(previous.retryable) : Boolean(details.retryable),
      nextRetryAt: Number(details.nextRetryAt ?? previous.nextRetryAt ?? 0),
      duplicateRecordId: details.duplicateRecordId || previous.duplicateRecordId,
      bridgeTxHash: details.bridgeTxHash || previous.bridgeTxHash,
      bridgeBlockNumber: Number(details.bridgeBlockNumber || previous.bridgeBlockNumber || 0),
      attemptCount: Number(details.attemptCount ?? previous.attemptCount ?? 0),
      lastErrorCode: details.lastErrorCode || previous.lastErrorCode,
      lastErrorMessage: details.lastErrorMessage || previous.lastErrorMessage,
      lifecycle,
      updatedAt: Number(details.updatedAt || stateAt),
    });
  }

  getByRecordId(recordId) {
    const record = this.records.get(normalizeString(recordId).trim()) || null;
    return record ? cloneJsonValue(record) : null;
  }

  getBySettlementId(settlementId) {
    const needle = normalizeLowerString(settlementId);
    if (!needle) {
      return null;
    }

    const record = toSortedRecordList(this.records).find(
      (entry) => normalizeLowerString(entry.settlementId) === needle,
    );
    return record ? cloneJsonValue(record) : null;
  }

  getByRequestId(requestId) {
    const needle = normalizeString(requestId).trim();
    if (!needle) {
      return null;
    }

    const record = toSortedRecordList(this.records).find(
      (entry) => normalizeString(entry.requestId) === needle,
    );
    return record ? cloneJsonValue(record) : null;
  }

  getByInvoiceTx(invoiceId, txHash, excludeRecordId = "") {
    const normalizedInvoiceId = normalizeCanonicalInvoiceId(invoiceId);
    const normalizedTxHash = normalizeLowerString(txHash);
    const excludedRecordId = normalizeString(excludeRecordId).trim();

    if (!normalizedInvoiceId || !normalizedTxHash) {
      return null;
    }

    const record = toSortedRecordList(this.records).find((entry) => {
      if (excludedRecordId && normalizeString(entry.recordId) === excludedRecordId) {
        return false;
      }

      return (
        normalizeLowerString(entry.invoiceId) === normalizeLowerString(normalizedInvoiceId) &&
        normalizeLowerString(entry.txHash) === normalizedTxHash
      );
    });

    return record ? cloneJsonValue(record) : null;
  }

  list(filters = {}) {
    const allRecords = toSortedRecordList(this.records).filter((record) => {
      return (
        matchesState(record, filters.state) &&
        matchesRecordId(record, filters.recordId) &&
        matchesSettlementId(record, filters.settlementId) &&
        matchesRequestId(record, filters.requestId) &&
        matchesWallet(record, filters.wallet) &&
        matchesMerchant(record, filters.merchant) &&
        matchesPayer(record, filters.payer) &&
        matchesTxHash(record, filters.txHash) &&
        matchesInvoiceId(record, filters.invoiceId)
      );
    });

    const limit = normalizePositiveInteger(filters.limit, 0);
    const records = limit > 0 ? allRecords.slice(0, limit) : allRecords;

    return {
      status: "ok",
      statusCode: 200,
      filters: {
        state: normalizeString(filters.state),
        recordId: normalizeString(filters.recordId),
        settlementId: normalizeString(filters.settlementId),
        requestId: normalizeString(filters.requestId),
        wallet: normalizeString(filters.wallet),
        merchant: normalizeString(filters.merchant),
        payer: normalizeString(filters.payer),
        txHash: normalizeString(filters.txHash),
        invoiceId: normalizeCanonicalInvoiceId(filters.invoiceId),
        limit,
      },
      summary: {
        totalCount: allRecords.length,
        returnedCount: records.length,
        byState: buildStateSummary(allRecords),
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
        byState: buildStateSummary(this.records.values()),
        updatedAt: nowMs(),
      },
      records: includeRecords ? records.map((record) => cloneJsonValue(record)) : [],
    };
  }

  clear() {
    this.records.clear();
    this.stats = createPaymentReconciliationStats();
  }
}

class StoreBackedPaymentReconciliationStore extends MemoryPaymentReconciliationStore {
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
    const nextState = createStoreStateFromValue(entry?.value || null);
    this.records = nextState.records;
    this.stats = nextState.stats;
    this.stateRevision = Math.max(0, Number(entry?.revision || 0));
  }

  async persistToStore() {
    if (!this.stateStore) {
      return true;
    }

    const payload = serializeStoreState(this.records, this.stats);

    if (typeof this.stateStore.writeEntry === "function") {
      const result = await Promise.resolve(
        this.stateStore.writeEntry(payload, {
          expectedRevision: this.stateRevision,
        }),
      );

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
      const result = await Promise.resolve(
        this.stateStore.clearEntry({
          expectedRevision: this.stateRevision,
        }),
      );

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

    throw new Error("Payment reconciliation write conflict could not be resolved.");
  }

  async observeCandidate(candidate, details) {
    return this.mutateWithRetry(() => super.observeCandidate(candidate, details));
  }

  async markState(recordId, details) {
    return this.mutateWithRetry(() => super.markState(recordId, details));
  }

  async getByRecordId(recordId) {
    await this.hydrateFromStore();
    return super.getByRecordId(recordId);
  }

  async getBySettlementId(settlementId) {
    await this.hydrateFromStore();
    return super.getBySettlementId(settlementId);
  }

  async getByRequestId(requestId) {
    await this.hydrateFromStore();
    return super.getByRequestId(requestId);
  }

  async getByInvoiceTx(invoiceId, txHash, excludeRecordId = "") {
    await this.hydrateFromStore();
    return super.getByInvoiceTx(invoiceId, txHash, excludeRecordId);
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

    throw new Error("Payment reconciliation clear conflict could not be resolved.");
  }
}

class FilePaymentReconciliationStore extends StoreBackedPaymentReconciliationStore {
  constructor({ filePath, stateStore, records, stats } = {}) {
    super({
      stateStore:
        stateStore ||
        new FileJsonStateStore({
          filePath: path.resolve(
            String(filePath || process.env.HEXAPAY_PAYMENT_RECONCILIATION_PATH || DEFAULT_PAYMENT_RECONCILIATION_PATH),
          ),
        }),
      records,
      stats,
    });
  }
}

function createPaymentReconciliationStoreAdapter(options = {}) {
  if (isJsonStateStore(options.stateStore)) {
    return new StoreBackedPaymentReconciliationStore(options);
  }

  const mode = resolvePaymentReconciliationMode(options.mode);

  if (mode === "memory") {
    return new MemoryPaymentReconciliationStore(options);
  }

  if (mode === "redis") {
    return new StoreBackedPaymentReconciliationStore({
      ...options,
      stateStore: new RedisJsonStateStore({
        redis: options.redis,
        storeId: resolvePaymentReconciliationStoreId(options.storeId),
        keyPrefix: resolvePaymentReconciliationKeyPrefix(options.keyPrefix),
      }),
    });
  }

  return new FilePaymentReconciliationStore(options);
}

const {
  getInstance: getSharedPaymentReconciliationStore,
  shared: sharedPaymentReconciliationStore,
} = createLazySharedInstance(() => createPaymentReconciliationStoreAdapter());

module.exports = {
  DEFAULT_PAYMENT_RECONCILIATION_MODE,
  DEFAULT_PAYMENT_RECONCILIATION_PATH,
  FilePaymentReconciliationStore,
  MemoryPaymentReconciliationStore,
  StoreBackedPaymentReconciliationStore,
  createPaymentReconciliationStats,
  createPaymentReconciliationStoreAdapter,
  getSharedPaymentReconciliationStore,
  resolvePaymentReconciliationKeyPrefix,
  resolvePaymentReconciliationMode,
  resolvePaymentReconciliationStoreId,
  sharedPaymentReconciliationStore,
};
