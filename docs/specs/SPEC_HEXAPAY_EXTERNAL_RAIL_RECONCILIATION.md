# HexaPay External Rail Reconciliation Spec

## Objective

Bridge live USDC executor settlements into workflow invoice accounting without creating a second debit on the internal HexaPay rail.

This spec exists because:

- `HexaPayUSDCExecutor` settles by public `transferFrom(payer, merchant, amount)`
- `HexaPayWorkflowModule.payInvoice` settles by debiting the confidential internal HexaPay balance through `core.createManagedPayment(...)`
- calling `payInvoice` after an external USDC settlement can charge the payer twice

The reconciliation layer must therefore be:

- explicit
- replay-safe
- non-duplicative
- additive to the current architecture instead of pretending both rails are already the same ledger

## Current Constraints From The Codebase

### 1. Internal invoice settlement is a real money movement

Today `payInvoice` routes through `_settleInvoicePayment(...)` in `HexaPayWorkflowWriteDelegate`, and that path:

- debits internal confidential balance
- creates a HexaPay `paymentId`
- credits the merchant on the internal rail
- decreases encrypted invoice outstanding

That makes `payInvoice` the wrong tool for recording an already-completed external transfer.

### 2. External executor records only rail facts

`HexaPayUSDCExecutor` stores:

- `intentHash`
- `requestIdHash`
- `token`
- `payer`
- `merchant`
- `amount`
- `executedAt`

This is enough to prove that a live rail payment happened, but not enough by itself to prove which workflow invoice it should reconcile.

### 3. Invoice binding currently lives in the payment app layer

For invoice-linked payment links, the UI currently places the invoice reference in:

- the shareable payload `invoiceId`
- the signed payment intent `receiptId`

The backend payment ledger persists `receiptId`, but the executor contract does not currently persist `invoiceId` or `receiptId`.

That means the first reconciliation version cannot pretend invoice binding is fully trustless onchain yet.

### 4. Payer identity may be a subject, not the signing wallet

Workflow invoices may use a registered company as `invoice.payer`, while the external payment may be signed by a company operator wallet.

A safe reconciliation path must therefore accept:

- `payer == invoice.payer`
- or `core.isCompanyOperator(invoice.payer, payerWallet) == true`

### 5. Public `Paid` finalization is not solved cleanly today

The current workflow settlement helper sets `invoice.status = PartiallyPaid` and does not finalize `Paid` in-contract today.

Because invoice outstanding is encrypted, exact zero-outstanding finalization is not something this spec should fake or hand-wave away. The reconciliation layer should focus first on:

- verified receipt linkage
- safe outstanding reduction without internal debit
- explicit metadata for external settlement history

## Design Principles

- Never call `payInvoice` to mirror an external rail transfer.
- Keep external rail settlement and internal HexaPay balance settlement as separate sources of truth.
- Make reconciliation a workflow action, not an implicit side effect.
- Record enough metadata to audit and replay-check every applied settlement.
- Prefer additive contract surfaces over breaking existing invoice reads.
- Do not hide exception cases such as wrong merchant, ambiguous invoice mapping, or mismatched payer identity.

## Proposed Architecture

The reconciliation path should be implemented in two phases.

### Phase 1: Verified External Receipt -> Explicit Reconcile / Apply

This is the recommended first implementation.

Flow:

1. A payment intent settles on the live USDC rail.
2. The payment ledger records the settled request with `intentHash`, `requestIdHash`, `txHash`, `receiptId`, `payer`, `merchant`, `token`, and `amount`.
3. A reconciliation worker detects invoice-linked settled records.
4. The worker submits a verified external receipt marker onchain.
5. A company operator explicitly applies that receipt to workflow accounting.

Why this is the safest first step:

- it prevents automatic double-charge
- it avoids pretending the current executor already carries a first-class invoice reference
- it gives the merchant a review point before encrypted outstanding is mutated
- it works even while workflow status semantics are still imperfect for exact `Paid` finalization

### Phase 2: Auto-Reconcile After Binding Hardening

Only after Phase 1 is stable should HexaPay consider auto-apply.

Auto-reconcile should require at least one of:

- explicit `invoiceId` added to the signed payment intent schema and persisted end-to-end
- executor v2 storing `invoiceId` or `invoiceIdHash` onchain
- or another equivalent onchain-verifiable invoice binding

Until that exists, auto-apply should remain off by default.

## Canonical Invoice Binding Rule

For the current architecture, invoice-linked external payments must follow one strict rule:

- `receiptId` in the signed payment intent must equal the canonical hex string form of the workflow `invoiceId`

Phase 1 reconciliation worker behavior:

- reject invoice-linked settled records with empty `receiptId`
- reject records whose `receiptId` is not a canonical `bytes32` hex string
- treat `receiptId` as the authoritative invoice reference for reconciliation

Hardening note:

- the shareable payload may continue carrying `invoiceId` for UX
- but the signed and persisted binding the worker should trust today is `receiptId`
- once schema migration is acceptable, add a first-class `invoiceId` field to the typed intent and backend ledger
- `deployment.json` remains the practical source of truth for workflow address discovery in Phase 1
- direct `workflow.getInvoice(...)` reads are access-controlled and should be treated as optional verifier enrichment, not a mandatory truth source for every backend reconciliation pass

