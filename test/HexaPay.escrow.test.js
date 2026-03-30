const { loadFixture, time } = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { expect } = require("chai");
const {
  createComplianceRoom,
  createPermission,
  deployHexaPayFixture,
  encrypt128,
  encrypt128Array,
  hashText,
  randomPublicKey,
  sendAndParseEvent,
  unseal,
  wrapAmount
} = require("./helpers/hexapay");

describe("HexaPay escrow module", function () {
  async function createEscrowFixture() {
    return loadFixture(deployHexaPayFixture);
  }

  async function createEscrowContext(totalAmount = 100n, expiryOffset = 3600) {
    const fixture = await createEscrowFixture();
    const { arbiter, buyer = fixture.owner, escrow, seller } = fixture;
    const expiresAt = (await time.latest()) + expiryOffset;

    const escrowArgs = await sendAndParseEvent(
      escrow.connect(buyer).createEscrow(
        seller.address,
        arbiter.address,
        await encrypt128(totalAmount),
        hashText(`escrow:${totalAmount.toString()}`),
        expiresAt
      ),
      escrow,
      "EscrowCreated"
    );

    return {
      ...fixture,
      buyer,
      escrowId: escrowArgs.escrowId,
      expiresAt
    };
  }

  async function fundEscrowAndGetPaymentId(escrow, buyer, escrowId, amount) {
    const args = await sendAndParseEvent(
      escrow.connect(buyer).fundEscrow(escrowId, await encrypt128(amount)),
      escrow,
      "EscrowFunded"
    );

    return args.paymentId;
  }

  it("creates a confidential escrow with buyer, seller, arbiter, and expiry", async function () {
    const { arbiter, escrow, escrowId, expiresAt, owner, seller } = await createEscrowContext();

    const record = await escrow.connect(owner).getEscrow(escrowId);

    expect(record.buyer).to.equal(owner.address);
    expect(record.seller).to.equal(seller.address);
    expect(record.arbiter).to.equal(arbiter.address);
    expect(record.expiresAt).to.equal(BigInt(expiresAt));
    expect(record.status).to.equal(0n);
    expect(record.fundingCount).to.equal(0n);
  });

  it("funds escrow from the buyer's wrapped balance", async function () {
    const { escrow, escrowId, hexaPay, owner, seller, token } = await createEscrowContext();
    const publicKey = randomPublicKey();

    await wrapAmount(token, hexaPay, owner, owner, 500n);
    const paymentId = await fundEscrowAndGetPaymentId(escrow, owner, escrowId, 40n);

    const record = await escrow.connect(owner).getEscrow(escrowId);
    const sealedFunded = await escrow.connect(owner).getSealedEscrowFunded(escrowId, publicKey);
    const sealedRemaining = await escrow
      .connect(owner)
      .getSealedEscrowRemaining(escrowId, publicKey);
    const payment = await hexaPay.getPaymentMetadata(paymentId);

    expect(record.fundingCount).to.equal(1n);
    expect(record.fullyFunded).to.equal(false);
    expect(await unseal(escrow, sealedFunded, owner)).to.equal(40n);
    expect(await unseal(escrow, sealedRemaining, owner)).to.equal(40n);
    expect(payment.recipient).to.equal(await escrow.getAddress());
    expect(payment.kind).to.equal(3n);
    expect(payment.sender).to.equal(owner.address);
    expect(payment.recipient).to.not.equal(seller.address);
  });

  it("stores encrypted milestones whose sum matches the escrow total", async function () {
    const { escrow, escrowId, owner } = await createEscrowContext();
    const publicKey = randomPublicKey();
    const refs = [hashText("milestone-1"), hashText("milestone-2")];

    await escrow.connect(owner).createEscrowMilestones(
      escrowId,
      await encrypt128Array([30n, 70n]),
      refs
    );

    expect(await escrow.connect(owner).getEscrowMilestoneCount(escrowId)).to.equal(2n);

    const milestone = await escrow.connect(owner).getEscrowMilestone(escrowId, 0);
    const sealedAmount = await escrow
      .connect(owner)
      .getSealedEscrowMilestoneAmount(escrowId, 0, publicKey);

    expect(milestone.referenceHash).to.equal(refs[0]);
    expect(milestone.released).to.equal(false);
    expect(await unseal(escrow, sealedAmount, owner)).to.equal(30n);
  });

  it("releases a milestone privately without double release", async function () {
    const { escrow, escrowId, hexaPay, owner, seller, token } = await createEscrowContext();
    const publicKey = randomPublicKey();

    await wrapAmount(token, hexaPay, owner, owner, 500n);
    await escrow.connect(owner).createEscrowMilestones(
      escrowId,
      await encrypt128Array([100n]),
      [hashText("delivery")]
    );
    await fundEscrowAndGetPaymentId(escrow, owner, escrowId, 100n);
    await escrow.connect(owner).releaseEscrowMilestone(escrowId, 0);

    const record = await escrow.connect(owner).getEscrow(escrowId);
    const milestone = await escrow.connect(owner).getEscrowMilestone(escrowId, 0);
    const sealedSellerBalance = await hexaPay
      .connect(seller)
      .getSealedBalance(publicKey);

    expect(record.status).to.equal(2n);
    expect(record.releaseCount).to.equal(1n);
    expect(milestone.released).to.equal(true);
    expect(await unseal(hexaPay, sealedSellerBalance, seller)).to.equal(100n);

    await expect(
      escrow.connect(owner).releaseEscrowMilestone(escrowId, 0)
    ).to.be.revertedWithCustomError(escrow, "EscrowNotOpen");
  });

  it("lets the seller refund part of the remaining escrow", async function () {
    const { escrow, escrowId, hexaPay, owner, seller, token } = await createEscrowContext();
    const publicKey = randomPublicKey();

    await wrapAmount(token, hexaPay, owner, owner, 500n);
    await fundEscrowAndGetPaymentId(escrow, owner, escrowId, 100n);
    await escrow.connect(seller).refundEscrow(escrowId, await encrypt128(30n));

    const record = await escrow.connect(owner).getEscrow(escrowId);
    const sealedRefunded = await escrow
      .connect(owner)
      .getSealedEscrowRefunded(escrowId, publicKey);
    const sealedRemaining = await escrow
      .connect(owner)
      .getSealedEscrowRemaining(escrowId, publicKey);
    const ownerPermission = await createPermission(hexaPay, owner);

    expect(record.status).to.equal(0n);
    expect(await unseal(escrow, sealedRefunded, owner)).to.equal(30n);
    expect(await unseal(escrow, sealedRemaining, owner)).to.equal(70n);
    expect(await hexaPay.connect(owner).getBalance(ownerPermission)).to.equal(429n);
  });

  it("opens a dispute from buyer or seller and blocks normal release while disputed", async function () {
    const { escrow, escrowId, hexaPay, owner, seller, token } = await createEscrowContext();

    await wrapAmount(token, hexaPay, owner, owner, 500n);
    await fundEscrowAndGetPaymentId(escrow, owner, escrowId, 100n);
    await escrow.connect(seller).openDispute(escrowId, hashText("work-quality"));

    const record = await escrow.connect(owner).getEscrow(escrowId);
    expect(record.status).to.equal(1n);

    await expect(
      escrow.connect(owner).releaseEscrow(escrowId, await encrypt128(10n))
    ).to.be.revertedWithCustomError(escrow, "EscrowNotOpen");
  });

  it("lets only the arbiter resolve disputed escrow", async function () {
    const { arbiter, escrow, escrowId, hexaPay, owner, seller, token } = await createEscrowContext();
    const publicKey = randomPublicKey();

    await wrapAmount(token, hexaPay, owner, owner, 500n);
    await fundEscrowAndGetPaymentId(escrow, owner, escrowId, 100n);
    await escrow.connect(owner).openDispute(escrowId, hashText("dispute"));

    await expect(
      escrow.connect(owner).resolveDispute(escrowId, 2500, 7500, hashText("ruling"))
    ).to.be.revertedWithCustomError(escrow, "NotArbiter");

    await escrow
      .connect(arbiter)
      .resolveDispute(escrowId, 2500, 7500, hashText("ruling"));

    const record = await escrow.connect(owner).getEscrow(escrowId);
    const ownerPermission = await createPermission(hexaPay, owner);
    const sellerPermission = await createPermission(hexaPay, seller);

    expect(record.status).to.equal(4n);
    expect(await hexaPay.connect(owner).getBalance(ownerPermission)).to.equal(424n);
    expect(await hexaPay.connect(seller).getBalance(sellerPermission)).to.equal(75n);
  });

  it("closes expired escrow back to the buyer", async function () {
    const { escrow, escrowId, hexaPay, owner, token } = await createEscrowContext(100n, 10);
    const publicKey = randomPublicKey();

    await wrapAmount(token, hexaPay, owner, owner, 500n);
    await fundEscrowAndGetPaymentId(escrow, owner, escrowId, 100n);
    await time.increase(20);

    const expiredArgs = await sendAndParseEvent(
      escrow.connect(owner).closeExpiredEscrow(escrowId),
      escrow,
      "EscrowExpiredClosed"
    );

    const record = await escrow.connect(owner).getEscrow(escrowId);
    const ownerPermission = await createPermission(hexaPay, owner);

    expect(expiredArgs.escrowId).to.equal(escrowId);
    expect(record.status).to.equal(5n);
    expect(await hexaPay.connect(owner).getBalance(ownerPermission)).to.equal(499n);
  });

  it("restricts sealed escrow reads to participants, operators, and granted auditors", async function () {
    const { auditor, compliance, escrow, escrowId, hexaPay, outsider, owner } =
      await createEscrowContext();
    const publicKey = randomPublicKey();

    await expect(
      escrow.connect(outsider).getEscrow(escrowId)
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

    const sealedTotal = await escrow.connect(auditor).getSealedEscrowTotal(escrowId, publicKey);
    expect(await unseal(escrow, sealedTotal, auditor)).to.equal(100n);
  });
});
