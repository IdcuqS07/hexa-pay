# HexaPay Unified Roadmap

## Vision

HexaPay should evolve into a unified confidential finance suite on Fhenix:

- private payroll
- private vendor payments
- confidential invoice and request-to-pay
- policy-based treasury approvals
- escrow and dispute resolution
- selective compliance disclosure
- privacy-preserving business analytics

The differentiator is not privacy alone. The differentiator is:

**real asset settlement + encrypted internal accounting + scoped auditability + business workflows**

Execution companion for the active private quote workstream:
- `docs/private-quotes/PRIVATE_QUOTES_NEXT_PHASE_ROADMAP.md`

Execution companion for internal developer waves:
- `docs/guides/GLOBAL_DEVELOPER_ROADMAP.md`

## Architectural direction

## One product, not one giant contract

To keep HexaPay a single product while staying realistic for Solidity and auditability, the target should be:

- one HexaPay deployment flow from the factory
- one shared company identity and signer system
- one shared vault and settlement token model
- one unified product surface for frontend and scripts
- multiple focused modules behind that surface

This matters because forcing all five new features into one ever-growing Solidity contract increases risk around:

- bytecode size limits
- audit complexity
- storage coupling
- upgrade friction
- bug blast radius

Recommended shape:

Implemented now:

1. `HexaPay`
   - wrap, unwrap, confidential balances, transfers, fee logic, compliance, registry

2. `HexaPayWorkflowModule`
   - invoices, payroll, and policy-based approvals

3. `HexaPayEscrowModule`
   - escrow deposits, milestone releases, disputes, arbiter flow

4. `HexaPayComplianceModule`
   - scoped compliance rooms, attestations, and access logs

5. `HexaPayAnalyticsModule`
   - encrypted aggregates and sealed business reporting

6. `HexaPayVault`
   - settlement token custody

7. `HexaPayFactory`
   - lightweight suite deployment via caller-supplied creation bytecode

Next modular targets:
- dispute refinements
- invoice aging bucket refinement
- richer analytics snapshot ingestion

If you want HexaPay to remain "one thing" from a user perspective, the cleanest compromise is:

- keep `HexaPay.sol` as the main user-facing entrypoint
- move feature-heavy logic into internal modules or separate contracts called by the main entrypoint
- expose one coherent interface family: `IHexaPayCore`, `IHexaPayInvoice`, `IHexaPayPolicy`, `IHexaPayEscrow`, `IHexaPayCompliance`, `IHexaPayAnalytics`

## Product pillars

These five new features should connect directly to the current architecture.

### 1. Confidential invoice and request-to-pay

Goal:
- let a business issue a bill without revealing amount publicly
- let payer review, partially pay, or reject
- keep invoice amount and line items encrypted

Best fit with current design:
- reuse `referenceHash`
- reuse company registry and signer roles
- settle using the same internal confidential balance rail

### 2. Policy-based treasury approvals

Goal:
- make signer management operational, not just administrative
- support approval thresholds and role-limited signers

Best fit with current design:
- build on `companySignerApprovals`
- gate sensitive actions like payroll execution, unwrap above threshold, invoice payment, escrow release

### 3. Escrow and dispute

Goal:
- support service delivery, milestone payments, procurement, freelance, and vendor agreements

Best fit with current design:
- use vault-backed balance model
- hold confidential commitment values while public settlement remains backed

### 4. Compliance workspace

Goal:
- move from raw grants to structured, reusable audit access
- give auditors limited, purpose-bound access

Best fit with current design:
- extend `ComplianceGrant` and `AuditAttestation`
- make grants scoped by object type, time window, and action type

### 5. Confidential analytics

Goal:
- give CFO, treasury, and auditors insight without exposing all raw transaction data

Best fit with current design:
- reuse sealed outputs
- compute encrypted totals and sealed summaries for authorized viewers

## Contract roadmap

## Phase 1: Invoice foundation

Priority:
- highest

Reason:
- it is the shortest path from private transfer rail to real business workflow

Deliverables:
- `Invoice` struct
- `InvoiceStatus` enum
- confidential line items
- due date and aging fields
- partial payment tracking
- payer acceptance or rejection
- settlement through existing confidential balances

Suggested state:

- issuer
- payer
- company
- encrypted total
- encrypted outstanding amount
- metadata hash
- due date
- status
- payment count

Suggested functions:

