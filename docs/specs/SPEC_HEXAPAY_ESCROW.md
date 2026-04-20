# HexaPay Escrow Module Spec

## Goal

Phase 3 turns HexaPay from a private payment and invoicing rail into a confidential commerce rail.

`HexaPayEscrowModule` adds:

- confidential escrow creation
- real funding from wrapped balances
- encrypted milestone amounts
- seller-side voluntary refund flow
- buyer/seller dispute opening
- arbiter split resolution
- timeout-based expiry close

## Contract shape

Primary contract:

- `HexaPayEscrowModule.sol`

Core dependency:

- `HexaPay.sol`

Settlement pattern:

1. buyer wraps real settlement token into HexaPay core
2. buyer funds escrow through `fundEscrow`
3. core moves confidential balance from buyer to escrow module address
4. escrow module later releases or refunds from its own confidential balance
5. no unwrap is required for normal escrow settlement

## Main state

Escrow metadata:

- `buyer`
- `seller`
- `arbiter`
- `createdAt`
- `expiresAt`
- `metadataHash`
- `disputeReasonHash`
- `rulingHash`
- `status`
- `fundingCount`
- `releaseCount`
- `fullyFunded`

Encrypted state:

- `escrowTotals`
- `escrowFunded`
- `escrowReleased`
- `escrowRefunded`
- `escrowRemaining`

Milestones:

- `referenceHash`
- encrypted `amount`
- `released`

## Status model

- `Open`
- `Disputed`
- `Released`
- `Refunded`
- `Resolved`
- `Expired`

## Core functions

- `createEscrow`
  creates a new escrow with buyer, seller, arbiter, encrypted total, metadata, and expiry

- `fundEscrow`
  moves encrypted balance from buyer to escrow module through HexaPay core

- `createEscrowMilestones`
  stores encrypted milestone amounts and requires milestone sum to equal encrypted escrow total

- `releaseEscrow`
  buyer-side direct release to seller for non-milestone or partial release cases

- `releaseEscrowMilestone`
  releases a stored milestone amount to seller

- `refundEscrow`
  seller-side voluntary refund back to buyer

- `openDispute`
  buyer or seller escalates escrow to arbiter flow

- `resolveDispute`
  arbiter splits remaining escrow between buyer and seller using basis points

- `closeExpiredEscrow`
  returns remaining escrow to buyer after expiry if no dispute is active

## Access model

Can manage buyer actions:

- buyer
- buyer company operators

Can manage seller refund:

- seller
- seller company operators

Can resolve dispute:

- arbiter
- arbiter company operators

Can view sealed escrow amounts:

- buyer
- seller
- arbiter
- their company operators
- authorized auditors with active compliance grant from one of those subjects

## Notes

- escrow uses `PaymentKind.Escrow`
- escrow funding uses normal managed payment flow with fee charging
- escrow release and refund use fee-exempt managed payment flow to avoid double-charging settlement from escrow custody
- dispute resolution currently uses plaintext basis-point math on the remaining amount before re-encrypting the split, matching the current practical limitations already used elsewhere in the suite

## Test focus

- buyer-only funding and release boundaries
- seller-only refund boundary
- no double milestone release
- arbiter-only dispute resolution
- expiry close returns remaining amount to buyer
- sealed reads stay limited to escrow participants and granted auditors
