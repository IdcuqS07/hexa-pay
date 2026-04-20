'use strict';

const { getSharedRedisClient } = require('./mock-receipt-redis-client.cjs');

function stableStringify(value) {
  return JSON.stringify(value == null ? null : value);
}

function parseJson(raw) {
  if (raw == null) return null;
  return JSON.parse(raw);
}

function nowIso() {
  return new Date().toISOString();
}

function createRedisCanonicalReceiptRegistry(options = {}) {
  const redis = options.redis || getSharedRedisClient();
  const storeId = options.storeId || process.env.MOCK_RECEIPT_CANONICAL_STORE_ID || 'default';
  const keyPrefix = options.keyPrefix || process.env.MOCK_RECEIPT_CANONICAL_KEY_PREFIX || 'mock-receipt:canonical';

  function receiptKey(receiptId) {
    if (!receiptId) throw new Error('receiptId is required');
    return `${keyPrefix}:${storeId}:receipt:${receiptId}`;
  }

  async function getCanonicalReceipt(receiptId) {
    const raw = await redis.get(receiptKey(receiptId));
    return parseJson(raw);
  }

  async function putCanonicalReceipt(receiptId, nextRecord) {
    if (!receiptId) throw new Error('receiptId is required');
    if (!nextRecord || typeof nextRecord !== 'object') {
      throw new Error('nextRecord object is required');
    }

    const current = await getCanonicalReceipt(receiptId);
    const nextVersion = current && Number.isFinite(current.version)
      ? current.version + 1
      : 1;

    const stored = {
      ...nextRecord,
      receiptId,
      version: nextVersion,
      updatedAt: nowIso(),
      createdAt: current && current.createdAt ? current.createdAt : nowIso(),
    };

    await redis.set(receiptKey(receiptId), stableStringify(stored));
    return {
      ok: true,
      conflict: false,
      record: stored,
    };
  }

  async function compareAndSetCanonicalReceipt(receiptId, expectedVersion, nextRecord) {
    if (!receiptId) throw new Error('receiptId is required');
    if (!Number.isFinite(expectedVersion)) {
      throw new Error('expectedVersion must be a finite number');
    }
    if (!nextRecord || typeof nextRecord !== 'object') {
      throw new Error('nextRecord object is required');
    }

    const key = receiptKey(receiptId);

    const lua = `
      local key = KEYS[1]
      local expectedVersion = tonumber(ARGV[1])
      local nextPayload = ARGV[2]
      local nowIso = ARGV[3]

      local raw = redis.call('GET', key)
      if not raw then
        return cjson.encode({
          ok = false,
          conflict = true,
          code = "not_found"
        })
      end

      local current = cjson.decode(raw)
      local currentVersion = tonumber(current.version or 0)

      if currentVersion ~= expectedVersion then
        return cjson.encode({
          ok = false,
          conflict = true,
          code = "version_conflict",
          currentVersion = currentVersion
        })
      end

      local nextRecord = cjson.decode(nextPayload)
      nextRecord.receiptId = current.receiptId or nextRecord.receiptId
      nextRecord.createdAt = current.createdAt or nowIso
      nextRecord.updatedAt = nowIso
      nextRecord.version = currentVersion + 1

      redis.call('SET', key, cjson.encode(nextRecord))

      return cjson.encode({
        ok = true,
        conflict = false,
        version = nextRecord.version,
        record = nextRecord
      })
    `;

    const resultRaw = await redis.eval(lua, 1, key, String(expectedVersion), stableStringify(nextRecord), nowIso());
    const result = parseJson(resultRaw);

    if (result && result.record && typeof result.record === 'object') {
      return result;
    }

    const current = await getCanonicalReceipt(receiptId);
    return {
      ok: false,
      conflict: true,
      code: result && result.code ? result.code : 'unknown_conflict',
      currentVersion: current && current.version,
      record: current,
    };
  }

  async function deleteCanonicalReceipt(receiptId) {
    const removed = await redis.del(receiptKey(receiptId));
    return { ok: true, removed: removed > 0 };
  }

  return {
    mode: 'redis',
    type: 'canonical-receipt-registry',
    storeId,

    getCanonicalReceipt,
    putCanonicalReceipt,
    compareAndSetCanonicalReceipt,
    deleteCanonicalReceipt,
  };
}

module.exports = {
  createRedisCanonicalReceiptRegistry,
};
