# HexaPay Policy Engine Spec

## Objective

HexaPay policy engine v1 turns signer management into operational treasury control.

It introduces:

- per-action signer scopes
- approval rules per company
- pending action queue
- multi-approval execution for sensitive company actions

## Scope in v1

Protected action types:

1. `InvoicePayment`
2. `PayrollExecution`
3. `InvoiceCancellation`

This version intentionally focuses on the actions that already move business value through the current HexaPay design.

## Why v1 does not enforce encrypted amount thresholds yet

HexaPay keeps payment amounts confidential. Enforcing amount thresholds onchain would require branching on decrypted comparison results, which leaks whether an amount crosses a configured threshold.

So policy v1 prioritizes:

- signer scoping
- approval count
- approval expiry
- explicit execution queue

Threshold-aware governance can be added later once the privacy tradeoff is designed deliberately.

## Core model

### Policy rule

Each company can set a rule per action type:

- `minApprovals`
- `approvalTtl`
- `active`

### Signer scope

Each approved signer can be explicitly authorized for a specific action type.

That means a signer can be:

- allowed for payroll approvals
- blocked from invoice cancellations
- allowed for invoice payment approvals

without giving them broad administrative power.

### Pending action

Sensitive actions move through a queue:

1. propose
2. collect approvals
3. execute

Stored metadata includes:

- company
- proposer
- resource id
- metadata hash
- action type
- created at
- expires at
- approval count
- executed flag

For invoice payment proposals, the encrypted amount is stored separately and can be retrieved via sealed output.

## Access rules

Can configure policy rules:

- company owner only

Can set signer scopes:

- company owner only

Can propose, approve, and execute pending actions:

- company owner
- approved company signer with the matching action permission

Can view pending actions:

- proposer
- company operators
- authorized auditors with an active grant for the company

## Behavior by action

### Invoice payment

If policy is active for the payer company:

- direct `payInvoice` is blocked
- company operator must call `proposeInvoicePayment`
- approvals are collected
- execution happens through `executePendingAction`

### Payroll execution

If policy is active for the employer company:

- direct `executePayroll` is blocked
- company operator must call `proposePayrollExecution`
- approved action later executes the payroll run

### Invoice cancellation

If policy is active for the issuer company:

- direct `cancelInvoice` is blocked
- company operator must call `proposeInvoiceCancellation`
- approved action later cancels the invoice

## Contract surface

Implemented in `HexaPay.sol`:

- `setPolicyRule`
- `getPolicyRule`
- `setSignerActionPermission`
- `isSignerAuthorizedForAction`
- `proposeInvoicePayment`
- `proposePayrollExecution`
- `proposeInvoiceCancellation`
- `approvePendingAction`
- `revokePendingActionApproval`
- `executePendingAction`
- `getPendingAction`
- `getPendingActionApprovers`
- `getCompanyPendingActions`
- `getSealedPendingActionAmount`

## Test matrix

High-priority scenarios:

1. company owner configures a policy rule
2. company owner scopes a signer to payroll only
3. direct payroll execution is blocked when policy is active
4. payroll execution succeeds after enough approvals
5. direct invoice payment is blocked when payer company policy is active
6. invoice payment succeeds through pending action execution
7. direct invoice cancellation is blocked when policy is active
8. unauthorized signer cannot propose or approve an action
9. approval revocation decreases approval count correctly
10. expired actions cannot be approved or executed
11. auditors with an active grant can inspect pending action metadata
12. sealed pending action amounts are restricted to permitted viewers

## Next layer after this spec

The next evolution after policy v1 should be:

- encrypted threshold design
- signer classes or policy templates
- signer change approvals
- unwrap governance for company treasury accounts
