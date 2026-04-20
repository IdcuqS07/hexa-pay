'use strict';

const { getSharedRedisClient } = require('./mock-receipt-redis-client.cjs');

function stableStringify(value) {
  return JSON.stringify(value == null ? null : value);
}

function parseJson(raw) {
  if (raw == null) {
    return null;
  }

  return JSON.parse(raw);
}

function nowMs() {
  return Date.now();
}

function createMemoryExecutionDedupeStore() {
  const keys = new Map();

  return {
    mode: 'memory',
    async has(key) {
      return keys.has(String(key));
    },
    async put(key, value) {
      keys.set(String(key), value);
      return value;
    },
    async get(key) {
      return keys.get(String(key)) || null;
    },
    async claim(key, value = {}) {
      const normalizedKey = String(key);

      if (keys.has(normalizedKey)) {
        return {
          ok: false,
          record: keys.get(normalizedKey) || null,
        };
      }

      const record = {
        ...(value && typeof value === 'object' ? value : {}),
        status: 'inflight',
        claimedAt: nowMs(),
      };
      keys.set(normalizedKey, record);

      return {
        ok: true,
        record,
      };
    },
    async finalize(key, value = {}) {
      const record = {
        ...(value && typeof value === 'object' ? value : {}),
        status: 'executed',
        finalizedAt: nowMs(),
      };
      keys.set(String(key), record);
      return {
        ok: true,
        record,
      };
    },
    async release(key) {
      keys.delete(String(key));
      return {
        ok: true,
      };
    },
  };
}

function createRedisExecutionDedupeStore(options = {}) {
  const redis = options.redis || getSharedRedisClient();
  const keyPrefix =
    String(
      options.keyPrefix ||
        process.env.HEXAPAY_EXECUTION_DEDUPE_KEY_PREFIX ||
        'hexapay:execution-dedupe',
    ).trim() || 'hexapay:execution-dedupe';
  const claimTtlMs = Math.max(
    1_000,
    Number(
      options.claimTtlMs ||
        process.env.HEXAPAY_EXECUTION_DEDUPE_TTL_MS ||
        15 * 60 * 1000,
    ) || 15 * 60 * 1000,
  );

  function dedupeKey(key) {
    return `${keyPrefix}:${String(key)}`;
  }

  return {
    mode: 'redis',
    async has(key) {
      return (await redis.exists(dedupeKey(key))) > 0;
    },
    async put(key, value) {
      await redis.set(dedupeKey(key), stableStringify(value));
      return value;
    },
    async get(key) {
      const raw = await redis.get(dedupeKey(key));
      return parseJson(raw);
    },
    async claim(key, value = {}) {
      const record = {
        ...(value && typeof value === 'object' ? value : {}),
        status: 'inflight',
        claimedAt: nowMs(),
      };
      const redisKey = dedupeKey(key);
      const result = await redis.set(
        redisKey,
        stableStringify(record),
        'PX',
        claimTtlMs,
        'NX',
      );

      if (result === 'OK') {
        return {
          ok: true,
          record,
        };
      }

      return {
        ok: false,
        record: await this.get(key),
      };
    },
    async finalize(key, value = {}) {
      const record = {
        ...(value && typeof value === 'object' ? value : {}),
        status: 'executed',
        finalizedAt: nowMs(),
      };
      await redis.set(dedupeKey(key), stableStringify(record));
      return {
        ok: true,
        record,
      };
    },
    async release(key) {
      await redis.del(dedupeKey(key));
      return {
        ok: true,
      };
    },
  };
}

function createExecutionDedupeStore(options = {}) {
  const resolvedMode = String(
    options.mode ||
      process.env.HEXAPAY_EXECUTION_DEDUPE_MODE ||
      (process.env.HEXAPAY_REDIS_URL || process.env.MOCK_RECEIPT_REDIS_URL ? 'redis' : 'memory'),
  )
    .trim()
    .toLowerCase();

  if (resolvedMode === 'redis') {
    return createRedisExecutionDedupeStore(options);
  }

  return createMemoryExecutionDedupeStore();
}

module.exports = {
  createExecutionDedupeStore,
  createMemoryExecutionDedupeStore,
  createRedisExecutionDedupeStore,
};
