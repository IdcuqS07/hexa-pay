import { projectReceiptForRole } from "./receipt-policy.js";
import { ReceiptStore } from "./receipt-store.js";
import {
  createReceiptStorageEnvelope,
  normalizeReceiptRecord,
  parseReceiptStorageEnvelope,
  ReceiptRoles,
} from "./receipt-types.js";

export const MOCK_REGISTRY_RECEIPT_STORE_KEY = "hexapay.privateQuotes.mockRegistry.v1";
const MOCK_REGISTRY_SOURCE_OF_TRUTH = {
  mode: "mock-registry",
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

function readRegistry() {
  const raw = safeReadStorage(MOCK_REGISTRY_RECEIPT_STORE_KEY);

  if (!raw) {
    return [];
  }

  try {
    return parseReceiptStorageEnvelope(JSON.parse(raw), {
      sourceOfTruth: MOCK_REGISTRY_SOURCE_OF_TRUTH,
    }).receipts;
  } catch (error) {
    return [];
  }
}

function writeRegistry(receipts) {
  safeWriteStorage(
    MOCK_REGISTRY_RECEIPT_STORE_KEY,
    JSON.stringify(
      createReceiptStorageEnvelope(receipts, {
        sourceOfTruth: MOCK_REGISTRY_SOURCE_OF_TRUTH,
      }),
    ),
  );
}

export class MockRegistryReceiptStore extends ReceiptStore {
  async saveReceipt(receipt) {
    const canonicalReceipt = normalizeReceiptRecord(receipt, {
      sourceOfTruth: MOCK_REGISTRY_SOURCE_OF_TRUTH,
    });

    if (!canonicalReceipt) {
      return null;
    }

    const receipts = readRegistry().filter((entry) => entry.quoteId !== canonicalReceipt.quoteId);
    receipts.unshift(canonicalReceipt);
    writeRegistry(receipts);
    return canonicalReceipt;
  }

  async getReceiptByQuoteId(quoteId, role = ReceiptRoles.MERCHANT) {
    const normalizedQuoteId = String(quoteId || "");

    if (!normalizedQuoteId) {
      return null;
    }

    const receipt = readRegistry().find((entry) => entry.quoteId === normalizedQuoteId) || null;
    return projectReceiptForRole(receipt, role, {
      transport: "mock-registry",
      sourceOfTruth: MOCK_REGISTRY_SOURCE_OF_TRUTH,
    });
  }

  async listReceipts(role = ReceiptRoles.MERCHANT) {
    return readRegistry()
      .map((receipt) =>
        projectReceiptForRole(receipt, role, {
          transport: "mock-registry",
          sourceOfTruth: MOCK_REGISTRY_SOURCE_OF_TRUTH,
        }),
      )
      .filter(Boolean);
  }
}
