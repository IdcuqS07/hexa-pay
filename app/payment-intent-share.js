const SHAREABLE_PAYMENT_INTENT_VERSION = 1;

function normalizeString(value) {
  return String(value || "").trim();
}

function toBase64Url(bytes) {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });

  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(input) {
  const normalized = String(input || "")
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const padding = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  const binary = atob(`${normalized}${padding}`);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

export function createShareablePaymentIntentPayload(input = {}) {
  return {
    v: SHAREABLE_PAYMENT_INTENT_VERSION,
    source: normalizeString(input.source) || "payment-rail",
    title: normalizeString(input.title),
    merchantId: normalizeString(input.merchantId),
    terminalId: normalizeString(input.terminalId),
    receiptId: normalizeString(input.receiptId),
    quoteId: normalizeString(input.quoteId),
    invoiceId: normalizeString(input.invoiceId),
    merchantAddress: normalizeString(input.merchantAddress),
    amount: normalizeString(input.amount),
    currency: normalizeString(input.currency) || "USDC",
    createdAt: Number(input.createdAt || Date.now()),
  };
}

export function encodeShareablePaymentIntent(payload = {}) {
  const normalizedPayload = createShareablePaymentIntentPayload(payload);
  const bytes = new TextEncoder().encode(JSON.stringify(normalizedPayload));
  return toBase64Url(bytes);
}

export function decodeShareablePaymentIntent(encoded = "") {
  const rawValue = normalizeString(encoded);

  if (!rawValue) {
    return null;
  }

  try {
    const bytes = fromBase64Url(rawValue);
    const decoded = JSON.parse(new TextDecoder().decode(bytes));
    return createShareablePaymentIntentPayload(decoded);
  } catch (error) {
    return null;
  }
}

export function createShareablePaymentIntentUrl(payload = {}, baseUrl = "") {
  const origin =
    baseUrl ||
    (typeof window !== "undefined" ? `${window.location.origin}/pay.html` : "http://localhost/pay.html");
  const url = new URL(origin, typeof window !== "undefined" ? window.location.origin : "http://localhost");
  url.searchParams.set("intent", encodeShareablePaymentIntent(payload));
  return url.toString();
}

export function getShareablePaymentIntentPayloadFromUrl(href = "") {
  try {
    const base =
      href || (typeof window !== "undefined" ? window.location.href : "http://localhost/pay.html");
    const url = new URL(base, typeof window !== "undefined" ? window.location.origin : "http://localhost");
    return decodeShareablePaymentIntent(url.searchParams.get("intent") || "");
  } catch (error) {
    return null;
  }
}
