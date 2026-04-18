# HexaPay Smart Contracts

HexaPay is now structured as an asset-backed confidential payment rail for Fhenix instead of a demo-only encrypted ledger.

## Architecture

### Core contracts

1. `HexaPay.sol`
   - Confidential balances with `euint128`
   - Private peer-to-peer payments
   - Compliance grants and auditor attestations
   - Company registry and signer management
   - Deploys and links the suite's workflow and escrow modules

2. `HexaPayWorkflowModule.sol`
   - Payroll schedules with encrypted line items
   - Confidential invoice and request-to-pay lifecycle
   - Policy-based treasury approvals and signer scopes

3. `HexaPayEscrowModule.sol`
   - Confidential escrow creation and funding
   - Milestone-based release, seller refund, and arbiter dispute resolution
   - Timeout-based close and selective escrow disclosure

4. `HexaPayComplianceModule.sol`
   - Scoped compliance rooms for balances, payments, invoices, payroll, escrow, and analytics
   - Room artifacts, room attestations, and access logs
   - Fine-grained auditor visibility integrated with the suite read-paths

5. `HexaPayAnalyticsModule.sol`
   - Sealed spend summaries over time windows
   - Latest payroll run totals, invoice exposure, and escrow exposure
   - Analytics checkpoints for offchain snapshot coordination

6. `HexaPayVault.sol`
   - Isolated custody layer for the settlement token
   - Pulls approved ERC20 funds in during wrap
   - Pushes ERC20 funds out during async unwrap completion

7. `HexaPayFactory.sol`
   - Deploys isolated HexaPay suites from caller-supplied creation bytecode
   - Keeps factory runtime small instead of embedding suite bytecode directly
   - Tracks per-user deployments and linked workflow, escrow, compliance, and analytics modules

8. `MockERC20.sol`
   - Lightweight local settlement token for localhost development

9. `IHexaPay.sol`
   - Integration interface for the HexaPay core rail

10. `IHexaPayWorkflow.sol`
   - Integration interface for invoice, policy, and payroll flows

11. `IHexaPayEscrow.sol`
   - Integration interface for escrow and dispute flows

12. `IHexaPayCompliance.sol`
   - Integration interface for compliance rooms and scoped audit workspaces

13. `IHexaPayAnalytics.sol`
   - Integration interface for sealed analytics and checkpoints

## Real Fhenix flow

HexaPay follows a realistic wrap-transfer-unwrap pattern:

1. User approves the settlement token to the HexaPay vault.
2. User calls `wrap(uint128 amount)`.
3. Contract pulls real ERC20 funds into `HexaPayVault`.
4. User receives an encrypted internal balance in `HexaPay`.
5. Private transfers happen in `HexaPay`, while invoice/payroll and escrow workflows route through dedicated suite modules.
6. User calls `unwrap(inEuint128 encryptedAmount)` to request a public ERC20 exit.
7. User calls `completeUnwrap(bytes32 withdrawalId)` after the async decrypt result becomes ready.

This keeps asset backing real while preserving balance and payment privacy inside the payment rail.

## Features

### Confidential payments
- Encrypted balances stored as `euint128`
- Encrypted payment amounts and platform fees
- Sealed output getters for user-side decryption
- No plaintext payment amounts in events

### Asset backing
- Every wrapped balance is backed by a real ERC20 settlement token
- Public token custody is separated into `HexaPayVault`
- `getBackingBalance()` exposes current vault backing

### Compliance and privacy
- Owner-managed auditor allowlist
- User or company-granted compliance access windows
- Auditor attestations linked by hash
- Sealed read access for balances, payroll entries, and payment values
- Scoped compliance rooms per subject and auditor
- Object-level scope control across balance, payment, invoice, payroll, escrow, and analytics
- Room artifacts, attestations, and access logs for structured audit workflows

### Confidential analytics
- Sealed spend summaries over configurable time windows
- Latest payroll run total per schedule
- Current invoice exposure per company
- Current escrow exposure per company
- Analytics checkpoints for offchain finance reporting pipelines

### Payroll
- Company payroll schedules with encrypted gross amounts
- Authorized company signers can execute payroll
- Payroll execution reuses the same confidential payment engine