Environment note:

- default backend mode should be best-effort invoice context:
  `HEXAPAY_REQUIRE_INVOICE_CONTEXT` unset or `0`
- strict backend mode should require invoice context resolution before reconciliation is accepted:
  `HEXAPAY_REQUIRE_INVOICE_CONTEXT=1`
- strict mode is appropriate only when the backend signer is guaranteed workflow invoice read access
- default mode is safer for dev or mixed-access environments where `NoInvoiceAccess` is an expected read outcome

## Contract Design

### A. New Bridge Contract

Add a dedicated bridge contract, for example:

- `HexaPayExternalSettlementBridge`

Responsibilities:

- verify that a live executor payment exists
- build a stable reconciliation id
- enforce replay protection
- submit verified receipt metadata into the workflow module

Phase 1 trust model:

- bridge submission should be restricted to an explicit reconciler role or owner-managed service account
- the bridge should read executor payment data onchain before recording a receipt
- the bridge should not be permissionless in Phase 1, because the current executor does not yet carry a first-class invoice reference onchain

Recommended immutable/configured dependencies:

- `workflow`
- `executor`
- `core`
- `settlementToken`

Recommended replay id:

```solidity
bytes32 settlementId = keccak256(
    abi.encode(
        block.chainid,
        address(executor),
        intentHash,
        requestIdHash
    )
);
```

Bridge storage:

- `settlementRecorded[settlementId]`
- optional `settlementTxHash[settlementId]`
- optional `settlementInvoiceId[settlementId]`

Minimum onchain verification before receipt recording:

- `executor.paymentRecords(intentHash)` exists
- stored `requestIdHash` matches
- stored `payer` matches
- stored `merchant` matches
- stored `token` matches
- stored `amount` matches

Recommended event:

```solidity
event ExternalSettlementReceiptRecorded(
    bytes32 indexed settlementId,
    bytes32 indexed invoiceId,
    bytes32 indexed intentHash,
    bytes32 requestIdHash,
    bytes32 txHash,
    address payer,
    address merchant,
    address token,
    uint256 amount,
    address recorder
);
```

### B. Workflow Module Additions

Add a dedicated receipt/apply surface instead of reusing `payInvoice`.

Recommended data model:

```solidity
struct ExternalSettlementReceipt {
    bytes32 settlementId;
    bytes32 invoiceId;
    bytes32 intentHash;
    bytes32 requestIdHash;
    bytes32 txHash;
    address payerWallet;
    address merchant;
    address token;
    uint128 observedAmount;
    uint64 recordedAt;
    uint64 appliedAt;
    bool applied;
    bool exists;
}
```

Recommended storage:

- `mapping(bytes32 => ExternalSettlementReceipt) externalSettlementReceipts`
- `mapping(bytes32 => bytes32[]) invoiceExternalSettlementIds`

Recommended events:

```solidity
event InvoiceExternalSettlementReceiptRecorded(
    bytes32 indexed invoiceId,
    bytes32 indexed settlementId,
    bytes32 indexed intentHash,
    bytes32 requestIdHash,
    bytes32 txHash,
    address payerWallet,
    uint256 observedAmount
);

event InvoiceExternalSettlementApplied(
    bytes32 indexed invoiceId,
    bytes32 indexed settlementId,
    uint256 appliedAmount,
    address indexed operator
);
```

Recommended functions:

```solidity
function setExternalSettlementBridge(address bridge) external;

function recordExternalSettlementReceipt(
    bytes32 invoiceId,
    bytes32 settlementId,
    bytes32 intentHash,
    bytes32 requestIdHash,
    bytes32 txHash,
    address payerWallet,
    address merchant,
    address token,
    uint128 observedAmount
) external;

function applyExternalSettlementReceipt(
    bytes32 settlementId,
    uint128 clearAmount
) external returns (bytes32 invoiceId);

function getInvoiceExternalSettlementIds(bytes32 invoiceId)
    external
    view
    returns (bytes32[] memory);

function getExternalSettlementReceipt(bytes32 settlementId)
    external
    view
    returns (...);
```

### Why Receipt Recording And Apply Should Be Separate

The split is intentional.

`recordExternalSettlementReceipt(...)` should:

- confirm bridge caller
- confirm invoice exists
- confirm token matches `core.settlementToken()`
- confirm merchant matches `invoice.company`
- confirm payer wallet is the invoice payer or an approved operator for the payer subject
- store immutable receipt metadata
- not touch confidential balances
- not touch invoice outstanding

`applyExternalSettlementReceipt(...)` should:

- require company operator access on the invoice company
- require receipt exists and is not already applied
- convert `clearAmount` into `euint128`
- reduce encrypted invoice outstanding
- decrease invoice exposure in analytics
- mark the receipt as applied
- never call `core.createManagedPayment(...)`

This separation gives the merchant a human-controlled review point before workflow accounting changes.

## Workflow Apply Semantics

