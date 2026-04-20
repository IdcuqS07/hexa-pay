# Private Quotes Bootstrap Acceptance

This document tracks acceptance criteria for the Private Quotes bootstrap implementation with authenticated persistence control plane.

---

## Milestone 3 acceptance — authenticated persistence control plane

### Summary

This acceptance block verifies that:
- HTTP-backed persistence adapters send auth + scoped headers
- debug/state routes are no longer exposed by default in non-dev
- local `_state` exposure is limited to local-state-backed adapters only
- canonical and challenge persistence paths preserve existing service/API contracts

---

## Acceptance criteria

### A. HTTP registry and challenge adapters carry auth headers

#### Expected
- `HttpReceiptRegistry` sends:
  - `Authorization: Bearer <token>` when `MOCK_RECEIPT_PERSISTENCE_TOKEN` is configured
  - `x-mock-receipt-scopes` using canonical registry scopes
- `HttpReceiptGrantChallengeRegistry` sends:
  - `Authorization: Bearer <token>` when `MOCK_RECEIPT_PERSISTENCE_TOKEN` is configured
  - `x-mock-receipt-scopes` using challenge registry scopes

#### Verification
- Configure:
  - `MOCK_RECEIPT_PERSISTENCE_TOKEN`
  - `MOCK_RECEIPT_REGISTRY_HTTP_SCOPES=canonical:read,canonical:write`
  - `MOCK_RECEIPT_CHALLENGE_HTTP_SCOPES=challenge:read,challenge:write`
- Run shared mock/backend path tests
- Confirm backend/control-plane logs show:
  - canonical requests with `canonical:*` scope
  - challenge requests with `challenge:*` scope
  - bearer token present

#### Result
- [ ] Pass
- [ ] Fail

---

### B. Debug routes are disabled by default in non-dev

#### Expected
- In non-dev runtime, these routes return `404` unless explicitly enabled:
  - `/api/receipts/_state/:storeId`
  - `/api/receipts/_debug/registry`
  - `/api/receipts/_debug/challenges`

#### Verification
- Set:
  - `NODE_ENV=production`
  - `MOCK_RECEIPT_ALLOW_DEBUG_STATE=0`
- Request:
  - `GET /api/receipts/_debug/registry`
  - `GET /api/receipts/_debug/challenges`
  - `GET /api/receipts/_state/registry`

#### Result
- [ ] All return `404`
- [ ] Fail

---

### C. Debug routes require admin auth when enabled

#### Expected
- When debug routes are enabled, requests without valid auth fail
- Requests require:
  - valid bearer token
  - `admin` scope

#### Verification
- Enable debug state:
  - `NODE_ENV=development` or `MOCK_RECEIPT_ALLOW_DEBUG_STATE=1`
- With no auth header:
  - debug route returns `401`
- With valid token but missing `admin` scope:
  - debug route returns `403`
- With valid token and `x-mock-receipt-scopes: admin`:
  - debug route returns `200`

#### Result
- [ ] Pass
- [ ] Fail

---

### D. Local `_state` exposure is limited to local adapters only

#### Expected
- `resolveReceiptStateStores()` only exposes stores backed by:
  - `memory`
  - `file` (dev/debug only)
- It must not expose:
  - `http`
  - `redis`

#### Verification
- Run plugin with:
  - HTTP-backed canonical registry
  - HTTP-backed challenge registry
- Confirm `/api/receipts/_state/registry` does not surface backend state
- Run plugin with:
  - Redis-backed canonical registry
  - Redis-backed challenge registry
- Confirm `/api/receipts/_state/registry` does not surface backend state
- Run plugin with:
  - memory-backed registry in dev
- Confirm local state remains available for debug

#### Result
- [ ] Pass
- [ ] Fail

---

### E. Canonical registry uses scoped operations

#### Expected
- Read operations require canonical read scope
- Write/CAS/delete operations require canonical write scope
- Debug-only operations remain admin-only

#### Verification
- Confirm `HttpJsonStateStore` for canonical registry receives:
  - `get -> canonical:read`
  - `set -> canonical:write`
  - `delete -> canonical:write`
  - `cas -> canonical:write`
  - `debug -> admin`
- Verify:
  - read succeeds with `canonical:read`
  - CAS/write fails with only `canonical:read`
  - write succeeds with `canonical:write`

#### Result
- [ ] Pass
- [ ] Fail

---

### F. Challenge registry uses scoped operations

#### Expected
- Read operations require challenge read scope
- Write/CAS/delete operations require challenge write scope
- Debug-only operations remain admin-only