### Invoicing
- Company operators can issue confidential invoices to payers
- Payers or payer-company operators can approve, reject, partially pay, or fully settle invoices
- Encrypted invoice totals, outstanding balances, and line items
- Invoice payments reuse the same balance-backed confidential rail

### Policy controls
- Company owners can define approval rules per sensitive action
- Signers can be scoped per action type instead of having blanket power
- Pending action queue supports multi-approval before execution
- Policy v1 currently protects invoice payment, payroll execution, and invoice cancellation

### Escrow and dispute
- Buyers can create and fund confidential escrows backed by real wrapped balances
- Milestones can be defined privately and released without exposing amount publicly
- Sellers can voluntarily refund from escrow without unwrapping
- Buyer or seller can open disputes, then arbiter resolves split on remaining escrow
- Expired escrows can be closed back to the buyer with confidential settlement

### Registry
- Unique `companyId`
- Optional unique ENS-style company identifier
- Company signer add/remove flows
- Owner verification flag for company profiles

## Key functions

### User operations
- `wrap(uint128 amount)`
- `unwrap(inEuint128 encryptedAmount)`
- `completeUnwrap(bytes32 withdrawalId)`
- `getWithdrawal(bytes32 withdrawalId)`
- `createPayment(address recipient, inEuint128 encryptedAmount, bytes32 referenceHash)`
- `workflowModule()`
- `escrowModule()`
- `complianceModule()`
- `analyticsModule()`
- `getBalance(Permission permission)`
- `getSealedBalance(bytes32 publicKey)`
- `getSealedPaymentAmount(bytes32 paymentId, bytes32 publicKey)`
- `getSealedPaymentFee(bytes32 paymentId, bytes32 publicKey)`

### Workflow module
- `createInvoice(address company, address payer, inEuint128 encryptedTotalAmount, bytes32 metadataHash, uint64 dueAt)`
- `addInvoiceLineItems(bytes32 invoiceId, inEuint128[] encryptedAmounts, bytes32[] labelHashes)`
- `approveInvoice(bytes32 invoiceId)`
- `payInvoice(bytes32 invoiceId, inEuint128 encryptedAmount)`
- `getSealedInvoiceAmount(bytes32 invoiceId, bytes32 publicKey)`
- `getSealedInvoiceOutstanding(bytes32 invoiceId, bytes32 publicKey)`

### Policy
- `setPolicyRule(address company, PolicyActionType actionType, uint8 minApprovals, uint64 approvalTtl, bool active)`
- `setSignerActionPermission(address signer, PolicyActionType actionType, bool approved)`
- `proposeInvoicePayment(bytes32 invoiceId, inEuint128 encryptedAmount, bytes32 metadataHash)`
- `proposePayrollExecution(bytes32 scheduleId, bytes32 metadataHash)`
- `proposeInvoiceCancellation(bytes32 invoiceId, bytes32 metadataHash)`
- `approvePendingAction(bytes32 actionId)`
- `executePendingAction(bytes32 actionId)`

### Escrow
- `createEscrow(address seller, address arbiter, inEuint128 encryptedTotalAmount, bytes32 metadataHash, uint64 expiresAt)`
- `fundEscrow(bytes32 escrowId, inEuint128 encryptedAmount)`
- `createEscrowMilestones(bytes32 escrowId, inEuint128[] encryptedMilestoneAmounts, bytes32[] referenceHashes)`
- `releaseEscrow(bytes32 escrowId, inEuint128 encryptedAmount)`
- `releaseEscrowMilestone(bytes32 escrowId, uint256 milestoneIndex)`
- `refundEscrow(bytes32 escrowId, inEuint128 encryptedAmount)`
- `openDispute(bytes32 escrowId, bytes32 reasonHash)`
- `resolveDispute(bytes32 escrowId, uint16 buyerBps, uint16 sellerBps, bytes32 rulingHash)`
- `closeExpiredEscrow(bytes32 escrowId)`
- `getSealedEscrowRemaining(bytes32 escrowId, bytes32 publicKey)`

### Compliance
- `grantComplianceAccess(address subject, address auditor, uint64 duration, bytes32 policyHash)`
- `revokeComplianceAccess(address subject, address auditor)`
- `authorizeAuditor(address auditor)`
- `revokeAuditor(address auditor)`
- `addAuditAttestation(address subject, bytes32 attestationHash)`

