const hre = require("hardhat");
const { ethers } = hre;
const { setCode } = require("@nomicfoundation/hardhat-toolbox/network-helpers");

const TASK_MANAGER_ADDRESS = "0xeA30c4B8b44078Bbf8a6ef5b9f1eC1626C7848D9";
const EUINT128_TFHE = 6;
const TEST_SETTLEMENT_DECIMALS = 6;

async function installMockFheOps() {
  const artifact = await hre.artifacts.readArtifact("HexaPayMockTaskManager");
  await setCode(TASK_MANAGER_ADDRESS, artifact.deployedBytecode);
}

async function deployHexaPayFixture() {
  await installMockFheOps();

  const [
    owner,
    treasury,
    signer,
    employee,
    payer,
    seller,
    arbiter,
    auditor,
    outsider
  ] = await ethers.getSigners();

  const MockERC20 = await ethers.getContractFactory("MockERC20");
  const token = await MockERC20.deploy(
    "Mock USDC",
    "USDC",
    TEST_SETTLEMENT_DECIMALS,
    ethers.parseUnits("1000000", TEST_SETTLEMENT_DECIMALS)
  );
  await token.waitForDeployment();

  const HexaPay = await ethers.getContractFactory("HexaPay");
  const hexaPay = await HexaPay.deploy(
    owner.address,
    await token.getAddress(),
    treasury.address,
    100
  );
  await hexaPay.waitForDeployment();

  const HexaPayVault = await ethers.getContractFactory("HexaPayVault");
  const vault = await HexaPayVault.deploy(await token.getAddress(), await hexaPay.getAddress());
  await vault.waitForDeployment();

  const HexaPayWorkflowModule = await ethers.getContractFactory("HexaPayWorkflowModule");
  const workflow = await HexaPayWorkflowModule.deploy(await hexaPay.getAddress());
  await workflow.waitForDeployment();
  const HexaPayEscrowModule = await ethers.getContractFactory("HexaPayEscrowModule");
  const escrow = await HexaPayEscrowModule.deploy(await hexaPay.getAddress());
  await escrow.waitForDeployment();
  const HexaPayComplianceModule = await ethers.getContractFactory("HexaPayComplianceModule");
  const compliance = await HexaPayComplianceModule.deploy(await hexaPay.getAddress());
  await compliance.waitForDeployment();
  const HexaPayAnalyticsModule = await ethers.getContractFactory("HexaPayAnalyticsModule");
  const analytics = await HexaPayAnalyticsModule.deploy(await hexaPay.getAddress());
  await analytics.waitForDeployment();

  await hexaPay.initializeSuite(
    await vault.getAddress(),
    await workflow.getAddress(),
    await escrow.getAddress(),
    await compliance.getAddress(),
    await analytics.getAddress()
  );

  return {
    analytics,
    arbiter,
    auditor,
    compliance,
    employee,
    escrow,
    hexaPay,
    hre,
    outsider,
    owner,
    payer,
    seller,
    signer,
    token,
    treasury,
    vault,
    workflow
  };
}

function hashText(value) {
  return ethers.keccak256(ethers.toUtf8Bytes(value));
}

function randomPublicKey() {
  return ethers.hexlify(ethers.randomBytes(32));
}

async function createPermission(contract, signer, publicKey = randomPublicKey()) {
  const verifyingContract =
    typeof contract === "string" ? contract : await contract.getAddress();
  const network = await ethers.provider.getNetwork();

  const signature = await signer.signTypedData(
    {
      name: "Fhenix Permission",
      version: "1.0",
      chainId: Number(network.chainId),
      verifyingContract
    },
    {
      Permissioned: [{ name: "publicKey", type: "bytes32" }]
    },
    { publicKey }
  );

  return {
    publicKey,
    signature
  };
}

async function encrypt128(value) {
  return {
    ctHash: BigInt(value),
    securityZone: 0,
    utype: EUINT128_TFHE,
    signature: "0x"
  };
}

async function encrypt128Array(values) {
  return Promise.all(values.map((value) => encrypt128(value)));
}

async function unseal(contract, sealedValue, viewer) {
  contract;
  viewer;
  return BigInt(sealedValue);
}

async function registerCompany(hexaPay, actor, slug, options = {}) {
  const companyName = options.companyName || `${slug} Corp`;
  const ensName = options.ensName === undefined ? `${slug}.eth` : options.ensName;
  const companyId = options.companyId || hashText(`company:${slug}`);

  await hexaPay.connect(actor).registerCompany(companyName, ensName, companyId);
  return companyId;
}

async function addSettlementBalance(token, source, recipient, amount) {
  if (source.address !== recipient.address) {
    await token.connect(source).transfer(recipient.address, amount);
  }
}

async function wrapAmount(token, hexaPay, source, actor, amount) {
  await addSettlementBalance(token, source, actor, amount);
  await token.connect(actor).approve(await hexaPay.vault(), amount);
  await hexaPay.connect(actor).wrap(amount);
}

async function unwrapAmount(hexaPay, actor, amount, delaySeconds = 15) {
  const withdrawal = await sendAndParseEvent(
    hexaPay.connect(actor).unwrap(await encrypt128(amount)),
    hexaPay,
    "WithdrawalRequested"
  );

  await ethers.provider.send("evm_increaseTime", [delaySeconds]);
  await ethers.provider.send("evm_mine", []);
  await hexaPay.connect(actor).completeUnwrap(withdrawal.withdrawalId);

  return withdrawal.withdrawalId;
}

async function createComplianceRoom(
  hexaPay,
  compliance,
  manager,
  subject,
  auditor,
  scopes,
  duration,
  policyLabel
) {
  await hexaPay.authorizeAuditor(auditor.address);

  const policyHash = hashText(policyLabel);
  const roomId = await compliance.connect(manager).createComplianceRoom.staticCall(
    subject.address,
    auditor.address,
    scopes,
    duration,
    policyHash
  );

  await compliance.connect(manager).createComplianceRoom(
    subject.address,
    auditor.address,
    scopes,
    duration,
    policyHash
  );

  return roomId;
}

async function getTxTimestamp(txPromise) {
  const receipt = await (await txPromise).wait();
  const block = await ethers.provider.getBlock(receipt.blockNumber);
  return block.timestamp;
}

async function sendAndParseEvent(txPromise, contract, eventName) {
  const receipt = await (await txPromise).wait();

  for (const log of receipt.logs) {
    try {
      const parsed = contract.interface.parseLog(log);

      if (parsed && parsed.name === eventName) {
        return parsed.args;
      }
    } catch (error) {
      error;
    }
  }

  throw new Error(`Event ${eventName} not found`);
}

module.exports = {
  createComplianceRoom,
  createPermission,
  deployHexaPayFixture,
  encrypt128,
  encrypt128Array,
  FHE_PRECOMPILE_ADDRESS: TASK_MANAGER_ADDRESS,
  getTxTimestamp,
  hashText,
  installMockFheOps,
  randomPublicKey,
  registerCompany,
  sendAndParseEvent,
  TASK_MANAGER_ADDRESS,
  TEST_SETTLEMENT_DECIMALS,
  unseal,
  unwrapAmount,
  wrapAmount
};
