const { loadFixture, time } = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { expect } = require("chai");
const {
  createComplianceRoom,
  deployHexaPayFixture,
  encrypt128,
  encrypt128Array,
  hashText,
  randomPublicKey,
  registerCompany,
  sendAndParseEvent,
  unseal,
  wrapAmount
} = require("./helpers/hexapay");

describe("HexaPay invoices", function () {
  async function createInvoiceFixture() {
    const fixture = await loadFixture(deployHexaPayFixture);
    const { hexaPay, owner } = fixture;

    await registerCompany(hexaPay, owner, "issuer");

    return fixture;
  }

  async function createInvoiceContext(totalAmount = 100n) {
    const fixture = await createInvoiceFixture();
    const { owner, payer, workflow } = fixture;
    const dueAt = (await time.latest()) + 86400;
    const metadataHash = hashText(`invoice:${totalAmount.toString()}`);
    const encryptedAmount = await encrypt128(totalAmount);

    const invoiceArgs = await sendAndParseEvent(
      workflow.connect(owner).createInvoice(
        owner.address,
        payer.address,
        encryptedAmount,
        metadataHash,
        dueAt
      ),
      workflow,
      "InvoiceCreated"
    );

    return {
      ...fixture,
      dueAt,
      encryptedAmount,
      invoiceId: invoiceArgs.invoiceId,
      metadataHash
    };
  }

  async function payInvoiceAndGetPaymentId(workflow, payer, invoiceId, amount) {
    const paymentArgs = await sendAndParseEvent(
      workflow.connect(payer).payInvoice(invoiceId, await encrypt128(amount)),
      workflow,
      "InvoicePaymentApplied"
    );

    return paymentArgs.paymentId;
  }

  it("creates a confidential invoice for a registered company operator", async function () {
    const { invoiceId, owner, payer, workflow } = await createInvoiceContext();
    const invoice = await workflow.connect(owner).getInvoice(invoiceId);
    const companyInvoices = await workflow.connect(owner).getCompanyInvoices(owner.address);
    const payerInvoices = await workflow.connect(payer).getPayerInvoices(payer.address);

    expect(invoice.issuer).to.equal(owner.address);
    expect(invoice.payer).to.equal(payer.address);
    expect(invoice.company).to.equal(owner.address);
    expect(invoice.status).to.equal(0n);
    expect(invoice.paymentCount).to.equal(0n);
    expect(companyInvoices).to.deep.equal([invoiceId]);
    expect(payerInvoices).to.deep.equal([invoiceId]);
  });

  it("lets the payer approve a pending invoice", async function () {
    const { invoiceId, payer, workflow } = await createInvoiceContext();

    await workflow.connect(payer).approveInvoice(invoiceId);

    const invoice = await workflow.connect(payer).getInvoice(invoiceId);
    expect(invoice.status).to.equal(1n);
  });

  it("lets the payer reject a pending invoice with a reason hash", async function () {
    const { invoiceId, payer, workflow } = await createInvoiceContext();

    await workflow.connect(payer).rejectInvoice(invoiceId, hashText("invoice-rejected"));

    const invoice = await workflow.connect(payer).getInvoice(invoiceId);
    expect(invoice.status).to.equal(2n);
  });

  it("records encrypted line items before any payment is applied", async function () {
    const { invoiceId, owner, workflow } = await createInvoiceContext();
    const amounts = await encrypt128Array([40n, 60n]);
    const labels = [hashText("design"), hashText("implementation")];
    const publicKey = randomPublicKey();

    await workflow.connect(owner).addInvoiceLineItems(invoiceId, amounts, labels);

    expect(await workflow.connect(owner).getInvoiceLineItemCount(invoiceId)).to.equal(2n);
    expect(await workflow.connect(owner).getInvoiceLineItemLabelHash(invoiceId, 0)).to.equal(labels[0]);

    const sealedTotal = await workflow.connect(owner).getSealedInvoiceAmount(invoiceId, publicKey);
    const sealedOutstanding = await workflow
      .connect(owner)
      .getSealedInvoiceOutstanding(invoiceId, publicKey);
    const sealedLineItem = await workflow
      .connect(owner)
      .getSealedInvoiceLineItemAmount(invoiceId, 0, publicKey);

    expect(await unseal(workflow, sealedTotal, owner)).to.equal(100n);
    expect(await unseal(workflow, sealedOutstanding, owner)).to.equal(100n);
    expect(await unseal(workflow, sealedLineItem, owner)).to.equal(40n);
  });

  it("applies a partial invoice payment and keeps the invoice open", async function () {
    const { hexaPay, invoiceId, owner, payer, token, workflow } = await createInvoiceContext();
    const publicKey = randomPublicKey();

    await workflow.connect(payer).approveInvoice(invoiceId);
    await wrapAmount(token, hexaPay, owner, payer, 500n);

    const paymentId = await payInvoiceAndGetPaymentId(workflow, payer, invoiceId, 40n);
    const invoice = await workflow.connect(owner).getInvoice(invoiceId);
    const sealedOutstanding = await workflow
      .connect(owner)
      .getSealedInvoiceOutstanding(invoiceId, publicKey);
    const payment = await hexaPay.getPaymentMetadata(paymentId);

    expect(invoice.status).to.equal(3n);
    expect(invoice.paymentCount).to.equal(1n);
    expect(await unseal(workflow, sealedOutstanding, owner)).to.equal(60n);
    expect(payment.kind).to.equal(2n);
  });

  it("marks an invoice as paid when outstanding reaches zero", async function () {
    const { hexaPay, invoiceId, owner, payer, token, workflow } = await createInvoiceContext();
    const publicKey = randomPublicKey();

    await workflow.connect(payer).approveInvoice(invoiceId);
    await wrapAmount(token, hexaPay, owner, payer, 500n);
    await payInvoiceAndGetPaymentId(workflow, payer, invoiceId, 100n);

    const invoice = await workflow.connect(owner).getInvoice(invoiceId);
    const sealedOutstanding = await workflow
      .connect(owner)
      .getSealedInvoiceOutstanding(invoiceId, publicKey);

    expect(invoice.status).to.equal(4n);
    expect(await unseal(workflow, sealedOutstanding, owner)).to.equal(0n);
  });

  it("blocks paying more than the encrypted outstanding balance", async function () {
    const { hexaPay, invoiceId, owner, payer, token, workflow } = await createInvoiceContext();

    await workflow.connect(payer).approveInvoice(invoiceId);
    await wrapAmount(token, hexaPay, owner, payer, 500n);

    await expect(
      workflow.connect(payer).payInvoice(invoiceId, await encrypt128(120n))
    ).to.be.reverted;
  });

  it("links invoice payments back to created payment ids", async function () {
    const { hexaPay, invoiceId, owner, payer, token, workflow } = await createInvoiceContext();

    await workflow.connect(payer).approveInvoice(invoiceId);
    await wrapAmount(token, hexaPay, owner, payer, 500n);

    const paymentId = await payInvoiceAndGetPaymentId(workflow, payer, invoiceId, 100n);
    const paymentIds = await workflow.connect(owner).getInvoicePayments(invoiceId);
    const payment = await hexaPay.getPaymentMetadata(paymentId);

    expect(paymentIds).to.deep.equal([paymentId]);
    expect(payment.paymentId).to.equal(paymentId);
    expect(payment.kind).to.equal(2n);
  });

  it("restricts sealed invoice reads to issuer, payer, company operators, and granted auditors", async function () {
    const { auditor, invoiceId, outsider, owner, payer, workflow, hexaPay, compliance } =
      await createInvoiceContext();
    const publicKey = randomPublicKey();

    await expect(
      workflow.connect(outsider).getInvoice(invoiceId)
    ).to.be.revertedWithCustomError(workflow, "NoInvoiceAccess");

    await createComplianceRoom(
      hexaPay,
      compliance,
      owner,
      owner,
      auditor,
      [2],
      3600,
      "invoice-room"
    );

    const issuerInvoice = await workflow.connect(owner).getInvoice(invoiceId);
    const payerInvoice = await workflow.connect(payer).getInvoice(invoiceId);
    const sealedAmount = await workflow
      .connect(auditor)
      .getSealedInvoiceAmount(invoiceId, publicKey);

    expect(issuerInvoice.company).to.equal(owner.address);
    expect(payerInvoice.payer).to.equal(payer.address);
    expect(await unseal(workflow, sealedAmount, auditor)).to.equal(100n);
  });
});
