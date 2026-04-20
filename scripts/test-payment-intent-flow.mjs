#!/usr/bin/env node

/**
 * End-to-end test for payment intent flow
 * 
 * Flow:
 * 1. Create challenge
 * 2. Sign intent (simulated)
 * 3. Execute signed intent
 * 4. Verify onchain
 */

import "dotenv/config";
import { ethers } from "ethers";

const API_BASE = process.env.API_BASE || "http://localhost:3000";
const RPC_URL = process.env.ARB_SEPOLIA_RPC_URL || "https://sepolia-rollup.arbitrum.io/rpc";
const CONTRACT_ADDRESS = process.env.HEXAPAY_EXECUTOR_CONTRACT_ADDRESS;
const PAYMENT_TOKEN_ADDRESS =
  process.env.VITE_HEXAPAY_PAYMENT_TOKEN_ADDRESS ||
  process.env.VITE_SETTLEMENT_TOKEN_ADDRESS ||
  "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d";
const PAYMENT_TOKEN_DECIMALS = Number(process.env.VITE_HEXAPAY_PAYMENT_TOKEN_DECIMALS || 6);

const ERC20_ABI = [
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address owner) view returns (uint256)",
];
const DEFAULT_TEST_PAYER_PRIVATE_KEY =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";

function resolveTestPayerPrivateKey() {
  return process.env.TEST_PAYER_PRIVATE_KEY || DEFAULT_TEST_PAYER_PRIVATE_KEY;
}

async function inspectPayer(privateKey) {
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(privateKey, provider);
  const token = new ethers.Contract(PAYMENT_TOKEN_ADDRESS, ERC20_ABI, wallet);
  const [nativeBalance, tokenBalance, allowance] = await Promise.all([
    provider.getBalance(wallet.address),
    token.balanceOf(wallet.address),
    token.allowance(wallet.address, CONTRACT_ADDRESS),
  ]);

  return {
    address: wallet.address,
    nativeBalance,
    tokenBalance,
    allowance,
  };
}

function logPayerPreflight(snapshot) {
  console.log("\n0️⃣  Payer preflight...");
  console.log("   Payer:", snapshot.address);
  console.log("   ETH:", ethers.formatEther(snapshot.nativeBalance));
  console.log(
    "   Token:",
    ethers.formatUnits(snapshot.tokenBalance, PAYMENT_TOKEN_DECIMALS),
    `(${PAYMENT_TOKEN_ADDRESS})`,
  );
  console.log(
    "   Allowance:",
    ethers.formatUnits(snapshot.allowance, PAYMENT_TOKEN_DECIMALS),
    `to ${CONTRACT_ADDRESS}`,
  );
}

