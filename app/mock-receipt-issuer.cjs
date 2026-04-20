const crypto = require("crypto");

const DEFAULT_RECEIPT_ISSUER_ID = "hexapay.mock-receipt-api";
const DEFAULT_RECEIPT_ISSUER_KEY_ID = "dev-seed-v1";
const DEFAULT_RECEIPT_ISSUER_SEED = "hexapay.private-quotes.mock-receipt-issuer.seed.v1";

function normalizeIssuerPurpose(purpose) {
  const normalizedPurpose = String(purpose || "")
    .trim()
    .toLowerCase();

  return normalizedPurpose || "shared";
}

function createPurposeLabel(purpose) {
  return `hexapay.private-quotes.receipt-token.${normalizeIssuerPurpose(purpose)}`;
}

function deriveReceiptIssuerSecret(seed, purpose) {
  return crypto
    .createHmac("sha256", Buffer.from(String(seed || DEFAULT_RECEIPT_ISSUER_SEED), "utf8"))
    .update(createPurposeLabel(purpose))
    .digest();
}

function resolveReceiptIssuerSecret(purpose) {
  const normalizedPurpose = normalizeIssuerPurpose(purpose);
  const purposeEnvName = `MOCK_RECEIPT_${normalizedPurpose.toUpperCase()}_SECRET`;
  const purposeSecret = String(process.env[purposeEnvName] || "");

  if (purposeSecret) {
    return {
      secret: Buffer.from(purposeSecret, "utf8"),
      source: `env:${purposeEnvName}`,
    };
  }

  const sharedSecret = String(process.env.MOCK_RECEIPT_ISSUER_SECRET || "");

  if (sharedSecret) {
    return {
      secret: Buffer.from(sharedSecret, "utf8"),
      source: "env:MOCK_RECEIPT_ISSUER_SECRET",
    };
  }

  const configuredSeed = String(process.env.MOCK_RECEIPT_ISSUER_SEED || "");

  if (configuredSeed) {
    return {
      secret: deriveReceiptIssuerSecret(configuredSeed, normalizedPurpose),
      source: "env:MOCK_RECEIPT_ISSUER_SEED",
    };
  }

  return {
    secret: deriveReceiptIssuerSecret(DEFAULT_RECEIPT_ISSUER_SEED, normalizedPurpose),
    source: "default-dev-seed",
  };
}

function resolveReceiptIssuerConfig(purpose) {
  const normalizedPurpose = normalizeIssuerPurpose(purpose);
  const issuerId = String(process.env.MOCK_RECEIPT_ISSUER_ID || DEFAULT_RECEIPT_ISSUER_ID);
  const baseKeyId = String(process.env.MOCK_RECEIPT_ISSUER_KEY_ID || DEFAULT_RECEIPT_ISSUER_KEY_ID);
  const resolvedSecret = resolveReceiptIssuerSecret(normalizedPurpose);

  return {
    purpose: normalizedPurpose,
    issuer: issuerId,
    keyId: `${baseKeyId}.${normalizedPurpose}`,
    secret: resolvedSecret.secret,
    secretSource: resolvedSecret.source,
  };
}

module.exports = {
  DEFAULT_RECEIPT_ISSUER_ID,
  DEFAULT_RECEIPT_ISSUER_KEY_ID,
  DEFAULT_RECEIPT_ISSUER_SEED,
  resolveReceiptIssuerConfig,
};
