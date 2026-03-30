const hre = require("hardhat");
const fs = require("fs");

async function main() {
  const network = await hre.ethers.provider.getNetwork();
  const [deployer] = await hre.ethers.getSigners();

  console.log(`🪙 Deploying settlement token to ${hre.network.name} (chainId ${network.chainId})...\n`);
  console.log("Deployer:", deployer.address);

  const MockERC20 = await hre.ethers.getContractFactory("MockERC20");
  const token = await MockERC20.deploy(
    "HexaPay USD",
    "hxUSD",
    18,
    hre.ethers.parseUnits("1000000", 18)
  );

  await token.waitForDeployment();

  const tokenAddress = await token.getAddress();
  const totalSupply = await token.totalSupply();

  const payload = {
    network: hre.network.name,
    chainId: Number(network.chainId),
    address: tokenAddress,
    name: "HexaPay USD",
    symbol: "hxUSD",
    decimals: 18,
    totalSupply: totalSupply.toString(),
    deployer: deployer.address,
    deployedAt: new Date().toISOString()
  };

  fs.writeFileSync("settlement-token.json", JSON.stringify(payload, null, 2));

  console.log("\n✅ Settlement token deployed");
  console.log("Address:", tokenAddress);
  console.log("Total Supply:", hre.ethers.formatUnits(totalSupply, 18), "hxUSD");
  console.log("\nSaved metadata to settlement-token.json");
  console.log("\nAdd this to your .env before deploying HexaPay:");
  console.log(`SETTLEMENT_TOKEN_ADDRESS=${tokenAddress}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
