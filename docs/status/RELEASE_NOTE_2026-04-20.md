# Release Note — 2026-04-20

## Release Summary

This release publishes the current HexaPay working stack to GitHub after the repository cleanup and docs regrouping pass.

- Commit: `45d59f4`
- Branch: `main`
- Remote: `origin` -> `https://github.com/IdcuqS07/hexa-pay.git`
- Author: `IdcuqS07 <idchuq@gmail.com>`

## Included In This Release

### 1. Private Quotes stack

- Added the `local`, `mock-registry`, and `mock-api` receipt modes.
- Added shared receipt access policy, projection handling, and participant-aware disclosure.
- Added mock receipt persistence seams for memory, file, HTTP, and Redis-oriented adapters.
- Added smoke tests and demos for receipt service, API adapter, and challenge lifecycle.

### 2. Payment rail hardening

- Stabilized the live Arbitrum Sepolia payment rail around `HexaPayUSDCExecutor`.
- Fixed EIP-712 domain handling so clients sign against the challenge-provided domain.
- Improved backend nonce handling and reduced `nonce too low` / reused nonce failures.
- Improved browser-side approval and error messaging for MetaMask RPC instability.
- Cleared payment form values after successful execution and removed demo-value flash on refresh.

### 3. Frontend and app surfaces

- Added `pay.html`, `audit.html`, and `payment-intent.html` flows.
- Added standalone auditor, payer, and payment-intent surfaces in the Vite app.
- Added React frontend workspace under `frontend/` for private quotes and payment intent flows.

### 4. Repository cleanup

- Moved roadmap, guide, spec, and status documents under `docs/`.
- Updated `.gitignore` to reduce local repo noise from generated files and local artifacts.
- Kept live payment rail notes and active executor details aligned in docs and env examples.

## Verified Before Push

- `npm run build`
- `npm run verify:private-quotes`

## Known Notes

- `lib/forge-std` is tracked as a Git submodule.
- `verify:private-quotes` may still print `MODULE_TYPELESS_PACKAGE_JSON` warnings, but the smoke tests pass.
- Vite may still print a CJS Node API deprecation warning during build, but it does not block the release.

## Recommended Follow-Up

1. Sweep remaining secondary guides so all deployment docs point to the active payment executor and current runtime flow.
2. Decide whether `lib/forge-std` should remain a submodule or be vendored differently.
3. If needed, prepare a tagged GitHub release using this note as the base summary.
