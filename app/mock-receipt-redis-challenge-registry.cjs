'use strict';

const crypto = require('crypto');
const { getSharedRedisClient } = require('./mock-receipt-redis-client.cjs');

function parseJson(raw) {
  if (raw == null) return null;
  return JSON.parse(raw);
}

function stableStringify(value) {
  return JSON.stringify(value == null ? null : value);
}

function nowMs() {
  return Date.now();
}

function newId() {
  return crypto.randomUUID();
}

function createRedisReceiptGrantChallengeRegistry(options = {}) {
  const redis = options.redis || getSharedRedisClient();
  const storeId = options.storeId || process.env.MOCK_RECEIPT_CHALLENGE_STORE_ID || 'default';
  const keyPrefix = options.keyPrefix || process.env.MOCK_RECEIPT_CHALLENGE_KEY_PREFIX || 'mock-receipt:challenge';
  const defaultTtlMs = Number(process.env.MOCK_RECEIPT_CHALLENGE_TTL_MS || options.defaultTtlMs || 5 * 60 * 1000);

  function challengeKey(challengeId) {
    if (!challengeId) throw new Error('challengeId is required');
    return `${keyPrefix}:${storeId}:challenge:${challengeId}`;
  }

  async function createChallenge(input = {}) {
    const challengeId = input.challengeId || newId();
    const createdAtMs = nowMs();
    const expiresAtMs = Number.isFinite(input.expiresAtMs)
      ? input.expiresAtMs
      : createdAtMs + defaultTtlMs;

    const ttlMs = Math.max(1, expiresAtMs - createdAtMs);

    const record = {
      challengeId,
      receiptId: input.receiptId || null,
      actorId: input.actorId || null,
      scope: input.scope || 'receipt.read',
      permitHash: input.permitHash || null,
      publicKeyFingerprint: input.publicKeyFingerprint || null,
      status: 'active',
      createdAtMs,
      expiresAtMs,
      consumedAtMs: null,
      revokedAtMs: null,
      metadata: input.metadata || null,
    };

    await redis.set(challengeKey(challengeId), stableStringify(record), 'PX', ttlMs);

    return {
      ok: true,
      record,
    };
  }

  async function getChallenge(challengeId) {
    const raw = await redis.get(challengeKey(challengeId));
    const record = parseJson(raw);
    if (!record) return null;

    if (record.expiresAtMs <= nowMs()) {
      return {
        ...record,
        status: record.status === 'active' ? 'expired' : record.status,
      };
    }

    return record;
  }

  async function consumeChallenge(challengeId, context = {}) {
    const key = challengeKey(challengeId);
    const consumedAtMs = nowMs();

    const lua = `
      local key = KEYS[1]
      local consumedAtMs = tonumber(ARGV[1])
      local actorId = ARGV[2]

      local raw = redis.call('GET', key)
      if not raw then
        return cjson.encode({
          ok = false,
          conflict = true,
          code = "not_found"
        })
      end

      local record = cjson.decode(raw)

      if tonumber(record.expiresAtMs or 0) <= consumedAtMs then
        record.status = "expired"
        redis.call('SET', key, cjson.encode(record))
        return cjson.encode({
          ok = false,
          conflict = true,
          code = "expired",
          record = record
        })
      end

      if record.status == "revoked" then
        return cjson.encode({
          ok = false,
          conflict = true,
          code = "revoked",
          record = record
        })
      end

      if record.status == "consumed" then
        return cjson.encode({
          ok = false,
          conflict = true,
          code = "already_consumed",
          record = record
        })
      end

      if record.status ~= "active" then
        return cjson.encode({
          ok = false,
          conflict = true,
          code = "invalid_status",
          record = record
        })
      end

      if actorId ~= "" and record.actorId ~= cjson.null and record.actorId ~= actorId then
        return cjson.encode({
          ok = false,
          conflict = true,
          code = "actor_mismatch",
          record = record
        })
      end

      record.status = "consumed"
      record.consumedAtMs = consumedAtMs
      redis.call('SET', key, cjson.encode(record))

      return cjson.encode({
        ok = true,
        conflict = false,
        record = record
      })
    `;

    const resultRaw = await redis.eval(lua, 1, key, String(consumedAtMs), context.actorId || '');
    return parseJson(resultRaw);
  }

  async function revokeChallenge(challengeId, reason = 'revoked') {
    const key = challengeKey(challengeId);
    const revokedAtMs = nowMs();

    const lua = `
      local key = KEYS[1]
      local revokedAtMs = tonumber(ARGV[1])
      local reason = ARGV[2]

      local raw = redis.call('GET', key)
      if not raw then
        return cjson.encode({
          ok = false,
          code = "not_found"
        })
      end

      local record = cjson.decode(raw)
      record.status = "revoked"
      record.revokedAtMs = revokedAtMs
      record.revokeReason = reason
      redis.call('SET', key, cjson.encode(record))

      return cjson.encode({
        ok = true,
        record = record
      })
    `;

    const resultRaw = await redis.eval(lua, 1, key, String(revokedAtMs), String(reason || 'revoked'));
    return parseJson(resultRaw);
  }

  return {
    mode: 'redis',
    type: 'receipt-grant-challenge-registry',
    storeId,

    createChallenge,
    getChallenge,
    consumeChallenge,
    revokeChallenge,
  };
}

module.exports = {
  createRedisReceiptGrantChallengeRegistry,
};
