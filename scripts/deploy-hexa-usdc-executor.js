const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();

  console.log("Deploying HexaPayUSDCExecutor with:", deployer.address);
  console.log("Account balance:", (await hre.ethers.provider.getBalance(deployer.address)).toString());

  const Contract = await hre.ethers.getContractFactory("HexaPayUSDCExecutor");
  const contract = await Contract.deploy(deployer.address);
  await contract.waitForDeployment();

  const address = await contract.getAddress();

  console.log("\n✅ HexaPayUSDCExecutor deployed successfully!");
  console.log("Contract address:", address);
  console.log("Owner:", deployer.address);
  console.log("\nUpdate your .env file:");
  console.log(`HEXAPAY_EXECUTOR_CONTRACT_ADDRESS=${address}`);
  console.log("\nView on Arbiscan:");
  console.log(`https://sepolia.arbiscan.io/address/${address}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
