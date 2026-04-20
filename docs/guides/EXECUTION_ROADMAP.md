# HexaPay Execution Roadmap

## 🎯 Current Status: Bootstrap Ready

All files prepared. Ready for execution.

---

## 📋 Phase 1: Bootstrap Foundation (30 minutes)

### Step 1.1: Repo Setup (5 min)

```bash
cd "/Users/idcuq/Documents/Fhenix Buildathon"

# Verify structure
ls -la src/
ls -la test/
ls -la script/

# Expected files:
# src/PrivateMerchantQuote.sol
# test/PrivateMerchantQuote.t.sol
# script/Deploy.s.sol
```

### Step 1.2: Install Dependencies (5 min)

```bash
# Install Node dependencies
npm install

# Install Foundry dependencies
forge install foundry-rs/forge-std --no-commit

# Verify installations
ls lib/forge-std/
ls node_modules/@fhenixprotocol/
```

### Step 1.3: Build Contracts (5 min)

```bash
# Clean build
forge clean

# Build
forge build

# Expected output:
# [⠊] Compiling...
# [⠒] Compiling 3 files with 0.8.24
# [⠢] Solc 0.8.24 finished in X.XXs
# Compiler run successful!
```

**If build fails:**
- Check `foundry.toml` has correct paths
- Verify `remappings.txt` exists
- Check Solidity version (0.8.24)

### Step 1.4: Run Tests (10 min)

```bash
# Run all tests
forge test -vv

# Expected: 13 tests passing
```

**Minimum Target (4 Core Tests):**
```bash
forge test --match-test "test_CreateQuote_Success|test_GrantAccess_Success|test_SettleQuote_Success|test_SettleQuote_RevertWhenWrongPayer" -vv
```

**Expected output:**
```
Running 4 tests for test/PrivateMerchantQuote.t.sol:PrivateMerchantQuoteTest
[PASS] test_CreateQuote_Success (gas: ~)
[PASS] test_GrantAccess_Success (gas: ~)
[PASS] test_SettleQuote_Success (gas: ~)
[PASS] test_SettleQuote_RevertWhenWrongPayer (gas: ~)
Test result: ok. 4 passed; 0 failed; finished in X.XXms
```

### Step 1.5: Deploy Contract (5 min)

```bash
# Terminal 1: Start Anvil
anvil

# Terminal 2: Deploy
PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
forge script script/Deploy.s.sol:Deploy --rpc-url http://127.0.0.1:8545 --broadcast

# Note the addresses:
# MockCreditAdapter: 0x...
# PrivateMerchantQuote: 0x...
```

---

## 📋 Phase 2: React Integration (1 hour)

### Step 2.1: Frontend Setup (10 min)

```bash
cd frontend

# Install dependencies
npm install

# Configure contract address
cp .env.example .env
# Edit .env: REACT_APP_CONTRACT_ADDRESS=<deployed_address>

# Start dev server
npm run dev
```

### Step 2.2: MetaMask Setup (5 min)

1. Add Localhost network (Chain ID: 31337)
2. Import Anvil account: `0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80`
3. Connect to http://localhost:3000

### Step 2.3: Test Merchant Flow (15 min)

1. Go to `/create`
2. Enter amount: `1000`
3. Enter payer: `0x70997970C51812dc3A010C7d01b50e0d17dc79C8`
4. Create quote
5. Copy payment link

### Step 2.4: Test Payer Flow (15 min)

1. Switch to account #2 in MetaMask
2. Open payment link
3. Review quote
4. Pay
5. Verify success

### Step 2.5: Validation (15 min)

- [ ] Quote created on-chain
- [ ] Payment link works
- [ ] Payer can view quote
- [ ] Payment settles
- [ ] Status updates to "Settled"

---

## 📋 Phase 3: FHE Migration (4-6 hours)

### Step 3.1: Contract Migration

**Changes:**
```solidity
// Before (Bootstrap)
bytes32 amountCt;

// After (Native FHE)
import {FHE, euint64} from "@fhenixprotocol/cofhe-contracts/FHE.sol";
euint64 amountCt;

// Add ACL
function createQuote(..., euint64 amountCt, ...) external {
    q.amountCt = amountCt;
    FHE.allow(q.amountCt, msg.sender);  // Add this
}

function grantAccess(...) external {
    FHE.allow(q.amountCt, payer);  // Add this
    q.accessGranted = true;
}
```

### Step 3.2: Frontend Migration

**Install CoFHE SDK:**
```bash
cd frontend
npm install @cofhe/sdk
```

