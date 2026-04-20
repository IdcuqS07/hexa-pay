// scripts/demo-private-quote.js
/**
 * Demo: Private Merchant Quote Flow
 * 
 * Flow:
 * 1. Seed payer credit (encrypted)
 * 2. Merchant creates quote (encrypted amount)
 * 3. Merchant grants access to payer
 * 4. Payer previews amount (optional)
 * 5. Payer settles quote
 */

const hre = require("hardhat");
const { FhenixClient } = require("fhenixjs");

async function main() {
  const [deployer, merchant, payer] = await hre.ethers.getSigners();

  // Load deployment addresses
  const deployment = require("../deployment-private-quote.json");
  
  const credit = await hre.ethers.getContractAt(
    "MockCreditAdapter",
    deployment.contracts.MockCreditAdapter
  );
  
  const quote = await hre.ethers.getContractAt(
    "PrivateMerchantQuote",
    deployment.contracts.PrivateMerchantQuote
  );

  // Initialize FhenixClient
  const fhenix = new FhenixClient({ provider: hre.ethers.provider });

  console.log("🎬 Private Merchant Quote Demo");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("Merchant:", merchant.address);
  console.log("Payer:   ", payer.address);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  // Step 1: Seed payer credit
  console.log("1️⃣  Seeding payer credit (10,000 units)...");
  const creditAmount = 10000;
  const encryptedCredit = await fhenix.encrypt_uint64(creditAmount);
  
  let tx = await credit.connect(deployer).seedCredit(payer.address, encryptedCredit);
  await tx.wait();
  console.log("✅ Credit seeded\n");

  // Step 2: Merchant creates quote
  console.log("2️⃣  Merchant creates quote (2,500 units)...");
  const quoteId = hre.ethers.utils.id("invoice-demo-001");
  const invoiceAmount = 2500;
  const encryptedAmount = await fhenix.encrypt_uint64(invoiceAmount);
  const expiresAt = Math.floor(Date.now() / 1000) + 3600; // 1 hour

  tx = await quote.connect(merchant).createQuote(
    quoteId,
    payer.address,
    encryptedAmount,
    expiresAt
  );
  await tx.wait();
  console.log("✅ Quote created");
  console.log("   Quote ID:", quoteId);
  console.log("   NFC Link: hexa://pay?quoteId=" + quoteId + "\n");

  // Step 3: Merchant grants access
  console.log("3️⃣  Merchant grants preview access to payer...");
  tx = await quote.connect(merchant).grantAccess(quoteId, payer.address);
  await tx.wait();
  console.log("✅ Access granted\n");

  // Step 4: Payer previews (optional)
  console.log("4️⃣  Payer previews amount...");
  const quoteDetails = await quote.getQuote(quoteId);
  console.log("   Status:", ["None", "Pending", "Settled", "Cancelled", "Expired"][quoteDetails.status]);
  console.log("   Access Granted:", quoteDetails.accessGranted);
  console.log("   (Amount remains encrypted on-chain)\n");

  // Step 5: Payer settles
  console.log("5️⃣  Payer settles quote...");
  tx = await quote.connect(payer).settleQuote(quoteId, false); // skipPreview=false
  await tx.wait();
  console.log("✅ Quote settled\n");

  // Verify final state
  const finalQuote = await quote.getQuote(quoteId);
  console.log("📊 Final State:");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("Quote Status:", ["None", "Pending", "Settled", "Cancelled", "Expired"][finalQuote.status]);
  console.log("Merchant:    ", finalQuote.merchant);
  console.log("Payer:       ", finalQuote.payer);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("\n✅ Demo completed successfully!");
  console.log("\n🔐 Privacy Guarantees:");
  console.log("   • Invoice amount never exposed on-chain");
  console.log("   • Only merchant and payer can decrypt");
  console.log("   • Credit balance remains encrypted");
  console.log("   • Settlement happens without revealing amounts");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
