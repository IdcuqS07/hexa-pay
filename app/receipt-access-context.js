import { getActivePermitBridge } from "../src/contracts/client.js";
import { ReceiptRoles } from "./receipt-types.js";

export const EMPTY_RECEIPT_ACCESS_CONTEXT = Object.freeze({
  token: "",
  grant: "",
  permitHash: "",
  publicKey: "",
  signGrantChallenge: null,
});

function normalizeReceiptRole(role) {
  switch (String(role || "")) {
    case ReceiptRoles.PAYER:
      return ReceiptRoles.PAYER;
    case ReceiptRoles.AUDITOR:
      return ReceiptRoles.AUDITOR;
    case ReceiptRoles.MERCHANT:
    default:
      return ReceiptRoles.MERCHANT;
  }
}

function normalizeViewerAccount(runtime) {
  return String(runtime?.account || "")
    .trim()
    .toLowerCase();
}

export function createReceiptAccessToken({ role, runtime } = {}) {
  const normalizedRole = normalizeReceiptRole(role);
  const viewer = normalizeViewerAccount(runtime) || "anonymous";
  const chainId = String(runtime?.chainId || "offchain");
  return `receipt-viewer:${normalizedRole}:${viewer}:${chainId}`;
}

export function createReceiptAccessContext({ role, runtime, fhenix, allowGrantSignature = false } = {}) {
  const permitBridge = getActivePermitBridge(fhenix);
  const signGrantChallenge =
    allowGrantSignature && runtime?.signer && typeof runtime.signer.signMessage === "function"
      ? async (message) => runtime.signer.signMessage(String(message || ""))
      : null;

  return {
    token: createReceiptAccessToken({ role, runtime }),
    grant: "",
    permitHash: String(permitBridge.permitHash || ""),
    publicKey: String(permitBridge.publicKey || ""),
    signGrantChallenge,
  };
}
