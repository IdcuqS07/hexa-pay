const hre = require("hardhat");

async function main() {
  try {
    const [deployer] = await hre.ethers.getSigners();
    const balance = await hre.ethers.provider.getBalance(deployer.address);
    
    console.log("Deployer address:", deployer.address);
    console.log("Balance:", hre.ethers.formatEther(balance), "ETH");
    
    if (balance === 0n) {
      console.log("\n❌ No ETH in wallet!");
      console.log("Get testnet ETH from: https://faucet.quicknode.com/arbitrum/sepolia");
      process.exit(1);
    } else {
      console.log("✅ Wallet has sufficient balance for deployment");
    }
  } catch (error) {
    console.log("❌ Error:", error.message);
    process.exit(1);
  }
}

main();
