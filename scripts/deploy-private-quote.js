// scripts/deploy-private-quote.js
const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const network = await hre.ethers.provider.getNetwork();
  const chainId = Number(network.chainId || 0);

  console.log("Deploying Private Merchant Quote system...");
  console.log("Deployer:", deployer.address);
  console.log("Network:", hre.network.name);
  console.log("Chain ID:", chainId);

  // 1. Deploy MockCreditAdapter
  console.log("\n1. Deploying MockCreditAdapter...");
  const MockCredit = await hre.ethers.getContractFactory("MockCreditAdapter");
  const credit = await MockCredit.deploy();
  await credit.waitForDeployment();
  const creditAddress = await credit.getAddress();
  console.log("✅ MockCreditAdapter:", creditAddress);

  // 2. Deploy PrivateMerchantQuote
  console.log("\n2. Deploying PrivateMerchantQuote...");
  const Quote = await hre.ethers.getContractFactory("PrivateMerchantQuote");
  const quote = await Quote.deploy(creditAddress);
  await quote.waitForDeployment();
  const quoteAddress = await quote.getAddress();
  console.log("✅ PrivateMerchantQuote:", quoteAddress);

  // 3. Authorize quote contract in credit adapter
  console.log("\n3. Authorizing quote contract...");
  const tx = await credit.authorizeCaller(quoteAddress);
  await tx.wait();
  console.log("✅ Quote contract authorized");

  // 4. Verify authorization
  const isAuthorized = await credit.authorizedCallers(quoteAddress);
  console.log("✅ Authorization verified:", isAuthorized);

  console.log("\n📋 Deployment Summary:");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("MockCreditAdapter:      ", creditAddress);
  console.log("PrivateMerchantQuote:   ", quoteAddress);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  // Save deployment addresses
  const deployment = {
    network: hre.network.name,
    chainId,
    timestamp: new Date().toISOString(),
    deployer: deployer.address,
    contracts: {
      MockCreditAdapter: creditAddress,
      PrivateMerchantQuote: quoteAddress
    }
  };

  const targets = [
    path.resolve(process.cwd(), "deployment-private-quote.json"),
    path.resolve(process.cwd(), "public", "deployment-private-quote.json"),
  ];

  targets.forEach((target) => {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, JSON.stringify(deployment, null, 2));
    console.log(`✅ Deployment info saved to ${path.relative(process.cwd(), target)}`);
  });
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
