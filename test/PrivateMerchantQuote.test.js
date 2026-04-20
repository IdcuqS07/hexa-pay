const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("PrivateMerchantQuote", function () {
  let contract, credit, merchant, payer, other;
  let fhenix;

  beforeEach(async function () {
    [merchant, payer, other] = await ethers.getSigners();

    // Deploy mock credit adapter
    const MockCredit = await ethers.getContractFactory("MockCreditAdapter");
    credit = await MockCredit.deploy();

    // Deploy quote contract
    const Quote = await ethers.getContractFactory("PrivateMerchantQuote");
    contract = await Quote.deploy(credit.address);

    // Initialize FhenixClient (mock for testing)
    fhenix = {
      encrypt_uint64: async (val) => ethers.utils.defaultAbiCoder.encode(["uint64"], [val])
    };
  });

  describe("createQuote", function () {
    it("should create quote with encrypted amount", async function () {
      const quoteId = ethers.utils.id("test-1");
      const amountCt = await fhenix.encrypt_uint64(1000);
      const expiresAt = Math.floor(Date.now() / 1000) + 3600;

      await expect(
        contract.connect(merchant).createQuote(quoteId, payer.address, amountCt, expiresAt)
      )
        .to.emit(contract, "QuoteCreated")
        .withArgs(quoteId, merchant.address, payer.address);

      const quote = await contract.getQuote(quoteId);
      expect(quote.merchant).to.equal(merchant.address);
      expect(quote.payer).to.equal(payer.address);
      expect(quote.status).to.equal(1); // Pending
    });

    it("should revert if quote already exists", async function () {
      const quoteId = ethers.utils.id("test-1");
      const amountCt = await fhenix.encrypt_uint64(1000);
      const expiresAt = Math.floor(Date.now() / 1000) + 3600;

      await contract.connect(merchant).createQuote(quoteId, payer.address, amountCt, expiresAt);

      await expect(
        contract.connect(merchant).createQuote(quoteId, payer.address, amountCt, expiresAt)
      ).to.be.revertedWithCustomError(contract, "QuoteExists");
    });

    it("should revert if payer is zero address", async function () {
      const quoteId = ethers.utils.id("test-1");
      const amountCt = await fhenix.encrypt_uint64(1000);
      const expiresAt = Math.floor(Date.now() / 1000) + 3600;

      await expect(
        contract.connect(merchant).createQuote(quoteId, ethers.constants.AddressZero, amountCt, expiresAt)
      ).to.be.revertedWithCustomError(contract, "InvalidPayer");
    });
  });

  describe("grantAccess", function () {
    let quoteId, amountCt, expiresAt;

    beforeEach(async function () {
      quoteId = ethers.utils.id("test-2");
      amountCt = await fhenix.encrypt_uint64(2000);
      expiresAt = Math.floor(Date.now() / 1000) + 3600;
      await contract.connect(merchant).createQuote(quoteId, payer.address, amountCt, expiresAt);
    });

    it("should grant access to payer", async function () {
      await expect(contract.connect(merchant).grantAccess(quoteId, payer.address))
        .to.emit(contract, "AccessGranted")
        .withArgs(quoteId, payer.address);

      const quote = await contract.getQuote(quoteId);
      expect(quote.accessGranted).to.be.true;
    });

    it("should revert if not merchant", async function () {
      await expect(
        contract.connect(other).grantAccess(quoteId, payer.address)
      ).to.be.revertedWithCustomError(contract, "NotAuthorized");
    });
  });

  describe("settleQuote", function () {
    let quoteId, amountCt, expiresAt;

    beforeEach(async function () {
      quoteId = ethers.utils.id("test-3");
      amountCt = await fhenix.encrypt_uint64(3000);
      expiresAt = Math.floor(Date.now() / 1000) + 3600;
      await contract.connect(merchant).createQuote(quoteId, payer.address, amountCt, expiresAt);

      // Setup mock credit
      await credit.setBalance(payer.address, 10000);
    });

    it("should settle with skipPreview", async function () {
      await expect(contract.connect(payer).settleQuote(quoteId, true))
        .to.emit(contract, "QuoteSettled")
        .withArgs(quoteId, payer.address);

      const quote = await contract.getQuote(quoteId);
      expect(quote.status).to.equal(2); // Settled
    });

    it("should settle after access granted", async function () {
      await contract.connect(merchant).grantAccess(quoteId, payer.address);

      await expect(contract.connect(payer).settleQuote(quoteId, false))
        .to.emit(contract, "QuoteSettled")
        .withArgs(quoteId, payer.address);
    });

    it("should revert if not payer", async function () {
      await expect(
        contract.connect(other).settleQuote(quoteId, true)
      ).to.be.revertedWithCustomError(contract, "NotAuthorized");
    });

    it("should revert if expired", async function () {
      // Create expired quote
      const expiredId = ethers.utils.id("expired");
      const expiredAt = Math.floor(Date.now() / 1000) - 100;
      await contract.connect(merchant).createQuote(expiredId, payer.address, amountCt, expiredAt);

      await expect(
        contract.connect(payer).settleQuote(expiredId, true)
      ).to.be.revertedWithCustomError(contract, "Expired");
    });

    it("should revert if access not granted and skipPreview=false", async function () {
      await expect(
        contract.connect(payer).settleQuote(quoteId, false)
      ).to.be.revertedWithCustomError(contract, "NotAuthorized");
    });
  });

  describe("cancelExpired", function () {
    it("should cancel expired quote", async function () {
      const quoteId = ethers.utils.id("test-4");
      const amountCt = await fhenix.encrypt_uint64(4000);
      const expiresAt = Math.floor(Date.now() / 1000) - 100; // expired

      await contract.connect(merchant).createQuote(quoteId, payer.address, amountCt, expiresAt);

      await expect(contract.connect(merchant).cancelExpired(quoteId))
        .to.emit(contract, "QuoteExpired")
        .withArgs(quoteId);

      const quote = await contract.getQuote(quoteId);
      expect(quote.status).to.equal(4); // Expired
    });

    it("should revert if not expired", async function () {
      const quoteId = ethers.utils.id("test-5");
      const amountCt = await fhenix.encrypt_uint64(5000);
      const expiresAt = Math.floor(Date.now() / 1000) + 3600;

      await contract.connect(merchant).createQuote(quoteId, payer.address, amountCt, expiresAt);

      await expect(
        contract.connect(merchant).cancelExpired(quoteId)
      ).to.be.revertedWithCustomError(contract, "InvalidState");
    });
  });
});
