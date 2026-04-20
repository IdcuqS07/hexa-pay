# HexaPay Compliance Workspace Spec

## Goal

Phase 4 turns HexaPay compliance from a broad auditor grant into a structured audit workspace.

`HexaPayComplianceModule` adds:

- scoped compliance rooms
- object-level disclosure scopes
- room artifacts
- room attestations
- room access logs
- integration with core, workflow, and escrow read authorization

## Scopes

Supported `ComplianceScope` values:

- `Balance`
- `Payment`
- `Invoice`
- `Payroll`
- `Escrow`
- `Analytics`

## Room model

Each room stores:

- `roomId`
- `subject`
- `auditor`
- `createdAt`
- `expiresAt`
- `policyHash`
- `active`

Each room also maintains:

- scope set
- artifact list
- attestation list
- access log list

## Access rules

Can create or extend room:

- subject
- subject company operators

Can close room:

- subject
- subject company operators
- assigned auditor

Can add room attestation:

- assigned auditor only

Can add artifact or access log:

- subject
- subject company operators
- assigned auditor

## Integration behavior

HexaPay core now checks:

- legacy broad grant from `grantComplianceAccess`
- or active scoped room from `HexaPayComplianceModule`

Read enforcement now maps to scope:

- balances -> `Balance`
- payment values -> `Payment`
- invoice values and invoice policy actions -> `Invoice`
- payroll amounts and payroll policy actions -> `Payroll`
- escrow values -> `Escrow`

## Main functions

- `createComplianceRoom`
- `extendComplianceRoom`
- `closeComplianceRoom`
- `addComplianceArtifact`
- `addAuditAttestation`
- `recordComplianceAccess`
- `canViewScope`
- `hasScopedAccess`
- `getComplianceRoom`
- `getRoomScopes`
- `getRoomArtifacts`
- `getRoomAttestations`
- `getRoomAccessLogs`

## Notes

- scoped rooms do not remove the older broad-grant flow; they augment it
- this preserves backward compatibility for earlier grant-based integrations
- the intended product path is to prefer scoped rooms for enterprise and auditor workflows

## Test focus

- only authorized auditors can be assigned to rooms
- subject/operator-only room creation and extension
- room closure revokes scoped access
- invoice/payroll/escrow reads respect scope boundaries
- room artifact and attestation history append correctly
