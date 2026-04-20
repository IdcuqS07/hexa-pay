const path = require("path");
const {
  FileJsonStateStore,
  isJsonStateStore,
} = require("./mock-receipt-state-store.cjs");
const { HttpJsonStateStore } = require("./mock-receipt-http-state-store.cjs");
const { createLazySharedInstance } = require('./lazy-shared-instance.cjs');
const { createRedisCanonicalReceiptRegistry } = require('./mock-receipt-redis-registry.cjs');

const RECEIPT_REGISTRY_VERSION = 1;
const DEFAULT_RECEIPT_REGISTRY_MODE = "file";
const DEFAULT_RECEIPT_REGISTRY_STORE_ID = "registry";
const DEFAULT_RECEIPT_REGISTRY_PATH = path.resolve(
  process.cwd(),
  ".hexapay",
  "mock-receipt-registry.json",
);

function createReceiptRegistryStats() {
  return {
    savedCount: 0,
    lastSavedAt: 0,
    lastSavedQuoteId: "",
  };
}

function normalizeStoredStats(stats) {
  return {
    ...createReceiptRegistryStats(),
    ...(stats && typeof stats === "object" ? stats : {}),
  };
}

function normalizeStoredRecords(records) {
  if (!Array.isArray(records)) {
    return [];
  }

  return records
    .filter((record) => record && typeof record === "object" && String(record.quoteId || ""))
    .map((record) => JSON.parse(JSON.stringify(record)));
}

function serializeRegistryState(records, stats) {
  return {
    version: RECEIPT_REGISTRY_VERSION,
    stats: normalizeStoredStats(stats),
    records: Array.from(records.values()).map((record) => JSON.parse(JSON.stringify(record))),
  };
}

function createRegistryStateFromValue(value) {
  const records = new Map();
  normalizeStoredRecords(value?.records).forEach((record) => {
    records.set(String(record.quoteId || ""), record);
  });

  return {
    records,
    stats: normalizeStoredStats(value?.stats),
  };
}

function resolveReceiptRegistryMode(mode = "") {
  const normalizedMode = String(
    mode || process.env.MOCK_RECEIPT_REGISTRY_MODE || DEFAULT_RECEIPT_REGISTRY_MODE,
  )
    .trim()
    .toLowerCase();

  if (normalizedMode === "memory" || normalizedMode === "http" || normalizedMode === "redis") {
    return normalizedMode;
  }

  return "file";
}

function createReceiptRegistryHttpHeaders(headers = {}) {
  const nextHeaders = { ...headers };
  const token = String(process.env.MOCK_RECEIPT_PERSISTENCE_TOKEN || "").trim();
  const scopes = String(
    process.env.MOCK_RECEIPT_REGISTRY_HTTP_SCOPES ||
    process.env.MOCK_RECEIPT_PERSISTENCE_CLIENT_SCOPES ||
    "admin"
  ).trim();
  if (token && !nextHeaders.authorization) {
    nextHeaders.authorization = `Bearer ${token}`;
  }
  if (scopes && !nextHeaders["x-mock-receipt-scopes"]) {
    nextHeaders["x-mock-receipt-scopes"] = scopes;
  }
  return nextHeaders;
}

function resolveReceiptRegistryPath(filePath = "") {
  return path.resolve(
    String(
      filePath ||
        process.env.MOCK_RECEIPT_REGISTRY_PATH ||
      DEFAULT_RECEIPT_REGISTRY_PATH,
    ),
  );
}

function resolveReceiptRegistryBaseUrl(baseUrl = "") {
  return String(
    baseUrl || process.env.MOCK_RECEIPT_REGISTRY_BASE_URL || "",
  ).trim();
}

function resolveReceiptRegistryStoreId(storeId = "") {
  return (
    String(
      storeId ||
        process.env.MOCK_RECEIPT_REGISTRY_STORE_ID ||
        DEFAULT_RECEIPT_REGISTRY_STORE_ID,
    ).trim() || DEFAULT_RECEIPT_REGISTRY_STORE_ID
  );
}

class MemoryReceiptRegistry {
  constructor({ records, stats } = {}) {
    this.records = records instanceof Map ? records : new Map();
    this.stats =
      stats && typeof stats === "object"
        ? {
            ...createReceiptRegistryStats(),
            ...stats,
          }
        : createReceiptRegistryStats();
  }

  describe() {
    return {
      kind: "memory",
    };
  }

  save(receipt) {
    if (!receipt?.quoteId) {
      return null;
    }

    const canonicalReceipt = JSON.parse(JSON.stringify(receipt));
    this.records.set(String(canonicalReceipt.quoteId), canonicalReceipt);
    this.stats.savedCount += 1;
    this.stats.lastSavedAt = Number(
      canonicalReceipt.meta?.createdAt || canonicalReceipt.settledAt || Date.now(),
    );
    this.stats.lastSavedQuoteId = String(canonicalReceipt.quoteId || "");
    return canonicalReceipt;
  }

