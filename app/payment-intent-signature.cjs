const { ethers } = require("ethers");

const DEFAULT_DOMAIN_NAME = "HexaPay";
const DEFAULT_DOMAIN_VERSION = "1";

function normalizeString(value) {
  return String(value || "");
}

function normalizeBigIntString(value) {
  const raw = String(value || "0").trim();
  if (!/^\d+$/.test(raw)) {
    throw new Error(`Invalid numeric string: ${value}`);
  }
  return raw;
}

function hashUtf8(value) {
  return ethers.keccak256(ethers.toUtf8Bytes(normalizeString(value)));
}

function buildIntentDomain({
  chainId,
  verifyingContract,
  name = DEFAULT_DOMAIN_NAME,
  version = DEFAULT_DOMAIN_VERSION,
}) {
  if (!chainId) {
    throw new Error("chainId is required for EIP-712 domain");
  }
  if (!verifyingContract) {
    throw new Error("verifyingContract is required for EIP-712 domain");
  }

  return {
    name,
    version,
    chainId: Number(chainId),
    verifyingContract,
  };
}

const PAYMENT_INTENT_TYPES = {
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
    { name: "expiresAtMs", type: "uint256" }
  ],
};

function toTypedIntent(intent) {
  if (!intent || typeof intent !== "object") {
    throw new Error("intent object is required");
  }

  return {
    challengeId: normalizeString(intent.challengeId),
    requestId: normalizeString(intent.requestId),
    receiptId: normalizeString(intent.receiptId),
    quoteId: normalizeString(intent.quoteId),
    merchantId: normalizeString(intent.merchantId),
    terminalId: normalizeString(intent.terminalId),
    payer: ethers.getAddress(intent.payer),
    merchant: ethers.getAddress(intent.merchant),
    token: ethers.getAddress(intent.token),
    amount: normalizeBigIntString(intent.amount),
    currency: normalizeString(intent.currency),
    decimals: Number(intent.decimals || 6),
    permitHash: normalizeString(intent.permitHash),
    sessionId: normalizeString(intent.sessionId),
    deviceFingerprintHash: normalizeString(intent.deviceFingerprintHash),
    issuedAtMs: normalizeBigIntString(intent.issuedAtMs),
    expiresAtMs: normalizeBigIntString(intent.expiresAtMs),
  };
}

function hashRequestId(requestId) {
  return hashUtf8(requestId);
}

function hashPaymentIntent(domain, intent) {
  const typedIntent = toTypedIntent(intent);
  return ethers.TypedDataEncoder.hash(domain, PAYMENT_INTENT_TYPES, typedIntent);
}

function recoverIntentSigner(domain, intent, signature) {
  const typedIntent = toTypedIntent(intent);
  return ethers.verifyTypedData(domain, PAYMENT_INTENT_TYPES, typedIntent, signature);
}

async function verifyIntentSignature({
  domain,
  intent,
  signature,
  expectedPayer,
}) {
  if (!signature) {
    return {
      ok: false,
      code: "missing_signature",
    };
  }

  let signer;
  let typedIntent;
  try {
    typedIntent = toTypedIntent(intent);
    signer = ethers.verifyTypedData(domain, PAYMENT_INTENT_TYPES, typedIntent, signature);
  } catch (error) {
    return {
      ok: false,
      code: "invalid_signature",
      error,
    };
  }

  if (expectedPayer && ethers.getAddress(signer) !== ethers.getAddress(expectedPayer)) {
    return {
      ok: false,
      code: "signer_mismatch",
      signer,
      expectedPayer: ethers.getAddress(expectedPayer),
    };
  }

  return {
    ok: true,
    signer: ethers.getAddress(signer),
    intentHash: hashPaymentIntent(domain, intent),
  };
}

module.exports = {
  DEFAULT_DOMAIN_NAME,
  DEFAULT_DOMAIN_VERSION,
  PAYMENT_INTENT_TYPES,
  buildIntentDomain,
  toTypedIntent,
  hashPaymentIntent,
  hashRequestId,
  recoverIntentSigner,
  verifyIntentSignature,
};
