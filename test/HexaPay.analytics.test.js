const { loadFixture, time } = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { expect } = require("chai");
const {
  createComplianceRoom,
  deployHexaPayFixture,
  encrypt128,
  encrypt128Array,
  getTxTimestamp,
  hashText,
  randomPublicKey,
  registerCompany,
  sendAndParseEvent,
  unseal,
  wrapAmount
} = require("./helpers/hexapay");

describe("HexaPay analytics module", function () {
  async function createFixture() {
    return loadFixture(deployHexaPayFixture);
  }

  async function createPayrollSchedule(workflow, employer, employee, amount = 100n) {
    const args = await sendAndParseEvent(
      workflow.connect(employer).createPayrollSchedule(
        employer.address,
        [employee.address],
        await encrypt128Array([amount]),
        3600,
        (await time.latest()) + 100,
        hashText("analytics-payroll")
      ),
      workflow,
      "PayrollScheduleCreated"
    );

    return args.scheduleId;
  }

  async function createInvoice(workflow, issuer, payer, amount, label) {
    const args = await sendAndParseEvent(
      workflow.connect(issuer).createInvoice(
        issuer.address,
        payer.address,
        await encrypt128(amount),
        hashText(label),
        (await time.latest()) + 86400
      ),
      workflow,
      "InvoiceCreated"
    );

    return args.invoiceId;
  }

  async function createEscrow(escrow, buyer, seller, arbiter, amount, label, expiryOffset = 3600) {
    const args = await sendAndParseEvent(
      escrow.connect(buyer).createEscrow(
        seller.address,
        arbiter.address,
        await encrypt128(amount),
        hashText(label),
        (await time.latest()) + expiryOffset
      ),
      escrow,
      "EscrowCreated"
    );

    return args.escrowId;
  }

  it("records cumulative spend and returns a sealed windowed spend summary", async function () {
    const { analytics, hexaPay, owner, seller, token } = await createFixture();
    const publicKey = randomPublicKey();

    await wrapAmount(token, hexaPay, owner, owner, 100n);
    await hexaPay.connect(owner).createPayment(seller.address, await encrypt128(10n), hashText("spend-1"));
    await time.increase(1);
    const secondTimestamp = await getTxTimestamp(
      hexaPay.connect(owner).createPayment(seller.address, await encrypt128(20n), hashText("spend-2"))
    );

    const sealedTotalSpend = await analytics
      .connect(owner)
      .getSealedCompanySpend(owner.address, 0, 0, publicKey);
    const sealedWindowSpend = await analytics
      .connect(owner)
      .getSealedCompanySpend(owner.address, secondTimestamp, 0, publicKey);

    expect(await unseal(analytics, sealedTotalSpend, owner)).to.equal(30n);
    expect(await unseal(analytics, sealedWindowSpend, owner)).to.equal(20n);
  });

  it("records the latest payroll run total for a schedule", async function () {
    const { analytics, employee, hexaPay, owner, token, workflow } = await createFixture();
    const publicKey = randomPublicKey();

    await registerCompany(hexaPay, owner, "analytics-payroll");
    await wrapAmount(token, hexaPay, owner, owner, 200n);

    const scheduleId = await createPayrollSchedule(workflow, owner, employee, 100n);
    const schedule = await workflow.getPayrollSchedule(scheduleId);
    await time.increaseTo(Number(schedule.nextPaymentAt) + 1);
    await workflow.connect(owner).executePayroll(scheduleId);

    const sealedRunTotal = await analytics
      .connect(owner)
      .getSealedPayrollRunTotal(scheduleId, publicKey);

    expect(await unseal(analytics, sealedRunTotal, owner)).to.equal(100n);
  });

  it("updates company invoice exposure on create, pay, reject, and cancel", async function () {
    const { analytics, auditor, hexaPay, owner, payer, seller, token, workflow } =
      await createFixture();
    const publicKey = randomPublicKey();

    await registerCompany(hexaPay, owner, "analytics-invoice");
    await wrapAmount(token, hexaPay, owner, payer, 200n);

    const invoiceA = await createInvoice(workflow, owner, payer, 60n, "invoice-a");
    const invoiceB = await createInvoice(workflow, owner, seller, 30n, "invoice-b");
    const invoiceC = await createInvoice(workflow, owner, auditor, 20n, "invoice-c");

    let sealedExposure = await analytics
      .connect(owner)
      .getSealedInvoiceExposure(owner.address, publicKey);
    expect(await unseal(analytics, sealedExposure, owner)).to.equal(110n);

    await workflow.connect(payer).approveInvoice(invoiceA);
    await workflow.connect(payer).payInvoice(invoiceA, await encrypt128(20n));

    sealedExposure = await analytics
      .connect(owner)
      .getSealedInvoiceExposure(owner.address, publicKey);
    expect(await unseal(analytics, sealedExposure, owner)).to.equal(90n);

    await workflow.connect(seller).rejectInvoice(invoiceB, hashText("reject-b"));
    sealedExposure = await analytics
      .connect(owner)
      .getSealedInvoiceExposure(owner.address, publicKey);
    expect(await unseal(analytics, sealedExposure, owner)).to.equal(60n);

    await workflow.connect(owner).cancelInvoice(invoiceC);
    sealedExposure = await analytics
      .connect(owner)
      .getSealedInvoiceExposure(owner.address, publicKey);
    expect(await unseal(analytics, sealedExposure, owner)).to.equal(40n);
  });

  it("updates company escrow exposure on fund, release, refund, resolve, and expiry close", async function () {
    const { analytics, arbiter, escrow, hexaPay, owner, seller, token } = await createFixture();
    const publicKey = randomPublicKey();

    await wrapAmount(token, hexaPay, owner, owner, 500n);

    const escrowA = await createEscrow(escrow, owner, seller, arbiter, 60n, "escrow-a");
    await escrow.connect(owner).fundEscrow(escrowA, await encrypt128(60n));
    let sealedExposure = await analytics
      .connect(owner)
      .getSealedEscrowExposure(owner.address, publicKey);
    expect(await unseal(analytics, sealedExposure, owner)).to.equal(60n);

    await escrow.connect(owner).releaseEscrow(escrowA, await encrypt128(20n));
    sealedExposure = await analytics
      .connect(owner)
      .getSealedEscrowExposure(owner.address, publicKey);
    expect(await unseal(analytics, sealedExposure, owner)).to.equal(40n);

    await escrow.connect(seller).refundEscrow(escrowA, await encrypt128(10n));
    sealedExposure = await analytics
      .connect(owner)
      .getSealedEscrowExposure(owner.address, publicKey);
    expect(await unseal(analytics, sealedExposure, owner)).to.equal(30n);

    const escrowB = await createEscrow(escrow, owner, seller, arbiter, 40n, "escrow-b");
    await escrow.connect(owner).fundEscrow(escrowB, await encrypt128(40n));
    sealedExposure = await analytics
      .connect(owner)
      .getSealedEscrowExposure(owner.address, publicKey);
    expect(await unseal(analytics, sealedExposure, owner)).to.equal(70n);

    await escrow.connect(owner).openDispute(escrowB, hashText("dispute-b"));
    await escrow.connect(arbiter).resolveDispute(escrowB, 2500, 7500, hashText("ruling-b"));
    sealedExposure = await analytics
      .connect(owner)
      .getSealedEscrowExposure(owner.address, publicKey);
    expect(await unseal(analytics, sealedExposure, owner)).to.equal(30n);

    const escrowC = await createEscrow(escrow, owner, seller, arbiter, 20n, "escrow-c", 10);
    await escrow.connect(owner).fundEscrow(escrowC, await encrypt128(20n));
    sealedExposure = await analytics
      .connect(owner)
      .getSealedEscrowExposure(owner.address, publicKey);
    expect(await unseal(analytics, sealedExposure, owner)).to.equal(50n);

    await time.increase(20);
    await escrow.connect(owner).closeExpiredEscrow(escrowC);
    sealedExposure = await analytics
      .connect(owner)
      .getSealedEscrowExposure(owner.address, publicKey);
    expect(await unseal(analytics, sealedExposure, owner)).to.equal(30n);
  });

  it("lets company operators create analytics checkpoints", async function () {
    const { analytics, hexaPay, owner, signer } = await createFixture();

    await registerCompany(hexaPay, owner, "analytics-checkpoint");
    await hexaPay.connect(owner).addSigner(signer.address);

    const checkpointArgs = await sendAndParseEvent(
      analytics.connect(signer).checkpointAnalytics(owner.address, hashText("checkpoint-1")),
      analytics,
      "AnalyticsCheckpointCreated"
    );

    const checkpoints = await analytics.connect(owner).getCompanyCheckpoints(owner.address);
    const checkpoint = await analytics.getAnalyticsCheckpoint(checkpointArgs.checkpointId);

    expect(checkpoints).to.deep.equal([checkpointArgs.checkpointId]);
    expect(checkpoint.company).to.equal(owner.address);
  });

  it("restricts analytics reads to subjects, operators, and Analytics-scoped auditors", async function () {
    const { analytics, auditor, compliance, hexaPay, outsider, owner, seller, signer, token } =
      await createFixture();

    await registerCompany(hexaPay, owner, "analytics-access");
    await hexaPay.connect(owner).addSigner(signer.address);
    await wrapAmount(token, hexaPay, owner, owner, 50n);
    await hexaPay.connect(owner).createPayment(seller.address, await encrypt128(10n), hashText("access"));

    await expect(
      analytics.connect(outsider).getCompanyCheckpoints(owner.address)
    ).to.be.revertedWithCustomError(analytics, "NoAnalyticsAccess");

    await sendAndParseEvent(
      analytics.connect(owner).checkpointAnalytics(owner.address, hashText("access-checkpoint")),
      analytics,
      "AnalyticsCheckpointCreated"
    );

    const operatorCheckpoints = await analytics
      .connect(signer)
      .getCompanyCheckpoints(owner.address);
    expect(operatorCheckpoints).to.have.lengthOf(1);

    await createComplianceRoom(
      hexaPay,
      compliance,
      owner,
      owner,
      auditor,
      [5],
      3600,
      "analytics-room"
    );

    const auditorCheckpoints = await analytics
      .connect(auditor)
      .getCompanyCheckpoints(owner.address);
    expect(auditorCheckpoints).to.have.lengthOf(1);
  });
});
