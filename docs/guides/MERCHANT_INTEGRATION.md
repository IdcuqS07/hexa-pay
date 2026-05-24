# Merchant Integration Guide

This guide is the merchant-facing Wave 5 onboarding path for HexaPay. It assumes you want to create payment intents from your application, let a payer sign them, execute settlement on the HexaPay rail, and verify the final result.

## What You Integrate

- Public API for challenge creation, verification, and execution
- Reusable JS SDK from `hexapay-fhenix`
- EIP-712 typed signing flow
- Optional POS session and device binding

## Integration Modes

### Mode 1: Browser wallet + merchant backend

Recommended for checkout flows, QR entry, POS, and testnet demos.

- merchant backend creates the challenge
- payer wallet signs in the browser
- merchant backend or frontend submits execution
- backend verifies status by `requestId`

### Mode 2: Server-orchestrated signer handoff

Useful when your app already owns a session layer and only needs HexaPay as the settlement rail.

## Prerequisites

- Node.js 18+
- access to the HexaPay backend deployed from this repo or an equivalent compatible service
- payer wallet with Arbitrum Sepolia ETH + USDC
- backend executor credentials configured on the HexaPay service

## Install The SDK

If you consume this repo as a package or workspace dependency:

```bash
npm install <path-to-this-repo>
```

```js
import { HexaPaySdk } from "hexapay-fhenix";
```

If you are integrating directly inside this repo:

```js
import { HexaPaySdk } from "../../sdk/hexapay-sdk.mjs";
```

## Initialize The Client

```js
import { HexaPaySdk } from "hexapay-fhenix";

const sdk = new HexaPaySdk({
  baseUrl: "http://localhost:3000",
  chainId: 421614,
  verifyingContract: "0xD3cBE1F9A84E96DF340bef7b9D2B7C466Eb29d55",
  tokenAddress: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d",
  tokenDecimals: 6,
  currency: "USDC",
});
```

## End-To-End Flow

### 1. Create the intent

`createIntent()` calls the public challenge API and returns both the challenge record and the final typed payload to sign.

```js
const { challenge, intent } = await sdk.createIntent({
  requestId: "req-store-1001",
  receiptId: "invoice-1001",
  invoiceId: "invoice-1001",
  source: "pos",
  merchantId: "merchant-jakarta-01",
  terminalId: "front-counter-02",
  amount: "1.25",
  payer: "0xPayerWallet",
  merchant: "0xMerchantWallet",
  sessionId: "sess-front-counter-02",
  deviceFingerprintHash: "dev-front-counter-02",
});
```

Notes:

- `amount` is human-readable here; the SDK converts it into base units.
- for POS flows, keep `sessionId` and `deviceFingerprintHash` stable between challenge and execution
- `challenge.domain` is authoritative and must be reused for signing

### 2. Sign the intent

```js
const signature = await sdk.signIntent(intent, signer, {
  challenge,
});
```

The signer must be the same address as `intent.payer`.

### 3. Pre-verify before execution

```js
const verification = await sdk.verifyPayment({
  intent,
  signature,
});

if (!verification.signature.valid) {
  throw new Error(`Intent signature invalid: ${verification.signature.code}`);
}
```

This step is optional, but it is useful when you want an explicit validation checkpoint before calling execute.

### 4. Execute settlement

```js
const execution = await sdk.executePayment({
  intent,
  signature,
});

console.log(execution.txHash);
```

### 5. Verify final status

```js
const finalStatus = await sdk.verifyPayment({
  requestId: intent.requestId,
});

console.log(finalStatus.ledger.status);
console.log(finalStatus.ledger.txHash);
```

## Browser Example

```js
import { BrowserProvider } from "ethers";

const provider = new BrowserProvider(window.ethereum);
const signer = await provider.getSigner();
const payer = await signer.getAddress();

const { challenge, intent } = await sdk.createIntent({
  requestId: `req-ui-${Date.now()}`,
  receiptId: "invoice-ui-001",
  source: "pos",
  merchantId: "merchant-ui-001",
  terminalId: "tablet-01",
  amount: "2.50",
  payer,
  merchant: "0xMerchantWallet",
  sessionId: "sess-tablet-01",
  deviceFingerprintHash: "dev-tablet-01",
});

const signature = await sdk.signIntent(intent, signer, { challenge });
await sdk.executePayment({ intent, signature });
```

## Backend Polling Example

```js
async function waitForSettlement(sdk, requestId, attempts = 10) {
  for (let index = 0; index < attempts; index += 1) {
    const result = await sdk.verifyPayment({ requestId });
    if (result.ledger?.status === "settled") {
      return result;
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }

  throw new Error("Settlement not observed before timeout.");
}
```

## Operational Guidance

- store `requestId`, `challengeId`, `intentHash`, and `txHash` together
- treat `requestId` as your idempotency key
- never rebuild the EIP-712 domain from stale env vars if the challenge already returned one
- rotate a fresh challenge if the backend reports `intent_expired`
- use `verifyPayment({ requestId })` for customer support and reconciliation views

## POS-Specific Notes

When `source=pos`, HexaPay enforces merchant terminal context:

- `merchantId` identifies the merchant-side operator or location
- `terminalId` identifies the checkout device
- `sessionId` binds the payer approval to the active checkout session
- `deviceFingerprintHash` binds the flow to the merchant device identity

If any of those fields drift between challenge issuance and execution, verification or execution will fail.

## Go-Live Checklist

- backend executor has Arbitrum Sepolia ETH
- payer wallet has ETH + USDC
- `HEXAPAY_EXECUTOR_CONTRACT_ADDRESS` matches the backend challenge domain
- your frontend signs the exact payload returned by HexaPay
- your app persists `requestId` and polls `verifyPayment()` after execution
- your support tooling can search by `requestId`, `payer`, or `merchant`

## Related Docs

- [Payment Intent Quick Start](./PAYMENT_INTENT_QUICKSTART.md)
- [HexaPay Payment Intent Specification](../specs/SPEC_HEXAPAY_PAYMENT_INTENT.md)
