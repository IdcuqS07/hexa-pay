# HexaPay Testnet Funding Guide

HexaPay currently targets `Arbitrum Sepolia` only.

## ETH For Gas

You need Arbitrum Sepolia ETH before you can deploy, wrap, or complete unwrap requests.

Faucet options already referenced elsewhere in this repo:

- Alchemy: <https://www.alchemy.com/faucets/arbitrum-sepolia>
- QuickNode: <https://faucet.quicknode.com/arbitrum/sepolia>
- ETHGlobal: <https://ethglobal.com/faucet/arbitrum-sepolia-421614>

Recommended starting gas balance:

- `0.02-0.05 ETH`

## Circle USDC Testnet

Default settlement token for HexaPay testnet deploys:

- Circle USDC on Arbitrum Sepolia: `0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d`

HexaPay now uses this address by default for `arb-sepolia` deploys unless you override `SETTLEMENT_TOKEN_ADDRESS`.

## Useful Commands

```bash
npm run check-balance
npm run deploy
npm run bootstrap-wrap
npm run bootstrap-unwrap
```

## Local Alternative

If you only need local contract testing, `npm run deploy:local` will use a mock 6-decimal USDC-style token instead of Circle testnet USDC.
