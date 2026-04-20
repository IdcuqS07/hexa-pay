import { Contract, getAddress, keccak256, toUtf8Bytes } from "ethers";
import { getChainMetadata } from "../src/contracts/config.js";
import { appendPrivateQuoteStoreMode } from "./config.js";

const DEFAULT_PRIVATE_QUOTE_ADDRESS = "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512";
const DEFAULT_PRIVATE_QUOTE_CHAIN_ID = "31337";

const NETWORK_TO_CHAIN_ID = {
  localhost: "31337",
  hardhat: "31337",
  "arb-sepolia": "421614",
  arbitrumSepolia: "421614",
  "arbitrum-sepolia": "421614",
};

const PRIVATE_QUOTE_ABI = [
  "error AlreadyExists()",
  "error Expired()",
  "error InvalidAmount()",
  "error InvalidPayer()",
  "error InvalidState()",
  "error NotAuthorized()",
  "error QuoteNotFound()",
  "function createQuote(bytes32 id, address payer, bytes32 amountCt, uint64 expiresAt)",
  "function grantAccess(bytes32 id, address payer)",
  "function settleQuote(bytes32 id, bool skipPreview)",
  "function getQuote(bytes32 id) view returns (address merchant, address payer, uint64 expiresAt, uint8 status, bool accessGranted)",
  "function getEncryptedAmount(bytes32 id) view returns (bytes32)",
];

const PRIVATE_QUOTE_STATUS_LABELS = {
  0: "None",
  1: "Pending",
  2: "Settled",
  3: "Cancelled",
  4: "Expired",
};

let privateQuoteConfigPromise = null;

function fallbackPrivateQuoteConfig() {
  return {
    address: DEFAULT_PRIVATE_QUOTE_ADDRESS,
    chainId: DEFAULT_PRIVATE_QUOTE_CHAIN_ID,
    network: getChainMetadata(DEFAULT_PRIVATE_QUOTE_CHAIN_ID).label,
    source: "fallback",
    isFallback: true,
  };
}

function normalizePrivateQuoteConfig(payload, source = "/deployment-private-quote.json") {
  if (!payload || typeof payload !== "object") {
    return fallbackPrivateQuoteConfig();
  }

  const chainId =
    String(payload.chainId || "") ||
    NETWORK_TO_CHAIN_ID[payload.network] ||
    DEFAULT_PRIVATE_QUOTE_CHAIN_ID;

  const rawAddress =
    payload.contracts?.PrivateMerchantQuote ||
    payload.ui?.addresses?.privateQuote ||
    payload.privateQuote ||
    payload.address ||
    "";

  try {
    return {
      address: getAddress(rawAddress),
      chainId,
      network: payload.network || getChainMetadata(chainId).label,
      source,
      isFallback: false,
    };
  } catch (error) {
    return fallbackPrivateQuoteConfig();
  }
}

export async function loadPrivateQuoteConfig({ refresh = false } = {}) {
  if (!privateQuoteConfigPromise || refresh) {
    privateQuoteConfigPromise = (async () => {
      if (typeof window === "undefined") {
        return fallbackPrivateQuoteConfig();
      }

      try {
        const response = await fetch(`/deployment-private-quote.json?t=${Date.now()}`, {
          cache: "no-store",
        });

        if (response.ok) {
          const payload = await response.json();
          return normalizePrivateQuoteConfig(payload);
        }
      } catch (error) {
        error;
      }

      return fallbackPrivateQuoteConfig();
    })();
  }

  return privateQuoteConfigPromise;
}

export function getPrivateQuoteContract(address, runner) {
  return new Contract(address, PRIVATE_QUOTE_ABI, runner);
}

async function assertPrivateQuoteContractCode({ runner, address }) {
  const provider = runner?.provider || runner;

  if (!provider || typeof provider.getCode !== "function") {
    return;
  }

  const code = await provider.getCode(address);

  if (!code || code === "0x") {
    throw new Error(
      "Private quote contract is missing at the configured address. If the local chain was restarted, redeploy the contract and refresh the app.",
    );
  }
}

export function buildPrivateQuoteId(seed = `${Date.now()}_${Math.random()}`) {
  return keccak256(toUtf8Bytes(String(seed)));
}

export function encryptPrivateQuoteAmountBootstrap(amount) {
  return keccak256(toUtf8Bytes(`enc_amount_${String(amount)}`));
}