#### Verification
- Confirm `HttpJsonStateStore` for challenge registry receives:
  - `get -> challenge:read`
  - `set -> challenge:write`
  - `delete -> challenge:write`
  - `cas -> challenge:write`
  - `debug -> admin`
- Verify:
  - challenge read succeeds with `challenge:read`
  - challenge consume/create/revoke fails with only `challenge:read`
  - challenge write flow succeeds with `challenge:write`

#### Result
- [ ] Pass
- [ ] Fail

---

### G. Service/API contract remains unchanged

#### Expected
- No service/API callers need to change their contract usage
- Adapter changes remain internal to:
  - HTTP header injection
  - scope mapping
  - debug route gating

#### Verification
- Existing smoke/integration path still passes without route contract changes
- Existing receipt service callers continue using the same registry interfaces
- Existing challenge service callers continue using the same registry interfaces

#### Result
- [ ] Pass
- [ ] Fail

---

### H. Existing verification suite remains green

#### Required verification
- `node --check app/mock-receipt-api-plugin.cjs`
- `node --check app/mock-receipt-registry.cjs`
- `node --check app/mock-receipt-challenge-registry.cjs`
- `node --check app/mock-receipt-http-state-store.cjs`
- `node --check app/mock-receipt-persistence-auth.cjs`
- `npm run verify:private-quotes`
- `npm run demo:private-quotes:paths`
- `npm run demo:private-quotes:challenges`
- `npm run build`

#### Result
- [ ] All pass
- [ ] Fail

---

## Notes / known non-blockers

- `MODULE_TYPELESS_PACKAGE_JSON` warning may still appear
- Vite CJS deprecation warning may still appear
- These warnings are non-blocking for this milestone unless they break runtime behavior

---

## Exit decision

Milestone 3 authenticated persistence control plane is accepted when:
- [ ] A through H all pass
- [ ] No debug/state exposure remains unintentionally open in non-dev
- [ ] HTTP-backed persistence paths are authenticated and scope-aware
- [ ] Existing service/API contracts remain stable


---

## Milestone 4 acceptance — authorization hardening

### Summary

This acceptance block verifies that:
- Challenges are bound to actor context (actorId, permitHash, sessionId, deviceFingerprint)
- Replay attacks are prevented (consume-once enforcement)
- Actor binding is enforced (challenge cannot be used by different actor)
- Permit binding is enforced (challenge cannot be used with different permit)
- Expiry is strictly enforced
- No privilege escalation is possible

---

## Acceptance criteria

### A. Challenge cannot be reused (replay protection)

#### Expected
- Challenge can be consumed once successfully
- Second consume attempt fails with `already_consumed` error
- consumedAt timestamp is recorded on first consume
- Stats track deniedConsumedCount

#### Verification
- Issue challenge for quote
- Consume challenge → success
- Attempt to consume same challenge again → fail with `already_consumed`
- Verify stats.deniedConsumedCount incremented

#### Result
- [ ] Pass
- [ ] Fail

---

### B. Actor binding enforced

#### Expected
- Challenge created with actorId A
- Consume attempt by actorId B fails with `actor_mismatch`
- Consume attempt by actorId A succeeds

#### Verification
- Create challenge with actorId: "0xAlice"
- Attempt consume with context.actorId: "0xBob" → fail `actor_mismatch`
- Attempt consume with context.actorId: "0xAlice" → success

#### Result
- [ ] Pass
- [ ] Fail

---

### C. Permit binding enforced

#### Expected
- Challenge created with permitHash X
- Consume attempt with permitHash Y fails with `permit_mismatch`
- Consume attempt with permitHash X succeeds

#### Verification
- Create challenge with permitHash: "hash-permit-1"
- Attempt consume with context.permitHash: "hash-permit-2" → fail `permit_mismatch`
- Attempt consume with context.permitHash: "hash-permit-1" → success

#### Result
- [ ] Pass
- [ ] Fail

---

### D. Session binding enforced (optional)

#### Expected
- Challenge created with sessionId S1
- Consume attempt with sessionId S2 fails with `session_mismatch`
- Consume attempt with sessionId S1 succeeds

#### Verification
- Create challenge with sessionId: "session-abc"
- Attempt consume with context.sessionId: "session-xyz" → fail `session_mismatch`
- Attempt consume with context.sessionId: "session-abc" → success

#### Result
- [ ] Pass
- [ ] Fail
- [ ] N/A (optional feature not enabled)

---

