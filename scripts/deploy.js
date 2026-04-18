const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

const ARBITRUM_SEPOLIA_CIRCLE_USDC = "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d";

async function main() {
  const network = await hre.ethers.provider.getNetwork();
  console.log(`🚀 Deploying HexaPay contracts to ${hre.network.name} (chainId ${network.chainId})...\n`);

  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying contracts with account:", deployer.address);

  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log("Account balance:", hre.ethers.formatEther(balance), "ETH\n");

  let settlementTokenAddress = process.env.SETTLEMENT_TOKEN_ADDRESS || "";

  if (!settlementTokenAddress) {
    if (hre.network.name === "localhost" || hre.network.name === "hardhat") {
      console.log("🧪 No settlement token configured, deploying Mock USDC for local use...");

      const MockERC20 = await hre.ethers.getContractFactory("MockERC20");
      const mockToken = await MockERC20.deploy(
        "Mock USDC",
        "USDC",
        6,
        hre.ethers.parseUnits("1000000", 6)
      );
      await mockToken.waitForDeployment();

      settlementTokenAddress = await mockToken.getAddress();
      console.log("✅ MockERC20 deployed to:", settlementTokenAddress);
    } else if (hre.network.name === "arb-sepolia") {
      settlementTokenAddress = ARBITRUM_SEPOLIA_CIRCLE_USDC;
      console.log("Using Circle USDC testnet address:", settlementTokenAddress);
    } else {
      throw new Error(
        "SETTLEMENT_TOKEN_ADDRESS is required on arb-sepolia. Point it to a test ERC-20 before deploying."
      );
    }
  } else {
    console.log("Using settlement token:", settlementTokenAddress);
  }

  console.log("📦 Deploying HexaPayFactory...");
  const HexaPayFactory = await hre.ethers.getContractFactory("HexaPayFactory");
  const factory = await HexaPayFactory.deploy();
  await factory.waitForDeployment();
  const factoryAddress = await factory.getAddress();
  console.log("✅ HexaPayFactory deployed to:", factoryAddress);

  console.log("\n📦 Deploying HexaPay core...");
  const HexaPay = await hre.ethers.getContractFactory("HexaPay");
  const hexaPay = await HexaPay.deploy(
    deployer.address,
    settlementTokenAddress,
    deployer.address,
    100
  );
  await hexaPay.waitForDeployment();
  const hexaPayAddress = await hexaPay.getAddress();
  console.log("✅ HexaPay deployed to:", hexaPayAddress);

  console.log("\n📦 Deploying HexaPay vault and modules...");
  const HexaPayVault = await hre.ethers.getContractFactory("HexaPayVault");
  const vault = await HexaPayVault.deploy(settlementTokenAddress, hexaPayAddress);
  await vault.waitForDeployment();
  const vaultAddress = await vault.getAddress();

  const HexaPayWorkflowModule = await hre.ethers.getContractFactory("HexaPayWorkflowModule");
  const workflow = await HexaPayWorkflowModule.deploy(hexaPayAddress);
  await workflow.waitForDeployment();
  const workflowAddress = await workflow.getAddress();

  const HexaPayEscrowModule = await hre.ethers.getContractFactory("HexaPayEscrowModule");
  const escrow = await HexaPayEscrowModule.deploy(hexaPayAddress);
  await escrow.waitForDeployment();
  const escrowAddress = await escrow.getAddress();

  const HexaPayComplianceModule = await hre.ethers.getContractFactory("HexaPayComplianceModule");
  const compliance = await HexaPayComplianceModule.deploy(hexaPayAddress);
  await compliance.waitForDeployment();
  const complianceAddress = await compliance.getAddress();

  const HexaPayAnalyticsModule = await hre.ethers.getContractFactory("HexaPayAnalyticsModule");
  const analytics = await HexaPayAnalyticsModule.deploy(hexaPayAddress);
  await analytics.waitForDeployment();
  const analyticsAddress = await analytics.getAddress();

  console.log("✅ Vault deployed to:", vaultAddress);
  console.log("✅ Workflow module deployed to:", workflowAddress);
  console.log("✅ Escrow module deployed to:", escrowAddress);
  console.log("✅ Compliance module deployed to:", complianceAddress);
  console.log("✅ Analytics module deployed to:", analyticsAddress);

  console.log("\n🔧 Initializing suite wiring...");
  const initTx = await hexaPay.initializeSuite(
    vaultAddress,
    workflowAddress,
    escrowAddress,
    complianceAddress,
    analyticsAddress
  );
  await initTx.wait();

  console.log("🗂️ Registering suite in factory...");
  const registerTx = await factory.registerHexaPay(hexaPayAddress);
  await registerTx.wait();

  const owner = await hexaPay.owner();
  const feeCollector = await hexaPay.feeCollector();
  const resolvedVaultAddress = await hexaPay.vault();
  const workflowModule = await hexaPay.workflowModule();
  const escrowModule = await hexaPay.escrowModule();
  const complianceModule = await hexaPay.complianceModule();
  const analyticsModule = await hexaPay.analyticsModule();
  const backingBalance = await hexaPay.getBackingBalance();

  console.log("\n📋 Contract Details:");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("Factory Address:    ", factoryAddress);
  console.log("HexaPay Address:    ", hexaPayAddress);
  console.log("Vault Address:      ", resolvedVaultAddress);
  console.log("Workflow Module:    ", workflowModule);
  console.log("Escrow Module:      ", escrowModule);
  console.log("Compliance Module:  ", complianceModule);
  console.log("Analytics Module:   ", analyticsModule);
  console.log("Settlement Token:   ", settlementTokenAddress);
  console.log("Owner:              ", owner);
  console.log("Fee Collector:      ", feeCollector);
  console.log("Platform Fee:        1% (100 basis points)");
  console.log("Vault Backing:      ", backingBalance.toString());
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  const deploymentInfo = {
    network: hre.network.name,
    chainId: Number(network.chainId),
    factory: factoryAddress,
    core: hexaPayAddress,
    hexaPay: hexaPayAddress,
    vault: resolvedVaultAddress,
    workflowModule,
    escrowModule,
    complianceModule,
    analyticsModule,
    settlementToken: settlementTokenAddress,
    owner: owner,
    feeCollector: feeCollector,
    deployedAt: new Date().toISOString(),
    deployer: deployer.address,
    ui: {
      chainId: Number(network.chainId),
      addresses: {
        core: hexaPayAddress,
        workflow: workflowModule,
        escrow: escrowModule,
        compliance: complianceModule,
        analytics: analyticsModule
      }
    }
  };

  fs.writeFileSync("deployment.json", JSON.stringify(deploymentInfo, null, 2));
  fs.mkdirSync(path.join(process.cwd(), "public"), { recursive: true });
  fs.writeFileSync(
    path.join(process.cwd(), "public", "deployment.json"),
    JSON.stringify(deploymentInfo, null, 2)
  );

  console.log("\n💾 Deployment info saved to deployment.json and public/deployment.json");
  console.log("\n🎉 Deployment completed successfully!");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
