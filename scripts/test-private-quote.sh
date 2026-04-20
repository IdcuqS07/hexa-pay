#!/bin/bash
# Test runner for Private Merchant Quote

set -e

echo "🧪 Private Merchant Quote Test Suite"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Check if forge is installed
if ! command -v forge &> /dev/null; then
    echo "❌ Foundry not installed. Install from https://getfoundry.sh"
    exit 1
fi

echo "📦 Installing dependencies..."
npm install --silent

echo ""
echo "🔨 Compiling contracts..."
forge build

echo ""
echo "🎯 Running minimum target tests (4 core tests)..."
forge test --match-test "test_CreateQuote_Success|test_GrantAccess_Success|test_SettleQuote_Success|test_SettleQuote_RevertWhenWrongPayer" -vv

echo ""
echo "✅ Core tests passed!"
echo ""
echo "🚀 Running full test suite..."
forge test -vv

echo ""
echo "📊 Gas report..."
forge test --gas-report

echo ""
echo "✅ All tests completed!"
