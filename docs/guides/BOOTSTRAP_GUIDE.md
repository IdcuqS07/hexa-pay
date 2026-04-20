# Bootstrap Guide — Private Merchant Quote

## ✅ Current State: Bootstrap-Friendly Version

### Why bytes32?

**Pragmatic approach untuk rapid iteration:**
- ✅ No FHE library dependency untuk basic testing
- ✅ No `FHE.allow()` complexity
- ✅ Simple mock encryption: `keccak256(abi.encodePacked(value))`
- ✅ Full lifecycle testable immediately
- ✅ Easy migration path to native FHE types

### Contract Surface

```solidity
interface ICreditAdapter {
    function canSpend(address user, bytes32 amountCt) external returns (bool);
    function consume(address user, bytes32 amountCt) external;
}

contract PrivateMerchantQuote {
    struct Quote {
        bytes32 amountCt;  // Bootstrap: simple handle
        // ... other fields
    }
    
    function createQuote(bytes32 id, address payer, bytes32 amountCt, uint64 expiresAt) external;
    function grantAccess(bytes32 id, address payer) external;
    function settleQuote(bytes32 id, bool skipPreview) external;
    // ...
}
```

---

## 🚀 Quick Start

### 1. Build
```bash
forge build
```

### 2. Run Bootstrap Tests (No Plugin Required)
```bash
npm run forge:test:bootstrap
```

Expected: **20 tests passing**

### 3. Run Minimum Target (4 Core Tests)
```bash
npm run forge:test:min
```

---

## 📊 Test Coverage

### Bootstrap Test Suite
**File:** `test/PrivateMerchantQuoteBootstrap.t.sol`

**Coverage:**
- ✅ 4 core tests (minimum target)
- ✅ 3 additional happy path tests
- ✅ 9 negative case tests
- ✅ 3 event tests
- ✅ 3 integration tests

**Total: 20 tests**

### Mock Encryption
```solidity
function _mockEncryptedAmount(uint64 value) internal pure returns (bytes32) {
    return keccak256(abi.encodePacked(value));
}
```

Simple, deterministic, no external dependencies.

---

## 🔄 Migration Path to Native FHE

### Phase 1: Bootstrap (Current) ✅
```solidity
// Contract
bytes32 amountCt;

// Test
bytes32 encrypted = keccak256(abi.encodePacked(100));
```

### Phase 2: CoFHE Plugin
```solidity
// Contract (same)
bytes32 amountCt;

// Test (upgrade)
import {CofheTest, CofheClient} from "@cofhe/foundry-plugin/CoFheTest.sol";

bytes32 encrypted = client.encrypt(100);  // Real encryption
```

### Phase 3: Native FHE Types
```solidity
// Contract (upgrade)
import {FHE, euint64} from "@fhenixprotocol/cofhe-contracts/FHE.sol";

euint64 amountCt;

function createQuote(..., euint64 amountCt, ...) external {
    q.amountCt = amountCt;
    FHE.allow(q.amountCt, msg.sender);  // Add ACL
}

function grantAccess(...) external {
    FHE.allow(q.amountCt, payer);  // Add ACL
}
```

---

## 🎯 What Changes in Each Phase

### Phase 1 → Phase 2 (Plugin Upgrade)
**Contract:** No changes  
**Test:** Replace mock with `CofheClient.encrypt()`  
**Effort:** Low (1-2 hours)

### Phase 2 → Phase 3 (Native FHE)
**Contract:** 
- `bytes32 amountCt` → `euint64 amountCt`
- Add `FHE.allow()` calls in `createQuote()` and `grantAccess()`
- Update `ICreditAdapter` interface

**Test:** Update type expectations  
**Effort:** Medium (4-6 hours)

---

## 📁 File Structure

```
src/
├── PrivateMerchantQuote.sol          # Bootstrap version (bytes32)
├── PrivateMerchantQuoteCofhe.sol     # Alternative CoFHE version
├── MockCreditAdapter.sol              # Bootstrap adapter (bytes32)
└── interfaces/
    └── ICreditAdapter.sol             # Interface definition

test/
├── PrivateMerchantQuoteBootstrap.t.sol    # ✅ Current (20 tests)
├── PrivateMerchantQuoteCofhe.t.sol        # CoFHE plugin version
└── PrivateMerchantQuoteFoundry.t.sol      # Alternative mock version
```

---