### E. Device binding enforced (optional)

#### Expected
- Challenge created with deviceFingerprint D1
- Consume attempt with deviceFingerprint D2 fails with `device_mismatch`
- Consume attempt with deviceFingerprint D1 succeeds

#### Verification
- Create challenge with deviceFingerprint: "device-fp-1"
- Attempt consume with context.deviceFingerprint: "device-fp-2" → fail `device_mismatch`
- Attempt consume with context.deviceFingerprint: "device-fp-1" → success

#### Result
- [ ] Pass
- [ ] Fail
- [ ] N/A (optional feature not enabled)

---

### F. Expiry enforced

#### Expected
- Expired challenge cannot be consumed
- Returns `expired` error code
- No consumedAt timestamp recorded for expired challenges

#### Verification
- Create challenge with expiresAt in the past
- Attempt consume → fail with `expired`
- Verify consumedAt remains 0

#### Result
- [ ] Pass
- [ ] Fail

---

### G. Challenge not found handling

#### Expected
- Consume attempt with non-existent challenge token
- Returns `challenge_not_found` error
- No state mutation occurs

#### Verification
- Attempt consume with random/invalid challenge token
- Verify returns `challenge_not_found`
- Verify no stats changes

#### Result
- [ ] Pass
- [ ] Fail

---

### H. Binding fields persisted correctly

#### Expected
- Challenge record stores: actorId, permitHash, sessionId, deviceFingerprint
- Fields survive serialization/deserialization
- Fields available in registry snapshot

#### Verification
- Create challenge with all binding fields populated
- Read challenge from registry
- Verify all binding fields present and correct
- Restart service (if using file/redis persistence)
- Verify binding fields still present

#### Result
- [ ] Pass
- [ ] Fail

---

### I. Service layer injects context correctly

#### Expected
- issueReceiptGrantChallenge extracts context from accessContext
- consumeReceiptGrantChallenge passes context to registry
- Context includes: actorId, permitHash, sessionId, deviceFingerprint

#### Verification
- Call issueReceiptGrantChallenge with accessContext containing binding fields
- Verify challenge token payload includes binding fields
- Call issueReceiptGrant (which consumes challenge)
- Verify context validation occurs

#### Result
- [ ] Pass
- [ ] Fail

---

### J. No privilege escalation

#### Expected
- Challenge without permitHash cannot gain privileged access
- Challenge with permitHash cannot be used without matching permit
- Actor cannot impersonate another actor's challenge

#### Verification
- Create unprivileged challenge (no permitHash)
- Attempt consume with privileged permitHash → fail or no privilege gain
- Create privileged challenge with permitHash
- Attempt consume without permitHash → fail `permit_mismatch`
- Attempt consume with different actor → fail `actor_mismatch`

#### Result
- [ ] Pass
- [ ] Fail

---

### K. Backward compatibility

#### Expected
- Challenges without binding fields still work (empty string defaults)
- Existing challenge flow remains functional
- Optional binding fields don't break existing callers

#### Verification
- Create challenge without specifying binding fields
- Consume challenge without context → success
- Verify existing tests still pass

#### Result
- [ ] Pass
- [ ] Fail

---

### L. Syntax and integration checks

#### Required verification
- `node --check app/mock-receipt-challenge-registry.cjs`
- `node --check app/mock-receipt-challenges.cjs`
- `node --check app/mock-receipt-service.cjs`
- Existing verification suite from Milestone 3 still passes

#### Result
- [ ] All pass
- [ ] Fail

---

## Notes / implementation details

### Binding fields added to challenge record:
- `actorId`: Identifier of the actor (typically viewer address)
- `permitHash`: Hash of the permit used to create challenge
- `sessionId`: Optional session identifier
- `deviceFingerprint`: Optional device fingerprint hash

### Consume method signature changed:
```javascript
// Before
consume(challengeToken, consumedAt)

// After
consume(challengeToken, context = {}, consumedAt)
```

### Context object structure:
```javascript
{
  actorId: string,
  permitHash: string,
  sessionId: string,
  deviceFingerprint: string,
}
```

### Error codes added:
- `already_consumed`: Challenge was already consumed (replay protection)
- `actor_mismatch`: Actor ID doesn't match challenge binding
- `permit_mismatch`: Permit hash doesn't match challenge binding
- `session_mismatch`: Session ID doesn't match challenge binding
- `device_mismatch`: Device fingerprint doesn't match challenge binding
- `expired`: Challenge has expired
- `challenge_not_found`: Challenge token not found in registry