  get(quoteId) {
    return this.records.get(String(quoteId || "")) || null;
  }

  values() {
    return Array.from(this.records.values());
  }

  snapshot({ includeRecords = false } = {}) {
    const summary = {
      ...this.stats,
      retainedCount: this.records.size,
      byStatus: {},
      updatedAt: Date.now(),
    };
    const records = [];

    this.records.forEach((record) => {
      if (!record || typeof record !== "object") {
        return;
      }

      const status = String(record.status || "unknown");
      summary.byStatus[status] = Number(summary.byStatus[status] || 0) + 1;

      if (!includeRecords) {
        return;
      }

      records.push(JSON.parse(JSON.stringify(record)));
    });

    return {
      status: "ok",
      statusCode: 200,
      summary,
      records,
    };
  }

  clear() {
    this.records.clear();
    this.stats = createReceiptRegistryStats();
  }
}

class StoreBackedReceiptRegistry extends MemoryReceiptRegistry {
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
    const parsed = entry?.value || null;
    const nextState = createRegistryStateFromValue(parsed);
    this.records = nextState.records;
    this.stats = nextState.stats;
    this.stateRevision = Math.max(0, Number(entry?.revision || 0));
  }

  async persistToStore() {
    if (!this.stateStore) {
      return true;
    }

    const payload = serializeRegistryState(this.records, this.stats);

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

    throw new Error("Receipt registry write conflict could not be resolved.");
  }

  async save(receipt) {
    return this.mutateWithRetry(() => super.save(receipt));
  }

  async get(quoteId) {
    await this.hydrateFromStore();
    return super.get(quoteId);
  }

  async values() {
    await this.hydrateFromStore();
    return super.values();
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

    throw new Error("Receipt registry clear conflict could not be resolved.");
  }
}

class FileReceiptRegistry extends StoreBackedReceiptRegistry {
  constructor({ filePath, stateStore, records, stats } = {}) {
    super({
      stateStore:
        stateStore ||
        new FileJsonStateStore({
          filePath: resolveReceiptRegistryPath(filePath),
        }),
      records,
      stats,
    });
  }
}

class HttpReceiptRegistry extends StoreBackedReceiptRegistry {
  constructor({ baseUrl, storeId, stateStore, fetchImpl, headers, records, stats } = {}) {
    const resolvedBaseUrl = resolveReceiptRegistryBaseUrl(baseUrl);

    if (!stateStore && !resolvedBaseUrl) {
      throw new Error(
        "HTTP receipt registry mode requires MOCK_RECEIPT_REGISTRY_BASE_URL or baseUrl.",
      );
    }

    super({
      stateStore:
        stateStore ||
        new HttpJsonStateStore({
          baseUrl: resolvedBaseUrl,
          storeId: resolveReceiptRegistryStoreId(storeId),
          fetchImpl,
          headers: createReceiptRegistryHttpHeaders(headers),
          scopeMap: {
            get: ["canonical:read"],
            set: ["canonical:write"],
            delete: ["canonical:write"],
            cas: ["canonical:write"],
            debug: ["admin"],
          },
        }),
      records,
      stats,
    });
  }
}

function createReceiptRegistryAdapter(options = {}) {
  if (isJsonStateStore(options.stateStore)) {
    return new StoreBackedReceiptRegistry(options);
  }

  const mode = resolveReceiptRegistryMode(options.mode);

  if (mode === "redis") {
    return createRedisCanonicalReceiptRegistry({
      redis: options.redis,
      storeId: options.storeId || resolveReceiptRegistryStoreId(options.storeId),
      keyPrefix: options.keyPrefix,
    });
  }

  if (mode === "memory") {
    return new MemoryReceiptRegistry(options);
  }

  if (mode === "http") {
    return new HttpReceiptRegistry(options);
  }

  return new FileReceiptRegistry(options);
}

const {
  getInstance: getSharedMockReceiptRegistry,
  shared: sharedMockReceiptRegistry,
} = createLazySharedInstance(() => createReceiptRegistryAdapter());

module.exports = {
  DEFAULT_RECEIPT_REGISTRY_MODE,
  DEFAULT_RECEIPT_REGISTRY_PATH,
  DEFAULT_RECEIPT_REGISTRY_STORE_ID,
  FileReceiptRegistry,
  HttpReceiptRegistry,
  MemoryReceiptRegistry,
  StoreBackedReceiptRegistry,
  createReceiptRegistryAdapter,
  createReceiptRegistryHttpHeaders,
  createReceiptRegistryStats,
  getSharedMockReceiptRegistry,
  resolveReceiptRegistryBaseUrl,
  resolveReceiptRegistryMode,
  resolveReceiptRegistryPath,
  resolveReceiptRegistryStoreId,
  sharedMockReceiptRegistry,
};
