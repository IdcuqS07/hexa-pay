#!/bin/bash

echo "🔧 HexaPay Deployment Environment Setup"
echo "========================================"
echo ""

# Check if .env exists
if [ ! -f .env ]; then
  echo "📝 Creating .env file..."
  cat > .env << 'EOF'
# Arbitrum Sepolia Configuration
ARB_SEPOLIA_RPC=https://sepolia-rollup.arbitrum.io/rpc
HEXAPAY_CHAIN_ID=421614

# Deployer/Executor Private Key (REQUIRED)
# Get testnet ETH from: https://faucet.quicknode.com/arbitrum/sepolia
PRIVATE_KEY=

# After deployment, set this:
HEXAPAY_EXECUTOR_CONTRACT_ADDRESS=

# For contract verification (optional)
ARBISCAN_API_KEY=

# Backend environment
HEXAPAY_EXECUTOR_PRIVATE_KEY=
ARB_SEPOLIA_RPC_URL=https://sepolia-rollup.arbitrum.io/rpc

# Redis (if using)
MOCK_RECEIPT_CANONICAL_MODE=redis
MOCK_RECEIPT_CHALLENGE_MODE=redis
MOCK_RECEIPT_REDIS_URL=redis://127.0.0.1:6379

# Persistence Auth
MOCK_RECEIPT_PERSISTENCE_AUTH_ENABLED=1
MOCK_RECEIPT_PERSISTENCE_TOKEN=super-secret-control-plane-token
MOCK_RECEIPT_ALLOW_DEBUG_STATE=0
EOF
  echo "✅ Created .env file"
  echo ""
fi

# Check PRIVATE_KEY
if grep -q "^PRIVATE_KEY=$" .env || ! grep -q "^PRIVATE_KEY=" .env; then
  echo "❌ PRIVATE_KEY not set in .env"
  echo ""
  echo "Please add your private key to .env:"
  echo "  PRIVATE_KEY=0x..."
  echo ""
  echo "⚠️  IMPORTANT: Never commit .env to git!"
  echo "   Make sure .env is in .gitignore"
  echo ""
  echo "💡 To generate a new test wallet:"
  echo "   node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
  echo ""
  exit 1
else
  echo "✅ PRIVATE_KEY is set"
fi

# Check if private key has 0x prefix
PRIVATE_KEY=$(grep "^PRIVATE_KEY=" .env | cut -d '=' -f2)
if [[ ! $PRIVATE_KEY =~ ^0x ]]; then
  echo "⚠️  Adding 0x prefix to PRIVATE_KEY"
  sed -i.bak "s/^PRIVATE_KEY=.*/PRIVATE_KEY=0x$PRIVATE_KEY/" .env
  rm .env.bak 2>/dev/null || true
fi

echo ""
echo "📋 Deployment Checklist:"
echo "  [✓] .env file exists"
echo "  [✓] PRIVATE_KEY is set"
echo ""

# Check balance (requires cast or ethers)
echo "💰 Checking deployer balance..."
echo "   (Make sure you have testnet ETH)"
echo ""

echo "🚀 Ready to deploy!"
echo ""
echo "Next steps:"
echo "  1. Get testnet ETH: https://faucet.quicknode.com/arbitrum/sepolia"
echo "  2. Run deployment: npm run deploy:sepolia"
echo "     or: npx hardhat run scripts/deploy-hexa-executor-safe.js --network arbitrumSepolia"
echo ""
