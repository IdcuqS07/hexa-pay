# Private Merchant Quote — Test Suite

## Overview

Comprehensive Foundry test suite for the Private Merchant Quote contract system.

## Test Coverage

### Core Happy Path (Minimum Target)
- ✅ `test_CreateQuote_Success` — Merchant creates encrypted quote
- ✅ `test_GrantAccess_Success` — Merchant grants preview access
- ✅ `test_SettleQuote_Success` — Payer settles with preview
- ✅ `test_SettleQuote_Success_WithSkipPreview` — Blind payment flow

### Negative Cases
- ✅ `test_CreateQuote_RevertOnDuplicateId` — Duplicate quote prevention
- ✅ `test_CreateQuote_RevertOnZeroPayer` — Invalid payer validation
- ✅ `test_GrantAccess_RevertWhenNotMerchant` — Access control
- ✅ `test_SettleQuote_RevertWhenWrongPayer` — Payer authorization
- ✅ `test_SettleQuote_RevertWhenExpired` — Expiry enforcement
- ✅ `test_SettleQuote_RevertWhenNoAccessAndNoSkipPreview` — Preview requirement
- ✅ `test_SettleQuote_RevertWhenInsufficientCredit` — Credit validation
- ✅ `test_CancelExpired_RevertWhenNotExpired` — Expiry timing
- ✅ `test_CancelExpired_RevertWhenNotMerchant` — Cancel authorization

### Event Tests
- ✅ `test_CreateQuote_EmitsEvent`
- ✅ `test_GrantAccess_EmitsEvent`
- ✅ `test_SettleQuote_EmitsEvent`

## Quick Start

### Run All Tests
```bash
forge test -vv
```

### Run Minimum Target (4 Core Tests)
```bash
forge test --match-test "test_CreateQuote_Success|test_GrantAccess_Success|test_SettleQuote_Success|test_SettleQuote_RevertWhenWrongPayer" -vv
```

### Run with Gas Report
```bash
forge test --gas-report
```

### Run Specific Test
```bash
forge test --match-test test_SettleQuote_Success -vvv
```

### Use Test Script
```bash
./scripts/test-private-quote.sh
```

## Test Architecture

### MockCreditAdapterForTest
- Simplified credit adapter for testing
- `forceApprove` flag to simulate sufficient/insufficient credit
- Proper FHE mock patterns for encrypted operations

### Test Helpers
- `_mockEncryptedAmount(uint64)` — Create mock encrypted values
- `_mockInEuint64(uint64)` — Create mock calldata parameters
- `_createQuote()` — Standard quote creation
- `_seedCredit(address, uint64)` — Setup user credit

## FHE Mocking Strategy

The test suite uses simplified FHE mocking:

```solidity
function _mockEncryptedAmount(uint64 value) internal pure returns (euint64) {
    return FHE.asEuint64(value);
}
```

For production testing with actual FHE operations, replace with:
- Fhenix localfhenix network
- Actual encryption via FhenixClient
- Real threshold network decryption

## Contract Interface Tested

```solidity
function createQuote(bytes32 id, address payer, inEuint64 calldata amountCt, uint64 expiresAt)
function grantAccess(bytes32 id, address payer)
function settleQuote(bytes32 id, bool skipPreview)
function cancelExpired(bytes32 id)
function getQuote(bytes32 id) returns (address, address, uint64, Status, bool)
```

## Expected Test Output

```
Running 16 tests for test/PrivateMerchantQuote.t.sol:PrivateMerchantQuoteTest
[PASS] test_CancelExpired_RevertWhenNotExpired() (gas: ~)
[PASS] test_CancelExpired_RevertWhenNotMerchant() (gas: ~)
[PASS] test_CreateQuote_EmitsEvent() (gas: ~)
[PASS] test_CreateQuote_RevertOnDuplicateId() (gas: ~)
[PASS] test_CreateQuote_RevertOnZeroPayer() (gas: ~)
[PASS] test_CreateQuote_Success() (gas: ~)
[PASS] test_GrantAccess_EmitsEvent() (gas: ~)
[PASS] test_GrantAccess_RevertWhenNotMerchant() (gas: ~)
[PASS] test_GrantAccess_Success() (gas: ~)
[PASS] test_SettleQuote_EmitsEvent() (gas: ~)
[PASS] test_SettleQuote_RevertWhenExpired() (gas: ~)
[PASS] test_SettleQuote_RevertWhenInsufficientCredit() (gas: ~)
[PASS] test_SettleQuote_RevertWhenNoAccessAndNoSkipPreview() (gas: ~)
[PASS] test_SettleQuote_RevertWhenWrongPayer() (gas: ~)
[PASS] test_SettleQuote_Success() (gas: ~)
[PASS] test_SettleQuote_Success_WithSkipPreview() (gas: ~)
Test result: ok. 16 passed; 0 failed; finished in Xms
```

## Troubleshooting

### Import Path Issues
If you see `@fhenixprotocol/contracts` import errors:
```bash
npm install @fhenixprotocol/contracts
```

### Forge Not Found
Install Foundry:
```bash
curl -L https://foundry.paradigm.sh | bash
foundryup
```

### FHE Mock Issues
The test uses simplified FHE mocking. For actual FHE testing:
1. Use Fhenix localfhenix network
2. Replace `_mockEncryptedAmount` with real encryption
3. Update `MockCreditAdapterForTest` to use actual FHE operations

## Next Steps

1. ✅ Run minimum target tests
2. ✅ Run full test suite
3. Deploy to Fhenix testnet
4. Integration testing with frontend
5. Add fuzzing tests for edge cases
6. Gas optimization analysis
