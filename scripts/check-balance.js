const hre = require("hardhat");
require("dotenv").config();

const NETWORK_HELP = {
  "arb-sepolia": {
    symbol: "ETH",
    minBalance: "0.02",
    faucets: [
      "Alchemy: https://www.alchemy.com/faucets/arbitrum-sepolia",
      "QuickNode: https://faucet.quicknode.com/arbitrum/sepolia",
      "ETHGlobal: https://ethglobal.com/faucet/arbitrum-sepolia-421614"
    ],
    estimates: [
      "Factory deploy: small testnet gas cost",
      "Suite deploy + retries: budget 0.02-0.05 ETH"
    ]
  },
  localhost: {
    symbol: "ETH",
    minBalance: "0.00",
    faucets: [],
    estimates: ["Local network uses funded test accounts from Hardhat."]
  }
};

async function main() {
  console.log("💰 Checking wallet balance...\n");

  if (!process.env.PRIVATE_KEY) {
    console.error("❌ PRIVATE_KEY not found in .env file");
    console.log("\n💡 Run: node scripts/setup-wallet.js");
    process.exit(1);
  }

  const [signer] = await hre.ethers.getSigners();
  const address = await signer.getAddress();
  const network = await hre.ethers.provider.getNetwork();
  const help = NETWORK_HELP[hre.network.name] || NETWORK_HELP["arb-sepolia"];

  console.log("Wallet Address:", address);
  console.log("Network:", `${hre.network.name} (chainId ${network.chainId})`);
  console.log("");

  try {
    const balance = await hre.ethers.provider.getBalance(address);
    const balanceInEth = hre.ethers.formatEther(balance);

    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("Balance:", balanceInEth, help.symbol);
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

    // Check if sufficient for deployment
    const minBalance = hre.ethers.parseEther(help.minBalance);
    
    if (balance < minBalance) {
      console.log(`\n⚠️  Low balance! Recommended starting balance: ${help.minBalance} ${help.symbol}`);

      if (help.faucets.length) {
        console.log("\n💰 Get testnet funds from:");
        help.faucets.forEach((entry) => {
          console.log(`   - ${entry}`);
        });
      }
    } else {
      console.log("\n✅ Sufficient balance for deployment!");
    }

    // Rough deployment budget
    console.log("\n📊 Estimated Deployment Budget:");
    help.estimates.forEach((entry) => {
      console.log(`   - ${entry}`);
    });

  } catch (error) {
    console.error("\n❌ Error checking balance:", error.message);
    console.log("\n💡 Make sure you're connected to the correct network");
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
