# HexaPay Arbitrum Sepolia Deployment Guide

This guide covers deploying HexaPay with EIP-712 signed intents to Arbitrum Sepolia testnet.

---

## Prerequisites

1. Node.js and npm installed
2. Hardhat installed: `npm install --save-dev hardhat @nomicfoundation/hardhat-toolbox`
3. Arbitrum Sepolia RPC access (Alchemy, Infura, or public RPC)
4. Testnet ETH on Arbitrum Sepolia for deployment
5. Private key for executor backend (keep secure!)

---

## Step 1: Install Dependencies

```bash
npm install ethers@^6.0.0
npm install --save-dev @openzeppelin/contracts
```

---

## Step 2: Configure Hardhat

Create or update `hardhat.config.js`:

```javascript
require("@nomicfoundation/hardhat-toolbox");

module.exports = {
  solidity: "0.8.24",
  networks: {
    arbitrumSepolia: {
      url: process.env.ARB_SEPOLIA_RPC_URL || "https://sepolia-rollup.arbitrum.io/rpc",
      accounts: process.env.HEXAPAY_EXECUTOR_PRIVATE_KEY ? [process.env.HEXAPAY_EXECUTOR_PRIVATE_KEY] : [],
    },
  },
  etherscan: {
    apiKey: {
      arbitrumSepolia: process.env.ARBISCAN_API_KEY || "",
    },
  },
};
```

---

## Step 3: Compile Contract

```bash
npx hardhat compile
```

Expected output:
```
Compiled 1 Solidity file successfully
```

---

## Step 4: Deploy to Arbitrum Sepolia

Set environment variables:

```bash
export ARB_SEPOLIA_RPC_URL="https://sepolia-rollup.arbitrum.io/rpc"
export HEXAPAY_EXECUTOR_PRIVATE_KEY="0x..."  # Your private key
```

Deploy:

```bash
npx hardhat run scripts/deploy-hexa-executor.js --network arbitrumSepolia
```

Expected output:
```
HexaPayIntentExecutor deployed to: 0x...
Owner: 0x...
```

Save the deployed contract address!

---

## Step 5: Verify Contract on Arbiscan

```bash
npx hardhat verify --network arbitrumSepolia <CONTRACT_ADDRESS> <OWNER_ADDRESS>
```

Example:
```bash
npx hardhat verify --network arbitrumSepolia 0x1234... 0x5678...
```

---

## Step 6: Configure Backend Environment

Update `.env` or environment variables:

```bash
# Arbitrum Sepolia RPC
ARB_SEPOLIA_RPC_URL=https://sepolia-rollup.arbitrum.io/rpc

# Executor private key (same as deployer)
HEXAPAY_EXECUTOR_PRIVATE_KEY=0x...

# Deployed contract address
HEXAPAY_EXECUTOR_CONTRACT_ADDRESS=0x...

# Chain ID (Arbitrum Sepolia)
HEXAPAY_CHAIN_ID=421614

# Challenge registry mode
MOCK_RECEIPT_CHALLENGE_REGISTRY_MODE=redis

# Redis URL (if using Redis)
MOCK_RECEIPT_REDIS_URL=redis://127.0.0.1:6379
```

---

## Step 7: Configure Frontend Environment

Create or update `frontend/.env`:

```bash
VITE_HEXAPAY_EXECUTOR_CONTRACT=0x...  # Deployed contract address
VITE_CHAIN_ID=421614
VITE_NETWORK_NAME=Arbitrum Sepolia
```

---

## Step 8: Test Full Flow

### 8.1 Create Payment Challenge

```bash
curl -X POST http://localhost:5173/api/payments/challenges \
  -H "Content-Type: application/json" \
  -d '{
    "requestId": "test-req-001",
    "receiptId": "receipt-001",
    "merchantId": "merchant-001",
    "terminalId": "terminal-001",
    "amount": "1000000",
    "currency": "USDC",
    "payer": "0xYourPayerAddress",
    "merchant": "0xMerchantAddress"
  }'
```

