# Private Quotes - Quick Start

## 🚀 Setup

### 1. Start Anvil
```bash
anvil
```

### 2. Deploy Contract
```bash
npm run deploy:private-quote
# atau
forge script script/Deploy.s.sol --broadcast --rpc-url http://127.0.0.1:8545
```

### 3. Update Contract Address
Edit `frontend/src/lib/privateQuote.ts`:
```typescript
const CONTRACT_ADDRESS = "0xYourDeployedAddress";
```

### 4. Start Frontend
```bash
cd frontend
npm install
npm run dev
```

## 📝 Usage

### Create Private Quote
1. Go to `http://localhost:5173/private-quotes`
2. Enter amount: `100`
3. Enter payer address: `0x70997970C51812dc3A010C7d01b50e0d17dc79C8`
4. Click "Create Quote"
5. Copy payment link

### Test Payment
1. Open payment link di browser
2. Switch wallet ke payer account
3. Complete payment

## 🧪 Debug Features

### Test Expired Quote
1. Check "Debug short expiry"
2. Create quote
3. Wait 10 seconds
4. Try to pay (should fail)

### Test Duplicate Prevention
1. Check "Debug fixed quote ID"
2. Create quote
3. Try create again (should fail)

## 🔧 Configuration

### Contract Address
`frontend/src/lib/privateQuote.ts` line 6

### Network
Anvil Local (Chain ID: `0x7a69`)

### ABI
`frontend/src/lib/abi/PrivateMerchantQuote.json`

## 📦 Files Structure

```
frontend/
├── src/
│   ├── lib/
│   │   ├── privateQuote.ts          # Contract interaction
│   │   ├── privateQuoteTypes.ts     # Type definitions
│   │   └── abi/
│   │       └── PrivateMerchantQuote.json
│   ├── pages/
│   │   └── PrivateQuotesPage.tsx    # Merchant UI
│   └── App.tsx                       # Router (updated)
```

## ⚠️ Bootstrap Mode

Current: Hash-based mock encryption
```typescript
keccak256(`enc_amount_${amount}`)
```

Next: Native FHE encryption (Fhenix)

## 🐛 Common Issues

### Wallet not connecting
```bash
# Check MetaMask installed
# Unlock wallet
# Switch to Anvil network manually
```

### Transaction fails
```bash
# Check Anvil running
# Verify contract deployed
# Check payer address valid
```

### Wrong network
```bash
# App will auto-prompt to switch
# Or add Anvil manually:
# - Chain ID: 31337 (0x7a69)
# - RPC: http://127.0.0.1:8545
```

## 📚 Full Documentation

See `PRIVATE_QUOTES_INTEGRATION.md` for complete guide.
