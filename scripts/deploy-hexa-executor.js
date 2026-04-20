const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const Contract = await hre.ethers.getContractFactory("HexaPayIntentExecutor");
  const contract = await Contract.deploy(deployer.address);
  await contract.waitForDeployment();

  console.log("HexaPayIntentExecutor deployed to:", await contract.getAddress());
  console.log("Owner:", deployer.address);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