Response:
```json
{
  "challengeId": "challenge-...",
  "requestId": "test-req-001",
  "amount": "1000000",
  "issuedAtMs": 1234567890,
  "expiresAtMs": 1234567890
}
```

### 8.2 Sign Intent (Frontend)

```typescript
import { signPaymentIntent } from './lib/paymentIntentSigning';

const intent = {
  challengeId: "challenge-...",
  requestId: "test-req-001",
  receiptId: "receipt-001",
  quoteId: "",
  merchantId: "merchant-001",
  terminalId: "terminal-001",
  payer: "0xYourPayerAddress",
  merchant: "0xMerchantAddress",
  amount: "1000000",
  currency: "USDC",
  permitHash: "",
  sessionId: "",
  deviceFingerprintHash: "",
  issuedAtMs: "1234567890",
  expiresAtMs: "1234567890"
};

const signature = await signPaymentIntent(intent);
```

### 8.3 Execute Signed Intent

```bash
curl -X POST http://localhost:5173/api/payments/execute \
  -H "Content-Type: application/json" \
  -d '{
    "intent": { ... },
    "signature": "0x..."
  }'
```

Response:
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

### 8.4 Verify on Arbiscan

Visit: `https://sepolia.arbiscan.io/tx/<txHash>`

Check:
- Transaction status: Success
- Event logs: PaymentExecuted
- Contract state: `wasIntentExecuted(intentHash)` returns true

---

## Step 9: Query Contract State

Using ethers.js or Hardhat console:

```javascript
const contract = await ethers.getContractAt(
  "HexaPayIntentExecutor",
  "0x..."  // deployed address
);

// Check if intent was executed
const executed = await contract.wasIntentExecuted("0x...");
console.log("Intent executed:", executed);

// Get payment record
const record = await contract.paymentRecords("0x...");
console.log("Payment record:", record);
```

---

## Troubleshooting

### Error: "insufficient funds for intrinsic transaction cost"
- Get testnet ETH from Arbitrum Sepolia faucet
- Visit: https://faucet.quicknode.com/arbitrum/sepolia

### Error: "invalid signature"
- Verify domain chainId matches network (421614)
- Verify verifyingContract address is correct
- Ensure payer address matches signer

### Error: "intent already executed"
- Intent was already processed (replay protection working!)
- Use new requestId for new payment

### Error: "challenge_consume_failed"
- Challenge may be expired
- Challenge may already be consumed
- Actor/permit binding may not match

### Error: "OwnableUnauthorizedAccount"
- Backend private key doesn't match contract owner
- Verify HEXAPAY_EXECUTOR_PRIVATE_KEY is correct

---

## Security Checklist

- [ ] Private keys stored securely (never commit to git)
- [ ] Contract owner is backend executor address
- [ ] RPC URL uses HTTPS
- [ ] Environment variables loaded from secure source
- [ ] Redis (if used) has authentication enabled
- [ ] Debug routes disabled in production (MOCK_RECEIPT_ALLOW_DEBUG_STATE=0)
- [ ] Persistence auth enabled (MOCK_RECEIPT_PERSISTENCE_AUTH_ENABLED=1)

---

## Next Steps

After successful Sepolia deployment:

1. Monitor contract events for execution patterns
2. Test edge cases (expiry, replay, wrong signer)
3. Integrate with frontend payment flow
4. Add USDC settlement logic (future milestone)
5. Deploy to Arbitrum mainnet when ready

---

## Useful Links

- Arbitrum Sepolia Explorer: https://sepolia.arbiscan.io
- Arbitrum Sepolia Faucet: https://faucet.quicknode.com/arbitrum/sepolia
- Arbitrum Sepolia RPC: https://sepolia-rollup.arbitrum.io/rpc
- Arbitrum Docs: https://docs.arbitrum.io
- EIP-712 Spec: https://eips.ethereum.org/EIPS/eip-712

---

## Support

For issues or questions:
1. Check contract events on Arbiscan
2. Review backend logs for signature verification
3. Verify environment variables are set correctly
4. Test with minimal example first
