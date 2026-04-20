# Payment Intent Quick Start

This guide matches the live Arbitrum Sepolia payment rail that is currently verified in this repo.

- Active executor: `HexaPayUSDCExecutor`
- Executor address: `0xD3cBE1F9A84E96DF340bef7b9D2B7C466Eb29d55`
- Settlement token: Circle USDC `0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d`
- Chain ID: `421614`
- Preferred RPC: `https://sepolia-rollup.arbitrum.io/rpc`

## What Uses What

- Browser UI at `app.html` and `payment-intent.html` uses the wallet currently connected in MetaMask or Rabby.
- `TEST_PAYER_PRIVATE_KEY` is only used by the CLI runner `npm run test:payment-flow`.
- EIP-712 signatures must use the `domain` returned by `POST /api/payments/challenges`.

## Prerequisites

- Node.js 18+
- Arbitrum Sepolia RPC access
- Backend executor private key with testnet ETH
- Payer wallet with testnet ETH and USDC

## Minimal Setup

Add these values to `.env`:

```bash
ARB_SEPOLIA_RPC_URL=https://sepolia-rollup.arbitrum.io/rpc
HEXAPAY_EXECUTOR_PRIVATE_KEY=0x...
HEXAPAY_EXECUTOR_CONTRACT_ADDRESS=0xD3cBE1F9A84E96DF340bef7b9D2B7C466Eb29d55
HEXAPAY_CHAIN_ID=421614
VITE_HEXAPAY_EXECUTOR_CONTRACT=0xD3cBE1F9A84E96DF340bef7b9D2B7C466Eb29d55
VITE_HEXAPAY_CHAIN_ID=421614
VITE_HEXAPAY_PAYMENT_TOKEN_ADDRESS=0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d
VITE_HEXAPAY_PAYMENT_TOKEN_DECIMALS=6
```

Optional for CLI live testing:

```bash
TEST_PAYER_PRIVATE_KEY=0x...
```

Start the local server:

```bash
npm install
npm run dev
```

## Recommended Tests

### Option A: CLI Live Test

This is the fastest way to verify the whole rail end-to-end.

```bash
npm run test:payment-flow
```

The runner will:

1. Create a payment challenge
2. Sign using the payer from `TEST_PAYER_PRIVATE_KEY`
3. Approve USDC if needed
4. Execute through `/api/payments/execute`
5. Verify `wasIntentExecuted(intentHash)` onchain

If `TEST_PAYER_PRIVATE_KEY` is missing, the runner falls back to a default Hardhat account, which is usually unfunded on Arbitrum Sepolia.

### Option B: Browser Test

1. Open `http://localhost:3000/app.html`
2. Connect the browser wallet you want to pay from
3. Ensure the wallet is on Arbitrum Sepolia
4. Ensure the wallet has testnet ETH and USDC
5. Fill the payment form and submit

Important:

- The payer is always the connected browser wallet.
- `Merchant Address` is the destination wallet, not the payer.
- If MetaMask shows repeated RPC errors, switch its Arbitrum Sepolia RPC to `https://sepolia-rollup.arbitrum.io/rpc`.

## Manual API Flow

### 1. Create Challenge

```bash
curl -X POST http://localhost:3000/api/payments/challenges \
  -H "Content-Type: application/json" \
  -d '{
    "requestId": "req-001",
    "receiptId": "receipt-001",
    "merchantId": "merchant-001",
    "terminalId": "terminal-001",
    "amount": "1000000",
    "currency": "USDC",
    "payer": "0xYourPayerAddress",
    "merchant": "0xYourMerchantAddress"
  }'
```

Example response shape:

```json
{
  "ok": true,
  "record": {
    "challengeId": "challenge-...",
    "requestId": "req-001",
    "receiptId": "receipt-001",
    "merchantId": "merchant-001",
    "terminalId": "terminal-001",
    "payer": "0xYourPayerAddress",
    "merchant": "0xYourMerchantAddress",
    "amount": "1000000",
    "currency": "USDC",
    "issuedAtMs": 1234567890,
    "expiresAtMs": 1234568190,
    "domain": {
      "name": "HexaPay",
      "version": "1",
      "chainId": 421614,
      "verifyingContract": "0xD3cBE1F9A84E96DF340bef7b9D2B7C466Eb29d55"
    }
  }
}
```

### 2. Sign the Typed Intent

Use the `domain` returned by the challenge response. Do not rebuild the domain locally with a stale executor address.

```typescript
import { signTypedData } from "ethers";

const challenge = payload.record;
const intent = {
  challengeId: challenge.challengeId,
  requestId: challenge.requestId,
  receiptId: challenge.receiptId,
  quoteId: "",
  merchantId: challenge.merchantId,
  terminalId: challenge.terminalId,
  payer: challenge.payer,
  merchant: challenge.merchant,
  token: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d",
  amount: challenge.amount,
  currency: challenge.currency,
  decimals: 6,
  permitHash: "",
  sessionId: "",
  deviceFingerprintHash: "",
  issuedAtMs: String(challenge.issuedAtMs),
  expiresAtMs: String(challenge.expiresAtMs),
};
```

The typed intent schema is defined in `app/payment-intent-signature.cjs`.

### 3. Execute

```bash
curl -X POST http://localhost:3000/api/payments/execute \
  -H "Content-Type: application/json" \
  -d '{
    "intent": { "...": "..." },
    "signature": "0x..."
  }'
```

Success response:

```json
{
  "ok": true,
  "status": "executed",
  "signer": "0x...",
  "intentHash": "0x...",
  "requestIdHash": "0x...",
  "txHash": "0x...",
  "blockNumber": 12345
}
```

## Troubleshooting

### "Payment intent service not configured"

Check these values:

```bash
ARB_SEPOLIA_RPC_URL=https://sepolia-rollup.arbitrum.io/rpc
HEXAPAY_EXECUTOR_PRIVATE_KEY=0x...
HEXAPAY_EXECUTOR_CONTRACT_ADDRESS=0xD3cBE1F9A84E96DF340bef7b9D2B7C466Eb29d55
```

### "Invalid payment intent signature" or `signer_mismatch`

Most common causes:

- the UI signed with the wrong wallet
- the domain was rebuilt locally instead of using the challenge response
- the payer field does not match the actual signer

### MetaMask RPC spam or `could not coalesce error`

Most common causes:

- the wallet is using a flaky Arbitrum Sepolia RPC
- the connected wallet is not the wallet you intended to pay from

Fix:

- switch Arbitrum Sepolia RPC in MetaMask to `https://sepolia-rollup.arbitrum.io/rpc`
- confirm the connected wallet address before approving USDC

### "Challenge consume failed"

Create a fresh challenge. Challenges are short-lived and one-time.

### "Duplicate execution"

Replay protection is working. Use a new `requestId`.

### "Insufficient funds"

The payer wallet needs ETH for gas and enough USDC for the transfer.

## Architecture

```text
Payer wallet
  -> POST /api/payments/challenges
  -> sign EIP-712 intent with challenge.domain
  -> approve USDC if needed
  -> POST /api/payments/execute
  -> HexaPayUSDCExecutor on Arbitrum Sepolia
```

## References

- Contract: `contracts/HexaPayUSDCExecutor.sol`
- Backend service: `app/payment-intent-service.cjs`
- Signature helpers: `app/payment-intent-signature.cjs`
- Browser widget: `app/payment-intent-widget.js`
- CLI verifier: `scripts/test-payment-intent-flow.mjs`
- Acceptance notes: `docs/private-quotes/PRIVATE_QUOTES_BOOTSTRAP_ACCEPTANCE.md`
