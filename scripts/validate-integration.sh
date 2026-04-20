#!/bin/bash
# Quick validation for Private Merchant Quote integration

echo "🔍 Private Merchant Quote — Integration Check"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Check contract exists
if [ ! -f "contracts/PrivateMerchantQuote.sol" ]; then
    echo "❌ PrivateMerchantQuote.sol not found"
    exit 1
fi
echo "✅ Contract found"

# Check test exists
if [ ! -f "test/PrivateMerchantQuote.t.sol" ]; then
    echo "❌ Test file not found"
    exit 1
fi
echo "✅ Test file found"

# Check MockCreditAdapter exists
if [ ! -f "contracts/MockCreditAdapter.sol" ]; then
    echo "❌ MockCreditAdapter.sol not found"
    exit 1
fi
echo "✅ MockCreditAdapter found"

echo ""
echo "📋 Contract Interface Check:"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Check key functions exist
grep -q "function createQuote" contracts/PrivateMerchantQuote.sol && echo "✅ createQuote()" || echo "❌ createQuote() missing"
grep -q "function grantAccess" contracts/PrivateMerchantQuote.sol && echo "✅ grantAccess()" || echo "❌ grantAccess() missing"
grep -q "function settleQuote" contracts/PrivateMerchantQuote.sol && echo "✅ settleQuote()" || echo "❌ settleQuote() missing"
grep -q "function cancelExpired" contracts/PrivateMerchantQuote.sol && echo "✅ cancelExpired()" || echo "❌ cancelExpired() missing"
grep -q "function getQuote" contracts/PrivateMerchantQuote.sol && echo "✅ getQuote()" || echo "❌ getQuote() missing"
grep -q "function getEncryptedAmount" contracts/PrivateMerchantQuote.sol && echo "✅ getEncryptedAmount()" || echo "❌ getEncryptedAmount() missing"

echo ""
echo "🧪 Test Coverage Check:"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

grep -q "test_CreateQuote_Success" test/PrivateMerchantQuote.t.sol && echo "✅ test_CreateQuote_Success" || echo "❌ Missing"
grep -q "test_GrantAccess_Success" test/PrivateMerchantQuote.t.sol && echo "✅ test_GrantAccess_Success" || echo "❌ Missing"
grep -q "test_SettleQuote_Success" test/PrivateMerchantQuote.t.sol && echo "✅ test_SettleQuote_Success" || echo "❌ Missing"
grep -q "test_SettleQuote_RevertWhenWrongPayer" test/PrivateMerchantQuote.t.sol && echo "✅ test_SettleQuote_RevertWhenWrongPayer" || echo "❌ Missing"

echo ""
echo "📦 Ready for:"
echo "  1. forge build"
echo "  2. forge test -vv"
echo "  3. Deploy to testnet"
echo ""
