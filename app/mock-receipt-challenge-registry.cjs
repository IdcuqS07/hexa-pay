const path = require("path");
const { ReceiptRoles } = require("./mock-receipt-policy.cjs");
const {
  FileJsonStateStore,
  isJsonStateStore,
} = require("./mock-receipt-state-store.cjs");
const { HttpJsonStateStore } = require("./mock-receipt-http-state-store.cjs");
const { createRedisReceiptGrantChallengeRegistry } = require('./mock-receipt-redis-challenge-registry.cjs');

const RECEIPT_GRANT_CHALLENGE_REGISTRY_VERSION = 1;
const DEFAULT_RECEIPT_GRANT_CHALLENGE_REGISTRY_MODE = "file";
const DEFAULT_RECEIPT_GRANT_CHALLENGE_REGISTRY_STORE_ID = "challenges";
const DEFAULT_RECEIPT_GRANT_CHALLENGE_REGISTRY_PATH = path.resolve(
  process.cwd(),
  ".hexapay",
  "mock-receipt-challenge-registry.json",
);

function createReceiptGrantChallengeStats() {
  return {
    issuedCount: 0,
    consumedCount: 0,
    deniedConsumedCount: 0,
    deniedUnrecognizedCount: 0,
    prunedCount: 0,
    lastIssuedAt: 0,
    lastConsumedAt: 0,
    lastPrunedAt: 0,
  };
}

function normalizeStoredStats(stats) {
  return {
    ...createReceiptGrantChallengeStats(),
    ...(stats && typeof stats === "object" ? stats : {}),
  };
}

function normalizeStoredRecords(records) {
  if (!Array.isArray(records)) {
    return [];
  }

  return records
    .filter((record) => record && typeof record === "object" && String(record.token || ""))
    .map((record) => ({
      token: String(record.token || ""),
      issuer: String(record.issuer || ""),
      keyId: String(record.keyId || ""),
      role: String(record.role || ""),
      viewer: String(record.viewer || ""),
      quoteId: String(record.quoteId || ""),
      chainId: String(record.chainId || ""),
      nonce: String(record.nonce || ""),
      actorId: String(record.actorId || ""),
      permitHash: String(record.permitHash || ""),
      sessionId: String(record.sessionId || ""),
      deviceFingerprint: String(record.deviceFingerprint || ""),
      reservedAt: Number(record.reservedAt || 0),
      reservedContextKey: String(record.reservedContextKey || ""),
      issuedAt: Number(record.issuedAt || 0),
      expiresAt: Number(record.expiresAt || 0),
      consumedAt: Number(record.consumedAt || 0),
    }));
}

function serializeRegistryState(records, stats) {
  return {
    version: RECEIPT_GRANT_CHALLENGE_REGISTRY_VERSION,
    stats: normalizeStoredStats(stats),
    records: Array.from(records.values()).map((record) => ({
      token: String(record.token || ""),
      issuer: String(record.issuer || ""),
      keyId: String(record.keyId || ""),
      role: String(record.role || ""),
      viewer: String(record.viewer || ""),
      quoteId: String(record.quoteId || ""),
      chainId: String(record.chainId || ""),
      nonce: String(record.nonce || ""),
      actorId: String(record.actorId || ""),
      permitHash: String(record.permitHash || ""),
      sessionId: String(record.sessionId || ""),
      deviceFingerprint: String(record.deviceFingerprint || ""),
      reservedAt: Number(record.reservedAt || 0),
      reservedContextKey: String(record.reservedContextKey || ""),
      issuedAt: Number(record.issuedAt || 0),
      expiresAt: Number(record.expiresAt || 0),
      consumedAt: Number(record.consumedAt || 0),
    })),
  };
}

function normalizeConsumeContext(context = {}) {
  return {
    actorId: String(context.actorId || ""),
    permitHash: String(context.permitHash || ""),
    sessionId: String(context.sessionId || ""),
    deviceFingerprint: String(context.deviceFingerprint || context.deviceFingerprintHash || ""),
  };
}

function buildConsumeContextKey(context = {}) {
  const normalizedContext = normalizeConsumeContext(context);
  return JSON.stringify([
    normalizedContext.actorId,
    normalizedContext.permitHash,
    normalizedContext.sessionId,
    normalizedContext.deviceFingerprint,
  ]);
}

