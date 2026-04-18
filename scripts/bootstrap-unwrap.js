const fs = require("fs");
const hre = require("hardhat");
require("dotenv").config();

const TOKEN_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)"
];

function getAmountInput() {
  return process.argv[2] || process.env.UNWRAP_AMOUNT || "25";
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function encryptUint128(signer, amount) {
  const { Encryptable } = require("@cofhe/sdk");
  const { Ethers6Adapter } = require("@cofhe/sdk/adapters");
  const { getChainById } = require("@cofhe/sdk/chains");
  const { createCofheClient, createCofheConfig } = require("@cofhe/sdk/node");
  const network = await hre.ethers.provider.getNetwork();
  const supportedChain = getChainById(Number(network.chainId));

  if (!supportedChain) {
    throw new Error(`CoFHE is not configured for chain ${network.chainId.toString()}.`);
  }

  const config = createCofheConfig({
    supportedChains: [supportedChain]
  });
  const client = createCofheClient(config);
  const { publicClient, walletClient } = await Ethers6Adapter(hre.ethers.provider, signer);

  await client.connect(publicClient, walletClient);

  const [encryptedValue] = await client
    .encryptInputs([Encryptable.uint128(amount)])
    .setAccount(signer.address)
    .setChainId(Number(network.chainId))
    .execute();

  return {
    ctHash: encryptedValue.ctHash,
    securityZone: Number(encryptedValue.securityZone),
    utype: Number(encryptedValue.utype),
    signature: encryptedValue.signature
  };
}

async function main() {
  if (!fs.existsSync("deployment.json")) {
    throw new Error("deployment.json not found. Deploy HexaPay first.");
  }

  const deployment = JSON.parse(fs.readFileSync("deployment.json", "utf8"));
  const amountInput = getAmountInput();
  const [signer] = await hre.ethers.getSigners();
  const token = new hre.ethers.Contract(deployment.settlementToken, TOKEN_ABI, signer);
  const hexaPay = await hre.ethers.getContractAt("HexaPay", deployment.hexaPay || deployment.core);

  const [symbol, decimals, vaultAddress, walletBalanceBefore, backingBefore] = await Promise.all([
    token.symbol().catch(() => "USDC"),
    token.decimals().catch(() => 6),
    hexaPay.vault(),
    token.balanceOf(signer.address),
    hexaPay.getBackingBalance(),
  ]);

  const amount = hre.ethers.parseUnits(amountInput, Number(decimals));
  const encryptedAmount = await encryptUint128(signer, amount);

  console.log(`\n🔓 Requesting private ${symbol} unwrap on ${hre.network.name}\n`);
  console.log("Account:", signer.address);
  console.log("Vault:", vaultAddress);
  console.log("Requested unwrap:", amountInput, symbol);
  console.log("Wallet balance before:", hre.ethers.formatUnits(walletBalanceBefore, decimals), symbol);
  console.log("Vault backing before:", hre.ethers.formatUnits(backingBefore, decimals), symbol);

  const requestTx = await hexaPay.unwrap(encryptedAmount);
  const requestReceipt = await requestTx.wait();
  const requestLog = requestReceipt.logs
    .map((log) => {
      try {
        return hexaPay.interface.parseLog(log);
      } catch (error) {
        return null;
      }
    })
    .find((entry) => entry?.name === "WithdrawalRequested");

  if (!requestLog) {
    throw new Error("WithdrawalRequested event not found.");
  }

  const withdrawalId = requestLog.args.withdrawalId;
  console.log("Request tx:", requestTx.hash);
  console.log("Withdrawal ID:", withdrawalId);
  console.log("\n⏳ Waiting for async decrypt readiness...");

  let ready = false;
  for (let attempt = 1; attempt <= 24; attempt += 1) {
    const withdrawal = await hexaPay.getWithdrawal(withdrawalId);
    ready = Boolean(withdrawal.ready);
    console.log(`Attempt ${attempt}:`, ready ? "ready" : "pending");

    if (ready) {
      break;
    }

    await sleep(5000);
  }

  if (!ready) {
    throw new Error("Withdrawal decrypt result was not ready before timeout.");
  }

  console.log("\n🏁 Completing unwrap...");
  const completeTx = await hexaPay.completeUnwrap(withdrawalId);
  await completeTx.wait();

  const [walletBalanceAfter, backingAfter] = await Promise.all([
    token.balanceOf(signer.address),
    hexaPay.getBackingBalance(),
  ]);

  const summary = {
    network: hre.network.name,
    account: signer.address,
    token: deployment.settlementToken,
    vault: vaultAddress,
    core: deployment.hexaPay || deployment.core,
    amountInput,
    amountUnits: amount.toString(),
    withdrawalId,
    requestHash: requestTx.hash,
    completeHash: completeTx.hash,
    walletBalanceBefore: walletBalanceBefore.toString(),
    walletBalanceAfter: walletBalanceAfter.toString(),
    backingBefore: backingBefore.toString(),
    backingAfter: backingAfter.toString(),
    updatedAt: new Date().toISOString(),
  };

  fs.writeFileSync("unwrap-bootstrap.json", JSON.stringify(summary, null, 2));

  console.log("\n📋 Post-unwrap snapshot");
  console.log("Wallet balance after:", hre.ethers.formatUnits(walletBalanceAfter, decimals), symbol);
  console.log("Vault backing after:", hre.ethers.formatUnits(backingAfter, decimals), symbol);
  console.log("\nSaved to unwrap-bootstrap.json");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
