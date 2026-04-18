# HexaPay Deployment Guide

## Target Network

HexaPay is now configured to deploy to Arbitrum Sepolia by default.

Network details:

```text
Network Name: Arbitrum Sepolia
RPC URL: https://sepolia-rollup.arbitrum.io/rpc
Chain ID: 421614
Currency Symbol: ETH
Block Explorer: https://sepolia.arbiscan.io
```

## Prerequisites

You need:

- a wallet private key for deployment
- Arbitrum Sepolia ETH for gas
- a settlement token address for HexaPay core if you want to override the default

On `arb-sepolia`, the deploy script now defaults to Circle USDC testnet:

- `0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d`

If you do not already have a test ERC-20 on Arbitrum Sepolia, deploy one with:

```bash
npm run deploy:token
```

## 1. Prepare Environment

```bash
cp .env.example .env
```

Edit `.env`:

```env
ARB_SEPOLIA_RPC=https://sepolia-rollup.arbitrum.io/rpc
PRIVATE_KEY=0xyour_private_key_here
ARBISCAN_API_KEY=
SETTLEMENT_TOKEN_ADDRESS=0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d
```

Notes:

- `PRIVATE_KEY` should include the `0x` prefix.
- `ARBISCAN_API_KEY` is optional and only needed for verification.
- `SETTLEMENT_TOKEN_ADDRESS` should point to the ERC-20 you want HexaPay to use as its settlement rail on Arbitrum Sepolia.
- Leave the default value in place if you want Circle USDC testnet.

## 2. Install And Compile

```bash
npm install
npm run compile
```

## 3. Check Wallet Balance

```bash
npm run check-balance
```

Recommended starting balance:

- `0.02-0.05 ETH` on Arbitrum Sepolia for deployment plus retries

Common faucet options for Arbitrum Sepolia ETH:

- Alchemy: https://www.alchemy.com/faucets/arbitrum-sepolia
- QuickNode: https://faucet.quicknode.com/arbitrum/sepolia
- ETHGlobal: https://ethglobal.com/faucet/arbitrum-sepolia-421614

## 4. Optional: Deploy A Settlement Token

If you still need a settlement token address:

```bash
npm run deploy:token
```

The script writes `settlement-token.json` and prints the exact `SETTLEMENT_TOKEN_ADDRESS=...` value to place in `.env`.

## 5. Deploy

```bash
npm run deploy
```

Equivalent explicit command:

```bash
npx hardhat run scripts/deploy.js --network arb-sepolia
```

After a successful deploy, the script writes:

- `deployment.json`
- `public/deployment.json`

Those files are consumed by the HexaPay UI for address import and module discovery.

## 6. Local Deployment

For local testing:

```bash
npm run node
npm run deploy:local
```

On `localhost`, the deploy script automatically deploys `MockERC20` when `SETTLEMENT_TOKEN_ADDRESS` is empty.

## 7. Interact After Deploy

```bash
npm run interact
```

You can also import `deployment.json` from the HexaPay workspace UI.

## Troubleshooting

### insufficient funds

Fund the deployer wallet with more Arbitrum Sepolia ETH.

### Override SETTLEMENT_TOKEN_ADDRESS on arb-sepolia

The default deploy flow already points to Circle USDC testnet. Override the env var only if you intentionally want a different settlement token.

### invalid account or private key

Make sure `PRIVATE_KEY` is a 32-byte private key and includes the `0x` prefix.

### network mismatch in the UI

Switch the connected wallet to Arbitrum Sepolia and re-import `deployment.json` if needed.