function createRegistryStateFromValue(value) {
  const records = new Map();
  normalizeStoredRecords(value?.records).forEach((record) => {
    records.set(record.token, record);
  });

  return {
    records,
    stats: normalizeStoredStats(value?.stats),
  };
}

function resolveReceiptGrantChallengeRegistryMode(mode = "") {
  const normalizedMode = String(
    mode || process.env.MOCK_RECEIPT_CHALLENGE_REGISTRY_MODE || DEFAULT_RECEIPT_GRANT_CHALLENGE_REGISTRY_MODE,
  )
    .trim()
    .toLowerCase();

  if (normalizedMode === "memory" || normalizedMode === "http" || normalizedMode === "redis") {
    return normalizedMode;
  }

  return "file";
}

function createReceiptGrantChallengeRegistryHttpHeaders(headers = {}) {
  const nextHeaders = { ...headers };
  const token = String(process.env.MOCK_RECEIPT_PERSISTENCE_TOKEN || "").trim();
  const scopes = String(
    process.env.MOCK_RECEIPT_CHALLENGE_REGISTRY_HTTP_SCOPES ||
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

function resolveReceiptGrantChallengeRegistryPath(filePath = "") {
  return path.resolve(
    String(
      filePath ||
        process.env.MOCK_RECEIPT_CHALLENGE_REGISTRY_PATH ||
      DEFAULT_RECEIPT_GRANT_CHALLENGE_REGISTRY_PATH,
    ),
  );
}

function resolveReceiptGrantChallengeRegistryBaseUrl(baseUrl = "") {
  return String(
    baseUrl || process.env.MOCK_RECEIPT_CHALLENGE_REGISTRY_BASE_URL || "",
  ).trim();
}

function resolveReceiptGrantChallengeRegistryStoreId(storeId = "") {
  return (
    String(
      storeId ||
        process.env.MOCK_RECEIPT_CHALLENGE_REGISTRY_STORE_ID ||
        DEFAULT_RECEIPT_GRANT_CHALLENGE_REGISTRY_STORE_ID,
    ).trim() || DEFAULT_RECEIPT_GRANT_CHALLENGE_REGISTRY_STORE_ID
  );
}

class MemoryReceiptGrantChallengeRegistry {
  constructor({ records, stats } = {}) {
    this.records = records instanceof Map ? records : new Map();
    this.stats =
      stats && typeof stats === "object"
        ? {
            ...createReceiptGrantChallengeStats(),
            ...stats,
          }
        : createReceiptGrantChallengeStats();
  }

  describe() {
    return {
      kind: "memory",
    };
  }

  pruneInMemory(now = Date.now()) {
    let prunedCount = 0;

    this.records.forEach((entry, token) => {
      if (!entry || typeof entry !== "object") {
        this.records.delete(token);
        prunedCount += 1;
        return;
      }

      const expiresAt = Number(entry.expiresAt || 0);

      if (!expiresAt || expiresAt <= now) {
        this.records.delete(token);
        prunedCount += 1;
      }
    });

    if (prunedCount > 0) {
      this.stats.prunedCount += prunedCount;
      this.stats.lastPrunedAt = Number(now || Date.now());
    }

    return prunedCount;
  }

  prune(now = Date.now()) {
    return this.pruneInMemory(now);
  }

  remember(parsedChallenge) {
    if (!parsedChallenge?.raw) {
      return null;
    }

    this.pruneInMemory();
    this.records.set(parsedChallenge.raw, {
      token: parsedChallenge.raw,
      issuer: parsedChallenge.issuer,
      keyId: parsedChallenge.keyId,
      role: parsedChallenge.role,
      viewer: parsedChallenge.viewer,
      quoteId: parsedChallenge.quoteId,
      chainId: parsedChallenge.chainId,
      nonce: parsedChallenge.nonce,
      actorId: parsedChallenge.actorId || "",
      permitHash: parsedChallenge.permitHash || "",
      sessionId: parsedChallenge.sessionId || "",
      deviceFingerprint: parsedChallenge.deviceFingerprint || "",
      reservedAt: 0,
      reservedContextKey: "",
      issuedAt: parsedChallenge.issuedAt,
      expiresAt: parsedChallenge.expiresAt,
      consumedAt: 0,
    });
    this.stats.issuedCount += 1;
    this.stats.lastIssuedAt = Number(parsedChallenge.issuedAt || Date.now());
    return parsedChallenge;
  }

  get(challengeToken) {
    this.pruneInMemory();
    return this.getInMemory(challengeToken);
  }

  getInMemory(challengeToken) {
    return this.records.get(String(challengeToken || "")) || null;
  }

  validateConsumeAttempt(challengeRecord, context = {}, at = Date.now(), allowReserved = false) {
    if (!challengeRecord) {
      return {
        ok: false,
        code: "challenge_not_found",
        record: null,
      };
    }

    if (Number(challengeRecord.consumedAt || 0) > 0) {
      this.stats.deniedConsumedCount += 1;
      return {
        ok: false,
        conflict: true,
        code: "already_consumed",
        record: challengeRecord,
      };
    }

    const now = Number(at || Date.now());
    if (Number(challengeRecord.expiresAt || 0) > 0 && challengeRecord.expiresAt <= now) {
      return {
        ok: false,
        code: "expired",
        record: challengeRecord,
      };
    }

    const normalizedContext = normalizeConsumeContext(context);

    if (
      challengeRecord.actorId &&
      normalizedContext.actorId &&
      challengeRecord.actorId !== normalizedContext.actorId
    ) {
      return {
        ok: false,
        conflict: true,
        code: "actor_mismatch",
        record: challengeRecord,
      };
    }

    if (
      challengeRecord.permitHash &&
      normalizedContext.permitHash &&
      challengeRecord.permitHash !== normalizedContext.permitHash
    ) {
      return {
        ok: false,
        conflict: true,
        code: "permit_mismatch",
        record: challengeRecord,
      };
    }

    if (
      challengeRecord.sessionId &&
      normalizedContext.sessionId &&
      challengeRecord.sessionId !== normalizedContext.sessionId
    ) {
      return {
        ok: false,
        conflict: true,
        code: "session_mismatch",
        record: challengeRecord,
      };
    }

    if (
      challengeRecord.deviceFingerprint &&
      normalizedContext.deviceFingerprint &&
      challengeRecord.deviceFingerprint !== normalizedContext.deviceFingerprint
    ) {
      return {
        ok: false,
        conflict: true,
        code: "device_mismatch",
        record: challengeRecord,
      };
    }

    const contextKey = buildConsumeContextKey(normalizedContext);
    const reservedAt = Number(challengeRecord.reservedAt || 0);
    const reservedContextKey = String(challengeRecord.reservedContextKey || "");

    if (reservedAt > 0) {
      if (!allowReserved) {
        return {
          ok: false,
          conflict: true,
          code: "challenge_in_flight",
          record: challengeRecord,
        };
      }

      if (reservedContextKey && reservedContextKey !== contextKey) {
        return {
          ok: false,
          conflict: true,
          code: "reservation_mismatch",
          record: challengeRecord,
        };
      }
    }

    return {
      ok: true,
      code: "validated",
      now,
      record: challengeRecord,
      context: normalizedContext,
      contextKey,
    };
  }

  reserveConsume(challengeToken, context = {}, reservedAt = Date.now()) {
    this.pruneInMemory();
    const challengeRecord = this.getInMemory(challengeToken);
    const validation = this.validateConsumeAttempt(challengeRecord, context, reservedAt, false);

    if (!validation.ok) {
      return validation;
    }

    const nextRecord = {
      ...challengeRecord,
      reservedAt: validation.now,
      reservedContextKey: validation.contextKey,
    };
    this.records.set(challengeRecord.token, nextRecord);

    return {
      ok: true,
      code: "reserved",
      record: nextRecord,
    };
  }

  commitConsume(challengeToken, context = {}, consumedAt = Date.now()) {
    this.pruneInMemory();
    const challengeRecord = this.getInMemory(challengeToken);
    const validation = this.validateConsumeAttempt(challengeRecord, context, consumedAt, true);

    if (!validation.ok) {
      return validation;
    }

    const nextRecord = {
      ...challengeRecord,
      reservedAt: 0,
      reservedContextKey: "",
      consumedAt: validation.now,
    };
    this.records.set(challengeRecord.token, nextRecord);

    this.stats.consumedCount += 1;
    this.stats.lastConsumedAt = nextRecord.consumedAt;

    return {
      ok: true,
      code: "consumed",
      record: nextRecord,
    };
  }

  releaseConsume(challengeToken, context = {}) {
    this.pruneInMemory();
    const challengeRecord = this.getInMemory(challengeToken);

    if (!challengeRecord) {
      return {
        ok: false,
        code: "challenge_not_found",
        record: null,
      };
    }

    if (Number(challengeRecord.consumedAt || 0) > 0) {
      return {
        ok: false,
        conflict: true,
        code: "already_consumed",
        record: challengeRecord,
      };
    }

    if (Number(challengeRecord.reservedAt || 0) <= 0) {
      return {
        ok: true,
        code: "not_reserved",
        record: challengeRecord,
      };
    }

    const contextKey = buildConsumeContextKey(context);
    if (
      challengeRecord.reservedContextKey &&
      contextKey &&
      challengeRecord.reservedContextKey !== contextKey
    ) {
      return {
        ok: false,
        conflict: true,
        code: "reservation_mismatch",
        record: challengeRecord,
      };
    }

    const nextRecord = {
      ...challengeRecord,
      reservedAt: 0,
      reservedContextKey: "",
    };
    this.records.set(challengeRecord.token, nextRecord);

    return {
      ok: true,
      code: "released",
      record: nextRecord,
    };
  }

  consume(challengeToken, context = {}, consumedAt = Date.now()) {
    const reserveResult = MemoryReceiptGrantChallengeRegistry.prototype.reserveConsume.call(
      this,
      challengeToken,
      context,
      consumedAt,
    );
    if (!reserveResult?.ok) {
      return reserveResult;
    }

    return MemoryReceiptGrantChallengeRegistry.prototype.commitConsume.call(
      this,
      challengeToken,
      context,
      consumedAt,
    );
  }

  markDenial(code) {
    switch (String(code || "")) {
      case "receipt-challenge-consumed":
        this.stats.deniedConsumedCount += 1;
        break;
      case "receipt-challenge-unrecognized":
        this.stats.deniedUnrecognizedCount += 1;
        break;
      default:
        break;
    }
  }

  snapshot({ includeRecords = false } = {}) {
    this.pruneInMemory();
    const summary = {
      ...this.stats,
      retainedCount: this.records.size,
      activeCount: 0,
      pendingCount: 0,
      consumedRetainedCount: 0,
      activeByRole: {
        [ReceiptRoles.MERCHANT]: 0,
        [ReceiptRoles.PAYER]: 0,
        [ReceiptRoles.AUDITOR]: 0,
      },
      updatedAt: Date.now(),
    };
    const records = [];

    this.records.forEach((entry) => {
      if (!entry || typeof entry !== "object") {
        return;
      }

      const consumed = Number(entry.consumedAt || 0) > 0;
      const reserved = Number(entry.reservedAt || 0) > 0;
      const state = consumed ? "consumed" : reserved ? "reserved" : "active";

      if (consumed) {
        summary.consumedRetainedCount += 1;
      } else if (reserved) {
        summary.pendingCount += 1;
      } else {
        summary.activeCount += 1;
        if (Object.hasOwn(summary.activeByRole, String(entry.role || ""))) {
          summary.activeByRole[String(entry.role || "")] += 1;
        }
      }

      if (!includeRecords) {
        return;
      }

      records.push({
        token: entry.token,
        issuer: entry.issuer,
        keyId: entry.keyId,
        role: entry.role,
        viewer: entry.viewer,
        quoteId: entry.quoteId,
        chainId: entry.chainId,
        nonce: entry.nonce,
        state,
        issuedAt: entry.issuedAt,
        expiresAt: entry.expiresAt,
        reservedAt: entry.reservedAt,
        consumedAt: entry.consumedAt,
        ttlMsRemaining: Math.max(0, Number(entry.expiresAt || 0) - Date.now()),
      });
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
    this.stats = createReceiptGrantChallengeStats();
  }
}

class StoreBackedReceiptGrantChallengeRegistry extends MemoryReceiptGrantChallengeRegistry {
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

    throw new Error("Receipt challenge registry write conflict could not be resolved.");
  }

  async prune(now = Date.now()) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await this.hydrateFromStore();
      const prunedCount = super.prune(now);

      if (prunedCount <= 0) {
        return 0;
      }

      if (await this.persistToStore()) {
        return prunedCount;
      }
    }

    throw new Error("Receipt challenge registry prune conflict could not be resolved.");
  }

  async remember(parsedChallenge) {
    return this.mutateWithRetry(() => super.remember(parsedChallenge));
  }

  async get(challengeToken) {
    await this.hydrateFromStore();
    return super.get(challengeToken);
  }

  async consume(challengeToken, context = {}, consumedAt = Date.now()) {
    return this.mutateWithRetry(() => super.consume(challengeToken, context, consumedAt));
  }

  async reserveConsume(challengeToken, context = {}, reservedAt = Date.now()) {
    return this.mutateWithRetry(() => super.reserveConsume(challengeToken, context, reservedAt));
  }

  async commitConsume(challengeToken, context = {}, consumedAt = Date.now()) {
    return this.mutateWithRetry(() => super.commitConsume(challengeToken, context, consumedAt));
  }

  async releaseConsume(challengeToken, context = {}) {
    return this.mutateWithRetry(() => super.releaseConsume(challengeToken, context));
  }

  async markDenial(code) {
    await this.mutateWithRetry(() => {
      super.markDenial(code);
      return null;
    });
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

    throw new Error("Receipt challenge registry clear conflict could not be resolved.");
  }
}

class FileReceiptGrantChallengeRegistry extends StoreBackedReceiptGrantChallengeRegistry {
  constructor({ filePath, stateStore, records, stats } = {}) {
    super({
      stateStore:
        stateStore ||
        new FileJsonStateStore({
          filePath: resolveReceiptGrantChallengeRegistryPath(filePath),
        }),
      records,
      stats,
    });
  }
}

class HttpReceiptGrantChallengeRegistry extends StoreBackedReceiptGrantChallengeRegistry {
  constructor({ baseUrl, storeId, stateStore, fetchImpl, headers, records, stats } = {}) {
    const resolvedBaseUrl = resolveReceiptGrantChallengeRegistryBaseUrl(baseUrl);

    if (!stateStore && !resolvedBaseUrl) {
      throw new Error(
        "HTTP receipt challenge registry mode requires MOCK_RECEIPT_CHALLENGE_REGISTRY_BASE_URL or baseUrl.",
      );
    }

    super({
      stateStore:
        stateStore ||
        new HttpJsonStateStore({
          baseUrl: resolvedBaseUrl,
          storeId: resolveReceiptGrantChallengeRegistryStoreId(storeId),
          fetchImpl,
          headers: createReceiptGrantChallengeRegistryHttpHeaders(headers),
          scopeMap: {
            get: ["challenge:read"],
            set: ["challenge:write"],
            delete: ["challenge:write"],
            cas: ["challenge:write"],
            debug: ["admin"],
          },
        }),
      records,
      stats,
    });
  }
}

function createReceiptGrantChallengeRegistryAdapter(options = {}) {
  if (isJsonStateStore(options.stateStore)) {
    return new StoreBackedReceiptGrantChallengeRegistry(options);
  }

  const mode = resolveReceiptGrantChallengeRegistryMode(options.mode);

  if (mode === "redis") {
    return createRedisReceiptGrantChallengeRegistry({
      redis: options.redis,
      storeId: options.storeId || resolveReceiptGrantChallengeRegistryStoreId(options.storeId),
      keyPrefix: options.keyPrefix,
      defaultTtlMs: options.defaultTtlMs,
    });
  }

  if (mode === "memory") {
    return new MemoryReceiptGrantChallengeRegistry(options);
  }

  if (mode === "http") {
    return new HttpReceiptGrantChallengeRegistry(options);
  }

  return new FileReceiptGrantChallengeRegistry(options);
}

const sharedMockReceiptGrantChallengeRegistry = createReceiptGrantChallengeRegistryAdapter();

module.exports = {
  DEFAULT_RECEIPT_GRANT_CHALLENGE_REGISTRY_MODE,
  DEFAULT_RECEIPT_GRANT_CHALLENGE_REGISTRY_PATH,
  DEFAULT_RECEIPT_GRANT_CHALLENGE_REGISTRY_STORE_ID,
  FileReceiptGrantChallengeRegistry,
  HttpReceiptGrantChallengeRegistry,
  MemoryReceiptGrantChallengeRegistry,
  StoreBackedReceiptGrantChallengeRegistry,
  createReceiptGrantChallengeRegistryAdapter,
  createReceiptGrantChallengeRegistryHttpHeaders,
  createReceiptGrantChallengeStats,
  resolveReceiptGrantChallengeRegistryBaseUrl,
  resolveReceiptGrantChallengeRegistryMode,
  resolveReceiptGrantChallengeRegistryPath,
  resolveReceiptGrantChallengeRegistryStoreId,
  sharedMockReceiptGrantChallengeRegistry,
};
