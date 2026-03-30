const { loadFixture } = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { expect } = require("chai");
const {
  createPermission,
  deployHexaPayFixture,
  encrypt128,
  hashText,
  randomPublicKey,
  sendAndParseEvent,
  unseal,
  wrapAmount
} = require("./helpers/hexapay");

describe("HexaPay core rail", function () {
  async function createFixture() {
    return loadFixture(deployHexaPayFixture);
  }

  it("wraps public settlement tokens into confidential balance and vault backing", async function () {
    const { hexaPay, owner, token } = await createFixture();

    await wrapAmount(token, hexaPay, owner, owner, 100n);

    const ownerPermission = await createPermission(hexaPay, owner);

    expect(await hexaPay.connect(owner).getBalance(ownerPermission)).to.equal(100n);
    expect(await hexaPay.getBackingBalance()).to.equal(100n);
    expect(await token.balanceOf(await hexaPay.vault())).to.equal(100n);
  });

  it("unwraps encrypted balances back into the settlement token", async function () {
    const { hexaPay, owner, token } = await createFixture();

    await wrapAmount(token, hexaPay, owner, owner, 100n);
    await hexaPay.connect(owner).unwrap(await encrypt128(40n));

    const ownerPermission = await createPermission(hexaPay, owner);

    expect(await hexaPay.connect(owner).getBalance(ownerPermission)).to.equal(60n);
    expect(await hexaPay.getBackingBalance()).to.equal(60n);
    expect(await token.balanceOf(await hexaPay.vault())).to.equal(60n);
  });

  it("creates a private payment, charges the platform fee, and records analytics spend", async function () {
    const { analytics, employee, hexaPay, owner, token, treasury } = await createFixture();
    const publicKey = randomPublicKey();

    await wrapAmount(token, hexaPay, owner, owner, 200n);

    const paymentArgs = await sendAndParseEvent(
      hexaPay.connect(owner).createPayment(
        employee.address,
        await encrypt128(100n),
        hashText("salary-advance")
      ),
      hexaPay,
      "PaymentInitiated"
    );

    const paymentId = paymentArgs.paymentId;
    const ownerPermission = await createPermission(hexaPay, owner);
    const employeePermission = await createPermission(hexaPay, employee);
    const treasuryPermission = await createPermission(hexaPay, treasury);
    const ownerPaymentDetails = await hexaPay
      .connect(owner)
      .getPaymentDetails(paymentId, ownerPermission);
    const employeePaymentDetails = await hexaPay
      .connect(employee)
      .getPaymentDetails(paymentId, employeePermission);
    const spendSummary = await analytics
      .connect(owner)
      .getSealedCompanySpend(owner.address, 0, 0, publicKey);
    const payment = await hexaPay.getPaymentMetadata(paymentId);

    expect(ownerPaymentDetails.amount).to.equal(100n);
    expect(ownerPaymentDetails.fee).to.equal(1n);
    expect(employeePaymentDetails.amount).to.equal(100n);
    expect(employeePaymentDetails.fee).to.equal(1n);
    expect(await hexaPay.connect(owner).getBalance(ownerPermission)).to.equal(99n);
    expect(await hexaPay.connect(employee).getBalance(employeePermission)).to.equal(100n);
    expect(await hexaPay.connect(treasury).getBalance(treasuryPermission)).to.equal(1n);
    expect(await hexaPay.getBackingBalance()).to.equal(200n);
    expect(await unseal(analytics, spendSummary, owner)).to.equal(101n);
    expect(payment.sender).to.equal(owner.address);
    expect(payment.recipient).to.equal(employee.address);
    expect(payment.kind).to.equal(0n);
  });

  it("blocks non-participants from reading payment details even with their own permission", async function () {
    const { employee, hexaPay, owner, outsider, token } = await createFixture();

    await wrapAmount(token, hexaPay, owner, owner, 200n);

    const paymentArgs = await sendAndParseEvent(
      hexaPay.connect(owner).createPayment(
        employee.address,
        await encrypt128(50n),
        hashText("vendor-payment")
      ),
      hexaPay,
      "PaymentInitiated"
    );

    const outsiderPermission = await createPermission(hexaPay, outsider);

    await expect(
      hexaPay.connect(outsider).getPaymentDetails(paymentArgs.paymentId, outsiderPermission)
    ).to.be.revertedWith("Not payment participant");
  });

  it("uses legacy compliance grants as broad auditor access and supports attestation", async function () {
    const { auditor, hexaPay, owner, token } = await createFixture();
    const publicKey = randomPublicKey();

    await wrapAmount(token, hexaPay, owner, owner, 75n);
    await hexaPay.authorizeAuditor(auditor.address);
    await hexaPay.grantComplianceAccess(
      owner.address,
      auditor.address,
      3600,
      hashText("legacy-grant")
    );

    expect(await hexaPay.hasActiveComplianceGrant(owner.address, auditor.address)).to.equal(true);
    expect(await hexaPay.canAuditorViewScope(owner.address, auditor.address, 0)).to.equal(true);
    expect(await hexaPay.canAuditorViewScope(owner.address, auditor.address, 1)).to.equal(true);

    const sealedBalance = await hexaPay
      .connect(auditor)
      .getSealedUserBalance(owner.address, publicKey);
    expect(await unseal(hexaPay, sealedBalance, auditor)).to.equal(75n);

    await hexaPay.connect(auditor).addAuditAttestation(owner.address, hashText("audit-ok"));

    const attestations = await hexaPay.getAuditAttestations(owner.address);
    expect(attestations).to.have.lengthOf(1);
    expect(attestations[0].auditor).to.equal(auditor.address);
    expect(attestations[0].verified).to.equal(true);

    await hexaPay.revokeComplianceAccess(owner.address, auditor.address);

    expect(await hexaPay.hasActiveComplianceGrant(owner.address, auditor.address)).to.equal(false);
    expect(await hexaPay.canAuditorViewScope(owner.address, auditor.address, 0)).to.equal(false);

    await expect(
      hexaPay.connect(auditor).addAuditAttestation(owner.address, hashText("audit-fail"))
    ).to.be.revertedWith("No compliance access");
  });
});