---

## Exit decision

Milestone 4 authorization hardening is accepted when:
- [ ] A through L all pass
- [ ] Replay attacks are prevented
- [ ] Actor and permit binding enforced
- [ ] No privilege escalation possible
- [ ] Backward compatibility maintained
- [ ] All syntax checks pass


---

## Milestone 5 acceptance — EIP-712 signed intents + Arb Sepolia execution

### Summary

This acceptance block verifies that:
- Payment intents are signed using EIP-712 by payer wallet
- Backend verifies signature and recovers signer
- Backend prevents replay via requestId/intentHash dedupe
- Backend executes to minimal contract on Arbitrum Sepolia
- Contract stores onchain execution record with dedupe
- Full flow: challenge → sign → verify → execute → onchain record

---

## Acceptance criteria

### A. EIP-712 signature creation (frontend)

#### Expected
- Frontend can create typed data domain with chainId + verifyingContract
- Frontend can sign PaymentIntent with all required fields
- Signature is recoverable and matches payer address

#### Verification
- Call `signPaymentIntent(intent)` with valid intent
- Verify signature is hex string starting with "0x"
- Recover signer using ethers.verifyTypedData
- Verify recovered address matches intent.payer

#### Result
- [ ] Pass
- [ ] Fail

---

### B. Backend signature verification

#### Expected
- Backend receives intent + signature
- Backend verifies signature using EIP-712
- Backend recovers signer address
- Backend rejects if signer !== intent.payer

#### Verification
- POST /api/payments/execute with valid intent + signature → success
- POST with invalid signature → fail `invalid_signature`
- POST with signature from wrong address → fail `signer_mismatch`
- POST without signature → fail `missing_signature`

#### Result
- [ ] Pass
- [ ] Fail

---

### C. Intent expiry enforcement

#### Expected
- Intent with expiresAtMs in past is rejected
- Intent with expiresAtMs in future is accepted (if not expired during processing)

#### Verification
- Create intent with expiresAtMs = Date.now() - 1000
- Attempt execute → fail `intent_expired`
- Create intent with expiresAtMs = Date.now() + 300000
- Attempt execute → success (if other validations pass)

#### Result
- [ ] Pass
- [ ] Fail

---

### D. Duplicate execution prevention (backend dedupe)

#### Expected
- Same requestId cannot be executed twice
- Dedupe key: `merchantId:terminalId:requestId`
- Second execution attempt fails with `duplicate_execution`

#### Verification
- Execute intent with requestId "req-001" → success
- Execute same intent again → fail `duplicate_execution`
- Execute different intent with same requestId → fail `duplicate_execution`

#### Result
- [ ] Pass
- [ ] Fail

---

### E. Challenge binding validation

#### Expected
- Intent must reference valid challengeId
- Challenge must not be consumed yet
- Challenge actorId must match intent.payer (if set)
- Challenge permitHash must match intent.permitHash (if set)

#### Verification
- Create challenge for payer A
- Create intent for payer A with that challengeId → success
- Attempt execute intent for payer B with same challengeId → fail `actor_mismatch`
- Attempt reuse consumed challenge → fail `already_consumed`

#### Result
- [ ] Pass
- [ ] Fail

---

### F. Contract execution (Arbitrum Sepolia)

#### Expected
- Backend calls `executePayment(intentHash, requestIdHash, payer, merchant, amount)`
- Contract validates all parameters non-zero/non-empty
- Contract checks intentHash not already executed
- Contract checks requestIdHash not already executed
- Contract stores PaymentRecord
- Contract emits PaymentExecuted event

#### Verification
- Deploy HexaPayIntentExecutor to Arb Sepolia
- Execute valid signed intent
- Verify transaction succeeds
- Verify event PaymentExecuted emitted
- Query `wasIntentExecuted(intentHash)` → true
- Query `wasRequestExecuted(requestIdHash)` → true
- Query `paymentRecords(intentHash)` → returns correct record

#### Result
- [ ] Pass
- [ ] Fail

---

### G. Contract dedupe enforcement

#### Expected
- Contract rejects if intentHash already executed
- Contract rejects if requestIdHash already executed
- Reverts with "intent already executed" or "request already executed"

#### Verification
- Execute intent → success
- Attempt execute same intentHash again → revert "intent already executed"
- Attempt execute different intent with same requestId → revert "request already executed"

#### Result
- [ ] Pass
- [ ] Fail

---

### H. Intent hash consistency

