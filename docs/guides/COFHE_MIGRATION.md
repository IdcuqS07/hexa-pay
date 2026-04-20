# CoFHE-Native Implementation Guide

## Overview

This guide covers the CoFHE-native implementation using `CofheTest` and `CofheClient` from the official Foundry plugin.

## Files Created

### Contracts
- `src/PrivateMerchantQuoteCofhe.sol` — CoFHE-compatible version using `bytes32` handles
- `src/PrivateMerchantQuote.sol` — Original version using `euint64` (kept for reference)

### Tests
- `test/PrivateMerchantQuoteCofhe.t.sol` — CoFHE-native tests with `CofheTest`
- `test/PrivateMerchantQuoteFoundry.t.sol` — Simplified mock tests (kept for reference)

### Scripts
- `script/DeployCofhe.s.sol` — CoFHE-compatible deployment
- `script/Deploy.s.sol` — Original deployment (kept for reference)

## Key Differences: euint64 vs bytes32

### Original Version (euint64)
```solidity
import {FHE, euint64, ebool} from "@fhenixprotocol/cofhe-contracts/FHE.sol";

struct Quote {
    euint64 amountCt;  // Native FHE type
}

function createQuote(bytes32 id, address payer, euint64 amountCt, uint64 expiresAt) external {
    q.amountCt = amountCt;
    FHE.allow(q.amountCt, msg.sender);  // ACL management
}
```

### CoFHE Version (bytes32)
```solidity
struct Quote {
    bytes32 amountCt;  // Handle for CoFHE client
}

function createQuote(bytes32 id, address payer, bytes32 amountCt, uint64 expiresAt) external {
    q.amountCt = amountCt;
    // No FHE.allow needed — handled by CoFHE client
}
```

## Test Pattern Comparison

### Simplified Mock Test
```solidity
import "forge-std/Test.sol";

contract Test is Test {
    function _mockEncryptedAmount(uint64 value) internal pure returns (euint64) {
        return FHE.asEuint64(value);
    }
    
    function test_CreateQuote() public {
        euint64 amountCt = _mockEncryptedAmount(100);
        quote.createQuote(quoteId, payer, amountCt, expiry);
    }
}
```

### CoFHE-Native Test
```solidity
import {CofheTest, CofheClient} from "@cofhe/foundry-plugin/CoFheTest.sol";

contract Test is CofheTest {
    CofheClient internal merchantClient;
    
    function setUp() public override {
        super.setUp();
        merchantClient = createClient(merchant);
    }
    
    function _encryptAmount(CofheClient client, uint64 value) internal returns (bytes32) {
        return client.encrypt(value);  // Real encryption
    }
    
    function test_CreateQuote() public {
        bytes32 amountCt = _encryptAmount(merchantClient, 100);
        quote.createQuote(quoteId, payer, amountCt, expiry);
    }
}
```

## Setup Instructions

### 1. Install CoFHE Plugin

```bash
npm install @cofhe/foundry-plugin @cofhe/mock-contracts
```

### 2. Verify Remappings

Check `remappings.txt`:
```
@cofhe/foundry-plugin/=node_modules/@cofhe/foundry-plugin/
@cofhe/mock-contracts/=node_modules/@cofhe/mock-contracts/
```

### 3. Build CoFHE Version

```bash
forge build --contracts src/PrivateMerchantQuoteCofhe.sol
```

### 4. Run CoFHE Tests

```bash
forge test --match-contract PrivateMerchantQuoteCofheTest -vv
```

## Adjustment Points

### 1. Import Path
The exact import path may vary by plugin version:

```solidity
// Try these in order:
import {CofheTest, CofheClient} from "@cofhe/foundry-plugin/CoFheTest.sol";
import {CofheTest, CofheClient} from "@cofhe/foundry-plugin/src/CoFheTest.sol";
import {CofheTest, CofheClient} from "@cofhe/foundry-plugin/contracts/CoFheTest.sol";
```

### 2. Encrypt Helper
The encryption method name may vary:

```solidity
// Try these:
client.encrypt(value)
client.encryptUint64(value)
client.encryptU64(value)
```

### 3. Credit Adapter Interface
Adjust `MockCreditAdapterCofhe` to match your encryption type:

```solidity
// For bytes32:
function canSpend(address user, bytes32 amountCt) external view returns (bool);
function consume(address user, bytes32 amountCt) external;

// For euint64:
function canSpend(address user, euint64 amountCt) external returns (ebool);
function consume(address user, euint64 amountCt) external;
```

## Migration Strategy

### Phase 1: Validate with Simplified Mocks (Current)
```bash
forge test --match-contract PrivateMerchantQuoteFoundryTest -vv
```
- ✅ Fast iteration
- ✅ No external dependencies
- ✅ Good for contract logic validation

### Phase 2: Upgrade to CoFHE Plugin
```bash
npm install @cofhe/foundry-plugin
forge test --match-contract PrivateMerchantQuoteCofheTest -vv
```
- ✅ Real encryption patterns
- ✅ Production-like testing
- ⚠️ Requires plugin setup

### Phase 3: Deploy to Fhenix Testnet
```bash
forge script script/DeployCofhe.s.sol --rpc-url fhenix_testnet --broadcast
```
- ✅ Real FHE network
- ✅ End-to-end validation

## Troubleshooting

### Error: Cannot find CofheTest
```
Error: Source "@cofhe/foundry-plugin/CoFheTest.sol" not found
```

**Fix:**
1. Check `node_modules/@cofhe/foundry-plugin` exists
2. Update `remappings.txt`
3. Try alternative import paths

### Error: client.encrypt not found
```
Error: Member "encrypt" not found
```

**Fix:** Check plugin documentation for correct method name:
```solidity
// Try:
client.encryptUint64(value)
// or
client.encryptU64(value)
```

### Error: Type mismatch
```
Error: Type bytes32 is not implicitly convertible to euint64
```

**Fix:** Use `PrivateMerchantQuoteCofhe.sol` (bytes32 version) instead of `PrivateMerchantQuote.sol` (euint64 version)

## Recommended Workflow

### For Rapid Development
```bash
# Use simplified mocks
forge test --match-contract PrivateMerchantQuoteFoundryTest -vv
```

### For Production Validation
```bash
# Use CoFHE plugin
forge test --match-contract PrivateMerchantQuoteCofheTest -vv
```

### For Deployment
```bash
# Use CoFHE-compatible contract
forge script script/DeployCofhe.s.sol --rpc-url fhenix_testnet --broadcast
```

## Contract Interface Compatibility

Both versions expose the same interface:

```solidity
function createQuote(bytes32 id, address payer, bytes32 amountCt, uint64 expiresAt) external;
function grantAccess(bytes32 id, address payer) external;
function settleQuote(bytes32 id, bool skipPreview) external;
function cancelExpired(bytes32 id) external;
function cancelQuote(bytes32 id) external;
function getQuote(bytes32 id) external view returns (address, address, uint64, uint8, bool);
function getEncryptedAmount(bytes32 id) external view returns (bytes32);
```

The only difference is internal storage type (`euint64` vs `bytes32`).

## Next Steps

1. ✅ Validate simplified mock tests pass
2. Install `@cofhe/foundry-plugin`
3. Adjust import paths if needed
4. Run CoFHE-native tests
5. Deploy to Fhenix testnet
6. Integrate with React frontend

## Resources

- [CoFHE Foundry Starter](https://github.com/FhenixProtocol/cofhe-foundry-starter)
- [Fhenix Documentation](https://docs.fhenix.zone/)
- [Foundry Book](https://book.getfoundry.sh/)
