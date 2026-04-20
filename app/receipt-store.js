export class ReceiptStore {
  async saveReceipt(_receipt) {
    throw new Error("saveReceipt not implemented");
  }

  async getReceiptByQuoteId(_quoteId, _role = "merchant") {
    throw new Error("getReceiptByQuoteId not implemented");
  }

  async listReceipts(_role = "merchant") {
    throw new Error("listReceipts not implemented");
  }
}
