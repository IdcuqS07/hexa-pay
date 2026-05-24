# HexaPay Payment Intent Specification

Status: active  
Protocol version: `1`

This specification defines the public Wave 5 payment intent flow for HexaPay. It covers the challenge handshake, the EIP-712 typed payload, public API endpoints, and compatibility rules for merchants integrating against the Arbitrum Sepolia payment rail.

## Goals

- give external integrators one stable typed payload to sign
- keep the executor domain authoritative on the backend
- support verification before and after execution
- preserve merchant POS context such as `merchantId`, `terminalId`, and device/session binding

## Network Defaults

- Chain: `Arbitrum Sepolia`
- Chain ID: `421614`
- Executor contract: `0xD3cBE1F9A84E96DF340bef7b9D2B7C466Eb29d55`
- Settlement token: Circle USDC `0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d`
- Domain name: `HexaPay`
- Domain version: `1`

Integrators must treat the backend challenge response as the source of truth for `domain.chainId` and `domain.verifyingContract`.

## Protocol Flow

1. Merchant backend calls `POST /api/payments/challenges`.
2. HexaPay returns a short-lived challenge record and the exact EIP-712 domain to use.
3. Payer signs the `PaymentIntent` payload offchain.
4. Integrator optionally calls `POST /api/payments/verify` to validate the signature and inspect ledger status.
5. Integrator calls `POST /api/payments/execute`.
6. Integrator can call `POST /api/payments/verify` again with `requestId` to confirm the execution status and tx hash.

## Challenge Record

The challenge response shape is:

```json
{
  "ok": true,
  "record": {
    "challengeId": "challenge-...",
    "requestId": "req-001",
    "receiptId": "invoice-001",
    "invoiceId": "invoice-001",
    "quoteId": "",
    "source": "pos",
    "merchantId": "merchant-001",
    "terminalId": "terminal-01",
    "amount": "1250000",
    "currency": "USDC",
    "payer": "0xPayer",
    "merchant": "0xMerchant",
    "sessionId": "sess-front-counter",
    "deviceFingerprintHash": "dev-front-counter",
    "issuedAtMs": 1712345678000,
    "expiresAtMs": 1712345978000,
    "domain": {
      "name": "HexaPay",
      "version": "1",
      "chainId": 421614,
      "verifyingContract": "0xD3cBE1F9A84E96DF340bef7b9D2B7C466Eb29d55"
    }
  }
}
```

## EIP-712 Domain

```json
{
  "name": "HexaPay",
  "version": "1",
  "chainId": 421614,
  "verifyingContract": "0xD3cBE1F9A84E96DF340bef7b9D2B7C466Eb29d55"
}
```

## Typed Data Schema

Primary type: `PaymentIntent`

```json
{
  "PaymentIntent": [
    { "name": "challengeId", "type": "string" },
    { "name": "requestId", "type": "string" },
    { "name": "receiptId", "type": "string" },
    { "name": "quoteId", "type": "string" },
    { "name": "source", "type": "string" },
    { "name": "merchantId", "type": "string" },
    { "name": "terminalId", "type": "string" },
    { "name": "payer", "type": "address" },
    { "name": "merchant", "type": "address" },
    { "name": "token", "type": "address" },
    { "name": "amount", "type": "uint256" },
    { "name": "currency", "type": "string" },
    { "name": "decimals", "type": "uint8" },
    { "name": "permitHash", "type": "string" },
    { "name": "sessionId", "type": "string" },
    { "name": "deviceFingerprintHash", "type": "string" },
    { "name": "issuedAtMs", "type": "uint256" },
    { "name": "expiresAtMs", "type": "uint256" }
  ]
}
```

## Field Requirements

- `challengeId`: backend-issued nonce-like challenge identifier
- `requestId`: idempotency key for the merchant integration
- `receiptId`: canonical invoice or receipt id when linked to invoice settlement
- `source`: use `pos` for terminal/QR-driven flows; other sources may omit device/session binding
- `merchantId`: merchant-side operator or store identifier
- `terminalId`: merchant-side checkout device identifier
- `payer`: wallet expected to sign the typed data
- `merchant`: wallet receiving settlement
- `token`: ERC-20 settlement token address
- `amount`: base-unit token amount
- `decimals`: token decimals used to derive `amount`
- `sessionId` and `deviceFingerprintHash`: required when `source=pos`
- `expiresAtMs`: the backend currently issues 5-minute challenges

