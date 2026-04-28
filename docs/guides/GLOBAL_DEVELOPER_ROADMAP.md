# Global Developer Roadmap

Internal note:
- This document is for local developer planning only.
- This is not a public product promise, release commitment, or external roadmap.
- Scope and ordering can change as implementation reality changes.

## Purpose

This roadmap turns HexaPay from a working private-finance prototype into a real payment product with:

- live USDC settlement
- persistent payment ledger
- product-grade merchant and payer flows
- real-world merchant entry points such as NFC, QR, and POS
- protocol and ecosystem primitives for external integration

## Roadmap Rules

- Wave 2 is the current execution priority because it makes HexaPay a real payment system.
- Each wave should land with testable backend, frontend, and documentation outcomes.
- Public-facing UI should only expose stable flows; dev-only controls should shrink over time.
- Payment rail correctness and idempotency are more important than shipping additional surfaces fast.

## Wave Dependencies

1. Wave 2 unlocks real settlement, lifecycle tracking, and payment history.
2. Wave 3 turns those primitives into a product experience.
3. Wave 4 adds merchant-grade entry hardware and POS flows.
4. Wave 5 turns the system into a reusable platform and protocol surface.

## Milestone: Wave 2 — Payment Core & Settlement

### Goal

Make HexaPay a real payment system with USDC settlement and ledger support.

### Issue Breakdown

#### Core Payment

1. Payment Intent Standardization

Title:
- `feat(payment): finalize EIP-712 payment intent schema`

Tasks:
- define schema for `token`, `decimals`, and `expiry`
- update frontend intent builder
- update backend validator

2. Signature Verification Hardening

Title:
- `feat(security): enforce strict EIP-712 signature verification`

Tasks:
- verify `chainId`
- verify `contract address`
- verify `expiry`
- reject malformed payloads

#### USDC Settlement

3. ERC20 Settlement Integration

Title:
- `feat(settlement): integrate USDC transferFrom execution`

Tasks:
- integrate `SafeERC20`
- update executor contract ABI
- update backend executor

4. Approval Flow (Frontend)

Title:
- `feat(ui): implement USDC approval flow before execution`

Tasks:
- check allowance
- trigger approve if needed
- add UX loading state

#### Lifecycle

5. Payment Lifecycle Engine

Title:
- `feat(payment): implement payment lifecycle state machine`

Tasks:
- define states: `challenge -> signed -> executing -> settled`
- add backend state tracking
- bind lifecycle state into UI

#### Ledger

6. Payment Ledger Storage

Title:
- `feat(ledger): implement persistent payment record storage`

Store at minimum:
- `intentHash`
- `requestId`
- `txHash`
- `status`

Plan:
- start with in-memory storage
- extend later to persistent backing store

7. Payment History API

Title:
- `feat(api): add payment history endpoint`

Tasks:
- add `/api/payments/list`
- filter by wallet
- filter by merchant

#### Security

8. Idempotency + Replay Protection

Title:
- `feat(security): enforce idempotent execution using requestId`

Tasks:
- prevent duplicate execution
- track request hashes

### Definition of Done

- user can send USDC
- payment appears in history
- no duplicate execution is possible
- full lifecycle is visible end-to-end

## Milestone: Wave 3 — Product UX & Merchant Flow

### Goal

Make HexaPay feel like a real product.

### Issue Breakdown

#### UX Core

1. Dashboard Rework

Title:
- `feat(ui): convert dashboard to action-based layout`

Tasks:
- replace menu-heavy layout
- add clear actions for:
- `Send Payment`
- `Create Invoice`
- `Activity`

2. Payment History UI

Title:
- `feat(ui): implement payment activity panel`

Show:
- amount
- status
- tx hash
- clickable explorer link

#### Invoice Flow

3. Invoice -> Payment Integration

Title:
- `feat(invoice): link invoice to payment intent execution`

Tasks:
- generate intent from invoice
- mark invoice paid on success

Current architecture note:
- the live USDC executor settles with direct `transferFrom`
- `HexaPayWorkflowModule.payInvoice` spends the confidential internal HexaPay balance rail
- do not auto-call `payInvoice` after external rail settlement until a dedicated bridge or reconciliation path exists, otherwise the payer can be charged twice
- Wave 3 UI may link external settlement receipts to invoices, but contract-level invoice settlement needs a separate design task

