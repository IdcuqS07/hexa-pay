// scripts/deploy-private-quote.js
const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();

  console.log("Deploying Private Merchant Quote system...");
  console.log("Deployer:", deployer.address);

  // 1. Deploy MockCreditAdapter
  console.log("\n1. Deploying MockCreditAdapter...");
  const MockCredit = await hre.ethers.getContractFactory("MockCreditAdapter");
  const credit = await MockCredit.deploy();
  await credit.deployed();
  console.log("✅ MockCreditAdapter:", credit.address);

  // 2. Deploy PrivateMerchantQuote
  console.log("\n2. Deploying PrivateMerchantQuote...");
  const Quote = await hre.ethers.getContractFactory("PrivateMerchantQuote");
  const quote = await Quote.deploy(credit.address);
  await quote.deployed();
  console.log("✅ PrivateMerchantQuote:", quote.address);

  // 3. Authorize quote contract in credit adapter
  console.log("\n3. Authorizing quote contract...");
  const tx = await credit.authorizeCaller(quote.address);
  await tx.wait();
  console.log("✅ Quote contract authorized");

  // 4. Verify authorization
  const isAuthorized = await credit.authorizedCallers(quote.address);
  console.log("✅ Authorization verified:", isAuthorized);

  console.log("\n📋 Deployment Summary:");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("MockCreditAdapter:      ", credit.address);
  console.log("PrivateMerchantQuote:   ", quote.address);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  // Save deployment addresses
  const fs = require("fs");
  const deployment = {
    network: hre.network.name,
    timestamp: new Date().toISOString(),
    deployer: deployer.address,
    contracts: {
      MockCreditAdapter: credit.address,
      PrivateMerchantQuote: quote.address
    }
  };

  fs.writeFileSync(
    "deployment-private-quote.json",
    JSON.stringify(deployment, null, 2)
  );

  console.log("\n✅ Deployment info saved to deployment-private-quote.json");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
