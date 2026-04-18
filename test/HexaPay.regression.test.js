const {
  loadFixture,
  time
} = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { expect } = require("chai");
const { ethers } = require("hardhat");
const {
  createComplianceRoom,
  createPermission,
  deployHexaPayFixture,
  encrypt128,
  hashText,
  randomPublicKey,
  sendAndParseEvent,
  TEST_SETTLEMENT_DECIMALS,
  unseal,
  unwrapAmount,
  wrapAmount
} = require("./helpers/hexapay");

describe("HexaPay regression flows", function () {
  async function createFixture() {
    return loadFixture(deployHexaPayFixture);
  }

  async function createEscrowAndFund(escrow, owner, seller, arbiter, amount) {
    const expiresAt = BigInt((await time.latest()) + 3600);
    const escrowArgs = await sendAndParseEvent(
      escrow.connect(owner).createEscrow(
        seller.address,
        arbiter.address,
        await encrypt128(amount),
        hashText(`regression-escrow:${amount.toString()}`),
        expiresAt
      ),
      escrow,
      "EscrowCreated"
    );

    await escrow.connect(owner).fundEscrow(escrowArgs.escrowId, await encrypt128(amount));
    return escrowArgs.escrowId;
  }

  it("preserves vault backing after a mixed payment, escrow, and unwrap sequence", async function () {
    const { analytics, arbiter, employee, escrow, hexaPay, owner, seller, token, treasury } =
      await createFixture();
    const publicKey = randomPublicKey();

    await wrapAmount(token, hexaPay, owner, owner, 300n);
    await hexaPay.connect(owner).createPayment(
      employee.address,
      await encrypt128(100n),
      hashText("regression-payment")
    );

    const escrowId = await createEscrowAndFund(escrow, owner, seller, arbiter, 100n);
    await escrow.connect(owner).releaseEscrow(escrowId, await encrypt128(100n));
    await unwrapAmount(hexaPay, owner, 20n);

    const ownerPermission = await createPermission(hexaPay, owner);
    const employeePermission = await createPermission(hexaPay, employee);
    const sellerPermission = await createPermission(hexaPay, seller);
    const treasuryPermission = await createPermission(hexaPay, treasury);

    const ownerBalance = await hexaPay.connect(owner).getBalance(ownerPermission);
    const employeeBalance = await hexaPay.connect(employee).getBalance(employeePermission);
    const sellerBalance = await hexaPay.connect(seller).getBalance(sellerPermission);
    const treasuryBalance = await hexaPay.connect(treasury).getBalance(treasuryPermission);
    const backingBalance = await hexaPay.getBackingBalance();
    const spendSummary = await analytics
      .connect(owner)
      .getSealedCompanySpend(owner.address, 0, 0, publicKey);
    const escrowExposure = await analytics
      .connect(owner)
      .getSealedEscrowExposure(owner.address, publicKey);

    expect(ownerBalance).to.equal(78n);
    expect(employeeBalance).to.equal(100n);
    expect(sellerBalance).to.equal(100n);
    expect(treasuryBalance).to.equal(2n);
    expect(ownerBalance + employeeBalance + sellerBalance + treasuryBalance).to.equal(backingBalance);
    expect(await unseal(analytics, spendSummary, owner)).to.equal(101n);
    expect(await unseal(analytics, escrowExposure, owner)).to.equal(0n);
  });

  it("routes new fees to the updated fee collector", async function () {
    const { employee, hexaPay, owner, signer, token, treasury } = await createFixture();

    await hexaPay.updateFeeCollector(signer.address);
    await wrapAmount(token, hexaPay, owner, owner, 200n);

    const paymentArgs = await sendAndParseEvent(
      hexaPay.connect(owner).createPayment(
        employee.address,
        await encrypt128(100n),
        hashText("new-fee-collector")
      ),
      hexaPay,
      "PaymentInitiated"
    );

    const ownerPermission = await createPermission(hexaPay, owner);
    const signerPermission = await createPermission(hexaPay, signer);
    const treasuryPermission = await createPermission(hexaPay, treasury);
    const paymentDetails = await hexaPay
      .connect(owner)
      .getPaymentDetails(paymentArgs.paymentId, ownerPermission);

    expect(paymentDetails.fee).to.equal(1n);
    expect(await hexaPay.connect(signer).getBalance(signerPermission)).to.equal(1n);
    expect(await hexaPay.connect(treasury).getBalance(treasuryPermission)).to.equal(0n);
  });

  it("applies updated fee rates to subsequent payments", async function () {
    const { employee, hexaPay, owner, token, treasury } = await createFixture();

    await wrapAmount(token, hexaPay, owner, owner, 500n);

    const firstPayment = await sendAndParseEvent(
      hexaPay.connect(owner).createPayment(
        employee.address,
        await encrypt128(100n),
        hashText("fee-before")
      ),
      hexaPay,
      "PaymentInitiated"
    );

    await hexaPay.updateFeeRate(250);

    const secondPayment = await sendAndParseEvent(
      hexaPay.connect(owner).createPayment(
        employee.address,
        await encrypt128(200n),
        hashText("fee-after")
      ),
      hexaPay,
      "PaymentInitiated"
    );

    const ownerPermission = await createPermission(hexaPay, owner);
    const treasuryPermission = await createPermission(hexaPay, treasury);
    const firstDetails = await hexaPay
      .connect(owner)
      .getPaymentDetails(firstPayment.paymentId, ownerPermission);
    const secondDetails = await hexaPay
      .connect(owner)
      .getPaymentDetails(secondPayment.paymentId, ownerPermission);

    expect(firstDetails.fee).to.equal(1n);
    expect(secondDetails.fee).to.equal(5n);
    expect(await hexaPay.connect(treasury).getBalance(treasuryPermission)).to.equal(6n);
  });

  it("keeps legacy grant access active after a scoped room closes until the grant is revoked", async function () {
    const { auditor, compliance, hexaPay, owner } = await createFixture();

    await hexaPay.authorizeAuditor(auditor.address);
    await hexaPay.grantComplianceAccess(
      owner.address,
      auditor.address,
      3600,
      hashText("legacy-priority")
    );

    const roomId = await createComplianceRoom(
      hexaPay,
      compliance,
      owner,
      owner,
      auditor,
      [2],
      3600,
      "scoped-room"
    );

    await compliance.connect(owner).closeComplianceRoom(roomId);

    expect(await hexaPay.canAuditorViewScope(owner.address, auditor.address, 0)).to.equal(true);
    expect(await hexaPay.canAuditorViewScope(owner.address, auditor.address, 2)).to.equal(true);

    await hexaPay.revokeComplianceAccess(owner.address, auditor.address);

    expect(await hexaPay.canAuditorViewScope(owner.address, auditor.address, 0)).to.equal(false);
    expect(await hexaPay.canAuditorViewScope(owner.address, auditor.address, 2)).to.equal(false);
  });
});

