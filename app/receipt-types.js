export const ReceiptRoles = {
  MERCHANT: "merchant",
  PAYER: "payer",
  AUDITOR: "auditor",
};

export const RECEIPT_CANONICAL_SCHEMA_VERSION = 3;
export const RECEIPT_PROJECTION_SCHEMA_VERSION = 1;
export const RECEIPT_STORAGE_ENVELOPE_SCHEMA_VERSION = 1;

export const ReceiptRecordTypes = {
  CANONICAL: "canonical-receipt",
  PROJECTION: "projected-receipt",
  STORAGE_ENVELOPE: "canonical-receipt-list",
};

export function createReceiptSourceOfTruth(sourceOfTruth = {}) {
  if (!sourceOfTruth || typeof sourceOfTruth !== "object") {
    return {
      mode: "local",
      authority: "browser-local-storage",
      readiness: "bootstrap",
    };
  }

  return {
    mode: String(sourceOfTruth.mode || "local"),
    authority: String(sourceOfTruth.authority || "browser-local-storage"),
    readiness: String(sourceOfTruth.readiness || "bootstrap"),
  };
}

function createReceiptEventRef(receipt = {}) {
  return {
    kind: "quote-settled",
    txHash: String(receipt.txHash || ""),
    settledAt: Number(receipt.settledAt || 0) || Date.now(),
  };
}

function buildCanonicalReceiptMeta(receipt = {}, options = {}) {
  const sourceOfTruth = createReceiptSourceOfTruth({
    ...(receipt.meta?.sourceOfTruth && typeof receipt.meta.sourceOfTruth === "object"
      ? receipt.meta.sourceOfTruth
      : {}),
    ...(options.sourceOfTruth && typeof options.sourceOfTruth === "object" ? options.sourceOfTruth : {}),
  });

  return {
    version: RECEIPT_CANONICAL_SCHEMA_VERSION,
    schemaVersion: RECEIPT_CANONICAL_SCHEMA_VERSION,
    recordType: ReceiptRecordTypes.CANONICAL,
    projectionVersion: RECEIPT_PROJECTION_SCHEMA_VERSION,
    createdAt: Number(receipt.meta?.createdAt || Date.now()),
    source: String(receipt.meta?.source || "bootstrap"),
    sourceOfTruth,
    eventRef: {
      ...(receipt.meta?.eventRef && typeof receipt.meta.eventRef === "object" ? receipt.meta.eventRef : {}),
      ...createReceiptEventRef(receipt),
    },
  };
}

export function createReceiptRecord(
  {
    quoteId,
    merchant,
    payer,
    status,
    settledAt,
    txHash,
    paymentLink,
    amount = null,
    currency = "ETH",
  },
  options = {},
) {
  return {
    id: `receipt:${quoteId}`,
    quoteId,
    merchant,
    payer,
    status,
    settledAt,
    txHash,
    paymentLink,
    amount,
    currency,
    access: {
      merchant: "full",
      payer: "full",
      auditor: "limited",
    },
    meta: buildCanonicalReceiptMeta(
      {
        settledAt,
        txHash,
      },
      options,
    ),
  };
}

export function normalizeReceiptRecord(receipt, options = {}) {
  if (!receipt || typeof receipt !== "object") {
    return null;
  }

  const quoteId = String(receipt.quoteId || "");

  if (!quoteId) {
    return null;
  }

  const canonical = createReceiptRecord(
    {
      quoteId,
      merchant: String(receipt.merchant || ""),
      payer: String(receipt.payer || ""),
      status: String(receipt.status || "Settled"),
      settledAt: Number(receipt.settledAt || 0) || Date.now(),
      txHash: String(receipt.txHash || ""),
      paymentLink: String(receipt.paymentLink || ""),
      amount: receipt.amount ?? null,
      currency: String(receipt.currency || "ETH"),
    },
    options,
  );

  return {
    ...canonical,
    id: String(receipt.id || canonical.id),
    access: {
      ...canonical.access,
      ...(receipt.access && typeof receipt.access === "object" ? receipt.access : {}),
    },
    meta: {
      ...canonical.meta,
      ...(receipt.meta && typeof receipt.meta === "object" ? receipt.meta : {}),
      ...buildCanonicalReceiptMeta(
        {
          ...receipt,
          settledAt: canonical.settledAt,
          txHash: canonical.txHash,
          meta: receipt.meta,
        },
        options,
      ),
    },
  };
}

export function normalizeReceiptRecordList(receipts, options = {}) {
  if (!Array.isArray(receipts)) {
    return [];
  }

  const entries = new Map();

  receipts
    .map((receipt) => normalizeReceiptRecord(receipt, options))
    .filter(Boolean)
    .forEach((receipt) => {
      const existingReceipt = entries.get(receipt.quoteId);

      if (!existingReceipt || Number(receipt.settledAt) >= Number(existingReceipt.settledAt)) {
        entries.set(receipt.quoteId, receipt);
      }
    });

  return Array.from(entries.values()).sort(
    (left, right) => Number(right.settledAt) - Number(left.settledAt),
  );
}

export function createReceiptStorageEnvelope(receipts, options = {}) {
  return {
    version: RECEIPT_STORAGE_ENVELOPE_SCHEMA_VERSION,
    schemaVersion: RECEIPT_STORAGE_ENVELOPE_SCHEMA_VERSION,
    recordType: ReceiptRecordTypes.STORAGE_ENVELOPE,
    sourceOfTruth: createReceiptSourceOfTruth(options.sourceOfTruth),
    receipts: normalizeReceiptRecordList(receipts, options),
  };
}

export function parseReceiptStorageEnvelope(payload, options = {}) {
  if (Array.isArray(payload)) {
    return {
      sourceOfTruth: createReceiptSourceOfTruth(options.sourceOfTruth),
      receipts: normalizeReceiptRecordList(payload, options),
    };
  }

  if (!payload || typeof payload !== "object") {
    return {
      sourceOfTruth: createReceiptSourceOfTruth(options.sourceOfTruth),
      receipts: [],
    };
  }

  const envelopeSourceOfTruth = createReceiptSourceOfTruth({
    ...(payload.sourceOfTruth && typeof payload.sourceOfTruth === "object" ? payload.sourceOfTruth : {}),
    ...(options.sourceOfTruth && typeof options.sourceOfTruth === "object" ? options.sourceOfTruth : {}),
  });

  return {
    sourceOfTruth: envelopeSourceOfTruth,
    receipts: normalizeReceiptRecordList(
      Array.isArray(payload.receipts) ? payload.receipts : [],
      {
        ...options,
        sourceOfTruth: envelopeSourceOfTruth,
      },
    ),
  };
}
