# HexaPay Invoice Module Spec

## Objective

The first expansion on top of the current HexaPay payment rail is a confidential invoice and request-to-pay workflow.

This module should let a registered company:

- issue a private invoice
- attach encrypted line items
- request approval from a payer
- accept partial settlement
- close automatically when outstanding balance reaches zero

## Core model

Invoice actors:

- `company`: registered business profile that receives payment
- `issuer`: company owner or approved signer who created the invoice
- `payer`: counterparty expected to settle the invoice

Invoice states:

1. `PendingApproval`
2. `Approved`
3. `Rejected`
4. `PartiallyPaid`
5. `Paid`
6. `Cancelled`

State transitions:

- create -> `PendingApproval`
- payer approve -> `Approved`
- payer reject -> `Rejected`
- first successful partial payment -> `PartiallyPaid`
- final payment clearing outstanding -> `Paid`
- company operator cancel before funding -> `Cancelled`

## Confidential data

Encrypted values stored onchain:

- invoice total
- invoice outstanding
- invoice line item amounts

Public metadata stored onchain:

- invoice id
- issuer
- payer
- company
- timestamps
- due date
- metadata hash
- status
- payment count

## Contract surface

Implemented in `HexaPay.sol`:

- `createInvoice`
- `addInvoiceLineItems`
- `approveInvoice`
- `rejectInvoice`
- `cancelInvoice`
- `payInvoice`
- `getInvoice`
- `getInvoicePayments`
- `getCompanyInvoices`
- `getPayerInvoices`
- `getInvoiceLineItemCount`
- `getInvoiceLineItemLabelHash`
- `getSealedInvoiceAmount`
- `getSealedInvoiceOutstanding`
- `getSealedInvoiceLineItemAmount`
- `isInvoiceOverdue`

## Access rules

Can manage invoice:

- issuer
- company owner
- approved company signer

Can view invoice data:

- issuer
- payer
- approved payer-company signer when the payer is a registered company
- company owner
- approved company signer
- authorized auditor with an active company, issuer, or payer grant

## Settlement behavior

Invoice payments reuse the same internal confidential transfer engine as:

- peer-to-peer transfers
- payroll runs

Effectively:

- payer internal balance is debited by invoice amount plus fee
- company internal balance is credited by invoice amount
- fee collector is credited by platform fee
- invoice outstanding is reduced by the paid amount

## Important implementation notes

- invoice line items are descriptive and confidential, while invoice total remains the authoritative amount to settle
- invoice cancellation is only allowed before any settlement has been applied
- overdue state is derived dynamically from `dueAt` and final status, instead of being persisted separately
- invoice settlement currently routes to the `company` address rather than to an invoice-specific sub-account

## Test matrix

High-priority test scenarios:

1. creates an invoice only for a registered company operator
2. rejects invoice creation with zero payer or invalid due date
3. lets payer approve only pending invoices
4. lets payer reject only pending invoices
5. blocks non-payer approval or rejection
6. blocks invoice cancellation after any payment is applied
7. records partial payment and decreases outstanding balance
8. marks invoice as paid when outstanding reaches zero
9. blocks overpayment beyond outstanding balance
10. links each invoice payment to a `paymentId`
11. restricts sealed invoice reads to permitted viewers
12. lets an authorized auditor view invoice data only while grant is active

## Next layer after this spec

The next contract layer should attach the policy engine to:

- invoice approval
- invoice payment over thresholds
- invoice cancellation for protected companies

That is the bridge from "private invoicing" to "private treasury controls".
