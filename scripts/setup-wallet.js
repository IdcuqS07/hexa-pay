const readline = require('readline');
const fs = require('fs');
const { ethers } = require('ethers');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(query) {
  return new Promise(resolve => rl.question(query, resolve));
}

async function main() {
  console.log('\n🔐 HexaPay Wallet Setup\n');
  console.log('This script will help you set up your wallet for Arbitrum Sepolia deployment.\n');

  const choice = await question(
    'Choose an option:\n' +
    '1. Create new wallet\n' +
    '2. Import existing wallet (private key)\n' +
    '3. Import from mnemonic (seed phrase)\n' +
    'Enter choice (1-3): '
  );

  let wallet;

  switch (choice.trim()) {
    case '1':
      // Create new wallet
      wallet = ethers.Wallet.createRandom();
      console.log('\n✅ New wallet created!\n');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('Address:', wallet.address);
      console.log('Private Key:', wallet.privateKey);
      console.log('Mnemonic:', wallet.mnemonic.phrase);
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('\n⚠️  IMPORTANT: Save these details securely!');
      console.log('⚠️  Never share your private key or mnemonic!\n');
      break;

    case '2':
      // Import from private key
      const privateKey = await question('Enter your private key: ');
      try {
        const normalizedPrivateKey = privateKey.trim().startsWith('0x')
          ? privateKey.trim()
          : `0x${privateKey.trim()}`;
        wallet = new ethers.Wallet(normalizedPrivateKey);
        console.log('\n✅ Wallet imported successfully!');
        console.log('Address:', wallet.address);
      } catch (error) {
        console.error('\n❌ Invalid private key!');
        rl.close();
        return;
      }
      break;

    case '3':
      // Import from mnemonic
      const mnemonic = await question('Enter your mnemonic (seed phrase): ');
      try {
        wallet = ethers.Wallet.fromPhrase(mnemonic.trim());
        console.log('\n✅ Wallet imported successfully!');
        console.log('Address:', wallet.address);
        console.log('Private Key:', wallet.privateKey);
      } catch (error) {
        console.error('\n❌ Invalid mnemonic!');
        rl.close();
        return;
      }
      break;

    default:
      console.log('\n❌ Invalid choice!');
      rl.close();
      return;
  }

  // Ask if user wants to save to .env
  const saveEnv = await question('\nSave to .env file? (y/n): ');

  if (saveEnv.toLowerCase() === 'y') {
    const envContent = `# Arbitrum Sepolia Configuration
ARB_SEPOLIA_RPC=https://sepolia-rollup.arbitrum.io/rpc

# Private Key with 0x prefix (DO NOT COMMIT THIS FILE)
PRIVATE_KEY=${wallet.privateKey}

# Arbiscan API Key (optional)
ARBISCAN_API_KEY=

# Circle USDC on Arbitrum Sepolia testnet
SETTLEMENT_TOKEN_ADDRESS=0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d

# Contract Addresses (filled after deployment)
HEXAPAY_FACTORY_ADDRESS=
HEXAPAY_ADDRESS=
`;

    fs.writeFileSync('.env', envContent);
    console.log('\n✅ Configuration saved to .env');
    console.log('⚠️  Make sure .env is in .gitignore!');
  }

  // Check balance on Arbitrum Sepolia
  console.log('\n🔍 Checking balance on Arbitrum Sepolia...');
  try {
    const provider = new ethers.JsonRpcProvider('https://sepolia-rollup.arbitrum.io/rpc');
    const balance = await provider.getBalance(wallet.address);
    console.log('Balance:', ethers.formatEther(balance), 'ETH');

    if (balance === 0n) {
      console.log('\n💰 Your wallet has no Arbitrum Sepolia ETH yet.');
      console.log('Get testnet funds from:');
      console.log('   - Alchemy: https://www.alchemy.com/faucets/arbitrum-sepolia');
      console.log('   - QuickNode: https://faucet.quicknode.com/arbitrum/sepolia');
      console.log('   - ETHGlobal: https://ethglobal.com/faucet/arbitrum-sepolia-421614');
    } else {
      console.log('\n✅ Wallet is funded and ready for deployment!');
    }
  } catch (error) {
    console.log('\n⚠️  Could not check balance. Network might be unavailable.');
  }

  console.log('\n📝 Next steps:');
  console.log('   1. Get Arbitrum Sepolia ETH if balance is 0');
  console.log('   2. Set SETTLEMENT_TOKEN_ADDRESS in .env');
  console.log('   3. Run: npm run compile');
  console.log('   4. Run: npm run deploy');
  console.log('');

  rl.close();
}

main().catch(console.error);