describe("HexaPayFactory regression", function () {
  async function createFactoryFixture() {
    const [owner, treasury, user] = await ethers.getSigners();

    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const token = await MockERC20.deploy(
      "Mock USDC",
      "USDC",
      TEST_SETTLEMENT_DECIMALS,
      ethers.parseUnits("1000000", TEST_SETTLEMENT_DECIMALS)
    );
    await token.waitForDeployment();

    const HexaPayFactory = await ethers.getContractFactory("HexaPayFactory");
    const factory = await HexaPayFactory.deploy();
    await factory.waitForDeployment();

    const HexaPay = await ethers.getContractFactory("HexaPay");

    return {
      HexaPay,
      factory,
      owner,
      token,
      treasury,
      user
    };
  }

  it("isolates deployed instances per user and tracks all instances globally", async function () {
    const { HexaPay, factory, owner, token, treasury, user } = await loadFixture(createFactoryFixture);

    const ownerDeployment = await HexaPay.getDeployTransaction(
      owner.address,
      await token.getAddress(),
      treasury.address,
      100
    );
    const userDeployment = await HexaPay.getDeployTransaction(
      user.address,
      await token.getAddress(),
      treasury.address,
      100
    );
    expect(ownerDeployment.data).to.be.a("string");
    expect(userDeployment.data).to.be.a("string");

    await factory.connect(owner).deployHexaPay(ownerDeployment.data);
    await factory.connect(user).deployHexaPay(userDeployment.data);

    const ownerInstances = await factory.getUserInstances(owner.address);
    const userInstances = await factory.getUserInstances(user.address);
    const allInstances = await factory.getAllInstances();

    expect(ownerInstances).to.have.lengthOf(1);
    expect(userInstances).to.have.lengthOf(1);
    expect(ownerInstances[0]).to.not.equal(userInstances[0]);
    expect(allInstances).to.deep.equal([ownerInstances[0], userInstances[0]]);
  });

  it("rejects deployment bytecode when the encoded owner does not match the sender", async function () {
    const { HexaPay, factory, owner, token, treasury, user } = await loadFixture(createFactoryFixture);

    const deployment = await HexaPay.getDeployTransaction(
      owner.address,
      await token.getAddress(),
      treasury.address,
      100
    );
    expect(deployment.data).to.be.a("string");

    await expect(
      factory.connect(user).deployHexaPay(deployment.data)
    ).to.be.revertedWithCustomError(factory, "InvalidOwner");
  });
});
