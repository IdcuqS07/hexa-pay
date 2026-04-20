# HexaPay

HexaPay is a confidential finance product built on Fhenix. It combines private treasury operations, company identity, confidential invoice workflows, and scoped compliance or analytics modules into one product surface.

The current repository includes:

- a public product homepage
- a focused app surface for treasury, company, invoices, and masked activity
- a deeper workspace for contract-level operations and diagnostics
- a Solidity contract suite for confidential balances, invoices, escrow, compliance, and analytics

## Product Features

- Private treasury: wrap into the confidential rail, keep balances masked by default, and send encrypted internal payments.
- Company registry: register operating companies, manage signer roles, and prepare business identities before invoice activity starts.
- Confidential invoices: create, approve, pay, and inspect outstanding balances without exposing raw invoice amounts publicly.
- Privacy controls: keep local reveal intentional, align wallet and chain state, and preserve a calmer masked product view.
- Compliance workspace: support scoped audit access and structured disclosure flows through dedicated modules.
- Confidential analytics: support sealed reporting and business checkpoints for treasury and finance operations.
- Escrow and dispute readiness: the contract suite already includes escrow and dispute-oriented modules for broader financial workflows.

## Testnet Settlement Target

Default settlement target for new testnet deployments:

- Circle USDC on Arbitrum Sepolia: [`0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d`](https://sepolia.arbiscan.io/address/0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d)

HexaPay now treats this as the default settlement rail for `arb-sepolia` deploys unless you explicitly override `SETTLEMENT_TOKEN_ADDRESS`.

## Product Surfaces

- `index.html`: HexaPay home and product overview
- `app.html`: product-facing app for day-to-day private finance flows
- `hexapay.html`: deeper operations workspace and contract console
- `payment-intent.html`: focused payment rail demo surface for Arbitrum Sepolia

## Live Contract Addresses

Current deployment target: `Arbitrum Sepolia`

- Explorer base: <https://sepolia.arbiscan.io>
- Factory: [`0x32c0cB019d03DbBd102Fb6Dd5554db03F183bf98`](https://sepolia.arbiscan.io/address/0x32c0cB019d03DbBd102Fb6Dd5554db03F183bf98)
- HexaPay Core: [`0x0625D29038081FAb5e1B1a9239445a3A1d2b76AD`](https://sepolia.arbiscan.io/address/0x0625D29038081FAb5e1B1a9239445a3A1d2b76AD)
- Vault: [`0x13C030C79F8e3ae12cDA194d2b827b622B21cB83`](https://sepolia.arbiscan.io/address/0x13C030C79F8e3ae12cDA194d2b827b622B21cB83)
- Workflow Module: [`0x2250Db096628db699D2D3e10C4bdAd7d4922e27e`](https://sepolia.arbiscan.io/address/0x2250Db096628db699D2D3e10C4bdAd7d4922e27e)
- Escrow Module: [`0x1E23DCbdd5da2ADF0Bf8904214463087b61a1C0d`](https://sepolia.arbiscan.io/address/0x1E23DCbdd5da2ADF0Bf8904214463087b61a1C0d)
- Compliance Module: [`0x0472D8e66E695c77C923938D69157CF60457650E`](https://sepolia.arbiscan.io/address/0x0472D8e66E695c77C923938D69157CF60457650E)
- Analytics Module: [`0x2C53EFE001fBB50473934f175d9617C6Ab54252E`](https://sepolia.arbiscan.io/address/0x2C53EFE001fBB50473934f175d9617C6Ab54252E)
- Default Testnet Settlement Token: [`0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d`](https://sepolia.arbiscan.io/address/0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d)

Source of truth for the suite deployment above: [`deployment.json`](./deployment.json)

## Payment Rail

The currently verified live payment rail on Arbitrum Sepolia uses:

- `HexaPayUSDCExecutor`: [`0xD3cBE1F9A84E96DF340bef7b9D2B7C466Eb29d55`](https://sepolia.arbiscan.io/address/0xD3cBE1F9A84E96DF340bef7b9D2B7C466Eb29d55)
- Settlement token: [`0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d`](https://sepolia.arbiscan.io/address/0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d)

Latest live verification in this repo:

- `npm run test:payment-flow` completed successfully on Arbitrum Sepolia
- Example tx: [`0xe71dd5412c783db11fa6f45f4824db208bb374f62adb53dccd738559536044ab`](https://sepolia.arbiscan.io/tx/0xe71dd5412c783db11fa6f45f4824db208bb374f62adb53dccd738559536044ab)
- Example block: `261115751`

Important runtime notes:

- Browser UI at `app.html` or `payment-intent.html` always uses the wallet currently connected in MetaMask or Rabby.
- `TEST_PAYER_PRIVATE_KEY` is only used by the CLI runner `npm run test:payment-flow`.
- EIP-712 signing must use the `domain` returned by `POST /api/payments/challenges`.
- For wallet stability on Arbitrum Sepolia, prefer `https://sepolia-rollup.arbitrum.io/rpc`.

## Repository Layout

```text
Fhenix Buildathon/
├── docs/                   # Roadmaps, status notes, and private-quote documentation
├── contracts/              # HexaPay core, workflow, escrow, compliance, analytics, vault, factory
├── scripts/                # Deployment, wallet setup, wrap bootstrap, and interaction helpers
├── src/                    # App, workspace, client runtime, and shared styling
├── test/                   # Hardhat test suite for core and module behaviors
├── app.html                # HexaPay App entry
├── hexapay.html            # HexaPay Workspace entry
├── index.html              # Product homepage entry
├── README_CONTRACTS.md     # Contract architecture and function summary
├── ROADMAP_HEXAPAY.md      # Product and contract roadmap
└── package.json
```

## Quick Start

```bash
npm install
npm run dev
```

Local entry points:

- `http://localhost:3000/` or the Vite port you run locally for the product homepage
- `/app.html` for HexaPay App
- `/hexapay.html` for HexaPay Workspace

## Core Scripts

```bash
# Frontend
npm run dev
npm run build
npm run preview
npm run test:payment-flow
npm run verify:private-quotes
npm run demo:private-quotes:paths
npm run demo:private-quotes:challenges

# Contracts
npm run compile
npm run test

# Deployment and setup
npm run deploy
npm run deploy:token
npm run bootstrap-wrap
npm run bootstrap-unwrap
npm run setup-wallet
npm run interact
```

## Contract Suite

HexaPay is structured as a modular confidential finance suite:

- `HexaPay.sol`: confidential balance rail, async unwrap requests, private transfers, compliance base, company registry
- `HexaPayWorkflowModule.sol`: confidential invoices, payroll, and policy-based approvals
- `HexaPayEscrowModule.sol`: escrow funding, milestone release, refunds, disputes
- `HexaPayComplianceModule.sol`: scoped compliance rooms, audit artifacts, access logs
- `HexaPayAnalyticsModule.sol`: sealed reporting and checkpoint flows
- `HexaPayVault.sol`: settlement token custody
- `HexaPayFactory.sol`: suite deployment

More detail is documented in [README_CONTRACTS.md](./README_CONTRACTS.md).

Operational, guide, and roadmap-heavy docs are grouped under [docs/README.md](./docs/README.md).

## Roadmap

The active roadmap is tracked in [ROADMAP_HEXAPAY.md](./ROADMAP_HEXAPAY.md). The main direction is to keep HexaPay as one product while scaling through focused modules for workflow, escrow, compliance, and analytics.

## Environment Notes

- Copy `.env.example` into `.env` before running deployment or network-specific scripts.
- `.env.example` now defaults `SETTLEMENT_TOKEN_ADDRESS` to Circle USDC on Arbitrum Sepolia testnet.
- Mock receipt canonical storage can be switched with `MOCK_RECEIPT_REGISTRY_MODE=memory|file|http`.
- File-backed mock receipt canonical storage defaults to `.hexapay/mock-receipt-registry.json` and can be overridden with `MOCK_RECEIPT_REGISTRY_PATH`.
- HTTP-backed mock receipt canonical storage expects `MOCK_RECEIPT_REGISTRY_BASE_URL` and optionally `MOCK_RECEIPT_REGISTRY_STORE_ID` (default `registry`).
- Mock receipt challenge storage can be switched with `MOCK_RECEIPT_CHALLENGE_REGISTRY_MODE=memory|file|http`.
- File-backed mock receipt challenge storage defaults to `.hexapay/mock-receipt-challenge-registry.json` and can be overridden with `MOCK_RECEIPT_CHALLENGE_REGISTRY_PATH`.
- HTTP-backed mock receipt challenge storage expects `MOCK_RECEIPT_CHALLENGE_REGISTRY_BASE_URL` and optionally `MOCK_RECEIPT_CHALLENGE_REGISTRY_STORE_ID` (default `challenges`).
- Both mock receipt registries now share a JSON state-store seam, so file persistence can be replaced by a custom backend/cache store without changing the API contract.
- The shared JSON state-store seam now includes revision metadata and optimistic conflict handling for safer multi-writer migrations.
- The mock receipt service and Vite mock API are now async-compatible on this persistence seam, which is the last plumbing step before swapping file storage for an actual HTTP/KV/shared backend adapter.
- The shared mock receipt registries can now point at a remote HTTP state-store control plane that exposes `/api/receipts/_state/:storeId`, which keeps the frontend contract unchanged while backend persistence is swapped underneath.
- `deployment.json` is intentionally ignored from git in the current setup.
- The app currently targets Arbitrum Sepolia for the live product flow and Fhenix tooling for encrypted operations.
