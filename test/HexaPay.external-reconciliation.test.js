const { loadFixture, time } = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { expect } = require("chai");
const hre = require("hardhat");
const { ethers } = hre;
const {
  createPermission,
  deployHexaPayFixture,
  encrypt128,
  hashText,
  randomPublicKey,
  registerCompany,
  sendAndParseEvent,
  unseal,
  wrapAmount,
} = require("./helpers/hexapay");

describe("HexaPay external settlement reconciliation", function () {
  async function createExternalSettlementContext(totalAmount = 100n) {
    const fixture = await loadFixture(deployHexaPayFixture);
    const { hexaPay, owner, payer, workflow } = fixture;

    await registerCompany(hexaPay, owner, "merchant");

    const dueAt = (await time.latest()) + 86400;
    const metadataHash = hashText(`external-invoice:${totalAmount.toString()}`);
    const invoiceArgs = await sendAndParseEvent(
      workflow.connect(owner).createInvoice(
        owner.address,
        payer.address,
        await encrypt128(totalAmount),
        metadataHash,
        dueAt,
      ),
      workflow,
      "InvoiceCreated",
    );

    await workflow.connect(payer).approveInvoice(invoiceArgs.invoiceId);

    return {
      ...fixture,
      dueAt,
      invoiceId: invoiceArgs.invoiceId,
      metadataHash,
    };
  }

  it("records an external settlement receipt only once through the bridge", async function () {
    const { owner, payer, token, workflow, invoiceId } = await createExternalSettlementContext();
    const HexaPayUSDCExecutor = await ethers.getContractFactory("HexaPayUSDCExecutor");
    const executor = await HexaPayUSDCExecutor.deploy(owner.address);
    await executor.waitForDeployment();

    const HexaPayExternalSettlementBridge = await ethers.getContractFactory(
      "HexaPayExternalSettlementBridge",
    );
    const bridge = await HexaPayExternalSettlementBridge.deploy(
      owner.address,
      await workflow.getAddress(),
      await executor.getAddress(),
    );
    await bridge.waitForDeployment();

    await workflow.connect(owner).setExternalSettlementBridge(await bridge.getAddress());
    await token.connect(owner).transfer(payer.address, 60n);
    await token.connect(payer).approve(await executor.getAddress(), 60n);

    const intentHash = hashText("external-intent:record");
    const requestIdHash = hashText("external-request:record");
    const executionTx = await executor.connect(owner).executePayment(
      intentHash,
      requestIdHash,
      await token.getAddress(),
      payer.address,
      owner.address,
      60n,
    );
    const executionReceipt = await executionTx.wait();

    const settlementId = await bridge.buildSettlementId(intentHash, requestIdHash);

    await expect(
      bridge.connect(owner).recordExternalSettlementReceipt(
        invoiceId,
        intentHash,
        requestIdHash,
        executionTx.hash,
        payer.address,
        owner.address,
        await token.getAddress(),
        60n,
      ),
    )
      .to.emit(bridge, "ExternalSettlementReceiptRecorded")
      .withArgs(
        settlementId,
        invoiceId,
        intentHash,
        requestIdHash,
        executionTx.hash,
        payer.address,
        owner.address,
        await token.getAddress(),
        60n,
        owner.address,
      );

    expect(await bridge.settlementRecorded(settlementId)).to.equal(true);
    expect(await bridge.settlementInvoiceId(settlementId)).to.equal(invoiceId);

    const settlementIds = await workflow.connect(owner).getInvoiceExternalSettlementIds(invoiceId);
    const receipt = await workflow.connect(owner).getExternalSettlementReceipt(settlementId);

    expect(settlementIds).to.deep.equal([settlementId]);
    expect(receipt.invoiceId).to.equal(invoiceId);
    expect(receipt.intentHash).to.equal(intentHash);
    expect(receipt.observedAmount).to.equal(60n);
    expect(receipt.applied).to.equal(false);

    await expect(
      bridge.connect(owner).recordExternalSettlementReceipt(
        invoiceId,
        intentHash,
        requestIdHash,
        executionTx.hash,
        payer.address,
        owner.address,
        await token.getAddress(),
        60n,
      ),
    ).to.be.revertedWithCustomError(bridge, "SettlementAlreadyRecorded");
  });

  it("applies a recorded external receipt without creating an internal rail debit", async function () {
    const { hexaPay, owner, payer, token, workflow, invoiceId } =
      await createExternalSettlementContext();
    const publicKey = randomPublicKey();
    const payerPermission = await createPermission(hexaPay, payer);
    const ownerPermission = await createPermission(hexaPay, owner);

    await wrapAmount(token, hexaPay, owner, payer, 300n);
    const payerInternalBefore = await hexaPay.connect(payer).getBalance(payerPermission);
    const ownerInternalBefore = await hexaPay.connect(owner).getBalance(ownerPermission);

    const HexaPayUSDCExecutor = await ethers.getContractFactory("HexaPayUSDCExecutor");
    const executor = await HexaPayUSDCExecutor.deploy(owner.address);
    await executor.waitForDeployment();

    const HexaPayExternalSettlementBridge = await ethers.getContractFactory(
      "HexaPayExternalSettlementBridge",
    );
    const bridge = await HexaPayExternalSettlementBridge.deploy(
      owner.address,
      await workflow.getAddress(),
      await executor.getAddress(),
    );
    await bridge.waitForDeployment();

    await workflow.connect(owner).setExternalSettlementBridge(await bridge.getAddress());
    await token.connect(owner).transfer(payer.address, 60n);
    await token.connect(payer).approve(await executor.getAddress(), 60n);

    const intentHash = hashText("external-intent:apply");
    const requestIdHash = hashText("external-request:apply");
    const executionTx = await executor.connect(owner).executePayment(
      intentHash,
      requestIdHash,
      await token.getAddress(),
      payer.address,
      owner.address,
      60n,
    );
    const executionReceipt = await executionTx.wait();

    await bridge.connect(owner).recordExternalSettlementReceipt(
      invoiceId,
      intentHash,
      requestIdHash,
      executionTx.hash,
      payer.address,
      owner.address,
      await token.getAddress(),
      60n,
    );

    const settlementId = await bridge.buildSettlementId(intentHash, requestIdHash);
    const invoicePaymentsBefore = await workflow.connect(owner).getInvoicePayments(invoiceId);
    expect(invoicePaymentsBefore).to.deep.equal([]);

    await expect(
      workflow.connect(owner).applyExternalSettlementReceipt(settlementId, 60n),
    )
      .to.emit(workflow, "InvoiceExternalSettlementApplied")
      .withArgs(invoiceId, settlementId, 60n, owner.address);

    const invoice = await workflow.connect(owner).getInvoice(invoiceId);
    const invoicePaymentsAfter = await workflow.connect(owner).getInvoicePayments(invoiceId);
    const receipt = await workflow.connect(owner).getExternalSettlementReceipt(settlementId);
    const sealedOutstanding = await workflow
      .connect(owner)
      .getSealedInvoiceOutstanding(invoiceId, publicKey);
    const payerInternalAfter = await hexaPay.connect(payer).getBalance(payerPermission);
    const ownerInternalAfter = await hexaPay.connect(owner).getBalance(ownerPermission);

    expect(invoice.status).to.equal(3n);
    expect(invoice.paymentCount).to.equal(0n);
    expect(invoicePaymentsAfter).to.deep.equal([]);
    expect(receipt.applied).to.equal(true);
    expect(receipt.appliedAmount).to.equal(60n);
    expect(await unseal(workflow, sealedOutstanding, owner)).to.equal(40n);
    expect(payerInternalAfter).to.equal(payerInternalBefore);
    expect(ownerInternalAfter).to.equal(ownerInternalBefore);

    await expect(
      workflow.connect(owner).applyExternalSettlementReceipt(settlementId, 60n),
    ).to.be.revertedWithCustomError(workflow, "ExternalSettlementAlreadyApplied");
  });
});