async function createChallenge(payerAddress) {
  console.log("\n1️⃣  Creating payment challenge...");
  
  const response = await fetch(`${API_BASE}/api/payments/challenges`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      requestId: `test-req-${Date.now()}`,
      receiptId: `receipt-${Date.now()}`,
      merchantId: "merchant-test-001",
      terminalId: "terminal-test-001",
      amount: "1000000",
      currency: "USDC",
      payer: payerAddress,
      merchant: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to create challenge: ${response.statusText}`);
  }

  const payload = await response.json();
  const challenge = payload?.record || payload?.challenge || payload;
  console.log("✅ Challenge created:", challenge.challengeId);
  return challenge;
}

async function signIntent(intent, privateKey, challengeDomain = null) {
  console.log("\n2️⃣  Signing payment intent with EIP-712...");
  
  const wallet = new ethers.Wallet(privateKey);
  
  const domain = challengeDomain || {
    name: "HexaPay",
    version: "1",
    chainId: 421614,
    verifyingContract: CONTRACT_ADDRESS,
  };

  const types = {
    PaymentIntent: [
      { name: "challengeId", type: "string" },
      { name: "requestId", type: "string" },
      { name: "receiptId", type: "string" },
      { name: "quoteId", type: "string" },
      { name: "merchantId", type: "string" },
      { name: "terminalId", type: "string" },
      { name: "payer", type: "address" },
      { name: "merchant", type: "address" },
      { name: "token", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "currency", type: "string" },
      { name: "decimals", type: "uint8" },
      { name: "permitHash", type: "string" },
      { name: "sessionId", type: "string" },
      { name: "deviceFingerprintHash", type: "string" },
      { name: "issuedAtMs", type: "uint256" },
      { name: "expiresAtMs", type: "uint256" },
    ],
  };

  const signature = await wallet.signTypedData(domain, types, intent);
  const recoveredSigner = ethers.verifyTypedData(domain, types, intent, signature);
  console.log("✅ Intent signed:", signature.slice(0, 20) + "...");
  console.log("   Local recovered signer:", recoveredSigner);
  return signature;
}

async function ensureTokenApproval(privateKey, amount) {
  console.log("\n3️⃣  Ensuring token approval...");

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(privateKey, provider);
  const token = new ethers.Contract(PAYMENT_TOKEN_ADDRESS, ERC20_ABI, wallet);
  const normalizedAmount = BigInt(String(amount));
  const allowance = await token.allowance(wallet.address, CONTRACT_ADDRESS);

  if (allowance >= normalizedAmount) {
    console.log("✅ Approval already in place");
    return;
  }

  let tx;
  try {
    tx = await token.approve(CONTRACT_ADDRESS, normalizedAmount);
  } catch (error) {
    if (error?.code === "INSUFFICIENT_FUNDS") {
      const nativeBalance = await provider.getBalance(wallet.address);
      const friendlyError = new Error(
        `Payer ${wallet.address} has insufficient ETH for approval gas on Arbitrum Sepolia. Balance: ${ethers.formatEther(nativeBalance)} ETH. Set TEST_PAYER_PRIVATE_KEY to a funded payer wallet before rerunning.`,
      );
      friendlyError.code = "INSUFFICIENT_FUNDS";
      friendlyError.cause = error;
      throw friendlyError;
    }
    throw error;
  }
  await tx.wait();
  console.log("✅ Approval tx:", tx.hash);
}

async function executeIntent(intent, signature) {
  console.log("\n4️⃣  Executing signed intent...");
  
  const response = await fetch(`${API_BASE}/api/payments/execute`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ intent, signature }),
  });

  if (!response.ok) {
    const error = await response.json();
    const details =
      error && typeof error.details === "object" && error.details
        ? ` details=${JSON.stringify(error.details)}`
        : "";
    throw new Error(`Execution failed: ${error.error} (${error.code})${details}`);
  }

  const result = await response.json();
  console.log("✅ Intent executed!");
  console.log("   Signer:", result.signer);
  console.log("   Intent Hash:", result.intentHash);
  console.log("   Tx Hash:", result.txHash);
  console.log("   Block:", result.blockNumber);
  return result;
}

async function verifyApiLedger(payerAddress, merchantAddress, requestId, txHash) {
  console.log("\n6️⃣  Verifying payment ledger API...");

  const url = new URL(`${API_BASE}/api/payments/list`);
  url.searchParams.set("wallet", payerAddress);
  url.searchParams.set("limit", "10");

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Payment history lookup failed: ${response.status} ${response.statusText}`);
  }

  const payload = await response.json();
  const record = Array.isArray(payload.records)
    ? payload.records.find((entry) => entry.requestId === requestId)
    : null;

  if (!record) {
    throw new Error(`Payment history record not found for requestId ${requestId}`);
  }

  if (String(record.status) !== "settled") {
    throw new Error(`Payment history record has unexpected status ${record.status}`);
  }

  if (String(record.txHash || "").toLowerCase() !== String(txHash || "").toLowerCase()) {
    throw new Error(`Payment history txHash mismatch for requestId ${requestId}`);
  }

  if (String(record.payer || "").toLowerCase() !== String(payerAddress || "").toLowerCase()) {
    throw new Error(`Payment history payer mismatch for requestId ${requestId}`);
  }

  if (String(record.merchant || "").toLowerCase() !== String(merchantAddress || "").toLowerCase()) {
    throw new Error(`Payment history merchant mismatch for requestId ${requestId}`);
  }

  console.log("✅ Payment history API contains settled record");
}

