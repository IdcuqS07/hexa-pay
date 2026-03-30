# Wallet Setup For Arbitrum Sepolia

## Add Network To MetaMask

Use these values:

```text
Network Name: Arbitrum Sepolia
RPC URL: https://sepolia-rollup.arbitrum.io/rpc
Chain ID: 421614
Currency Symbol: ETH
Block Explorer: https://sepolia.arbiscan.io
```

## Fund Your Wallet

HexaPay deployment now expects Arbitrum Sepolia ETH for gas.

Faucet options:

- Alchemy: https://www.alchemy.com/faucets/arbitrum-sepolia
- QuickNode: https://faucet.quicknode.com/arbitrum/sepolia
- ETHGlobal: https://ethglobal.com/faucet/arbitrum-sepolia-421614

Recommended starting balance:

- `0.02-0.05 ETH`

## Create `.env`

```bash
cp .env.example .env
```

Then fill:

```env
ARB_SEPOLIA_RPC=https://sepolia-rollup.arbitrum.io/rpc
PRIVATE_KEY=0xyour_private_key_here
ARBISCAN_API_KEY=
SETTLEMENT_TOKEN_ADDRESS=0xyour_test_erc20_here
```

If you do not have a test token yet, deploy one first:

```bash
npm run deploy:token
```

## Helper Script

You can also run:

```bash
npm run setup-wallet
```

That helper can generate or import a wallet and write a ready-to-edit `.env` template for Arbitrum Sepolia.

## Verify Before Deploy

```bash
npm run check-balance
npm run compile
npm run deploy
```

## Important Notes

- Keep `PRIVATE_KEY` secret and never commit `.env`.
- `PRIVATE_KEY` should include the `0x` prefix.
- `SETTLEMENT_TOKEN_ADDRESS` is required on `arb-sepolia`.
- The UI is now configured to default to Arbitrum Sepolia and reads `deployment.json` after deploy.
