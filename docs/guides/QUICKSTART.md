# Private Merchant Quote — Bootstrap Package

## ✅ Final Bootstrap Package

**3 files yang saling cocok:**
- `src/PrivateMerchantQuote.sol`
- `test/PrivateMerchantQuote.t.sol`
- `script/Deploy.s.sol`

**Target:** Cepat compile, cepat test hijau, lalu migrasi ke native FHE types.

---

## 🚀 Quick Start

### 1. Build
```bash
forge build
```

### 2. Test
```bash
forge test -vv
```

Expected: **13 tests passing**

### 3. Deploy Local
```bash
# Start Anvil (separate terminal)
anvil

# Deploy
PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
forge script script/Deploy.s.sol:Deploy --rpc-url http://127.0.0.1:8545 --broadcast
```

### 4. Deploy Testnet
```bash
PRIVATE_KEY=0xyourkey \
forge script script/Deploy.s.sol:Deploy --rpc-url $FHENIX_RPC_URL --broadcast
```

---

## 📊 Test Coverage

### 13 Tests Total

**Core Happy Path (4 tests):**
- ✅ test_CreateQuote_Success
- ✅ test_GrantAccess_Success
- ✅ test_SettleQuote_Success
- ✅ test_SettleQuote_RevertWhenWrongPayer

**Additional Happy Path (3 tests):**
- ✅ test_SettleQuote_Success_WithSkipPreview
- ✅ test_CancelExpired_Success
- ✅ test_CancelQuote_Success

**Negative Cases (5 tests):**
- ✅ test_SettleQuote_RevertWhenExpired
- ✅ test_SettleQuote_RevertWhenNoAccessAndNoSkipPreview
- ✅ test_SettleQuote_RevertWhenInsufficientCredit
- ✅ test_CreateQuote_RevertOnDuplicateId
- ✅ test_GrantAccess_RevertWhenNotMerchant

**Utility (1 test):**
- ✅ test_GetEncryptedAmount_Success

---

## 🎯 Why This Package Works

### 1. No FHE Dependencies
```solidity
// Contract
bytes32 amountCt;  // Simple handle, no euint64

// Test
function _mockEncryptedAmount(uint64 value) internal pure returns (bytes32) {
    return keccak256(abi.encodePacked("enc_amount", value));
}
```

### 2. No ACL Complexity
```solidity
// No FHE.allow() needed yet
function createQuote(..., bytes32 amountCt, ...) external {
    q.amountCt = amountCt;
    // That's it!
}
```

### 3. Full Lifecycle Testable
- Create → Grant → Settle → Cancel
- All edge cases covered
- Event emission validated

### 4. Easy Migration Path
```solidity
// Phase 1 (Current)
bytes32 amountCt;
bool canSpend(...);

// Phase 2 (Native FHE)
euint64 amountCt;
ebool canSpend(...);
FHE.allow(q.amountCt, payer);
```

---

## 🔄 Migration Roadmap

### Phase 1: Bootstrap (Current) ✅
**Contract:**
```solidity
bytes32 amountCt;
ICreditAdapter { function canSpend(...) returns (bool); }
```

**Test:**
```solidity
bytes32 encrypted = keccak256(abi.encodePacked("enc_amount", 100));
```

**Status:** Ready to test now

---

### Phase 2: Native FHE Types
**Contract Changes:**
```solidity
// 1. Import FHE library
import {FHE, euint64, ebool} from "@fhenixprotocol/cofhe-contracts/FHE.sol";

// 2. Update struct
struct Quote {
    euint64 amountCt;  // Changed from bytes32
    // ...
}

// 3. Update interface
interface ICreditAdapter {
    function canSpend(address user, euint64 amountCt) external returns (ebool);
    function consume(address user, euint64 amountCt) external;
}

// 4. Add ACL in createQuote
function createQuote(..., euint64 amountCt, ...) external {
    q.amountCt = amountCt;
    FHE.allow(q.amountCt, msg.sender);  // Add this
    // ...
}

// 5. Add ACL in grantAccess
function grantAccess(bytes32 id, address payer) external {
    // ...
    FHE.allow(q.amountCt, payer);  // Add this
    q.accessGranted = true;
}

// 6. Update settleQuote
function settleQuote(...) public {
    // ...
    ebool ok = credit.canSpend(msg.sender, q.amountCt);  // Returns ebool now
    // Handle ebool → bool conversion or use sealed computation
}
```

