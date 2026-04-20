import {
  ReceiptRecordTypes,
  ReceiptRoles,
  RECEIPT_PROJECTION_SCHEMA_VERSION,
} from "./receipt-types.js";

const DEFAULT_RECEIPT_ACCESS_TRANSPORT = "client-store";

export function normalizeReceiptAccessContext(accessContext) {
  if (!accessContext || typeof accessContext !== "object") {
    return {
      token: "",
      permitHash: "",
      publicKey: "",
    };
  }

  return {
    token: String(accessContext.token || ""),
    permitHash: String(accessContext.permitHash || ""),
    publicKey: String(accessContext.publicKey || ""),
  };
}

function resolveReceiptAccessScope(visibility) {
  return visibility === "limited" ? "private-quote.receipt.limited" : "private-quote.receipt.full";
}

function createReceiptReadModel(receipt, role, options = {}) {
  return {
    recordType: ReceiptRecordTypes.PROJECTION,
    projectionVersion: RECEIPT_PROJECTION_SCHEMA_VERSION,
    role,
    transport: String(options.transport || DEFAULT_RECEIPT_ACCESS_TRANSPORT),
    canonical: {
      recordType: String(receipt.meta?.recordType || ReceiptRecordTypes.CANONICAL),
      schemaVersion: Number(receipt.meta?.schemaVersion || receipt.meta?.version || 0),
      sourceOfTruth: {
        ...(receipt.meta?.sourceOfTruth && typeof receipt.meta.sourceOfTruth === "object"
          ? receipt.meta.sourceOfTruth
          : {}),
      },
      eventRef: {
        ...(receipt.meta?.eventRef && typeof receipt.meta.eventRef === "object"
          ? receipt.meta.eventRef
          : {}),
      },
    },
  };
}

export function createReceiptAccessBridge(receipt, role, visibility, options = {}) {
  const accessContext = normalizeReceiptAccessContext(options.accessContext);
  const hasAttachedPermit = Boolean(accessContext.permitHash || accessContext.publicKey);

  return {
    version: 1,
    phase: "bootstrap",
    transport: String(options.transport || DEFAULT_RECEIPT_ACCESS_TRANSPORT),
    role,
    visibility,
    scope: resolveReceiptAccessScope(visibility),
    accessToken: {
      kind: "receipt-access-token",
      value: accessContext.token || `receipt-access:${receipt.quoteId}:${role}`,
      source: accessContext.token ? "provided" : "derived",
    },
    permit: {
      hash: accessContext.permitHash,
      publicKey: accessContext.publicKey,
      source: hasAttachedPermit ? "provided" : "none",
      state:
        role === ReceiptRoles.AUDITOR
          ? "not-required"
          : hasAttachedPermit
            ? "attached"
            : "bridge-ready",
    },
  };
}

export function projectReceiptForRole(receipt, role, options = {}) {
  if (!receipt) {
    return null;
  }

  const visibility = String(receipt.access?.[role] || "");

  if (!visibility) {
    return null;
  }

  switch (role) {
    case ReceiptRoles.MERCHANT:
    case ReceiptRoles.PAYER:
      return {
        quoteId: receipt.quoteId,
        merchant: receipt.merchant,
        payer: receipt.payer,
        status: receipt.status,
        settledAt: receipt.settledAt,
        txHash: receipt.txHash,
        paymentLink: receipt.paymentLink,
        amount: receipt.amount,
        currency: receipt.currency,
        visibility,
        readModel: createReceiptReadModel(receipt, role, options),
        accessBridge: createReceiptAccessBridge(receipt, role, visibility, options),
      };

    case ReceiptRoles.AUDITOR:
      return {
        quoteId: receipt.quoteId,
        merchant: receipt.merchant,
        payer: maskAddress(receipt.payer),
        status: receipt.status,
        settledAt: receipt.settledAt,
        txHash: receipt.txHash,
        currency: receipt.currency,
        amount: null,
        paymentLink: null,
        visibility,
        readModel: createReceiptReadModel(receipt, role, options),
        accessBridge: createReceiptAccessBridge(receipt, role, visibility, options),
      };

    default:
      return null;
  }
}

export function maskAddress(address) {
  if (!address || address.length < 10) {
    return address || "";
  }

  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}
