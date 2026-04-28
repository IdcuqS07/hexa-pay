const { expect } = require("chai");
const {
  isInvoiceAccessRestrictedError,
} = require("../app/payment-reconciliation-invoice-context.cjs");

describe("payment reconciliation invoice context", function () {
  it("treats NoInvoiceAccess call exceptions as access-restricted reads", function () {
    const error = {
      code: "CALL_EXCEPTION",
      shortMessage: "execution reverted",
      message: "execution reverted: NoInvoiceAccess()",
    };

    expect(isInvoiceAccessRestrictedError(error)).to.equal(true);
  });

  it("does not treat unrelated errors as access-restricted reads", function () {
    const error = {
      code: "CALL_EXCEPTION",
      shortMessage: "execution reverted",
      message: "execution reverted: UnknownInvoice()",
    };

    expect(isInvoiceAccessRestrictedError(error)).to.equal(false);
  });
});