**Update crypto.ts:**
```typescript
import { CofheClient } from "@cofhe/sdk";

export async function encryptAmount(amount: number): Promise<string> {
    const client = new CofheClient({ provider });
    return await client.encryptUint64(amount);
}

export async function decryptAmount(handle: string): Promise<number> {
    const permit = await client.generatePermit(contractAddress);
    return await client.unseal(contractAddress, handle);
}
```

### Step 3.3: Add Preview

**Update PayerPayQuote.tsx:**
```typescript
async function handlePreview() {
    const handle = await getEncryptedAmount(provider, quoteId);
    const amount = await decryptAmount(handle);
    setPreviewAmount(amount);
}

// Change skipPreview to false
await settleQuote(signer, quoteId, false);
```

---

## 📋 Phase 4: Selective Disclosure Receipt (Future)

**After Phase 3 is stable:**
- Receipt registry contract
- Merchant/payer/auditor roles
- Permit-based selective disclosure
- Analytics aggregation

---

## 🚨 Common Issues & Fixes

### Build Fails

**Error: Cannot find FHE.sol**
```bash
# Check remappings
cat remappings.txt

# Should have:
# @fhenixprotocol/cofhe-contracts/=node_modules/@fhenixprotocol/cofhe-contracts/
```

**Error: Solidity version mismatch**
```bash
# Check foundry.toml
cat foundry.toml | grep solc_version
# Should be: solc_version = "0.8.24"
```

### Test Fails

**Error: Contract not found**
```bash
# Rebuild
forge clean && forge build
```

**Error: Revert without reason**
```bash
# Run with very verbose
forge test -vvvv
```

### Deploy Fails

**Error: Anvil not running**
```bash
# Check Anvil
curl http://127.0.0.1:8545 -X POST -H "Content-Type: application/json" \
  --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'
```

**Error: Insufficient funds**
```bash
# Use Anvil's default account (has 10000 ETH)
PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
```

### Frontend Fails

**Error: Contract address not set**
```bash
# Check .env
cat frontend/.env
# Should have: REACT_APP_CONTRACT_ADDRESS=0x...
```

**Error: MetaMask not connecting**
```bash
# Reset MetaMask account
# Settings → Advanced → Reset Account
```

---

## 📊 Success Metrics

### Phase 1 Complete When:
- ✅ `forge build` succeeds
- ✅ 13 tests pass (minimum 4 core tests)
- ✅ Contract deploys to Anvil
- ✅ Addresses logged

### Phase 2 Complete When:
- ✅ Frontend loads
- ✅ Merchant creates quote
- ✅ Payment link works
- ✅ Payer settles quote
- ✅ Transaction confirms

### Phase 3 Complete When:
- ✅ Native FHE types working
- ✅ Real encryption via CoFHE SDK
- ✅ Preview functionality works
- ✅ ACL management correct

---

## 🎯 Decision Points

### ❌ Don't Do Yet:
- Selective Disclosure Receipt
- Analytics module
- Compliance features
- Production deployment

### ✅ Do Now:
1. Build contracts
2. Run tests
3. Deploy local
4. Test React flow

### ⏭️ Do Next:
1. Migrate to FHE native
2. Add preview
3. Test on Fhenix testnet

---

## 📞 Debug Protocol

**When you hit an error:**

1. **Copy exact error message**
2. **Note which step failed:**
   - Build?
   - Test?
   - Deploy?
   - Frontend?
3. **Check logs:**
   - Terminal output
   - Browser console
   - MetaMask errors
4. **Try common fixes first:**
   - Clean build
   - Restart services
   - Check config files

**Then share:**
- Error message
- Step that failed
- What you tried

---

## 🚀 Execute Now

```bash
# Start here:
cd "/Users/idcuq/Documents/Fhenix Buildathon"

# Run validation
./scripts/validate-integration.sh

# If all green, proceed:
npm install
forge install foundry-rs/forge-std --no-commit
forge build
forge test -vv
```

**Target:** 13 tests passing ✅

**Next:** Deploy + React integration

**Future:** FHE migration + Selective Disclosure

---

## 📖 Documentation Index

- `QUICKSTART.md` — Contract quick start
- `BOOTSTRAP_GUIDE.md` — Bootstrap details
- `E2E_INTEGRATION.md` — Full integration guide
- `frontend/README.md` — Frontend setup
- `COFHE_MIGRATION.md` — FHE migration guide
- `EXECUTION_ROADMAP.md` — This file

---

## ✅ Ready to Execute

All files prepared. All documentation written. Clear roadmap defined.

**Next command:**
```bash
forge build && forge test -vv
```

Kirim error pertama yang muncul! 🚀
