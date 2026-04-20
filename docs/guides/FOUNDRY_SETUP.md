# Private Merchant Quote — Foundry Setup Guide

## Overview

Foundry-based testing and deployment for Private Merchant Quote using official CoFHE patterns.

## Prerequisites

- Foundry installed: `curl -L https://foundry.paradigm.sh | bash && foundryup`
- Node.js v18+
- Git

## Directory Structure

```
hexa-pay-fhenix/
├── foundry.toml          # Foundry config
├── remappings.txt        # Import remappings for CoFHE
├── src/
│   ├── PrivateMerchantQuote.sol
│   ├── MockCreditAdapter.sol
│   └── interfaces/
│       └── ICreditAdapter.sol
├── test/
│   └── PrivateMerchantQuoteFoundry.t.sol
├── script/
│   └── Deploy.s.sol
└── lib/
    └── forge-std/        # Installed via forge install
```

## Setup Steps

### 1. Install Dependencies

```bash
# Install Foundry dependencies
forge install foundry-rs/forge-std

# Install Node dependencies (CoFHE packages)
npm install
```

### 2. Verify Remappings

Check `remappings.txt`:
```
forge-std/=lib/forge-std/src/
@fhenixprotocol/cofhe-contracts/=node_modules/@fhenixprotocol/cofhe-contracts/
@cofhe/foundry-plugin/=node_modules/@cofhe/foundry-plugin/
@cofhe/mock-contracts/=node_modules/@cofhe/mock-contracts/
```

### 3. Build Contracts

```bash
forge build
# or
npm run forge:build
```

Expected output:
```
[⠊] Compiling...
[⠒] Compiling 3 files with 0.8.24
[⠢] Solc 0.8.24 finished in X.XXs
Compiler run successful!
```

### 4. Run Tests

#### Minimum Target (4 Core Tests)
```bash
npm run forge:test:min
```

#### Full Test Suite
```bash
forge test -vv
# or
npm run forge:test
```

#### With Gas Report
```bash
forge test --gas-report
```

#### Specific Test
```bash
forge test --match-test test_SettleQuote_Success -vvv
```

## Test Coverage

### Core Tests (Minimum Target)
- ✅ `test_CreateQuote_Success`
- ✅ `test_GrantAccess_Success`
- ✅ `test_SettleQuote_Success`
- ✅ `test_SettleQuote_RevertWhenWrongPayer`

### Additional Tests
- Happy path: 7 tests
- Negative cases: 7 tests
- Event tests: 3 tests
- Integration tests: 2 tests

**Total: 19 tests**

## Deployment

### Local Deployment
```bash
# Start local node (separate terminal)
anvil

# Deploy
forge script script/Deploy.s.sol:DeployPrivateMerchantQuote --rpc-url local --broadcast
# or
npm run forge:deploy
```

### Testnet Deployment
```bash
# Set environment variables
export PRIVATE_KEY=0x...
export FHENIX_RPC_URL=https://...

# Deploy
forge script script/Deploy.s.sol:DeployPrivateMerchantQuote --rpc-url fhenix_testnet --broadcast --verify
```

Deployment info saved to `deployment-foundry.json`.

## CoFHE Integration Notes

### Current Setup (Simplified Mocking)
The test suite uses simplified FHE mocking via `FHE.asEuint64()` for rapid local testing.

```solidity
function _mockEncryptedAmount(uint64 value) internal pure returns (euint64) {
    return FHE.asEuint64(value);
}
```

### Production Testing (Full CoFHE)
For production-grade FHE testing, upgrade to official CoFHE plugin:

```solidity
import {CofheTest, CofheClient} from "@cofhe/foundry-plugin/CoFheTest.sol";

contract PrivateMerchantQuoteTest is CofheTest {
    CofheClient internal merchantClient;
    CofheClient internal payerClient;

    function setUp() public override {
        super.setUp();
        merchantClient = createClient(merchant);
        payerClient = createClient(payer);
    }

    function test_CreateQuote_WithRealEncryption() public {
        // Real encryption via CoFHE client
        euint64 amountCt = merchantClient.encrypt(1000);
        
        vm.prank(merchant);
        quote.createQuote(quoteId, payer, amountCt, expiry);
    }
}
```

## Troubleshooting

### Import Errors
```
Error: Could not find @fhenixprotocol/cofhe-contracts
```

**Fix:**
```bash
npm install
forge remappings > remappings.txt
```

### Compilation Errors
```
Error: Source not found
```

**Fix:** Verify `foundry.toml` has:
```toml
libs = ["lib", "node_modules"]
```

### Test Failures
```
Error: NotAuthorized()
```

**Fix:** Ensure `setUp()` calls `credit.authorizeCaller(address(quote))`

## Migration from Hardhat

If migrating from existing Hardhat tests:

1. Keep Hardhat tests in `test/*.test.js`
2. Add Foundry tests in `test/*.t.sol`
3. Both can coexist:
   - `npm test` → Hardhat
   - `npm run forge:test` → Foundry

## Next Steps

1. ✅ Run minimum target tests
2. ✅ Run full test suite
3. Deploy to Fhenix testnet
4. Integrate with React frontend
5. Upgrade to full CoFHE plugin for production testing

## Resources

- [Foundry Book](https://book.getfoundry.sh/)
- [CoFHE Foundry Starter](https://github.com/FhenixProtocol/cofhe-foundry-starter)
- [Fhenix Docs](https://docs.fhenix.zone/)

## Quick Commands Reference

```bash
# Build
forge build

# Test (verbose)
forge test -vv

# Test (very verbose with traces)
forge test -vvvv

# Test specific contract
forge test --match-contract PrivateMerchantQuoteFoundryTest

# Test with gas report
forge test --gas-report

# Deploy local
forge script script/Deploy.s.sol --rpc-url local --broadcast

# Clean build artifacts
forge clean
```
