const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployHexaPayFixture, TEST_SETTLEMENT_DECIMALS } = require("./helpers/hexapay");

describe("HexaPay", function () {
  let hexaPay;
  let token;
  let workflow;
  let escrow;
  let compliance;
  let analytics;
  let owner;
  let treasury;
  let signer;
  let employee;

  beforeEach(async function () {
    ({
      analytics,
      compliance,
      employee,
      escrow,
      hexaPay,
      owner,
      signer,
      token,
      treasury,
      workflow
    } = await deployHexaPayFixture());
  });

  describe("Deployment", function () {
    it("sets the configured owner", async function () {
      expect(await hexaPay.owner()).to.equal(owner.address);
    });

    it("sets the configured fee collector", async function () {
      expect(await hexaPay.feeCollector()).to.equal(treasury.address);
    });

    it("stores the settlement token and deploys a vault", async function () {
      expect(await hexaPay.settlementToken()).to.equal(await token.getAddress());
      expect(await hexaPay.vault()).to.not.equal(ethers.ZeroAddress);
    });

    it("deploys and links a workflow module", async function () {
      expect(await hexaPay.workflowModule()).to.not.equal(ethers.ZeroAddress);
      expect(await workflow.core()).to.equal(await hexaPay.getAddress());
    });

    it("deploys and links an escrow module", async function () {
      expect(await hexaPay.escrowModule()).to.not.equal(ethers.ZeroAddress);
      expect(await escrow.core()).to.equal(await hexaPay.getAddress());
    });

    it("deploys and links a compliance module", async function () {
      expect(await hexaPay.complianceModule()).to.not.equal(ethers.ZeroAddress);
      expect(await compliance.core()).to.equal(await hexaPay.getAddress());
    });

    it("deploys and links an analytics module", async function () {
      expect(await hexaPay.analyticsModule()).to.not.equal(ethers.ZeroAddress);
      expect(await analytics.core()).to.equal(await hexaPay.getAddress());
    });

    it("rejects a fee above the configured maximum", async function () {
      const HexaPay = await ethers.getContractFactory("HexaPay");
      await expect(
        HexaPay.deploy(owner.address, await token.getAddress(), treasury.address, 1001)
      ).to.be.revertedWith("Fee too high");
    });
  });

  describe("Admin", function () {
    it("allows the owner to update the fee collector", async function () {
      await hexaPay.updateFeeCollector(signer.address);
      expect(await hexaPay.feeCollector()).to.equal(signer.address);
    });

    it("blocks non-owners from updating the fee collector", async function () {
      await expect(
        hexaPay.connect(signer).updateFeeCollector(signer.address)
      ).to.be.revertedWith("Not authorized");
    });

    it("allows ownership transfer", async function () {
      await hexaPay.transferOwnership(signer.address);
      expect(await hexaPay.owner()).to.equal(signer.address);
    });
  });

  describe("Registry", function () {
    it("registers a company and exposes signer/operator state", async function () {
      const companyId = ethers.keccak256(ethers.toUtf8Bytes("acme"));

      await hexaPay.registerCompany("Acme Corp", "acme.eth", companyId);

      const company = await hexaPay.getCompany(owner.address);
      expect(company[0]).to.equal("Acme Corp");
      expect(company[1]).to.equal("acme.eth");
      expect(company[2]).to.equal(companyId);
      expect(await hexaPay.isCompanyOperator(owner.address, owner.address)).to.equal(true);
    });

    it("adds and removes company signers", async function () {
      const companyId = ethers.keccak256(ethers.toUtf8Bytes("acme"));
      await hexaPay.registerCompany("Acme Corp", "acme.eth", companyId);

      await hexaPay.addSigner(signer.address);
      expect(await hexaPay.isCompanyOperator(owner.address, signer.address)).to.equal(true);

      await hexaPay.removeSigner(signer.address);
      expect(await hexaPay.isCompanyOperator(owner.address, signer.address)).to.equal(false);
    });
  });

  describe("Compliance workspace", function () {
    it("creates a scoped compliance room for an authorized auditor", async function () {
      await hexaPay.authorizeAuditor(signer.address);

      const policyHash = ethers.keccak256(ethers.toUtf8Bytes("balance-room"));
      const roomId = await compliance.createComplianceRoom.staticCall(
        owner.address,
        signer.address,
        [0],
        3600,
        policyHash
      );

      await compliance.createComplianceRoom(
        owner.address,
        signer.address,
        [0],
        3600,
        policyHash
      );

      const room = await compliance.getComplianceRoom(roomId);
      expect(room.subject).to.equal(owner.address);
      expect(room.auditor).to.equal(signer.address);
      expect(room.active).to.equal(true);
      expect(
        await hexaPay.canAuditorViewScope(owner.address, signer.address, 0)
      ).to.equal(true);
      expect(
        await hexaPay.canAuditorViewScope(owner.address, signer.address, 1)
      ).to.equal(false);
    });

    it("revokes scoped access when a room is closed", async function () {
      await hexaPay.authorizeAuditor(signer.address);

      const roomId = await compliance.createComplianceRoom.staticCall(
        owner.address,
        signer.address,
        [0, 1],
        3600,
        ethers.keccak256(ethers.toUtf8Bytes("close-room"))
      );

      await compliance.createComplianceRoom(
        owner.address,
        signer.address,
        [0, 1],
        3600,
        ethers.keccak256(ethers.toUtf8Bytes("close-room"))
      );

      await compliance.closeComplianceRoom(roomId);

      expect(
        await hexaPay.canAuditorViewScope(owner.address, signer.address, 0)
      ).to.equal(false);
    });
  });

  describe("Analytics workspace", function () {
    it("creates analytics checkpoints for a company operator", async function () {
      const snapshotHash = ethers.keccak256(ethers.toUtf8Bytes("q1-analytics"));
      const checkpointId = await analytics.checkpointAnalytics.staticCall(
        owner.address,
        snapshotHash
      );

      await analytics.checkpointAnalytics(owner.address, snapshotHash);

      const checkpoint = await analytics.getAnalyticsCheckpoint(checkpointId);
      expect(checkpoint.company).to.equal(owner.address);
      expect(checkpoint.snapshotHash).to.equal(snapshotHash);

      const companyCheckpoints = await analytics.getCompanyCheckpoints(owner.address);
      expect(companyCheckpoints).to.deep.equal([checkpointId]);
    });

    it("uses Analytics scope for auditor access to analytics checkpoints", async function () {
      await hexaPay.authorizeAuditor(signer.address);

      const roomId = await compliance.createComplianceRoom.staticCall(
        owner.address,
        signer.address,
        [5],
        3600,
        ethers.keccak256(ethers.toUtf8Bytes("analytics-room"))
      );

      await compliance.createComplianceRoom(
        owner.address,
        signer.address,
        [5],
        3600,
        ethers.keccak256(ethers.toUtf8Bytes("analytics-room"))
      );

      const checkpointId = await analytics.checkpointAnalytics.staticCall(
        owner.address,
        ethers.keccak256(ethers.toUtf8Bytes("snapshot-2"))
      );

      await analytics.checkpointAnalytics(
        owner.address,
        ethers.keccak256(ethers.toUtf8Bytes("snapshot-2"))
      );

      expect(
        await hexaPay.canAuditorViewScope(owner.address, signer.address, 5)
      ).to.equal(true);
      expect(
        await hexaPay.canAuditorViewScope(owner.address, signer.address, 1)
      ).to.equal(false);

      const checkpoint = await analytics.connect(signer).getAnalyticsCheckpoint(checkpointId);
      expect(checkpoint.checkpointId).to.equal(checkpointId);

      await compliance.closeComplianceRoom(roomId);
      expect(
        await hexaPay.canAuditorViewScope(owner.address, signer.address, 5)
      ).to.equal(false);
    });
  });
});

