# HexaPay x Reineira Adoption Notes

## Objective

This note captures what is worth adopting from Reineira for HexaPay, what should stay out, and the safest order for implementation.

Date reviewed: 2026-04-18

## Sources reviewed

- Reineira docs landing page: `https://docs.reineira.xyz/`
- Reineira SDK npm package: `https://www.npmjs.com/package/@reineira-os/sdk`
- Reineira dev toolkit: `https://github.com/ReineiraOS/reineira-code`
- Reineira interfaces:
  - `IConditionResolver.sol`
  - `IUnderwriterPolicy.sol`

## Important source notes

- The npm package `@reineira-os/sdk` currently shows latest dist-tag `0.2.0`.
- The npm registry metadata shows `0.2.0` was published on 2026-03-22.
- `reineira-code` currently reports package version `0.2.0`, but its platform file still says `0.1.0`.
- The toolkit README still references platform `0.1` and SDK `^0.1.0`.
- Some deep doc links referenced by the toolkit README returned `404` during review, so the most reliable technical references were:
  - the SDK README bundled in npm
  - the toolkit README
  - the published Solidity interfaces

## Reineira model in one paragraph

Reineira is centered on confidential escrow rails. Its main primitives are:

- confidential escrow creation and funding
- optional release conditions through resolver plugins
- optional insurance coverage attached to escrow
- event-driven SDK flows around escrow lifecycle
- optional cross-chain USDC funding through operator coordination

That is narrower than HexaPay, which is already a broader confidential finance suite covering treasury, invoices, policy controls, compliance, analytics, and escrow.

## What fits HexaPay well

### 1. Escrow condition plugin pattern

This is the strongest concept to adopt.

Reineira exposes a simple resolver interface:

- `isConditionMet(uint256 escrowId) -> bool`
- `onConditionSet(uint256 escrowId, bytes data)`

Why it fits:

- HexaPay already has a dedicated escrow module.
- HexaPay already supports disputes, milestones, and expiry.
- A resolver hook would let us add programmable release conditions without rewriting the full escrow design.

Good HexaPay use cases:

- release only after offchain proof verification
- release only after buyer acceptance signal
- release only after oracle or zkTLS attestation
- release only after invoice-linked delivery confirmation

Recommended adaptation:

- keep HexaPay escrow as the base contract
- add an optional resolver address plus opaque resolver config bytes per escrow
- check resolver status before `releaseEscrow` and `releaseEscrowMilestone`
- keep dispute and expiry logic as fallback paths even when a resolver exists

### 2. SDK ergonomics, not protocol replacement

Reineira SDK has several useful frontend patterns:

- `TransactionResult` normalization
- explicit approval flow with `autoApprove`
- typed domain modules like `escrow`, `insurance`, `events`, `bridge`
- helper functions such as `usdc()`, `formatUsdc()`
- named error classes such as `ApprovalRequiredError`, `TransactionFailedError`, `TimeoutError`
- wallet adapter helpers like `walletClientToSigner()`

Why it fits:

- HexaPay frontend already has a contract client layer in `src/contracts/client.js`.
- HexaPay app already normalizes encrypted input building, sealed reads, and write calls.
- The SDK patterns can make the HexaPay client easier to use without changing the protocol.

Recommended adaptation:

- keep HexaPay on its own client stack
- borrow the shape of:
  - typed result objects
  - named error classes
  - explicit approval UX
  - event subscription helpers
- do not replace HexaPay contract calls with Reineira SDK directly

### 3. Event-driven UX

Reineira SDK gives a clean event module for:

- `EscrowCreated`
- `EscrowFunded`
- `EscrowRedeemed`
- insurance and pool events

Why it fits:

- HexaPay app currently reads and writes correctly, but richer event listeners would improve live monitoring.
- This is especially useful for:
  - invoice payment updates
  - escrow funding and release
  - pending action approval progress
  - analytics checkpoint visibility

Recommended adaptation:

- add a HexaPay events layer in `src/contracts/client.js`
- expose subscribe/query helpers for:
  - payments
  - invoices
  - pending actions
  - escrow
  - compliance rooms
  - analytics checkpoints

### 4. Resolver data encoding helpers

Reineira exposes small helpers like ABI-based resolver data encoding.

Why it fits:

- HexaPay will need deterministic resolver configuration payloads if we add condition plugins.

Recommended adaptation:

- add a tiny utility helper for ABI-encoding resolver params
- keep it independent from any Reineira address book or protocol assumptions

