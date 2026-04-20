const crypto = require("crypto");
const { verifyMessage } = require("ethers");
const { resolveReceiptIssuerConfig } = require("./mock-receipt-issuer.cjs");

const RECEIPT_CHALLENGE_PREFIX = "receipt-challenge-v1";
const RECEIPT_CHALLENGE_TTL_MS = 5 * 60 * 1000;
const RECEIPT_CHALLENGE_ISSUER = resolveReceiptIssuerConfig("challenge");

function normalizeChallengeValue(value) {
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
    .createHmac("sha256", RECEIPT_CHALLENGE_ISSUER.secret)
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

function createReceiptGrantChallengeToken({
  role,
  viewer,
  quoteId,
  chainId,
  actorId = "",
  permitHash = "",
  sessionId = "",
  deviceFingerprint = "",
  nonce = crypto.randomBytes(16).toString("base64url"),
  issuedAt = Date.now(),
  expiresAt = Number(issuedAt) + RECEIPT_CHALLENGE_TTL_MS,
} = {}) {
  const payload = {
    version: 1,
    issuer: RECEIPT_CHALLENGE_ISSUER.issuer,
    keyId: RECEIPT_CHALLENGE_ISSUER.keyId,
    role: String(role || ""),
    viewer: normalizeChallengeValue(viewer),
    quoteId: String(quoteId || ""),
    chainId: String(chainId || ""),
    nonce: String(nonce || ""),
    actorId: String(actorId || ""),
    permitHash: String(permitHash || ""),
    sessionId: String(sessionId || ""),
    deviceFingerprint: String(deviceFingerprint || ""),
    issuedAt: Number(issuedAt || Date.now()),
    expiresAt: Number(expiresAt || Date.now() + RECEIPT_CHALLENGE_TTL_MS),
  };
  const encodedPayload = encodePayload(payload);
  const signature = signPayload(encodedPayload);
  return `${RECEIPT_CHALLENGE_PREFIX}.${encodedPayload}.${signature}`;
}

function parseReceiptGrantChallengeToken(challengeToken) {
  const normalizedChallengeToken = String(challengeToken || "").trim();

  if (!normalizedChallengeToken) {
    return null;
  }

  const segments = normalizedChallengeToken.split(".");

  if (segments.length !== 3 || segments[0] !== RECEIPT_CHALLENGE_PREFIX) {
    return {
      kind: "receipt-grant-challenge",
      raw: normalizedChallengeToken,
      valid: false,
      expired: false,
      issuer: "",
      keyId: "",
      role: "",
      viewer: "",
      quoteId: "",
      chainId: "",
      nonce: "",
      actorId: "",
      permitHash: "",
      sessionId: "",
      deviceFingerprint: "",
      issuedAt: 0,
      expiresAt: 0,
    };
  }

  const encodedPayload = segments[1];
  const signature = segments[2];
  const payload = decodePayload(encodedPayload);

  if (!payload || typeof payload !== "object") {
    return {
      kind: "receipt-grant-challenge",
      raw: normalizedChallengeToken,
      valid: false,
      expired: false,
      issuer: "",
      keyId: "",
      role: "",
      viewer: "",
      quoteId: "",
      chainId: "",
      nonce: "",
      actorId: "",
      permitHash: "",
      sessionId: "",
      deviceFingerprint: "",
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
    Boolean(normalizeChallengeValue(payload.viewer)) &&
    Boolean(String(payload.quoteId || "")) &&
    Boolean(String(payload.chainId || "")) &&
    Boolean(String(payload.nonce || "")) &&
    issuedAt > 0 &&
    expiresAt > 0;

  return {
    kind: "receipt-grant-challenge",
    raw: normalizedChallengeToken,
    valid: signatureValid && hasRequiredShape && !expired,
    expired,
    issuer: String(payload.issuer || ""),
    keyId: String(payload.keyId || ""),
    role: String(payload.role || ""),
    viewer: normalizeChallengeValue(payload.viewer),
    quoteId: String(payload.quoteId || ""),
    chainId: String(payload.chainId || ""),
    nonce: String(payload.nonce || ""),
    actorId: String(payload.actorId || ""),
    permitHash: String(payload.permitHash || ""),
    sessionId: String(payload.sessionId || ""),
    deviceFingerprint: String(payload.deviceFingerprint || ""),
    issuedAt,
    expiresAt,
  };
}

function createReceiptGrantChallengeMessage(challengeToken) {
  return [
    "HexaPay receipt grant challenge",
    "Sign this message to request a quote-scoped receipt grant.",
    `challenge=${String(challengeToken || "")}`,
  ].join("\n");
}

function verifyReceiptGrantChallengeSignature({
  challengeToken,
  challengeSignature,
  expectedViewer,
} = {}) {
  const parsedChallenge = parseReceiptGrantChallengeToken(challengeToken);

  if (!parsedChallenge || !parsedChallenge.valid) {
    return {
      valid: false,
      recoveredViewer: "",
      parsedChallenge,
    };
  }

  try {
    const recoveredViewer = normalizeChallengeValue(
      verifyMessage(
        createReceiptGrantChallengeMessage(parsedChallenge.raw),
        String(challengeSignature || ""),
      ),
    );

    return {
      valid: recoveredViewer === normalizeChallengeValue(expectedViewer),
      recoveredViewer,
      parsedChallenge,
    };
  } catch (error) {
    return {
      valid: false,
      recoveredViewer: "",
      parsedChallenge,
    };
  }
}

module.exports = {
  createReceiptGrantChallengeMessage,
  createReceiptGrantChallengeToken,
  parseReceiptGrantChallengeToken,
  verifyReceiptGrantChallengeSignature,
  RECEIPT_CHALLENGE_ISSUER: {
    issuer: RECEIPT_CHALLENGE_ISSUER.issuer,
    keyId: RECEIPT_CHALLENGE_ISSUER.keyId,
    secretSource: RECEIPT_CHALLENGE_ISSUER.secretSource,
  },
};
