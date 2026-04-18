const hre = require("hardhat");
const fs = require("fs");

async function main() {
  console.log("🔗 Interacting with HexaPay contracts...\n");

  if (!fs.existsSync("deployment.json")) {
    console.error("❌ deployment.json not found. Please deploy contracts first.");
    process.exit(1);
  }

  const deployment = JSON.parse(fs.readFileSync("deployment.json", "utf8"));
  const [signer] = await hre.ethers.getSigners();

  console.log("Using account:", signer.address);
  console.log("HexaPay address:", deployment.hexaPay);
  console.log("Factory address:", deployment.factory, "\n");

  const HexaPay = await hre.ethers.getContractFactory("HexaPay");
  const hexaPay = HexaPay.attach(deployment.hexaPay);
  const resolvedWorkflowAddress = deployment.workflowModule || await hexaPay.workflowModule();
  const resolvedEscrowAddress = deployment.escrowModule || await hexaPay.escrowModule();
  const resolvedComplianceAddress = deployment.complianceModule || await hexaPay.complianceModule();
  const resolvedAnalyticsAddress = deployment.analyticsModule || await hexaPay.analyticsModule();
  const HexaPayWorkflowModule = await hre.ethers.getContractFactory("HexaPayWorkflowModule");
  const workflow = HexaPayWorkflowModule.attach(resolvedWorkflowAddress);
  const HexaPayEscrowModule = await hre.ethers.getContractFactory("HexaPayEscrowModule");
  const escrow = HexaPayEscrowModule.attach(resolvedEscrowAddress);
  const HexaPayComplianceModule = await hre.ethers.getContractFactory("HexaPayComplianceModule");
  const compliance = HexaPayComplianceModule.attach(resolvedComplianceAddress);
  const HexaPayAnalyticsModule = await hre.ethers.getContractFactory("HexaPayAnalyticsModule");
  const analytics = HexaPayAnalyticsModule.attach(resolvedAnalyticsAddress);

  const HexaPayFactory = await hre.ethers.getContractFactory("HexaPayFactory");
  const factory = HexaPayFactory.attach(deployment.factory);

  console.log("📋 Contract Information:");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  const owner = await hexaPay.owner();
  const feeCollector = await hexaPay.feeCollector();
  const settlementToken = await hexaPay.settlementToken();
  const vault = await hexaPay.vault();
  const workflowAddress = await hexaPay.workflowModule();
  const escrowAddress = await hexaPay.escrowModule();
  const complianceAddress = await hexaPay.complianceModule();
  const analyticsAddress = await hexaPay.analyticsModule();
  const backingBalance = await hexaPay.getBackingBalance();
  const hasBalance = await hexaPay.hasBalance(signer.address);
  const workflowCore = await workflow.core();
  const escrowCore = await escrow.core();
  const complianceCore = await compliance.core();
  const analyticsCore = await analytics.core();

  console.log("Owner:", owner);
  console.log("Fee Collector:", feeCollector);
  console.log("Settlement Token:", settlementToken);
  console.log("Vault:", vault);
  console.log("Workflow Module:", workflowAddress);
  console.log("Workflow Core Link:", workflowCore);
  console.log("Escrow Module:", escrowAddress);
  console.log("Escrow Core Link:", escrowCore);
  console.log("Compliance Module:", complianceAddress);
  console.log("Compliance Core Link:", complianceCore);
  console.log("Analytics Module:", analyticsAddress);
  console.log("Analytics Core Link:", analyticsCore);
  console.log("Vault Backing:", backingBalance.toString());
  console.log("Your confidential balance exists:", hasBalance);

  const instanceCount = await factory.getInstanceCount();
  const registeredWorkflow = await factory.getWorkflowModule(deployment.hexaPay);
  const registeredEscrow = await factory.getEscrowModule(deployment.hexaPay);
  const registeredCompliance = await factory.getComplianceModule(deployment.hexaPay);
  const registeredAnalytics = await factory.getAnalyticsModule(deployment.hexaPay);
  console.log("Total instances deployed:", instanceCount.toString());
  console.log("Factory Workflow Link:", registeredWorkflow);
  console.log("Factory Escrow Link:", registeredEscrow);
  console.log("Factory Compliance Link:", registeredCompliance);
  console.log("Factory Analytics Link:", registeredAnalytics);

  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  console.log("✅ Interaction completed!");
  console.log("\n💡 Next steps:");
  console.log("   1. Approve the settlement token to the HexaPay vault");
  console.log("   2. Call wrap(uint128 amount) to create private balance");
  console.log("   3. Use the CoFHE client to encrypt payment amounts for createPayment()");
  console.log("   4. Use the workflow module for createInvoice()/payInvoice() flows");
  console.log("   5. Use the escrow module for createEscrow()/fundEscrow()/releaseEscrow flows");
  console.log("   6. Use the compliance module for scoped audit rooms and attestations");
  console.log("   7. Use the analytics module for sealed spend, payroll, invoice, and escrow summaries");
  console.log("   8. Configure workflow policy rules if payroll or invoice actions need multi-approval");
  console.log("   9. Use unwrap(...) to request a private USDC exit, then completeUnwrap(...) after the async decrypt is ready");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
