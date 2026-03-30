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

## Product Surfaces

- `index.html`: HexaPay home and product overview
- `app.html`: product-facing app for day-to-day private finance flows
- `hexapay.html`: deeper operations workspace and contract console

## Repository Layout

```text
Fhenix Buildathon/
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

# Contracts
npm run compile
npm run test

# Deployment and setup
npm run deploy
npm run deploy:token
npm run bootstrap-wrap
npm run setup-wallet
npm run interact
```

## Contract Suite

HexaPay is structured as a modular confidential finance suite:

- `HexaPay.sol`: confidential balance rail, wrap and unwrap, private transfers, compliance base, company registry
- `HexaPayWorkflowModule.sol`: confidential invoices, payroll, and policy-based approvals
- `HexaPayEscrowModule.sol`: escrow funding, milestone release, refunds, disputes
- `HexaPayComplianceModule.sol`: scoped compliance rooms, audit artifacts, access logs
- `HexaPayAnalyticsModule.sol`: sealed reporting and checkpoint flows
- `HexaPayVault.sol`: settlement token custody
- `HexaPayFactory.sol`: suite deployment

More detail is documented in [README_CONTRACTS.md](./README_CONTRACTS.md).

## Roadmap

The active roadmap is tracked in [ROADMAP_HEXAPAY.md](./ROADMAP_HEXAPAY.md). The main direction is to keep HexaPay as one product while scaling through focused modules for workflow, escrow, compliance, and analytics.

## Environment Notes

- Copy `.env.example` into `.env` before running deployment or network-specific scripts.
- `deployment.json` is intentionally ignored from git in the current setup.
- The app currently targets Arbitrum Sepolia for the live product flow and Fhenix tooling for encrypted operations.