## Public API

### `POST /api/payments/challenges`

Purpose: issue the authoritative challenge and EIP-712 domain.

Request body:

```json
{
  "requestId": "req-001",
  "receiptId": "invoice-001",
  "invoiceId": "invoice-001",
  "quoteId": "",
  "source": "pos",
  "merchantId": "merchant-001",
  "terminalId": "terminal-01",
  "amount": "1250000",
  "currency": "USDC",
  "payer": "0xPayer",
  "merchant": "0xMerchant",
  "actorId": "0xPayer"
}
```

Optional headers:

- `x-receipt-permit-hash`
- `x-session-id`
- `x-device-fingerprint-hash`
- `x-actor-id`

### `POST /api/payments/verify`

Purpose: verify the typed signature and inspect execution state without executing settlement.

Request body:

```json
{
  "requestId": "req-001",
  "intent": { "...": "..." },
  "signature": "0x...",
  "expectedPayer": "0xPayer"
}
```

Response shape:

```json
{
  "ok": true,
  "status": "verified",
  "requestId": "req-001",
  "requestIdHash": "0x...",
  "intentHash": "0x...",
  "signature": {
    "provided": true,
    "valid": true,
    "code": "ok",
    "signer": "0xPayer",
    "expectedPayer": "0xPayer"
  },
  "ledger": {
    "found": true,
    "status": "settled",
    "txHash": "0x...",
    "blockNumber": 261115751
  }
}
```

The endpoint also supports request-id-only lookups:

```json
{
  "requestId": "req-001"
}
```

### `POST /api/payments/execute`

Purpose: submit a signed intent to the backend executor.

Request body:

```json
{
  "intent": { "...": "..." },
  "signature": "0x..."
}
```

Success response:

```json
{
  "ok": true,
  "status": "executed",
  "signer": "0xPayer",
  "intentHash": "0x...",
  "requestIdHash": "0x...",
  "txHash": "0x...",
  "blockNumber": 261115751
}
```

## Reference Intent Example

```json
{
  "challengeId": "challenge-001",
  "requestId": "req-001",
  "receiptId": "invoice-001",
  "quoteId": "",
  "source": "pos",
  "merchantId": "merchant-001",
  "terminalId": "terminal-01",
  "payer": "0x1111111111111111111111111111111111111111",
  "merchant": "0x2222222222222222222222222222222222222222",
  "token": "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d",
  "amount": "1250000",
  "currency": "USDC",
  "decimals": 6,
  "permitHash": "",
  "sessionId": "sess-front-counter",
  "deviceFingerprintHash": "dev-front-counter",
  "issuedAtMs": "1712345678000",
  "expiresAtMs": "1712345978000"
}
```

## Versioning Rules

- `domain.version` governs signing compatibility.
- Adding optional response metadata is non-breaking.
- Changing field names, field types, or signing order is breaking and requires a new protocol version.
- Executors must reject signatures built against a different `verifyingContract`.
- Integrators should store the raw challenge record and the final `intentHash` for auditability.

## Error Semantics

- `missing_signature`: verify request omitted a signature
- `invalid_signature`: typed data recovery failed
- `signer_mismatch`: recovered signer does not match the expected payer
- `intent_expired`: execution attempted after `expiresAtMs`
- `duplicate_execution`: the request id already reached a terminal execution state
- `challenge_intent_mismatch`: a later intent no longer matches the recorded challenge context

## SDK Reference

HexaPay now exposes a reusable Wave 5 SDK surface from:

- `sdk/hexapay-sdk.cjs`
- `sdk/hexapay-sdk.mjs`

If this repo is installed as a package or workspace dependency, use:

```js
import { HexaPaySdk } from "hexapay-fhenix";
```
