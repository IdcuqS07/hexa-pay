const hre = require("hardhat");

async function main() {
  console.log("🚀 Deploying HexaPayIntentExecutor to Arbitrum Sepolia...\n");

  // Check network
  const network = hre.network.name;
  console.log("Network:", network);
  
  if (network === "hardhat" || network === "localhost") {
    console.log("⚠️  Warning: Deploying to local network");
  }

  // Get deployer
  let deployer;
  try {
    [deployer] = await hre.ethers.getSigners();
    console.log("Deployer address:", deployer.address);
    
    // Check balance
    const balance = await hre.ethers.provider.getBalance(deployer.address);
    console.log("Deployer balance:", hre.ethers.formatEther(balance), "ETH");
    
    if (balance === 0n) {
      console.log("\n❌ Error: Deployer has no ETH");
      console.log("Get testnet ETH from: https://faucet.quicknode.com/arbitrum/sepolia");
      process.exit(1);
    }
  } catch (error) {
    console.log("\n❌ Error: Could not get signer");
    console.log("Make sure PRIVATE_KEY is set in .env or environment");
    console.log("\nExample:");
    console.log("  export PRIVATE_KEY=0x...");
    console.log("  or add to .env file:");
    console.log("  PRIVATE_KEY=0x...");
    process.exit(1);
  }

  console.log("\n📝 Deploying contract...");
  
  try {
    const Contract = await hre.ethers.getContractFactory("HexaPayIntentExecutor");
    const contract = await Contract.deploy(deployer.address);
    
    console.log("⏳ Waiting for deployment transaction...");
    await contract.waitForDeployment();
    
    const contractAddress = await contract.getAddress();
    
    console.log("\n✅ Deployment successful!");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("Contract address:", contractAddress);
    console.log("Owner address:", deployer.address);
    console.log("Network:", network);
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    
    console.log("\n📋 Next steps:");
    console.log("1. Verify contract on Arbiscan:");
    console.log(`   npx hardhat verify --network ${network} ${contractAddress} ${deployer.address}`);
    console.log("\n2. Set environment variables:");
    console.log(`   export HEXAPAY_EXECUTOR_CONTRACT_ADDRESS=${contractAddress}`);
    console.log(`   export HEXAPAY_EXECUTOR_PRIVATE_KEY=$PRIVATE_KEY`);
    console.log(`   export ARB_SEPOLIA_RPC_URL=https://sepolia-rollup.arbitrum.io/rpc`);
    console.log(`   export HEXAPAY_CHAIN_ID=421614`);
    console.log("\n3. Test the deployment:");
    console.log("   node scripts/test-payment-intent-flow.mjs");
    console.log("\n4. View on Arbiscan:");
    console.log(`   https://sepolia.arbiscan.io/address/${contractAddress}`);
    
  } catch (error) {
    console.log("\n❌ Deployment failed:", error.message);
    
    if (error.message.includes("insufficient funds")) {
      console.log("\n💡 Tip: Get testnet ETH from:");
      console.log("   https://faucet.quicknode.com/arbitrum/sepolia");
    }
    
    if (error.message.includes("nonce")) {
      console.log("\n💡 Tip: Try resetting your account nonce or wait a moment");
    }
    
    process.exit(1);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n❌ Unexpected error:", error);
    process.exit(1);
  });