#### Expected
- Backend computes intentHash using EIP-712 TypedDataEncoder
- Contract receives same intentHash
- Hash is deterministic for same intent data

#### Verification
- Create intent with specific data
- Compute hash in backend
- Compute hash in frontend (if needed)
- Verify hashes match
- Execute to contract with that hash
- Verify contract stores same hash

#### Result
- [ ] Pass
- [ ] Fail

---

### I. RequestId hash consistency

#### Expected
- Backend hashes requestId using keccak256(utf8(requestId))
- Contract receives requestIdHash
- Hash is deterministic

#### Verification
- Create intent with requestId "test-request-123"
- Backend computes requestIdHash
- Execute to contract
- Verify contract stores correct requestIdHash
- Verify `wasRequestExecuted(requestIdHash)` returns true

#### Result
- [ ] Pass
- [ ] Fail

---

### J. Full flow integration

#### Expected
- Complete flow works end-to-end:
  1. POST /api/payments/challenges → get challenge
  2. Frontend signs intent with challenge
  3. POST /api/payments/execute → backend verifies + executes
  4. Contract records execution onchain
  5. Backend returns txHash + blockNumber

#### Verification
- Run full flow with real wallet signature
- Verify each step succeeds
- Verify final transaction on Arbiscan Sepolia
- Verify event logs contain correct data

#### Result
- [ ] Pass
- [ ] Fail

---

### K. Error handling and validation

#### Expected
- Missing required fields → clear error messages
- Invalid addresses → validation error
- Invalid amount (non-numeric) → validation error
- Executor not configured → `executor_missing`
- RPC failure → appropriate error propagation

#### Verification
- Test each validation case
- Verify error codes are descriptive
- Verify no silent failures

#### Result
- [ ] Pass
- [ ] Fail

---

### L. Contract ownership and access control

#### Expected
- Only contract owner can call executePayment
- Non-owner calls revert with "OwnableUnauthorizedAccount"
- Owner can transfer ownership

#### Verification
- Deploy contract with owner A
- Call executePayment from owner A → success
- Call executePayment from non-owner → revert
- Transfer ownership to B
- Call from B → success

#### Result
- [ ] Pass
- [ ] Fail

---

### M. Syntax and deployment checks

#### Required verification
- `node --check app/payment-intent-signature.cjs`
- `node --check app/payment-intent-service.cjs`
- Contract compiles: `npx hardhat compile`
- Contract deploys: `npx hardhat run scripts/deploy-hexa-executor.js --network arbitrumSepolia`
- Verify contract on Arbiscan

#### Result
- [ ] All pass
- [ ] Fail

---

## Environment variables required

```bash
# Arbitrum Sepolia RPC
ARB_SEPOLIA_RPC_URL=https://sepolia-rollup.arbitrum.io/rpc

# Executor private key (backend signer)
HEXAPAY_EXECUTOR_PRIVATE_KEY=0x...

# Deployed contract address
HEXAPAY_EXECUTOR_CONTRACT_ADDRESS=0x...

# Chain ID
HEXAPAY_CHAIN_ID=421614

# Frontend env
VITE_HEXAPAY_EXECUTOR_CONTRACT=0x...
```

---

## Implementation notes

### EIP-712 Domain
```javascript
{
  name: "HexaPay",
  version: "1",
  chainId: 421614,
  verifyingContract: "<deployed_contract_address>"
}
```

### PaymentIntent Type
```javascript
{
  challengeId: string,
  requestId: string,
  receiptId: string,
  quoteId: string,
  merchantId: string,
  terminalId: string,
  payer: address,
  merchant: address,
  amount: uint256,
  currency: string,
  permitHash: string,
  sessionId: string,
  deviceFingerprintHash: string,
  issuedAtMs: uint256,
  expiresAtMs: uint256
}
```

### Contract minimal features
- Onchain dedupe (intentHash + requestIdHash)
- Execution record storage
- Event emission for indexing
- Owner-only execution (backend is owner)
- No token transfer (validation phase)

### Why minimal contract is sufficient
- Validates auth + intent pipeline
- Provides onchain audit trail
- Enables public verification
- Defers settlement complexity
- Reduces risk during validation phase

---

## Exit decision

Milestone 5 EIP-712 signed intents + Arb Sepolia execution is accepted when:
- [ ] A through M all pass
- [ ] Contract deployed and verified on Arb Sepolia
- [ ] Full flow works with real wallet signatures
- [ ] Onchain records are queryable
- [ ] Replay protection works at both backend and contract level
- [ ] Error handling is robust
