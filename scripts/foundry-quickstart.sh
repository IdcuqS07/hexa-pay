#!/bin/bash
# Quick start script for Foundry setup

set -e

echo "🚀 Private Merchant Quote — Foundry Quick Start"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Check Foundry
if ! command -v forge &> /dev/null; then
    echo ""
    echo "📦 Foundry not installed. Installing..."
    curl -L https://foundry.paradigm.sh | bash
    source ~/.bashrc || source ~/.zshrc || true
    foundryup
    echo "✅ Foundry installed"
else
    echo "✅ Foundry already installed"
    forge --version
fi

echo ""
echo "📦 Installing Forge dependencies..."
forge install foundry-rs/forge-std --no-commit

echo ""
echo "📦 Installing Node dependencies..."
npm install --silent

echo ""
echo "🔨 Building contracts..."
forge build

echo ""
echo "✅ Setup complete!"
echo ""
echo "📋 Next steps:"
echo "  1. Run minimum tests: npm run forge:test:min"
echo "  2. Run full tests: npm run forge:test"
echo "  3. Deploy: npm run forge:deploy"
echo ""
echo "📖 See docs/guides/FOUNDRY_SETUP.md for detailed guide"
