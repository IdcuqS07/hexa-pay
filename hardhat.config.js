require("@nomicfoundation/hardhat-toolbox");
require("cofhe-hardhat-plugin");
require("dotenv").config();

const ARB_SEPOLIA_CHAIN_ID = 421614;
const ARB_SEPOLIA_RPC_URL =
  process.env.ARB_SEPOLIA_RPC || "https://sepolia-rollup.arbitrum.io/rpc";

function getAccounts() {
  if (!process.env.PRIVATE_KEY) {
    return [];
  }

  return [process.env.PRIVATE_KEY.startsWith("0x") ? process.env.PRIVATE_KEY : `0x${process.env.PRIVATE_KEY}`];
}

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.25",
    settings: {
      evmVersion: "cancun",
      optimizer: {
        enabled: true,
        runs: 50
      }
    }
  },
  networks: {
    hardhat: {
      chainId: 31337,
      allowUnlimitedContractSize: true
    },
    "arb-sepolia": {
      url: ARB_SEPOLIA_RPC_URL,
      accounts: getAccounts(),
      chainId: ARB_SEPOLIA_CHAIN_ID
    },
    arbitrumSepolia: {
      url: ARB_SEPOLIA_RPC_URL,
      accounts: getAccounts(),
      chainId: ARB_SEPOLIA_CHAIN_ID
    },
    localhost: {
      url: "http://127.0.0.1:8545",
      chainId: 31337
    }
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts"
  },
  etherscan: {
    apiKey: {
      "arb-sepolia": process.env.ARBISCAN_API_KEY || "",
      arbitrumSepolia: process.env.ARBISCAN_API_KEY || ""
    },
    customChains: [
      {
        network: "arb-sepolia",
        chainId: ARB_SEPOLIA_CHAIN_ID,
        urls: {
          apiURL: "https://api-sepolia.arbiscan.io/api",
          browserURL: "https://sepolia.arbiscan.io"
        }
      }
    ]
  }
};