describe("HexaPayFactory", function () {
  let factory;
  let token;
  let HexaPay;
  let owner;
  let treasury;
  let user;

  beforeEach(async function () {
    [owner, treasury, user] = await ethers.getSigners();

    const MockERC20 = await ethers.getContractFactory("MockERC20");
    token = await MockERC20.deploy(
      "Mock USDC",
      "USDC",
      TEST_SETTLEMENT_DECIMALS,
      ethers.parseUnits("1000000", TEST_SETTLEMENT_DECIMALS)
    );
    await token.waitForDeployment();

    const HexaPayFactory = await ethers.getContractFactory("HexaPayFactory");
    factory = await HexaPayFactory.deploy();
    await factory.waitForDeployment();

    HexaPay = await ethers.getContractFactory("HexaPay");
  });

  it("deploys a user-owned HexaPay instance", async function () {
    const deploymentTx = await HexaPay.getDeployTransaction(
      user.address,
      await token.getAddress(),
      treasury.address,
      100
    );
    expect(deploymentTx.data).to.be.a("string");
    await factory.connect(user).deployHexaPay(deploymentTx.data);

    const userInstances = await factory.getUserInstances(user.address);
    expect(userInstances.length).to.equal(1);

    const hexaPay = HexaPay.attach(userInstances[0]);
    const HexaPayVault = await ethers.getContractFactory("HexaPayVault");
    const vault = await HexaPayVault.deploy(await token.getAddress(), userInstances[0]);
    await vault.waitForDeployment();
    const HexaPayWorkflowModule = await ethers.getContractFactory("HexaPayWorkflowModule");
    workflow = await HexaPayWorkflowModule.deploy(userInstances[0]);
    await workflow.waitForDeployment();
    const HexaPayEscrowModule = await ethers.getContractFactory("HexaPayEscrowModule");
    escrow = await HexaPayEscrowModule.deploy(userInstances[0]);
    await escrow.waitForDeployment();
    const HexaPayComplianceModule = await ethers.getContractFactory("HexaPayComplianceModule");
    compliance = await HexaPayComplianceModule.deploy(userInstances[0]);
    await compliance.waitForDeployment();
    const HexaPayAnalyticsModule = await ethers.getContractFactory("HexaPayAnalyticsModule");
    analytics = await HexaPayAnalyticsModule.deploy(userInstances[0]);
    await analytics.waitForDeployment();

    await hexaPay.connect(user).initializeSuite(
      await vault.getAddress(),
      await workflow.getAddress(),
      await escrow.getAddress(),
      await compliance.getAddress(),
      await analytics.getAddress()
    );
    await factory.connect(user).registerHexaPay(userInstances[0]);

    expect(await hexaPay.owner()).to.equal(user.address);
    expect(await hexaPay.settlementToken()).to.equal(await token.getAddress());
    expect(await factory.getWorkflowModule(userInstances[0])).to.equal(await hexaPay.workflowModule());
    expect(await factory.getEscrowModule(userInstances[0])).to.equal(await hexaPay.escrowModule());
    expect(await factory.getComplianceModule(userInstances[0])).to.equal(await hexaPay.complianceModule());
    expect(await factory.getAnalyticsModule(userInstances[0])).to.equal(await hexaPay.analyticsModule());
  });

  it("tracks instance count", async function () {
    const firstDeploymentTx = await HexaPay.getDeployTransaction(
      owner.address,
      await token.getAddress(),
      treasury.address,
      100
    );
    const secondDeploymentTx = await HexaPay.getDeployTransaction(
      owner.address,
      await token.getAddress(),
      treasury.address,
      200
    );
    expect(firstDeploymentTx.data).to.be.a("string");
    expect(secondDeploymentTx.data).to.be.a("string");

    await factory.deployHexaPay(firstDeploymentTx.data);
    await factory.deployHexaPay(secondDeploymentTx.data);

    expect(await factory.getInstanceCount()).to.equal(2);
  });
});
