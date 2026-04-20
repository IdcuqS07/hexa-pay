import {
  MockRegistryReceiptStore,
  MOCK_REGISTRY_RECEIPT_STORE_KEY,
} from "./receipt-store-mock-registry.js";
import {
  ApiReceiptStore,
  API_RECEIPT_STORE_SYNC_KEY,
} from "./receipt-store-api.js";
import { LocalReceiptStore, LOCAL_RECEIPT_STORE_KEY } from "./receipt-store-local.js";

export const DEFAULT_RECEIPT_STORE_MODE = "local";

export function createReceiptStore(mode = DEFAULT_RECEIPT_STORE_MODE, options = {}) {
  switch (mode) {
    case "mock-api":
      return new ApiReceiptStore(options);
    case "mock-registry":
      return new MockRegistryReceiptStore();
    case "local":
    default:
      return new LocalReceiptStore();
  }
}

export function getReceiptStoreChangeKey(mode = DEFAULT_RECEIPT_STORE_MODE) {
  switch (mode) {
    case "mock-api":
      return API_RECEIPT_STORE_SYNC_KEY;
    case "mock-registry":
      return MOCK_REGISTRY_RECEIPT_STORE_KEY;
    case "local":
      return LOCAL_RECEIPT_STORE_KEY;
    default:
      return "";
  }
}
