# HexaPay Analytics Module Spec

## Goal

Phase 5 adds sealed finance summaries on top of the HexaPay suite.

`HexaPayAnalyticsModule` focuses on lightweight onchain aggregates plus checkpoint hooks for heavier offchain reporting.

## Current aggregates

Implemented aggregates:

- cumulative company spend history
- latest payroll run total per schedule
- current invoice exposure per company
- current escrow exposure per company

Implemented checkpointing:

- company-scoped analytics checkpoint metadata
- snapshot hash anchoring
- company checkpoint index

## Spend model

Spend is recorded from HexaPay core payments using total debit:

- payment amount
- plus platform fee when applicable

Escrow funding is intentionally excluded from spend summaries because it is tracked separately as escrow exposure.

`getSealedCompanySpend(company, from, to, publicKey)` computes the value from cumulative encrypted checkpoints.

## Payroll model

`recordPayrollRun` stores the latest gross payroll total for a schedule after each execution.

`getSealedPayrollRunTotal(scheduleId, publicKey)` returns that latest cycle total.

## Invoice exposure model

Exposure is company-side confidential receivables currently open in workflow:

- increase on invoice creation
- decrease on invoice payment
- decrease on invoice rejection
- decrease on invoice cancellation

`getSealedInvoiceExposure(company, publicKey)` returns the current encrypted total.

## Escrow exposure model

Exposure is buyer-side capital still locked in active escrow:

- increase on escrow funding
- decrease on seller release
- decrease on seller refund
- decrease on arbiter resolution
- decrease on expiry close

`getSealedEscrowExposure(company, publicKey)` returns the current encrypted total.

## Access rules

Can view analytics:

- subject/company itself
- subject/company operators
- auditors with active `Analytics` compliance scope

Can create analytics checkpoints:

- subject/company itself
- subject/company operators

## Checkpoints

`checkpointAnalytics(company, snapshotHash)` stores:

- checkpoint id
- company
- snapshot hash
- timestamp

This is meant to anchor richer offchain finance snapshots such as:

- invoice aging tables
- departmental spend splits
- runway projections
- vendor concentration analysis

## Notes

- current implementation keeps onchain aggregation deliberately narrow
- invoice aging summary refinement is still a good next enhancement on top of checkpoint infrastructure
- checkpoint metadata is plain, while the aggregate values remain encrypted and sealed on read

## Test focus

- analytics module deployment and linkage
- analytics checkpoint creation
- analytics scope authorization for auditors
- spend window correctness
- invoice and escrow exposure updates after workflow activity
