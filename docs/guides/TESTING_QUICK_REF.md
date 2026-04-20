# Testing Quick Reference

## Two Testing Approaches

### 1. Simplified Mock Testing (Fast Iteration)
**Use when:** Validating contract logic, rapid development

```bash
# Run tests
npm run forge:test:mock

# Or directly
forge test --match-contract PrivateMerchantQuoteFoundryTest -vv
```

**Files:**
- Contract: `src/PrivateMerchantQuote.sol` (uses `euint64`)
- Test: `test/PrivateMerchantQuoteFoundry.t.sol`
- Mock: `FHE.asEuint64()` for encryption

**Pros:**
- ✅ Fast compilation
- ✅ No external dependencies
- ✅ Easy debugging

**Cons:**
- ⚠️ Not production-accurate FHE behavior

---

### 2. CoFHE-Native Testing (Production-Like)
**Use when:** Production validation, testnet deployment prep

```bash
# Run tests
npm run forge:test:cofhe

# Or directly
forge test --match-contract PrivateMerchantQuoteCofheTest -vv
```

**Files:**
- Contract: `src/PrivateMerchantQuoteCofhe.sol` (uses `bytes32`)
- Test: `test/PrivateMerchantQuoteCofhe.t.sol`
- Plugin: `@cofhe/foundry-plugin` for real encryption

**Pros:**
- ✅ Production-accurate FHE patterns
- ✅ Real encryption via `CofheClient`
- ✅ Better testnet compatibility

**Cons:**
- ⚠️ Requires plugin setup
- ⚠️ Slightly slower

---

## Quick Commands

### Build
```bash
forge build                          # Build all
forge build --contracts src/PrivateMerchantQuote.sol        # Specific contract
forge build --contracts src/PrivateMerchantQuoteCofhe.sol   # CoFHE version
```

### Test
```bash
npm run forge:test:min               # 4 core tests (any version)
npm run forge:test:mock              # Simplified mock tests
npm run forge:test:cofhe             # CoFHE-native tests
npm run forge:test                   # All tests
```

### Deploy
```bash
npm run forge:deploy                 # Deploy mock version
npm run forge:deploy:cofhe           # Deploy CoFHE version
```

---

## Contract Comparison

| Feature | PrivateMerchantQuote | PrivateMerchantQuoteCofhe |
|---------|---------------------|---------------------------|
| Encrypted Type | `euint64` | `bytes32` |
| FHE Library | `@fhenixprotocol/cofhe-contracts` | Same |
| ACL Management | `FHE.allow()` | Handled by client |
| Test Pattern | `FHE.asEuint64()` | `CofheClient.encrypt()` |
| Best For | Hardhat integration | Foundry + CoFHE plugin |

---

## Workflow Recommendation

### Phase 1: Development (Current)
```bash
# Use simplified mocks for fast iteration
npm run forge:test:mock
```

### Phase 2: Pre-Deployment
```bash
# Validate with CoFHE plugin
npm install @cofhe/foundry-plugin
npm run forge:test:cofhe
```

### Phase 3: Deployment
```bash
# Deploy CoFHE-compatible version
npm run forge:deploy:cofhe
```

---

## Troubleshooting

### Mock Tests Fail
```bash
# Check contract exists
ls src/PrivateMerchantQuote.sol

# Rebuild
forge clean && forge build

# Run with verbose output
forge test --match-contract PrivateMerchantQuoteFoundryTest -vvvv
```

### CoFHE Tests Fail
```bash
# Check plugin installed
ls node_modules/@cofhe/foundry-plugin

# Reinstall if missing
npm install @cofhe/foundry-plugin

# Check import path in test file
# Try alternative paths if needed
```

### Import Errors
```bash
# Regenerate remappings
forge remappings > remappings.txt

# Verify paths
cat remappings.txt
```

---

## File Locations

```
src/
├── PrivateMerchantQuote.sol          # euint64 version
├── PrivateMerchantQuoteCofhe.sol     # bytes32 version (CoFHE)
├── MockCreditAdapter.sol              # euint64 adapter
└── interfaces/
    └── ICreditAdapter.sol

test/
├── PrivateMerchantQuoteFoundry.t.sol # Mock tests
└── PrivateMerchantQuoteCofhe.t.sol   # CoFHE tests

script/
├── Deploy.s.sol                       # Mock deployment
└── DeployCofhe.s.sol                  # CoFHE deployment
```

---

## Next Steps

1. ✅ Run mock tests: `npm run forge:test:mock`
2. Install CoFHE plugin: `npm install @cofhe/foundry-plugin`
3. Run CoFHE tests: `npm run forge:test:cofhe`
4. Deploy to testnet: `npm run forge:deploy:cofhe`
5. Integrate with React frontend