When applying an external settlement receipt:

- the workflow module must mutate invoice accounting only
- it must never mint a core `paymentId`
- it must never debit internal HexaPay balance
- it must treat the settlement as an external source, not a core payment

Recommended rules:

- allow apply only when invoice status is `Approved` or `PartiallyPaid`
- merchant must equal `invoice.company`
- token must equal `core.settlementToken()`
- payer wallet must be `invoice.payer` or an operator of `invoice.payer`
- one `settlementId` can be applied only once
- operator may choose a partial `clearAmount`, but workflow must clamp apply to `min(clearAmount, observedAmount, current outstanding)`
- any overpayment beyond current outstanding must not mint internal credit, must not roll into prepaid balance automatically, and must stay visible as a manual review / refund case outside Phase 1 auto-apply semantics

Recommended metadata behavior:

- keep existing `invoicePayments` untouched for internal payment ids only
- store external settlement ids separately
- keep current `getInvoicePayments(...)` semantics stable

## Status Semantics

The first reconciliation version should not overpromise public status semantics.

Recommended behavior:

- keep external receipt linkage and apply state explicit through dedicated receipt events and getters
- continue using revealed outstanding in the product UI to determine whether the invoice is effectively cleared
- do not block Phase 1 on solving exact public `InvoiceStatus.Paid` finalization

If HexaPay later wants a fully reliable public `Paid` status for encrypted invoices, that should be handled as a separate design task, for example through:

- a shared internal helper for status finalization
- and, if required, a zero-outstanding finalizer or another explicit mechanism compatible with encrypted state

## Backend Reconciliation Worker

Phase 1 needs a dedicated backend reconciliation worker or service module.

Recommended worker inputs:

- payment ledger settled records
- executor address / chain config
- workflow address
- bridge address

Recommended worker lifecycle:

1. `observed`
2. `eligible`
3. `submitted`
4. `recorded`
5. `applied`
6. `exception`

Recommended eligibility checks:

- ledger record status is `settled`
- `intentHash`, `requestIdHash`, and `txHash` exist
- `receiptId` is present and canonical
- merchant address is present
- payer address is present
- token address is present

Recommended exception reasons:

- `invalid_receipt_reference`
- `duplicate_settlement`
- `executor_record_missing`
- `merchant_mismatch`
- `payer_mismatch`
- `token_mismatch`
- `invoice_not_payable`
- `apply_requires_review`

Phase 1 policy:

- worker may auto-record a verified external receipt
- worker should not auto-apply it by default
- worker should treat overpayment beyond current invoice outstanding as operator-review territory, not something to auto-credit into HexaPay
- if `observedAmount > appliedAmount`, the delta should be considered an external settlement remainder that needs explicit merchant handling off the happy path

## Replay And Safety Rules

- A single executor settlement must map to one `settlementId`.
- A `settlementId` may be recorded once and applied once.
- Receipt recording and receipt apply must be separate state transitions.
- Bridge and workflow must each keep their own replay guard.
- External settlement metadata must remain queryable after apply.
- Internal HexaPay payment ids and external settlement ids must never share the same namespace or pretend to be interchangeable.

## Implementation Sequence

Recommended order:

1. Canonicalize invoice-linked intent binding:
   `receiptId` must equal `invoiceId` for invoice payment links.
2. Add backend reconciliation storage and worker lifecycle.
3. Add `HexaPayExternalSettlementBridge`.
4. Add workflow receipt recording functions and getters.
5. Add workflow receipt apply function that mutates outstanding without internal debit.
6. Update UI to show:
   `External receipt recorded`
   `Awaiting reconcile apply`
   `External receipt applied`
7. Only after that, evaluate whether auto-apply should exist for low-risk cases.

## Test Matrix

High-priority scenarios:

1. records an external settlement receipt only once for a given `settlementId`
2. rejects receipt recording when executor record is missing
3. rejects receipt recording when merchant does not match invoice company
4. rejects receipt recording when token does not match core settlement token
5. rejects receipt recording when payer wallet is neither the invoice payer nor a valid operator
6. lets a company operator apply a recorded receipt exactly once
7. proves `applyExternalSettlementReceipt` does not call `core.createManagedPayment`
8. proves internal HexaPay balances do not change during external receipt apply
9. keeps `getInvoicePayments(...)` unchanged for internal rail payments
10. keeps external settlement ids queryable through dedicated getters
11. shows a recorded-but-not-applied receipt in the UI
12. flags ambiguous or malformed `receiptId` values as reconciliation exceptions

## Non-Goals For This Pass

- merging external USDC transfers into the internal confidential balance rail
- redesigning the wallet stack
- redesigning the full invoice status model
- automatic refund or credit memo handling
- permissionless reconciliation before invoice binding is hardened end-to-end

## Summary

The safe first bridge is not:

- `external payment succeeds -> auto-call payInvoice`

The safe first bridge is:

- `external payment succeeds`
- `verified external receipt is recorded onchain`
- `merchant explicitly applies that receipt into workflow accounting`

That closes the double-charge risk without pretending the current rails are already one ledger.