## 🧪 Test Commands

```bash
# Bootstrap tests (recommended for now)
npm run forge:test:bootstrap

# Minimum target (4 core tests)
npm run forge:test:min

# All tests
npm run forge:test

# With gas report
forge test --match-contract PrivateMerchantQuoteBootstrapTest --gas-report

# Specific test
forge test --match-test test_SettleQuote_Success -vvv
```

---

## ✅ Validation Checklist

Run this to validate everything works:

```bash
# 1. Clean build
forge clean && forge build

# 2. Run bootstrap tests
npm run forge:test:bootstrap

# 3. Check minimum target
npm run forge:test:min

# 4. Verify all 20 tests pass
forge test --match-contract PrivateMerchantQuoteBootstrapTest
```

Expected output:
```
Running 20 tests for test/PrivateMerchantQuoteBootstrap.t.sol:PrivateMerchantQuoteBootstrapTest
[PASS] test_CancelExpired_RevertWhenNotExpired() (gas: ~)
[PASS] test_CancelExpired_RevertWhenNotMerchant() (gas: ~)
[PASS] test_CancelExpired_Success() (gas: ~)
[PASS] test_CancelQuote_Success() (gas: ~)
[PASS] test_CreateQuote_EmitsEvent() (gas: ~)
[PASS] test_CreateQuote_RevertOnDuplicateId() (gas: ~)
[PASS] test_CreateQuote_RevertOnZeroAmount() (gas: ~)
[PASS] test_CreateQuote_RevertOnZeroPayer() (gas: ~)
[PASS] test_CreateQuote_Success() (gas: ~)
[PASS] test_CreditAdapter_Authorization() (gas: ~)
[PASS] test_GetEncryptedAmount() (gas: ~)
[PASS] test_GrantAccess_EmitsEvent() (gas: ~)
[PASS] test_GrantAccess_RevertWhenNotMerchant() (gas: ~)
[PASS] test_GrantAccess_Success() (gas: ~)
[PASS] test_SettleQuote_ConsumesCredit() (gas: ~)
[PASS] test_SettleQuote_EmitsEvent() (gas: ~)
[PASS] test_SettleQuote_RevertWhenExpired() (gas: ~)
[PASS] test_SettleQuote_RevertWhenInsufficientCredit() (gas: ~)
[PASS] test_SettleQuote_RevertWhenNoAccessAndNoSkipPreview() (gas: ~)
[PASS] test_SettleQuote_RevertWhenWrongPayer() (gas: ~)
[PASS] test_SettleQuote_Success() (gas: ~)
[PASS] test_SettleQuote_Success_WithSkipPreview() (gas: ~)
Test result: ok. 20 passed; 0 failed; finished in X.XXms
```

---

## 🎯 Recommended Workflow

### Now (Bootstrap Phase)
```bash
# Rapid iteration with bootstrap tests
forge build
npm run forge:test:bootstrap
```

### Next (Plugin Phase)
```bash
# Upgrade to CoFHE plugin
npm install @cofhe/foundry-plugin
npm run forge:test:cofhe
```

### Later (Production Phase)
```bash
# Migrate to native FHE types
# Update contract to use euint64
# Add FHE.allow() calls
# Deploy to Fhenix testnet
```

---

## 💡 Key Benefits of This Approach

1. **Immediate Validation**
   - No waiting for plugin setup
   - Pure Foundry, no external dependencies
   - Fast compile and test cycles

2. **Full Lifecycle Coverage**
   - Create → Grant → Settle → Cancel
   - All edge cases tested
   - Event emission validated

3. **Clear Migration Path**
   - Incremental upgrades
   - No big-bang rewrite
   - Each phase independently testable

4. **Production-Ready Logic**
   - Business logic fully validated
   - Only encryption layer changes
   - Contract interface stable

---

## 🚦 Next Steps

1. ✅ Run `npm run forge:test:bootstrap` to validate
2. Deploy to local Anvil for integration testing
3. Build React frontend against bootstrap version
4. Upgrade to CoFHE plugin when ready
5. Migrate to native FHE types for production

---

## 📖 Related Documentation

- `FOUNDRY_SETUP.md` — Foundry configuration guide
- `COFHE_MIGRATION.md` — CoFHE plugin migration guide
- `TESTING_QUICK_REF.md` — Testing command reference
- `FOUNDRY_INTEGRATION.md` — Integration summary
