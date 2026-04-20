import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const { createRedisCanonicalReceiptRegistry } = require('../../app/mock-receipt-redis-registry.cjs');
const { createRedisReceiptGrantChallengeRegistry } = require('../../app/mock-receipt-redis-challenge-registry.cjs');
const { getSharedRedisClient, closeSharedRedisClient } = require('../../app/mock-receipt-redis-client.cjs');

async function main() {
  const redis = getSharedRedisClient();

  const canonical = createRedisCanonicalReceiptRegistry({
    redis,
    storeId: 'smoke',
  });

  const challenges = createRedisReceiptGrantChallengeRegistry({
    redis,
    storeId: 'smoke',
    defaultTtlMs: 60_000,
  });

  const receiptId = `rcpt_${Date.now()}`;

  const put1 = await canonical.putCanonicalReceipt(receiptId, {
    status: 'draft',
    amount: 1000,
  });

  assert.equal(put1.ok, true);
  assert.equal(put1.record.version, 1);

  const casOk = await canonical.compareAndSetCanonicalReceipt(receiptId, 1, {
    status: 'issued',
    amount: 1000,
  });

  assert.equal(casOk.ok, true);
  assert.equal(casOk.record.version, 2);

  const casConflict = await canonical.compareAndSetCanonicalReceipt(receiptId, 1, {
    status: 'paid',
    amount: 1000,
  });

  assert.equal(casConflict.ok, false);
  assert.equal(casConflict.conflict, true);

  const challengeCreated = await challenges.createChallenge({
    receiptId,
    actorId: 'payer_123',
    scope: 'receipt.read',
  });

  assert.equal(challengeCreated.ok, true);

  const challengeId = challengeCreated.record.challengeId;

  const challengeFetched = await challenges.getChallenge(challengeId);
  assert.equal(challengeFetched.status, 'active');

  const consumed = await challenges.consumeChallenge(challengeId, {
    actorId: 'payer_123',
  });

  assert.equal(consumed.ok, true);
  assert.equal(consumed.record.status, 'consumed');

  const secondConsume = await challenges.consumeChallenge(challengeId, {
    actorId: 'payer_123',
  });

  assert.equal(secondConsume.ok, false);
  assert.equal(secondConsume.code, 'already_consumed');

  console.log('[ok] redis adapter smoke passed');
  await closeSharedRedisClient();
}

main().catch(async (err) => {
  console.error(err);
  try {
    await closeSharedRedisClient();
  } catch {}
  process.exit(1);
});