- `createInvoice(address payer, inEuint128 totalAmount, bytes32 metadataHash, uint64 dueAt)`
- `addInvoiceLineItems(bytes32 invoiceId, inEuint128[] calldata amounts, bytes32[] calldata labels)`
- `approveInvoice(bytes32 invoiceId)`
- `rejectInvoice(bytes32 invoiceId, bytes32 reasonHash)`
- `payInvoice(bytes32 invoiceId, inEuint128 calldata amount)`
- `cancelInvoice(bytes32 invoiceId)`
- `getInvoice(bytes32 invoiceId)`
- `getSealedInvoiceAmount(bytes32 invoiceId, bytes32 publicKey)`
- `getSealedInvoiceOutstanding(bytes32 invoiceId, bytes32 publicKey)`

Testing focus:
- issuer-only creation rules
- payer-only approval
- partial settlement accuracy
- prevention of overpayment
- correct payment-to-invoice linkage

## Phase 2: Policy and approval engine

Priority:
- very high

Reason:
- turns HexaPay into corporate treasury software instead of a private wallet

Deliverables:
- role-scoped signers
- action thresholds
- multi-approval workflow
- pending action queue
- reusable policy templates per company

Suggested concepts:

- `ActionType`: payroll, invoicePayment, unwrap, escrowRelease, signerChange
- `PolicyRule`: min approvers, max single amount, daily limit, allowed counterparties
- `PendingAction`: action hash, proposer, approvals collected, expiry

Suggested functions:

- `setPolicyRule(address company, ActionType actionType, PolicyRule calldata rule)`
- `proposeAction(bytes32 actionHash, ActionType actionType, bytes32 metadataHash)`
- `approveAction(bytes32 actionHash)`
- `revokeApproval(bytes32 actionHash)`
- `executeApprovedAction(bytes32 actionHash)`
- `getPendingAction(bytes32 actionHash)`

Testing focus:
- threshold enforcement
- unauthorized signer rejection
- approval expiry
- duplicate approval prevention
- policy updates without breaking queued actions

## Phase 3: Escrow and dispute module

Status:
- implemented in `HexaPayEscrowModule.sol`

Priority:
- high

Reason:
- biggest commercial differentiator for B2B transactions

Deliverables:
- escrow creation
- confidential escrow amount
- milestone-based release
- refund path
- dispute opening
- arbiter resolution
- timeout-based settlement fallback

Suggested state:

- buyer
- seller
- arbiter
- encrypted escrowed amount
- encrypted released amount
- milestone count
- dispute status
- expiry timestamps

Suggested functions:

- `createEscrow(address seller, address arbiter, inEuint128 totalAmount, bytes32 metadataHash)`
- `fundEscrow(bytes32 escrowId, inEuint128 calldata amount)`
- `createEscrowMilestones(bytes32 escrowId, inEuint128[] calldata milestoneAmounts, bytes32[] calldata refs)`
- `releaseEscrowMilestone(bytes32 escrowId, uint256 milestoneIndex)`
- `refundEscrow(bytes32 escrowId, inEuint128 calldata amount)`
- `openDispute(bytes32 escrowId, bytes32 reasonHash)`
- `resolveDispute(bytes32 escrowId, uint16 buyerBps, uint16 sellerBps, bytes32 rulingHash)`
- `closeExpiredEscrow(bytes32 escrowId)`

Testing focus:
- no double release
- buyer and seller permission boundaries
- arbiter-only resolution
- milestone math integrity
- refund and dispute race conditions

## Phase 4: Compliance workspace

Status:
- implemented in `HexaPayComplianceModule.sol`

Priority:
- high

Reason:
- makes privacy usable in regulated or enterprise settings

Deliverables:
- scoped disclosure room
- access by subject, company operator, or regulator-approved auditor
- object-level scopes for balances, payroll, invoices, escrow, payment history
- attestation chain and access history

Suggested concepts:

- `ComplianceScope`: balance, payroll, invoice, escrow, analytics
- `ComplianceRoom`: room id, subject, auditor, scope, validity window, policy hash
- access logs and attestation list

Suggested functions:

- `createComplianceRoom(address subject, address auditor, ComplianceScope[] calldata scopes, uint64 duration, bytes32 policyHash)`
- `extendComplianceRoom(bytes32 roomId, uint64 duration)`
- `closeComplianceRoom(bytes32 roomId)`
- `addComplianceArtifact(bytes32 roomId, bytes32 artifactHash)`
- `addAuditAttestation(bytes32 roomId, bytes32 attestationHash)`
- `canViewScope(bytes32 roomId, ComplianceScope scope)`

Testing focus:
- scope isolation
- expiry correctness
- auditor gating
- no read leakage outside permitted scope

## Phase 5: Confidential analytics

Status:
- implemented in `HexaPayAnalyticsModule.sol`

Priority:
- medium-high

Reason:
- strongest executive demo layer and sticky SaaS-style feature

