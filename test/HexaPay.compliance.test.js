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

describe("HexaPay compliance workspace", function () {
  async function createFixture() {
    return loadFixture(deployHexaPayFixture);
  }

  async function createInvoice(workflow, issuer, payer, amount = 100n) {
    const args = await sendAndParseEvent(
      workflow.connect(issuer).createInvoice(
        issuer.address,
        payer.address,
        await encrypt128(amount),
        hashText("compliance-invoice"),
        (await time.latest()) + 86400
      ),
      workflow,
      "InvoiceCreated"
    );

    return args.invoiceId;
  }

  async function createPayrollSchedule(workflow, employer, employee, amount = 100n) {
    const args = await sendAndParseEvent(
      workflow.connect(employer).createPayrollSchedule(
        employer.address,
        [employee.address],
        await encrypt128Array([amount]),
        3600,
        (await time.latest()) + 100,
        hashText("compliance-payroll")
      ),
      workflow,
      "PayrollScheduleCreated"
    );

    return args.scheduleId;
  }

  async function createEscrow(escrow, buyer, seller, arbiter, amount = 100n) {
    const args = await sendAndParseEvent(
      escrow.connect(buyer).createEscrow(
        seller.address,
        arbiter.address,
        await encrypt128(amount),
        hashText("compliance-escrow"),
        (await time.latest()) + 3600
      ),
      escrow,
      "EscrowCreated"
    );

    return args.escrowId;
  }

  it("creates a scoped room for an authorized auditor", async function () {
    const { auditor, compliance, hexaPay, owner } = await createFixture();

    const roomId = await createComplianceRoom(
      hexaPay,
      compliance,
      owner,
      owner,
      auditor,
      [0, 2],
      3600,
      "balance-invoice-room"
    );

    const room = await compliance.getComplianceRoom(roomId);
    expect(room.subject).to.equal(owner.address);
    expect(room.auditor).to.equal(auditor.address);
    expect(room.active).to.equal(true);
  });

  it("extends and closes a compliance room", async function () {
    const { auditor, compliance, hexaPay, owner } = await createFixture();

    const roomId = await createComplianceRoom(
      hexaPay,
      compliance,
      owner,
      owner,
      auditor,
      [0],
      3600,
      "extend-room"
    );

    const roomBefore = await compliance.getComplianceRoom(roomId);
    await compliance.connect(owner).extendComplianceRoom(roomId, 7200);

    const roomAfterExtend = await compliance.getComplianceRoom(roomId);
    expect(roomAfterExtend.expiresAt).to.be.greaterThan(roomBefore.expiresAt);

    await compliance.connect(owner).closeComplianceRoom(roomId);

    const roomAfterClose = await compliance.getComplianceRoom(roomId);
    expect(roomAfterClose.active).to.equal(false);
  });

  it("blocks unauthorized auditors from receiving a room", async function () {
    const { auditor, compliance, owner } = await createFixture();

    await expect(
      compliance.connect(owner).createComplianceRoom(
        owner.address,
        auditor.address,
        [0],
        3600,
        hashText("unauthorized-auditor")
      )
    ).to.be.revertedWithCustomError(compliance, "InvalidAuditor");
  });

  it("lets only the room auditor add room attestations", async function () {
    const { auditor, compliance, hexaPay, owner } = await createFixture();

    const roomId = await createComplianceRoom(
      hexaPay,
      compliance,
      owner,
      owner,
      auditor,
      [0],
      3600,
      "attestation-room"
    );

    await expect(
      compliance.connect(owner).addAuditAttestation(roomId, hashText("owner-attestation"))
    ).to.be.revertedWithCustomError(compliance, "NotRoomAuditor");

    await compliance
      .connect(auditor)
      .addAuditAttestation(roomId, hashText("auditor-attestation"));

    const attestations = await compliance.getRoomAttestations(roomId);
    expect(attestations).to.have.lengthOf(1);
    expect(attestations[0].auditor).to.equal(auditor.address);
    expect(attestations[0].verified).to.equal(true);
  });

  it("tracks room artifacts and access logs", async function () {
    const { auditor, compliance, hexaPay, owner } = await createFixture();

    const roomId = await createComplianceRoom(
      hexaPay,
      compliance,
      owner,
      owner,
      auditor,
      [0, 2],
      3600,
      "artifact-room"
    );

    await compliance.connect(owner).addComplianceArtifact(roomId, hashText("artifact-1"));
    await compliance.connect(auditor).recordComplianceAccess(roomId, 2, hashText("invoice-read"));

    const artifacts = await compliance.getRoomArtifacts(roomId);
    const accessLogs = await compliance.getRoomAccessLogs(roomId);

    expect(artifacts).to.have.lengthOf(1);
    expect(artifacts[0].actor).to.equal(owner.address);
    expect(accessLogs).to.have.lengthOf(1);
    expect(accessLogs[0].actor).to.equal(auditor.address);
    expect(accessLogs[0].scope).to.equal(2n);
  });

  it("limits balance reads to auditors with Balance scope", async function () {
    const { auditor, compliance, hexaPay, owner, token } = await createFixture();
    const publicKey = randomPublicKey();

    await wrapAmount(token, hexaPay, owner, owner, 50n);

    await expect(
      hexaPay.connect(auditor).getSealedUserBalance(owner.address, publicKey)
    ).to.be.revertedWith("No compliance access");

    await createComplianceRoom(
      hexaPay,
      compliance,
      owner,
      owner,
      auditor,
      [0],
      3600,
      "balance-room"
    );

    const sealedBalance = await hexaPay
      .connect(auditor)
      .getSealedUserBalance(owner.address, publicKey);

    expect(await unseal(hexaPay, sealedBalance, auditor)).to.equal(50n);
  });

  it("limits invoice reads to auditors with Invoice scope", async function () {
    const { auditor, compliance, hexaPay, owner, payer, workflow } = await createFixture();
    const publicKey = randomPublicKey();

    await registerCompany(hexaPay, owner, "invoice-company");
    const invoiceId = await createInvoice(workflow, owner, payer);

    await expect(
      workflow.connect(auditor).getSealedInvoiceAmount(invoiceId, publicKey)
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

    const sealedAmount = await workflow
      .connect(auditor)
      .getSealedInvoiceAmount(invoiceId, publicKey);

    expect(await unseal(workflow, sealedAmount, auditor)).to.equal(100n);
  });

  it("limits payroll reads to auditors with Payroll scope", async function () {
    const { auditor, compliance, employee, hexaPay, owner, workflow } = await createFixture();
    const publicKey = randomPublicKey();

    await registerCompany(hexaPay, owner, "payroll-company");
    const scheduleId = await createPayrollSchedule(workflow, owner, employee);

    await expect(
      workflow.connect(auditor).getSealedPayrollAmount(scheduleId, 0, publicKey)
    ).to.be.revertedWithCustomError(workflow, "NoPayrollAccess");

    await createComplianceRoom(
      hexaPay,
      compliance,
      owner,
      owner,
      auditor,
      [3],
      3600,
      "payroll-room"
    );

    const sealedPayroll = await workflow
      .connect(auditor)
      .getSealedPayrollAmount(scheduleId, 0, publicKey);

    expect(await unseal(workflow, sealedPayroll, auditor)).to.equal(100n);
  });

  it("limits escrow reads to auditors with Escrow scope", async function () {
    const { arbiter, auditor, compliance, escrow, hexaPay, owner, seller } =
      await createFixture();
    const publicKey = randomPublicKey();

    const escrowId = await createEscrow(escrow, owner, seller, arbiter);

    await expect(
      escrow.connect(auditor).getSealedEscrowTotal(escrowId, publicKey)
    ).to.be.revertedWithCustomError(escrow, "NoEscrowAccess");

    await createComplianceRoom(
      hexaPay,
      compliance,
      owner,
      owner,
      auditor,
      [4],
      3600,
      "escrow-room"
    );

    const sealedTotal = await escrow
      .connect(auditor)
      .getSealedEscrowTotal(escrowId, publicKey);

    expect(await unseal(escrow, sealedTotal, auditor)).to.equal(100n);
  });
});
