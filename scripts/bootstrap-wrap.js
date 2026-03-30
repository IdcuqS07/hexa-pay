const fs = require("fs");
const hre = require("hardhat");
require("dotenv").config();

const TOKEN_ABI = [
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)"
];

function getAmountInput() {
  return process.argv[2] || process.env.WRAP_AMOUNT || "100";
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

  const [symbol, decimals, vaultAddress] = await Promise.all([
    token.symbol().catch(() => "TOKEN"),
    token.decimals().catch(() => 18),
    hexaPay.vault(),
  ]);

  const amount = hre.ethers.parseUnits(amountInput, Number(decimals));
  const [walletBalanceBefore, allowanceBefore, backingBefore] = await Promise.all([
    token.balanceOf(signer.address),
    token.allowance(signer.address, vaultAddress),
    hexaPay.getBackingBalance(),
  ]);

  console.log(`\n🏦 Bootstrapping HexaPay balance on ${hre.network.name}\n`);
  console.log("Account:", signer.address);
  console.log("Token:", `${symbol} (${decimals} decimals)`);
  console.log("Vault:", vaultAddress);
  console.log("Requested wrap:", amountInput, symbol);
  console.log("Wallet balance before:", hre.ethers.formatUnits(walletBalanceBefore, decimals), symbol);
  console.log("Allowance before:", hre.ethers.formatUnits(allowanceBefore, decimals), symbol);
  console.log("Vault backing before:", hre.ethers.formatUnits(backingBefore, decimals), symbol);

  if (walletBalanceBefore < amount) {
    throw new Error("Wallet balance is lower than the requested wrap amount.");
  }

  let approveHash = "";
  if (allowanceBefore < amount) {
    console.log("\n✍️ Approving settlement token...");
    const approveTx = await token.approve(vaultAddress, amount);
    await approveTx.wait();
    approveHash = approveTx.hash;
    console.log("Approve tx:", approveHash);
  } else {
    console.log("\n✅ Existing allowance is already sufficient.");
  }

  console.log("\n🔒 Wrapping settlement balance...");
  const wrapTx = await hexaPay.wrap(amount);
  await wrapTx.wait();
  console.log("Wrap tx:", wrapTx.hash);

  const [walletBalanceAfter, allowanceAfter, backingAfter] = await Promise.all([
    token.balanceOf(signer.address),
    token.allowance(signer.address, vaultAddress),
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
    approveHash,
    wrapHash: wrapTx.hash,
    walletBalanceBefore: walletBalanceBefore.toString(),
    walletBalanceAfter: walletBalanceAfter.toString(),
    allowanceBefore: allowanceBefore.toString(),
    allowanceAfter: allowanceAfter.toString(),
    backingBefore: backingBefore.toString(),
    backingAfter: backingAfter.toString(),
    updatedAt: new Date().toISOString(),
  };

  fs.writeFileSync("wrap-bootstrap.json", JSON.stringify(summary, null, 2));

  console.log("\n📋 Post-wrap snapshot");
  console.log("Wallet balance after:", hre.ethers.formatUnits(walletBalanceAfter, decimals), symbol);
  console.log("Allowance after:", hre.ethers.formatUnits(allowanceAfter, decimals), symbol);
  console.log("Vault backing after:", hre.ethers.formatUnits(backingAfter, decimals), symbol);
  console.log("\nSaved to wrap-bootstrap.json");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