Implementation order for the bridge path:
- use `receiptId = invoiceId` as the canonical invoice binding for invoice-linked payment intents
- add a reconciliation worker that detects settled invoice-linked rail payments from the payment ledger
- record a verified external settlement receipt onchain first
- require an explicit workflow apply step that updates invoice accounting without calling `payInvoice`
- treat any external overpayment above current invoice outstanding as manual review or refund territory; do not auto-credit it into internal HexaPay balance
- only evaluate auto-apply after invoice binding is hardened end-to-end

Design reference:
- `docs/specs/SPEC_HEXAPAY_EXTERNAL_RAIL_RECONCILIATION.md`

4. Payment Link

Title:
- `feat(payment): generate shareable payment link`

Tasks:
- support `/pay?intent=...`
- make the route mobile-friendly

#### Wallet UX

5. Wallet Auto Flow

Title:
- `feat(wallet): improve wallet connect and chain handling`

Tasks:
- auto connect
- auto switch chain
- session persist

Execution note:
- land wallet continuity as a short Wave 3B UX closure pass
- do not expand this into a wallet-system redesign before the external rail reconciliation layer is defined
- after the UX pass, move directly into the bridge / reconciliation design needed to close invoice settlement correctness

#### UI Polish

6. Remove Dev Artifacts

Title:
- `refactor(ui): remove store mode and dev-only controls`

Tasks:
- remove Local / Mock UI controls
- keep backend-supported product flows only

### Definition of Done

- user can send payment
- user can receive payment via invoice
- user can track payment history
- UI feels production-like

## Milestone: Wave 4 — Real-World Payments (NFC & POS)

### Goal

Enable real merchant usage.

### Issue Breakdown

#### NFC

1. NFC -> Intent Binding

Title:
- `feat(nfc): bind NFC tap to payment intent trigger`

Tasks:
- load intent from tap
- trigger UI flow from tap entry

#### POS Mode

2. Merchant POS Interface

Title:
- `feat(pos): build merchant payment interface (tablet mode)`

Tasks:
- amount input
- customer flow
- simplified merchant-first UI

#### Payment Entry

3. QR Payment Flow

Title:
- `feat(payment): implement QR-based payment entry`

Tasks:
- generate QR
- scan -> open intent

#### Device Layer

4. Device Identity Enforcement

Title:
- `feat(security): enforce terminalId and device binding`

Tasks:
- bind session to terminal context
- validate device identity

### Definition of Done

- merchant can accept payment
- user can pay via NFC
- user can pay via QR
- POS mode is usable in merchant flow

## Milestone: Wave 5 — Protocol & Ecosystem

### Goal

Turn HexaPay into a platform and protocol.

### Issue Breakdown

#### SDK

1. JS SDK

Title:
- `feat(sdk): create HexaPay JS SDK`

Core methods:
- `createIntent`
- `signIntent`
- `executePayment`

#### API

2. Public API

Title:
- `feat(api): expose public payment endpoints`

Endpoints:
- intent create
- execute
- verify

#### Standard

3. Payment Intent Spec

Title:
- `docs(protocol): define HexaPay payment intent specification`

Scope:
- schema
- versioning
- examples

#### Ecosystem

4. Merchant Integration Flow

Title:
- `feat(integration): merchant onboarding and integration guide`

#### Optional Credit Layer

5. Credit Layer

Title:
- `feat(credit): implement USDC collateral credit system`

### Definition of Done

- external developers can integrate HexaPay
- SDK is usable
- protocol is documented

## Cross-Wave Implementation Notes

- Keep backend validation and frontend intent building in lockstep.
- Treat payment lifecycle state as a first-class product primitive, not only a backend detail.
- Ledger and history should be designed once with persistence expansion in mind.
- Merchant-facing UX should not depend on dev-only mock controls once Wave 3 begins.
- Device identity, terminal binding, and QR/NFC entry should reuse the same intent model introduced in Wave 2.
- External USDC rail settlement and confidential workflow settlement are different ledgers today; any future bridge between them must be explicit, replay-safe, and non-duplicative.

## Recommended Folder Alignment

```text
app/
contracts/
backend/
  payment/
  ledger/
  validation/
frontend/
  widgets/
  wallet/
  payment/
```

## Suggested Immediate Next Steps

1. Freeze the final Wave 2 EIP-712 intent schema and make it the shared contract between frontend and backend.
2. Add payment ledger storage plus `/api/payments/list` before broadening more UI.
3. Land lifecycle visibility in the UI so Wave 3 builds on stable primitives instead of hidden backend state.
