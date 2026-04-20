# HexaPay Payment Rail Status

## Active Arbitrum Sepolia Rail

- Contract: `HexaPayUSDCExecutor`
- Address: `0xD3cBE1F9A84E96DF340bef7b9D2B7C466Eb29d55`
- Settlement token: `0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d` (Circle USDC)
- Chain ID: `421614`
- Preferred RPC: `https://sepolia-rollup.arbitrum.io/rpc`

Arbiscan:

- Contract: https://sepolia.arbiscan.io/address/0xD3cBE1F9A84E96DF340bef7b9D2B7C466Eb29d55

## Latest Live Verification

The full payment rail was re-verified end-to-end from this repo.

- CLI command: `npm run test:payment-flow`
- Result: success
- Example tx: `0xe71dd5412c783db11fa6f45f4824db208bb374f62adb53dccd738559536044ab`
- Example block: `261115751`
- Verified onchain: `wasIntentExecuted(intentHash) == true`

This verification included:

1. challenge creation
2. EIP-712 signing
3. payer-side USDC approval
4. backend execution
5. onchain verification

## Runtime Notes

- Browser UI at `app.html` and `payment-intent.html` always uses the currently connected wallet in MetaMask or Rabby.
- `TEST_PAYER_PRIVATE_KEY` is only used by `npm run test:payment-flow`.
- The signature domain must come from `POST /api/payments/challenges`.
- The backend executor now queues writes and retries one nonce-conflict to reduce `nonce too low` and `nonce has already been used` failures.

## Contract Surface

The active rail uses the 6-argument USDC executor:

```solidity
executePayment(
  bytes32 intentHash,
  bytes32 requestIdHash,
  address token,
  address payer,
  address merchant,
  uint256 amount
)
```

Related read functions:

- `wasIntentExecuted(bytes32 intentHash) -> bool`
- `wasRequestExecuted(bytes32 requestIdHash) -> bool`
- `paymentRecords(bytes32 intentHash) -> PaymentRecord`

Source of truth: `contracts/HexaPayUSDCExecutor.sol`

## Expected Environment

Root `.env`:

```bash
ARB_SEPOLIA_RPC_URL=https://sepolia-rollup.arbitrum.io/rpc
HEXAPAY_EXECUTOR_PRIVATE_KEY=0x...
HEXAPAY_EXECUTOR_CONTRACT_ADDRESS=0xD3cBE1F9A84E96DF340bef7b9D2B7C466Eb29d55
HEXAPAY_CHAIN_ID=421614
TEST_PAYER_PRIVATE_KEY=0x...
VITE_HEXAPAY_EXECUTOR_CONTRACT=0xD3cBE1F9A84E96DF340bef7b9D2B7C466Eb29d55
VITE_HEXAPAY_CHAIN_ID=421614
VITE_HEXAPAY_PAYMENT_TOKEN_ADDRESS=0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d
VITE_HEXAPAY_PAYMENT_TOKEN_DECIMALS=6
```

Frontend note:

- `VITE_HEXAPAY_EXECUTOR_CONTRACT` must match the active executor.
- The UI signs with the challenge-provided domain, not a hardcoded local domain.

## Retest Checklist

### CLI

```bash
npm run dev
npm run test:payment-flow
```

### Browser

1. open `http://localhost:3000/app.html`
2. connect the intended payer wallet
3. switch to Arbitrum Sepolia
4. ensure the wallet has ETH and USDC
5. submit the payment form

## Common Failure Modes

### `signer_mismatch`

- wrong wallet signed the intent
- payer field does not match the signer
- the client ignored `challenge.domain`

### `could not coalesce error` or repeated MetaMask RPC warnings

- Arbitrum Sepolia RPC in MetaMask is unhealthy
- the connected wallet is not the wallet you meant to use

Preferred fix:

- use `https://sepolia-rollup.arbitrum.io/rpc` in MetaMask
- confirm the connected wallet address before approving USDC

### `nonce has already been used`

This was previously observed and is now mitigated by backend nonce management plus a one-time retry. If it appears again, check for duplicate local dev servers or a stale backend process.

## Legacy Note

Older documents referenced executor `0x7AD0bB5220E664A1057d101069c0309f9302c075`. That contract is no longer the active source of truth for the live payment rail described here.