### Compliance workspace
- `createComplianceRoom(address subject, address auditor, ComplianceScope[] scopes, uint64 duration, bytes32 policyHash)`
- `extendComplianceRoom(bytes32 roomId, uint64 duration)`
- `closeComplianceRoom(bytes32 roomId)`
- `addComplianceArtifact(bytes32 roomId, bytes32 artifactHash)`
- `addAuditAttestation(bytes32 roomId, bytes32 attestationHash)`
- `recordComplianceAccess(bytes32 roomId, ComplianceScope scope, bytes32 accessHash)`
- `canViewScope(bytes32 roomId, ComplianceScope scope)`
- `hasScopedAccess(address subject, address auditor, ComplianceScope scope)`

### Analytics
- `getSealedCompanySpend(address company, uint64 from, uint64 to, bytes32 publicKey)`
- `getSealedPayrollRunTotal(bytes32 scheduleId, bytes32 publicKey)`
- `getSealedInvoiceExposure(address company, bytes32 publicKey)`
- `getSealedEscrowExposure(address company, bytes32 publicKey)`
- `checkpointAnalytics(address company, bytes32 snapshotHash)`
- `getCompanyCheckpoints(address company)`

### Payroll
- `createPayrollSchedule(address company, address[] employees, inEuint128[] encryptedGrossAmounts, uint64 frequency, uint64 firstPaymentAt, bytes32 metadataHash)`
- `updatePayrollSchedule(...)`
- `executePayroll(bytes32 scheduleId)`
- `cancelPayrollSchedule(bytes32 scheduleId)`
- `getSealedPayrollAmount(bytes32 scheduleId, uint256 index, bytes32 publicKey)`

### Registry
- `registerCompany(string companyName, string ensName, bytes32 companyId)`
- `verifyCompany(address company)`
- `addSigner(address signer)`
- `removeSigner(address signer)`
- `getCompany(address company)`

## Deployment

### Local deployment

```bash
npm install
npm run deploy:local
```

If no settlement token is provided on localhost, the deployment script will deploy `MockERC20` automatically.

### Testnet deployment

Set a settlement token in `.env`:

```env
PRIVATE_KEY=...
ARB_SEPOLIA_RPC=https://sepolia-rollup.arbitrum.io/rpc
SETTLEMENT_TOKEN_ADDRESS=0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d
```

Then deploy:

```bash
npm run deploy
```

## Example flow

These examples assume `client` is an `@cofhe/sdk` client that is already connected, and that `Encryptable` and `FheTypes` are imported from `@cofhe/sdk`.

### Wrap public tokens

```javascript
await settlementToken.approve(hexapayAddress, amount);
await hexaPay.wrap(amount);
```

### Create a confidential payment

```javascript
const [encryptedAmount] = await client
  .encryptInputs([Encryptable.uint128(500n)])
  .execute();

await hexaPay.createPayment(
  recipientAddress,
  encryptedAmount,
  ethers.keccak256(ethers.toUtf8Bytes("invoice-001"))
);
```

### Create and approve a confidential invoice

```javascript
const [encryptedInvoiceTotal] = await client
  .encryptInputs([Encryptable.uint128(5000n)])
  .execute();
const HexaPayWorkflowModule = await ethers.getContractFactory("HexaPayWorkflowModule");
const workflowAddress = await hexaPay.workflowModule();
const workflow = HexaPayWorkflowModule.attach(workflowAddress);

const tx = await workflow.createInvoice(
  companyAddress,
  payerAddress,
  encryptedInvoiceTotal,
  ethers.keccak256(ethers.toUtf8Bytes("invoice-apr-001")),
  Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60
);

await tx.wait();
```

```javascript
const invoiceId = "read from InvoiceCreated event or createInvoice.staticCall(...)";
await workflow.connect(payer).approveInvoice(invoiceId);
```

### Queue a treasury-approved invoice payment

```javascript
const [encryptedAmount] = await client
  .encryptInputs([Encryptable.uint128(2500n)])
  .execute();

const actionId = await workflow.proposeInvoicePayment(
  invoiceId,
  encryptedAmount,
  ethers.keccak256(ethers.toUtf8Bytes("policy-invoice-payment-001"))
);
```