## What only partially fits

### 1. Insurance plugin architecture

Reineira supports underwriter policies and coverage purchases around escrow.

Why only partial fit:

- HexaPay has policy, compliance, and analytics modules, but not an insurance market.
- HexaPay policy today means treasury approvals, not underwriting.
- The meaning of "policy" in the two systems is different.

Possible future use:

- add optional dispute coverage for escrow later
- treat insurance as a new module, not as an extension of current `PolicyActionType`

Recommendation:

- do not integrate this now
- keep it as a possible future module after escrow condition plugins are stable

### 2. Cross-chain coordinator and CCTP flow

Reineira SDK supports cross-chain funding via CCTP and coordinator/operator settlement.

Why only partial fit:

- HexaPay is currently a single-suite confidential finance app on Arbitrum Sepolia with its own vault and wrapped settlement model.
- Reineira assumes protocol-owned addresses like:
  - escrow receiver
  - operator registry
  - fee manager
  - CCTP handler
- Those are not part of HexaPay architecture today.

Recommendation:

- do not import this flow into HexaPay now
- only revisit after core escrow usage is proven and multi-chain product scope is explicit

## What does not fit HexaPay right now

### 1. Reineira protocol addresses and deployed contracts

Do not reuse:

- `TESTNET_ADDRESSES`
- `confidentialUSDC`
- `escrowReceiver`
- `coverageManager`
- `poolFactory`
- operator or CCTP addresses

Reason:

- HexaPay already has its own deployed suite and its own settlement token model.
- Reineira addresses would couple HexaPay to a different protocol.

### 2. Reineira escrow ID and ownership model

Reineira SDK assumes:

- sequential `uint256` escrow ids
- owner-based redemption flow
- escrow-centric application model

HexaPay uses:

- hashed `bytes32` ids in multiple modules
- buyer, seller, arbiter, and company-operator permissions
- modular finance workflows beyond escrow

Recommendation:

- keep HexaPay identifiers and permission model as-is
- only borrow the plugin idea, not the object model

### 3. Direct SDK drop-in as the main HexaPay frontend library

Reason:

- Reineira SDK is built around Reineira contracts and address layout.
- HexaPay frontend already has bespoke support for:
  - core suite snapshots
  - sealed reads across multiple modules
  - company and invoice workflows
  - escrow, compliance, and analytics integration

Recommendation:

- treat Reineira SDK as design inspiration, not as a drop-in dependency

## Proposed HexaPay adoption order

### Phase A. Add escrow condition plugins

Highest-value adoption.

Suggested contract additions:

- new interface in HexaPay, modeled after `IConditionResolver`
- optional `resolver` and `resolverData` on escrow creation
- stored resolver config per escrow
- resolver gate checked on release paths

Suggested behavior:

- no resolver means current escrow behavior stays unchanged
- resolver failure should block release, but not block dispute or expiry close
- resolver should be optional and auditable through metadata reads

### Phase B. Improve client ergonomics

Low-risk frontend adoption.

Suggested client changes:

- normalize transaction results
- introduce typed error mapping
- add event subscribe/query helpers
- add small amount formatting helpers for settlement token units

Good targets:

- `src/contracts/client.js`
- `app/main.js`
- `src/hexapay.js`

### Phase C. Add resolver-ready UI flow

After contract support exists.

Suggested UI capabilities:

- choose escrow type: standard or conditional
- provide resolver address
- encode resolver config data
- show whether an escrow is condition-gated
- surface resolver state in escrow detail view

### Phase D. Evaluate insurance only if escrow volume justifies it

Only after:

- escrow condition plugins work well
- dispute metrics justify coverage demand
- product scope clearly includes underwriters or coverage pools

## Concrete implementation recommendation

If we start integrating now, the safest first feature is:

1. extend `HexaPayEscrowModule` with optional condition resolver support
2. add a matching interface file and tests
3. expose resolver-aware escrow creation in the frontend
4. add event helpers for escrow status tracking

This gives HexaPay a real upgrade from Reineira without forcing HexaPay into Reineira's protocol model.

## Short conclusion

Take from Reineira:

- escrow condition plugin architecture
- SDK ergonomics and event patterns
- resolver data encoding helpers

Do not take right now:

- Reineira deployed addresses
- direct SDK replacement for HexaPay frontend
- insurance and CCTP coordinator flows

Best interpretation for HexaPay:

Reineira is a useful source of escrow extensibility patterns, not a protocol to embed wholesale.
