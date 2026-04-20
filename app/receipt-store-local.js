import { projectReceiptForRole } from "./receipt-policy.js";
import { ReceiptStore } from "./receipt-store.js";
import {
  createReceiptStorageEnvelope,
  normalizeReceiptRecord,
  parseReceiptStorageEnvelope,
  ReceiptRoles,
} from "./receipt-types.js";

export const LOCAL_RECEIPT_STORE_KEY = "hexapay.privateQuotes.receipts.v2";

const LEGACY_RECEIPT_LIST_KEY = "hexapay.private-quote.receipts.v1";
const LEGACY_LATEST_RECEIPT_KEY = "hexapay.private-quote.latest-receipt.v1";
const LOCAL_RECEIPT_SOURCE_OF_TRUTH = {
  mode: "local",
  authority: "browser-local-storage",
  readiness: "bootstrap",
};

function safeReadStorage(key) {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return window.localStorage.getItem(key);
  } catch (error) {
    return null;
  }
}

function safeWriteStorage(key, value) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(key, value);
  } catch (error) {
    error;
  }
}

function safeRemoveStorage(key) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.removeItem(key);
  } catch (error) {
    error;
  }
}

function normalizeReceiptList(receipts) {
  return parseReceiptStorageEnvelope(receipts, {
    sourceOfTruth: LOCAL_RECEIPT_SOURCE_OF_TRUTH,
  }).receipts;
}

function parseStoredList(raw) {
  if (!raw) {
    return [];
  }

  try {
    return parseReceiptStorageEnvelope(JSON.parse(raw), {
      sourceOfTruth: LOCAL_RECEIPT_SOURCE_OF_TRUTH,
    }).receipts;
  } catch (error) {
    return [];
  }
}

function parseLegacyLatest(raw) {
  if (!raw) {
    return [];
  }

  try {
    const receipt = normalizeReceiptRecord(JSON.parse(raw), {
      sourceOfTruth: LOCAL_RECEIPT_SOURCE_OF_TRUTH,
    });
    return receipt ? [receipt] : [];
  } catch (error) {
    return [];
  }
}

function writeAll(receipts) {
  safeWriteStorage(
    LOCAL_RECEIPT_STORE_KEY,
    JSON.stringify(
      createReceiptStorageEnvelope(receipts, {
        sourceOfTruth: LOCAL_RECEIPT_SOURCE_OF_TRUTH,
      }),
    ),
  );
  safeRemoveStorage(LEGACY_RECEIPT_LIST_KEY);
  safeRemoveStorage(LEGACY_LATEST_RECEIPT_KEY);
}

function readAll() {
  const currentReceipts = parseStoredList(safeReadStorage(LOCAL_RECEIPT_STORE_KEY));

  if (currentReceipts.length > 0) {
    return currentReceipts;
  }

  const migratedReceipts = normalizeReceiptList([
    ...parseStoredList(safeReadStorage(LEGACY_RECEIPT_LIST_KEY)),
    ...parseLegacyLatest(safeReadStorage(LEGACY_LATEST_RECEIPT_KEY)),
  ]);

  if (migratedReceipts.length === 0) {
    return [];
  }

  writeAll(migratedReceipts);
  return migratedReceipts;
}

export class LocalReceiptStore extends ReceiptStore {
  async saveReceipt(receipt) {
    const canonicalReceipt = normalizeReceiptRecord(receipt, {
      sourceOfTruth: LOCAL_RECEIPT_SOURCE_OF_TRUTH,
    });

    if (!canonicalReceipt) {
      return null;
    }

    const receipts = readAll().filter((entry) => entry.quoteId !== canonicalReceipt.quoteId);
    receipts.unshift(canonicalReceipt);
    writeAll(receipts);
    return canonicalReceipt;
  }

  async getReceiptByQuoteId(quoteId, role = ReceiptRoles.MERCHANT) {
    const normalizedQuoteId = String(quoteId || "");

    if (!normalizedQuoteId) {
      return null;
    }

    const receipt = readAll().find((entry) => entry.quoteId === normalizedQuoteId) || null;
    return projectReceiptForRole(receipt, role, {
      transport: "local",
      sourceOfTruth: LOCAL_RECEIPT_SOURCE_OF_TRUTH,
    });
  }

  async listReceipts(role = ReceiptRoles.MERCHANT) {
    return readAll()
      .map((receipt) =>
        projectReceiptForRole(receipt, role, {
          transport: "local",
          sourceOfTruth: LOCAL_RECEIPT_SOURCE_OF_TRUTH,
        }),
      )
      .filter(Boolean);
  }
}