**Test Changes:**
```solidity
// Use CofheClient for real encryption
import {CofheTest, CofheClient} from "@cofhe/foundry-plugin/CoFheTest.sol";

contract Test is CofheTest {
    CofheClient internal merchantClient;
    
    function setUp() public override {
        super.setUp();
        merchantClient = createClient(merchant);
    }
    
    function _mockEncryptedAmount(uint64 value) internal returns (euint64) {
        return merchantClient.encrypt(value);  // Real encryption
    }
}
```

**Effort:** 4-6 hours

---

## 📁 File Structure

```
src/
├── PrivateMerchantQuote.sol          # Bootstrap version (bytes32)
└── interfaces/
    └── ICreditAdapter.sol             # Interface (optional)

test/
└── PrivateMerchantQuote.t.sol        # 13 tests, no plugin required

script/
└── Deploy.s.sol                       # Simple deployment

foundry.toml                           # Foundry config
remappings.txt                         # Import mappings
```

---

## 🧪 Test Commands

```bash
# All tests
forge test -vv

# Specific test
forge test --match-test test_SettleQuote_Success -vvv

# With gas report
forge test --gas-report

# Watch mode (requires forge-watch)
forge test --watch
```

---

## 🎯 Expected Output

```bash
$ forge test -vv

Running 13 tests for test/PrivateMerchantQuote.t.sol:PrivateMerchantQuoteTest
[PASS] test_CancelExpired_Success() (gas: ~)
[PASS] test_CancelQuote_Success() (gas: ~)
[PASS] test_CreateQuote_RevertOnDuplicateId() (gas: ~)
[PASS] test_CreateQuote_Success() (gas: ~)
[PASS] test_GetEncryptedAmount_Success() (gas: ~)
[PASS] test_GrantAccess_RevertWhenNotMerchant() (gas: ~)
[PASS] test_GrantAccess_Success() (gas: ~)
[PASS] test_SettleQuote_RevertWhenExpired() (gas: ~)
[PASS] test_SettleQuote_RevertWhenInsufficientCredit() (gas: ~)
[PASS] test_SettleQuote_RevertWhenNoAccessAndNoSkipPreview() (gas: ~)
[PASS] test_SettleQuote_RevertWhenWrongPayer() (gas: ~)
[PASS] test_SettleQuote_Success() (gas: ~)
[PASS] test_SettleQuote_Success_WithSkipPreview() (gas: ~)
Test result: ok. 13 passed; 0 failed; finished in X.XXms
```

---

## ✅ Validation Checklist

```bash
# 1. Clean build
forge clean && forge build

# 2. Run tests
forge test -vv

# 3. Check all 13 pass
forge test --summary

# 4. Deploy local
anvil &
PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
forge script script/Deploy.s.sol:Deploy --rpc-url http://127.0.0.1:8545 --broadcast
```

---

## 🚦 Next Steps

1. ✅ Run `forge build`
2. ✅ Run `forge test -vv` (expect 13 passing)
3. Deploy to local Anvil
4. Build React frontend
5. Migrate to native FHE types when ready

---

## 💡 Key Benefits

**Immediate:**
- ✅ No plugin dependencies
- ✅ Fast compile/test cycles
- ✅ Full business logic validated

**Future:**
- ✅ Clear migration path
- ✅ Incremental upgrades
- ✅ Production-ready foundation

---

## 📖 Related Docs

- `BOOTSTRAP_GUIDE.md` — Detailed bootstrap guide
- `COFHE_MIGRATION.md` — Migration to native FHE
- `FOUNDRY_SETUP.md` — Foundry configuration

---

## 🎉 Ready to Go

```bash
forge build && forge test -vv
```

Expect: **13 tests passing** ✅