```javascript
await workflow.connect(financeSigner).approvePendingAction(actionId);
await workflow.connect(treasurySigner).executePendingAction(actionId);
```

### Create and settle a confidential escrow

```javascript
const [encryptedEscrowTotal] = await client
  .encryptInputs([Encryptable.uint128(10000n)])
  .execute();
const HexaPayEscrowModule = await ethers.getContractFactory("HexaPayEscrowModule");
const escrowAddress = await hexaPay.escrowModule();
const escrow = HexaPayEscrowModule.attach(escrowAddress);

const escrowTx = await escrow.createEscrow(
  sellerAddress,
  arbiterAddress,
  encryptedEscrowTotal,
  ethers.keccak256(ethers.toUtf8Bytes("procurement-escrow-001")),
  Math.floor(Date.now() / 1000) + 14 * 24 * 60 * 60
);

await escrowTx.wait();
```

```javascript
const escrowId = "read from EscrowCreated event or createEscrow.staticCall(...)";
await escrow.fundEscrow(escrowId, encryptedEscrowTotal);
```

### Open a scoped compliance room

```javascript
const HexaPayComplianceModule = await ethers.getContractFactory("HexaPayComplianceModule");
const complianceAddress = await hexaPay.complianceModule();
const compliance = HexaPayComplianceModule.attach(complianceAddress);

const roomTx = await compliance.createComplianceRoom(
  companyAddress,
  auditorAddress,
  [0, 2, 3],
  7 * 24 * 60 * 60,
  ethers.keccak256(ethers.toUtf8Bytes("quarterly-audit-room"))
);

await roomTx.wait();
```

### Create an analytics checkpoint

```javascript
const HexaPayAnalyticsModule = await ethers.getContractFactory("HexaPayAnalyticsModule");
const analyticsAddress = await hexaPay.analyticsModule();
const analytics = HexaPayAnalyticsModule.attach(analyticsAddress);

const checkpointTx = await analytics.checkpointAnalytics(
  companyAddress,
  ethers.keccak256(ethers.toUtf8Bytes("q1-finance-snapshot"))
);

await checkpointTx.wait();
```

### Read your balance

```javascript
const permit = await client.permits.getOrCreateSelfPermit();
const balanceHandle = await hexaPay.getSealedBalance(permit.sealingPair.publicKey);
const balance = await client
  .decryptForView(balanceHandle, FheTypes.Uint128)
  .execute();
```

### Unwrap to public ERC20

```javascript
const [encryptedAmount] = await client
  .encryptInputs([Encryptable.uint128(250n)])
  .execute();
const withdrawalId = await hexaPay.unwrap(encryptedAmount);
await hexaPay.completeUnwrap(withdrawalId);
```

## Security notes

- The vault is separated from confidential accounting logic.
- `wrap`, `unwrap`, and `completeUnwrap` are protected with a reentrancy guard.
- Invoice settlement and payroll now live in a dedicated workflow module while still reusing the same confidential debit and credit checks from the core rail.
- Escrow custody is kept inside the same encrypted rail by moving funds into the escrow module address instead of unwrapping them.
- Scoped compliance rooms are enforced on read access through the core and module authorization helpers, while legacy broad grants remain available as a fallback path.
- Analytics aggregates are intentionally lightweight onchain and pair with checkpoints for heavier offchain finance reporting.
- Policy v1 adds queued approvals for company-governed actions without giving every signer blanket authority.
- Threshold-based policy on encrypted amounts is intentionally deferred until the privacy tradeoff is designed explicitly.
- Factory deployment fixes the owner-assignment bug from the earlier design and keeps factory bytecode smaller by accepting suite creation bytecode from the caller.
- Compliance access is explicit, time-bounded, and auditor-gated.
- Registry enforces uniqueness for `companyId` and ENS labels.
- Company signers are explicit and removable.

## Current repo note

This redesign assumes the Fhenix contract and Hardhat dependencies are installed locally. If `hardhat` or `@fhenixprotocol/*` packages are missing, run `npm install` before compiling or testing.

## Next roadmap

See `ROADMAP_HEXAPAY.md` for the unified contract and product roadmap covering:

- confidential invoice and request-to-pay
- policy-based treasury approvals
- escrow and dispute
- compliance workspace
- confidential analytics