export function buildPrivateQuotePaymentLink(quoteId) {
  const url = appendPrivateQuoteStoreMode(new URL("/pay.html", window.location.origin));
  url.searchParams.set("id", quoteId);
  return url.toString();
}

export function getPrivateQuoteStatusLabel(status) {
  return PRIVATE_QUOTE_STATUS_LABELS[Number(status)] || "Unknown";
}

export function formatPrivateQuoteExpiry(unixTs) {
  return new Date(Number(unixTs) * 1000).toLocaleString();
}

export function formatPrivateQuoteReceiptTime(timestamp) {
  return new Date(Number(timestamp || 0)).toLocaleString();
}

export function isPrivateQuoteExpired(unixTs) {
  return Math.floor(Date.now() / 1000) > Number(unixTs || 0);
}

export function canSettlePrivateQuote(quote) {
  if (!quote) {
    return false;
  }

  return Number(quote.status) === 1 && !isPrivateQuoteExpired(quote.expiresAt);
}

export async function createPrivateQuote({
  signer,
  address,
  payer,
  amount,
  expirySeconds = 3600,
}) {
  if (!signer) {
    throw new Error("Connect a wallet first.");
  }

  const contract = getPrivateQuoteContract(address, signer);
  const id = buildPrivateQuoteId(`${payer}_${amount}_${Date.now()}`);
  const expiresAt = Math.floor(Date.now() / 1000) + expirySeconds;
  const amountCt = encryptPrivateQuoteAmountBootstrap(amount);
  const tx = await contract.createQuote(id, payer, amountCt, expiresAt);
  const receipt = await tx.wait();

  return {
    id,
    payer,
    amount,
    amountCt,
    expiresAt,
    txHash: tx.hash,
    blockNumber: receipt?.blockNumber || 0,
    paymentLink: buildPrivateQuotePaymentLink(id),
  };
}

export async function readPrivateQuote({ runner, address, quoteId }) {
  await assertPrivateQuoteContractCode({ runner, address });
  const contract = getPrivateQuoteContract(address, runner);
  const result = await contract.getQuote(quoteId);

  return {
    id: quoteId,
    merchant: result[0],
    payer: result[1],
    expiresAt: Number(result[2]),
    status: Number(result[3]),
    statusLabel: getPrivateQuoteStatusLabel(result[3]),
    accessGranted: Boolean(result[4]),
  };
}

export async function settlePrivateQuote({ signer, address, quoteId, skipPreview = true }) {
  if (!signer) {
    throw new Error("Connect a wallet first.");
  }

  const contract = getPrivateQuoteContract(address, signer);
  const tx = await contract.settleQuote(quoteId, skipPreview);
  const receipt = await tx.wait();

  return {
    txHash: tx.hash,
    blockNumber: receipt?.blockNumber || 0,
  };
}

export function buildPrivateQuoteReceipt({
  quoteId,
  quote,
  txHash,
  settledAt = Date.now(),
  paymentLink = "",
}) {
  return {
    quoteId,
    merchant: quote?.merchant || "",
    payer: quote?.payer || "",
    status: "Settled",
    settledAt,
    txHash,
    paymentLink,
  };
}

export function getPrivateQuoteErrorMessage(error) {
  const message =
    error?.shortMessage ||
    error?.reason ||
    error?.info?.error?.message ||
    error?.message ||
    String(error || "");

  if (/user rejected/i.test(message)) {
    return "Transaction was rejected in the wallet.";
  }

  if (/QuoteNotFound/i.test(message)) {
    return "Quote was not found on the configured private quote contract. This usually means the payment link came from an older local deployment.";
  }

  if (/AlreadyExists/i.test(message)) {
    return "Quote ID already exists. Try again.";
  }

  if (/InvalidPayer/i.test(message)) {
    return "Payer address is invalid.";
  }

  if (/NotAuthorized/i.test(message)) {
    return "This wallet is not authorized for the selected quote.";
  }

  if (/Expired/i.test(message)) {
    return "The quote has already expired.";
  }

  if (/wrong network|unknown chain preset/i.test(message)) {
    return "Switch the wallet to the private quote network first.";
  }

  if (/contract is missing at the configured address/i.test(message)) {
    return "Private quote contract is not deployed on the current local chain. Redeploy after restarting Anvil, then refresh the app.";
  }

  if (/could not decode result data/i.test(message)) {
    return "Private quote route could not read the configured contract. The local deployment address or quote link is likely stale.";
  }

  return message || "Private quote action failed.";
}
