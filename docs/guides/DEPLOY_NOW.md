# Deploy HexaPay to Arbitrum Sepolia NOW

Quick deployment guide - get your contract onchain in 5 minutes.

---

## Step 1: Setup Environment

```bash
npm run setup:deploy
```

This will:
- Create `.env` file if it doesn't exist
- Check if `PRIVATE_KEY` is set
- Validate configuration

**If PRIVATE_KEY is not set:**

1. Generate a new wallet (or use existing):
```bash
# Generate new private key
node -e "console.log('0x' + require('crypto').randomBytes(32).toString('hex'))"
```

2. Add to `.env`:
```bash
PRIVATE_KEY=0x...  # Your private key here
```

3. Get testnet ETH:
   - Visit: https://faucet.quicknode.com/arbitrum/sepolia
   - Enter your wallet address
   - Request testnet ETH

---

## Step 2: Deploy Contract

```bash
npm run deploy:executor
```

This will:
- Compile `HexaPayIntentExecutor.sol`
- Deploy to Arbitrum Sepolia
- Show contract address and next steps

**Expected output:**
```
🚀 Deploying HexaPayIntentExecutor to Arbitrum Sepolia...

Network: arbitrumSepolia
Deployer address: 0x...
Deployer balance: 0.1 ETH

📝 Deploying contract...
⏳ Waiting for deployment transaction...

✅ Deployment successful!
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Contract address: 0x...
Owner address: 0x...
Network: arbitrumSepolia
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## Step 3: Update Environment

Copy the contract address from deployment output and add to `.env`:

```bash
HEXAPAY_EXECUTOR_CONTRACT_ADDRESS=0x...  # From deployment
HEXAPAY_EXECUTOR_PRIVATE_KEY=$PRIVATE_KEY  # Same as deployer
ARB_SEPOLIA_RPC_URL=https://sepolia-rollup.arbitrum.io/rpc
HEXAPAY_CHAIN_ID=421614
```

Or use this one-liner (replace CONTRACT_ADDRESS):
```bash
echo "HEXAPAY_EXECUTOR_CONTRACT_ADDRESS=0x..." >> .env
echo "HEXAPAY_EXECUTOR_PRIVATE_KEY=\$PRIVATE_KEY" >> .env
echo "ARB_SEPOLIA_RPC_URL=https://sepolia-rollup.arbitrum.io/rpc" >> .env
echo "HEXAPAY_CHAIN_ID=421614" >> .env
```

---

## Step 4: Verify Contract (Optional but Recommended)

```bash
npx hardhat verify --network arbitrumSepolia <CONTRACT_ADDRESS> <OWNER_ADDRESS>
```

Example:
```bash
npx hardhat verify --network arbitrumSepolia 0x1234... 0x5678...
```

---

## Step 5: Test Deployment

```bash
npm run test:payment-flow
```

This will:
1. Create payment challenge
2. Sign intent with EIP-712
3. Execute signed intent
4. Verify onchain execution

**Expected output:**
```
🚀 HexaPay Payment Intent Flow Test
=====================================

1️⃣  Creating payment challenge...
✅ Challenge created: challenge-...

2️⃣  Signing payment intent with EIP-712...
✅ Intent signed: 0x...

3️⃣  Executing signed intent...
✅ Intent executed!
   Tx Hash: 0x...
   Block: 12345

4️⃣  Verifying onchain execution...
   Intent executed: true
   Transaction status: ✅ Success

🔗 View on Arbiscan:
   https://sepolia.arbiscan.io/tx/0x...

✅ Full flow completed successfully!
```

---

## Troubleshooting

### "PRIVATE_KEY not set"
```bash
# Add to .env
PRIVATE_KEY=0x...
```

### "Deployer has no ETH"
Get testnet ETH: https://faucet.quicknode.com/arbitrum/sepolia

### "Compilation failed"
```bash
# Clean and recompile
rm -rf artifacts cache
npx hardhat compile
```

### "Payment intent service not configured"
Make sure these are set in `.env`:
```bash
HEXAPAY_EXECUTOR_CONTRACT_ADDRESS=0x...
ARB_SEPOLIA_RPC_URL=https://sepolia-rollup.arbitrum.io/rpc
HEXAPAY_EXECUTOR_PRIVATE_KEY=0x...
```

---

## Quick Commands Reference

```bash
# Setup
npm run setup:deploy

# Deploy
npm run deploy:executor

# Or combined
npm run deploy:sepolia

# Test
npm run test:payment-flow

# Verify
npx hardhat verify --network arbitrumSepolia <ADDRESS> <OWNER>

# Check balance
npx hardhat run scripts/check-balance.js --network arbitrumSepolia
```

---

## What You Get

After successful deployment:

✅ **HexaPayIntentExecutor contract** deployed to Arbitrum Sepolia  
✅ **Onchain dedupe** for intentHash and requestIdHash  
✅ **Payment records** stored onchain  
✅ **Events emitted** for indexing  
✅ **Public verification** available on Arbiscan  

---

## Next Steps

1. ✅ Deploy contract (you're here!)
2. ✅ Test full flow
3. 🔜 Integrate with frontend UI
4. 🔜 Add USDC settlement
5. 🔜 Deploy to mainnet

---

## Resources

- Full Guide: `docs/guides/SEPOLIA_DEPLOYMENT_GUIDE.md`
- Quick Start: `docs/guides/PAYMENT_INTENT_QUICKSTART.md`
- Acceptance Tests: `docs/private-quotes/PRIVATE_QUOTES_BOOTSTRAP_ACCEPTANCE.md`
- Arbiscan Sepolia: https://sepolia.arbiscan.io
- Faucet: https://faucet.quicknode.com/arbitrum/sepolia

---

**Ready? Let's deploy!**

```bash
npm run deploy:sepolia
```
