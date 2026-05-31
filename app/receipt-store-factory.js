import {
  MockRegistryReceiptStore,
  MOCK_REGISTRY_RECEIPT_STORE_KEY,
} from "./receipt-store-mock-registry.js";
import {
  ApiReceiptStore,
  API_RECEIPT_STORE_SYNC_KEY,
} from "./receipt-store-api.js";
import { LocalReceiptStore, LOCAL_RECEIPT_STORE_KEY } from "./receipt-store-local.js";
import { normalizePrivateQuoteStoreMode } from "./config.js";

export const DEFAULT_RECEIPT_STORE_MODE = "api";

export function createReceiptStore(mode = DEFAULT_RECEIPT_STORE_MODE, options = {}) {
  switch (normalizePrivateQuoteStoreMode(mode)) {
    case "api":
      return new ApiReceiptStore(options);
    case "registry":
      return new MockRegistryReceiptStore();
    case "local":
    default:
      return new LocalReceiptStore();
  }
}

export function getReceiptStoreChangeKey(mode = DEFAULT_RECEIPT_STORE_MODE) {
  switch (normalizePrivateQuoteStoreMode(mode)) {
    case "api":
      return API_RECEIPT_STORE_SYNC_KEY;
    case "registry":
      return MOCK_REGISTRY_RECEIPT_STORE_KEY;
    case "local":
      return LOCAL_RECEIPT_STORE_KEY;
    default:
      return "";
  }
}
