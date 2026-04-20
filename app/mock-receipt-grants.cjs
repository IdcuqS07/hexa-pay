const crypto = require("crypto");
const { resolveReceiptIssuerConfig } = require("./mock-receipt-issuer.cjs");

const RECEIPT_GRANT_PREFIX = "receipt-grant-v1";
const RECEIPT_GRANT_TTL_MS = 30 * 60 * 1000;
const RECEIPT_GRANT_ISSUER = resolveReceiptIssuerConfig("grant");

function normalizeGrantValue(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function encodePayload(payload) {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodePayload(encodedPayload) {
  try {
    return JSON.parse(Buffer.from(String(encodedPayload || ""), "base64url").toString("utf8"));
  } catch (error) {
    return null;
  }
}

function signPayload(encodedPayload) {
  return crypto
    .createHmac("sha256", RECEIPT_GRANT_ISSUER.secret)
    .update(encodedPayload)
    .digest("base64url");
}

function isSignatureMatch(expectedSignature, actualSignature) {
  const expectedBuffer = Buffer.from(String(expectedSignature || ""), "utf8");
  const actualBuffer = Buffer.from(String(actualSignature || ""), "utf8");

  if (expectedBuffer.length === 0 || expectedBuffer.length !== actualBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(expectedBuffer, actualBuffer);
}

function createReceiptAccessGrantToken({
  role,
  viewer,
  quoteId,
  chainId,
  issuedAt = Date.now(),
  expiresAt = Number(issuedAt) + RECEIPT_GRANT_TTL_MS,
} = {}) {
  const payload = {
    version: 1,
    issuer: RECEIPT_GRANT_ISSUER.issuer,
    keyId: RECEIPT_GRANT_ISSUER.keyId,
    role: String(role || ""),
    viewer: normalizeGrantValue(viewer),
    quoteId: String(quoteId || ""),
    chainId: String(chainId || ""),
    issuedAt: Number(issuedAt || Date.now()),
    expiresAt: Number(expiresAt || Date.now() + RECEIPT_GRANT_TTL_MS),
  };
  const encodedPayload = encodePayload(payload);
  const signature = signPayload(encodedPayload);
  return `${RECEIPT_GRANT_PREFIX}.${encodedPayload}.${signature}`;
}

function parseReceiptAccessGrantToken(grantToken) {
  const normalizedGrantToken = String(grantToken || "").trim();

  if (!normalizedGrantToken) {
    return null;
  }

  const segments = normalizedGrantToken.split(".");

  if (segments.length !== 3 || segments[0] !== RECEIPT_GRANT_PREFIX) {
    return {
      kind: "receipt-grant",
      raw: normalizedGrantToken,
      valid: false,
      expired: false,
      issuer: "",
      keyId: "",
      role: "",
      viewer: "",
      quoteId: "",
      chainId: "",
      issuedAt: 0,
      expiresAt: 0,
    };
  }

  const encodedPayload = segments[1];
  const signature = segments[2];
  const payload = decodePayload(encodedPayload);

  if (!payload || typeof payload !== "object") {
    return {
      kind: "receipt-grant",
      raw: normalizedGrantToken,
      valid: false,
      expired: false,
      issuer: "",
      keyId: "",
      role: "",
      viewer: "",
      quoteId: "",
      chainId: "",
      issuedAt: 0,
      expiresAt: 0,
    };
  }

  const expectedSignature = signPayload(encodedPayload);
  const signatureValid = isSignatureMatch(expectedSignature, signature);
  const issuedAt = Number(payload.issuedAt || 0);
  const expiresAt = Number(payload.expiresAt || 0);
  const expired = !expiresAt || expiresAt <= Date.now();
  const hasRequiredShape =
    Number(payload.version || 0) === 1 &&
    Boolean(String(payload.issuer || "")) &&
    Boolean(String(payload.keyId || "")) &&
    Boolean(String(payload.role || "")) &&
    Boolean(normalizeGrantValue(payload.viewer)) &&
    Boolean(String(payload.quoteId || "")) &&
    Boolean(String(payload.chainId || "")) &&
    issuedAt > 0 &&
    expiresAt > 0;

  return {
    kind: "receipt-grant",
    raw: normalizedGrantToken,
    valid: signatureValid && hasRequiredShape && !expired,
    expired,
    issuer: String(payload.issuer || ""),
    keyId: String(payload.keyId || ""),
    role: String(payload.role || ""),
    viewer: normalizeGrantValue(payload.viewer),
    quoteId: String(payload.quoteId || ""),
    chainId: String(payload.chainId || ""),
    issuedAt,
    expiresAt,
  };
}

module.exports = {
  createReceiptAccessGrantToken,
  parseReceiptAccessGrantToken,
  RECEIPT_GRANT_ISSUER: {
    issuer: RECEIPT_GRANT_ISSUER.issuer,
    keyId: RECEIPT_GRANT_ISSUER.keyId,
    secretSource: RECEIPT_GRANT_ISSUER.secretSource,
  },
};