Deliverables:
- sealed company spend summaries
- sealed payroll totals per cycle
- sealed invoice aging summaries
- sealed escrow exposure summaries
- optional checkpoint snapshots for cheaper reads

Suggested functions:

- `getSealedCompanySpend(address company, uint64 from, uint64 to, bytes32 publicKey)`
- `getSealedPayrollRunTotal(bytes32 scheduleId, bytes32 publicKey)`
- `getSealedInvoiceExposure(address company, bytes32 publicKey)`
- `getSealedEscrowExposure(address company, bytes32 publicKey)`
- `checkpointAnalytics(address company, bytes32 snapshotHash)`

Implementation note:
- heavy aggregation should lean on event indexing and offchain analytics preparation
- onchain logic should remain limited to trusted encrypted aggregates and sealed reads

Testing focus:
- viewer authorization
- aggregate correctness
- stale snapshot handling

## Product roadmap

## Milestone A: "Private B2B payments"

Scope:
- current wrap, transfer, unwrap
- payroll
- company registry
- signers
- basic compliance grants

Outcome:
- HexaPay is credible as a confidential payment rail

Demo story:
- company funds account
- pays employee privately
- auditor gets temporary access

## Milestone B: "Private invoicing"

Scope:
- invoice issuance
- request-to-pay
- partial settlement
- invoice references and metadata

Outcome:
- HexaPay becomes usable for AP and AR workflows

Demo story:
- vendor issues invoice
- buyer approves
- invoice gets partially paid and closed

## Milestone C: "Private treasury controls"

Scope:
- approval engine
- signer role scopes
- amount thresholds
- approval queue

Outcome:
- HexaPay becomes treasury-grade

Demo story:
- payroll run requires two approvals
- large unwrap requires finance lead approval

## Milestone D: "Private escrow commerce"

Scope:
- escrow creation
- milestones
- dispute and resolution

Outcome:
- HexaPay supports service and procurement transactions

Demo story:
- client funds escrow
- milestone released privately
- dispute can be resolved by arbiter

## Milestone E: "Auditable private finance"

Scope:
- compliance room
- scoped disclosure
- reusable attestations
- audit logs

Outcome:
- HexaPay becomes enterprise-friendly and regulator-ready

Demo story:
- auditor sees only payroll scope for limited time
- attestation is recorded onchain

## Milestone F: "Executive privacy analytics"

Scope:
- sealed analytics dashboard
- company spend views
- payroll exposure views
- invoice aging views

Outcome:
- HexaPay becomes a finance operations platform, not only a payment protocol

Demo story:
- CFO sees total payroll, liabilities, and invoice exposure without exposing raw payments

## Build order recommendation

If you want the fastest path to a compelling demo and a strong product story, the order should be:

1. invoice module
2. policy and approvals
3. compliance workspace
4. escrow and dispute
5. analytics

Why this order:

- invoice is easiest to connect to existing payment flow
- policies make the product enterprise-grade immediately
- compliance makes the privacy story believable to judges, partners, and auditors
- escrow is powerful but broader in scope
- analytics is strongest once the underlying objects already exist

## Suggested interface evolution

Short-term:
- extend `IHexaPay.sol` with invoice read and write methods
- keep new module-specific interfaces in separate files to avoid one oversized interface

Mid-term:
- split interfaces into:
  - `IHexaPayCore.sol`
  - `IHexaPayInvoice.sol`
  - `IHexaPayPolicy.sol`
  - `IHexaPayEscrow.sol`
  - `IHexaPayCompliance.sol`
  - `IHexaPayAnalytics.sol`

Long-term:
- add a facade or router interface for frontend convenience

## Security roadmap

Each phase should add its own security work, not wait until the end.

For every new module:

- add unit tests for happy path and permission failures
- add invariant thinking for balance conservation
- validate no module can mint unbacked value
- validate no disclosure path leaks unauthorized information
- validate all settlement-changing flows use reentrancy protection
- keep storage responsibilities isolated

Additional must-haves before production:

- pause or circuit breaker strategy
- emergency settlement withdrawal policy
- clearer event model for indexing
- nonce and replay protection for queued actions
- economic review of fee behavior and rounding

## Immediate next implementation slice

Best next slice:

1. add `Invoice` and `InvoiceStatus`
2. implement `createInvoice`, `approveInvoice`, `payInvoice`, `getSealedInvoiceAmount`
3. link invoice settlement into current `createPayment` flow
4. add tests for full invoice lifecycle
5. then layer `PolicyRule` on top of invoice payment and payroll execution

This gives the fastest visible jump from payment rail to confidential business finance product.
