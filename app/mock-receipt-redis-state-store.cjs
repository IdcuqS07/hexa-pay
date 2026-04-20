'use strict';

const {
  createJsonStateStoreEntry,
} = require('./mock-receipt-state-store.cjs');
const { getSharedRedisClient } = require('./mock-receipt-redis-client.cjs');

function normalizeRevision(revision) {
  return Math.max(0, Number(revision || 0));
}

function stableStringify(value) {
  return JSON.stringify(value == null ? null : value);
}

function parseJson(raw) {
  if (raw == null) {
    return null;
  }

  return JSON.parse(raw);
}

function createEnvelope(value = null, revision = 0) {
  return {
    __jsonStateStoreEnvelope: true,
    version: 1,
    revision: normalizeRevision(revision),
    value,
  };
}

function parseEnvelope(raw) {
  const parsed = parseJson(raw);

  if (
    parsed &&
    typeof parsed === 'object' &&
    parsed.__jsonStateStoreEnvelope === true
  ) {
    return createJsonStateStoreEntry(parsed.value, parsed.revision);
  }

  return createJsonStateStoreEntry(parsed, 0);
}

class RedisJsonStateStore {
  constructor({ redis, keyPrefix = '', storeId = '' } = {}) {
    this.redis = redis || getSharedRedisClient();
    this.keyPrefix =
      String(
        keyPrefix ||
          process.env.HEXAPAY_REDIS_STATE_KEY_PREFIX ||
          'hexapay:state-store',
      ).trim() || 'hexapay:state-store';
    this.storeId =
      String(storeId || process.env.HEXAPAY_REDIS_STATE_STORE_ID || 'default').trim() ||
      'default';
  }

  get key() {
    return `${this.keyPrefix}:${this.storeId}`;
  }

  describe() {
    return {
      kind: 'redis',
      key: this.key,
    };
  }

  async readEntry() {
    const raw = await this.redis.get(this.key);
    return parseEnvelope(raw);
  }

  async read() {
    return (await this.readEntry()).value;
  }

  async writeEntry(value, { expectedRevision } = {}) {
    const normalizedExpectedRevision =
      expectedRevision === undefined || expectedRevision === null
        ? null
        : normalizeRevision(expectedRevision);

    const lua = `
      local key = KEYS[1]
      local expectedRevisionRaw = ARGV[1]
      local valueJson = ARGV[2]

      local raw = redis.call('GET', key)
      local currentRevision = 0
      local currentValue = cjson.null

      if raw then
        local currentEnvelope = cjson.decode(raw)
        if type(currentEnvelope) == 'table' and currentEnvelope.__jsonStateStoreEnvelope == true then
          currentRevision = tonumber(currentEnvelope.revision or 0)
          currentValue = currentEnvelope.value
        end
      end

      if expectedRevisionRaw ~= '' then
        local expectedRevision = tonumber(expectedRevisionRaw)
        if currentRevision ~= expectedRevision then
          return cjson.encode({
            ok = false,
            conflict = true,
            revision = currentRevision,
            value = currentValue
          })
        end
      end

      local nextRevision = currentRevision + 1
      local nextEnvelope = {
        __jsonStateStoreEnvelope = true,
        version = 1,
        revision = nextRevision,
        value = cjson.decode(valueJson)
      }

      redis.call('SET', key, cjson.encode(nextEnvelope))

      return cjson.encode({
        ok = true,
        conflict = false,
        revision = nextRevision,
        value = nextEnvelope.value
      })
    `;

    const resultRaw = await this.redis.eval(
      lua,
      1,
      this.key,
      normalizedExpectedRevision === null ? '' : String(normalizedExpectedRevision),
      stableStringify(value),
    );
    const result = parseJson(resultRaw) || {};

    return {
      ok: Boolean(result.ok),
      conflict: Boolean(result.conflict),
      ...createJsonStateStoreEntry(result.value, result.revision),
    };
  }

  async write(value, options = {}) {
    return (await this.writeEntry(value, options)).value;
  }

  async clearEntry({ expectedRevision } = {}) {
    const normalizedExpectedRevision =
      expectedRevision === undefined || expectedRevision === null
        ? null
        : normalizeRevision(expectedRevision);

    const lua = `
      local key = KEYS[1]
      local expectedRevisionRaw = ARGV[1]

      local raw = redis.call('GET', key)
      local currentRevision = 0
      local currentValue = cjson.null

      if raw then
        local currentEnvelope = cjson.decode(raw)
        if type(currentEnvelope) == 'table' and currentEnvelope.__jsonStateStoreEnvelope == true then
          currentRevision = tonumber(currentEnvelope.revision or 0)
          currentValue = currentEnvelope.value
        end
      end

      if expectedRevisionRaw ~= '' then
        local expectedRevision = tonumber(expectedRevisionRaw)
        if currentRevision ~= expectedRevision then
          return cjson.encode({
            ok = false,
            conflict = true,
            revision = currentRevision,
            value = currentValue
          })
        end
      end

      redis.call('DEL', key)

      return cjson.encode({
        ok = true,
        conflict = false,
        revision = 0,
        value = cjson.null
      })
    `;

    const resultRaw = await this.redis.eval(
      lua,
      1,
      this.key,
      normalizedExpectedRevision === null ? '' : String(normalizedExpectedRevision),
    );
    const result = parseJson(resultRaw) || {};

    return {
      ok: Boolean(result.ok),
      conflict: Boolean(result.conflict),
      ...createJsonStateStoreEntry(result.value, result.revision),
    };
  }

  async clear(options = {}) {
    return await this.clearEntry(options);
  }
}

module.exports = {
  RedisJsonStateStore,
};