async function verifyOnchain(intentHash, txHash) {
  console.log("\n5️⃣  Verifying onchain execution...");
  
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const contract = new ethers.Contract(
    CONTRACT_ADDRESS,
    [
      "function wasIntentExecuted(bytes32) view returns (bool)",
      "function paymentRecords(bytes32) view returns (bytes32,bytes32,address,address,address,uint256,uint256)",
    ],
    provider
  );

  const executed = await contract.wasIntentExecuted(intentHash);
  console.log("   Intent executed:", executed);

  if (executed) {
    const record = await contract.paymentRecords(intentHash);
    console.log("   Payment record:");
    console.log("     Token:", record[2]);
    console.log("     Payer:", record[3]);
    console.log("     Merchant:", record[4]);
    console.log("     Amount:", record[5].toString());
    console.log("     Executed at:", new Date(Number(record[6]) * 1000).toISOString());
  }

  const receipt = await provider.getTransactionReceipt(txHash);
  console.log("   Transaction status:", receipt.status === 1 ? "✅ Success" : "❌ Failed");
  console.log("   Gas used:", receipt.gasUsed.toString());
  
  console.log("\n🔗 View on Arbiscan:");
  console.log(`   https://sepolia.arbiscan.io/tx/${txHash}`);
}

async function main() {
  console.log("🚀 HexaPay Payment Intent Flow Test");
  console.log("=====================================");

  if (!CONTRACT_ADDRESS) {
    console.error("❌ HEXAPAY_EXECUTOR_CONTRACT_ADDRESS not set");
    process.exit(1);
  }

  try {
    const testPrivateKey = resolveTestPayerPrivateKey();
    if (!process.env.TEST_PAYER_PRIVATE_KEY) {
      console.warn(
        "⚠️  TEST_PAYER_PRIVATE_KEY not set. Falling back to the default Hardhat test account, which is usually unfunded on Arbitrum Sepolia.",
      );
    }
    const payerSnapshot = await inspectPayer(testPrivateKey);
    logPayerPreflight(payerSnapshot);

    // Step 1: Create challenge
    const challenge = await createChallenge(payerSnapshot.address);

    // Step 2: Build intent
    const intent = {
      challengeId: challenge.challengeId,
      requestId: challenge.requestId,
      receiptId: challenge.receiptId,
      quoteId: challenge.quoteId || "",
      merchantId: challenge.merchantId,
      terminalId: challenge.terminalId,
      payer: challenge.payer,
      merchant: challenge.merchant,
      token: PAYMENT_TOKEN_ADDRESS,
      amount: String(challenge.amount),
      currency: challenge.currency,
      decimals: String(PAYMENT_TOKEN_DECIMALS),
      permitHash: "",
      sessionId: "",
      deviceFingerprintHash: "",
      issuedAtMs: String(challenge.issuedAtMs),
      expiresAtMs: String(challenge.expiresAtMs),
    };

    // Step 3: Sign intent (using test private key)
    const signature = await signIntent(intent, testPrivateKey, challenge.domain || null);

    // Step 4: Approve token
    await ensureTokenApproval(testPrivateKey, intent.amount);

    // Step 5: Execute
    const result = await executeIntent(intent, signature);

    // Step 6: Verify onchain
    await verifyOnchain(result.intentHash, result.txHash);

    // Step 7: Verify API ledger
    await verifyApiLedger(intent.payer, intent.merchant, intent.requestId, result.txHash);

    console.log("\n✅ Full flow completed successfully!");
    
  } catch (error) {
    console.error("\n❌ Test failed:", error.message);
    if (error.details) {
      console.error("   Details:", error.details);
    }
    process.exit(1);
  }
}

main();
