'use strict';

const Redis = require('ioredis');

let sharedClient = null;

function resolveBooleanEnvFlag(value, fallback) {
  const normalized = String(value ?? '').trim().toLowerCase();

  if (!normalized) {
    return fallback;
  }

  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }

  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }

  return fallback;
}

function createRedisClientFromEnv() {
  const url =
    process.env.HEXAPAY_REDIS_URL ||
    process.env.MOCK_RECEIPT_REDIS_URL ||
    'redis://127.0.0.1:6379';
  const lazyConnect = resolveBooleanEnvFlag(
    process.env.HEXAPAY_REDIS_LAZY_CONNECT ?? process.env.MOCK_RECEIPT_REDIS_LAZY_CONNECT,
    true,
  );

  const client = new Redis(url, {
    lazyConnect,
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
  });

  client.on('error', (err) => {
    console.error('[mock-receipt][redis] client error:', err && err.message ? err.message : err);
  });

  return client;
}

function getSharedRedisClient() {
  if (!sharedClient) {
    sharedClient = createRedisClientFromEnv();
  }
  return sharedClient;
}

async function closeSharedRedisClient() {
  if (sharedClient) {
    const client = sharedClient;
    sharedClient = null;
    await client.quit();
  }
}

module.exports = {
  createRedisClientFromEnv,
  getSharedRedisClient,
  closeSharedRedisClient,
  resolveBooleanEnvFlag,
};
