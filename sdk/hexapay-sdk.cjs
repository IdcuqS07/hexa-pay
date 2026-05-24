const { parseUnits } = require("ethers");
const {
  PAYMENT_INTENT_TYPES,
  buildIntentDomain,
  hashRequestId,
} = require("../app/payment-intent-signature.cjs");

const DEFAULT_HEXAPAY_DOMAIN = {
  name: "HexaPay",
  version: "1",
  chainId: 421614,
};

const DEFAULT_PAYMENT_ASSET = {
  symbol: "USDC",
  decimals: 6,
  token: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d",
};

function normalizeString(value) {
  return String(value || "");
}

function normalizePositiveInteger(value, fallback = 0) {
  const parsed = Number.parseInt(String(value || fallback), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function resolveBaseUrl(baseUrl = "") {
  const explicit = normalizeString(baseUrl).trim();
  if (explicit) {
    return explicit.replace(/\/+$/, "");
  }

  if (typeof window !== "undefined" && window.location?.origin) {
    return String(window.location.origin).replace(/\/+$/, "");
  }

  return "http://localhost:3000";
}

function resolveFetchImplementation(fetchImplementation) {
  if (typeof fetchImplementation === "function") {
    return fetchImplementation;
  }

  if (typeof fetch === "function") {
    return fetch.bind(globalThis);
  }

  throw new Error("A fetch implementation is required.");
}

function buildJsonHeaders(extra = {}) {
  return {
    "Content-Type": "application/json",
    ...extra,
  };
}

function resolveAtomicAmount({ amount, amountAtomic, decimals }) {
  if (amountAtomic !== undefined && amountAtomic !== null && String(amountAtomic).trim()) {
    return String(amountAtomic);
  }

  return parseUnits(String(amount || "0"), Number(decimals || DEFAULT_PAYMENT_ASSET.decimals)).toString();
}

function createRequestId(prefix = "req_sdk") {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

class HexaPaySdk {
  constructor(options = {}) {
    this.baseUrl = resolveBaseUrl(options.baseUrl);
    this.fetch = resolveFetchImplementation(options.fetch);
    this.chainId = Number(options.chainId || DEFAULT_HEXAPAY_DOMAIN.chainId);
    this.verifyingContract = normalizeString(options.verifyingContract);
    this.domainName = normalizeString(options.domainName || DEFAULT_HEXAPAY_DOMAIN.name);
    this.domainVersion = normalizeString(options.domainVersion || DEFAULT_HEXAPAY_DOMAIN.version);
    this.currency = normalizeString(options.currency || DEFAULT_PAYMENT_ASSET.symbol);
    this.tokenDecimals = normalizePositiveInteger(
      options.tokenDecimals,
      DEFAULT_PAYMENT_ASSET.decimals,
    );
    this.tokenAddress = normalizeString(options.tokenAddress || DEFAULT_PAYMENT_ASSET.token);
  }

  buildDomain(overrides = {}) {
    return buildIntentDomain({
      chainId: overrides.chainId || this.chainId,
      verifyingContract: overrides.verifyingContract || this.verifyingContract,
      name: overrides.name || this.domainName,
      version: overrides.version || this.domainVersion,
    });
  }

  async request(pathname, { method = "GET", body, headers = {} } = {}) {
    const response = await this.fetch(`${this.baseUrl}${pathname}`, {
      method,
      headers: buildJsonHeaders(headers),
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      const error = new Error(
        payload.error || `HexaPay request failed with status ${response.status}`,
      );
      error.code = payload.code || "hexapay_request_failed";
      error.details = payload.details || null;
      throw error;
    }

    return payload;
  }

  buildIntentFromChallenge(challenge = {}, options = {}) {
    const decimals = normalizePositiveInteger(
      options.decimals !== undefined ? options.decimals : challenge.decimals,
      this.tokenDecimals,
    );
    const amount = resolveAtomicAmount({
      amount: options.amount,
      amountAtomic: options.amountAtomic || challenge.amount,
      decimals,
    });

    return {
      challengeId: normalizeString(challenge.challengeId),
      requestId: normalizeString(challenge.requestId),
      receiptId: normalizeString(options.receiptId || challenge.receiptId),
      quoteId: normalizeString(options.quoteId || challenge.quoteId),
      source: normalizeString(
        options.source !== undefined ? options.source : challenge.source,
      ),
      merchantId: normalizeString(options.merchantId || challenge.merchantId),
      terminalId: normalizeString(options.terminalId || challenge.terminalId),
      payer: normalizeString(options.payer || challenge.payer),
      merchant: normalizeString(options.merchant || challenge.merchant),
      token: normalizeString(options.token || this.tokenAddress),
      amount,
      currency: normalizeString(options.currency || challenge.currency || this.currency),
      decimals,
      permitHash: normalizeString(options.permitHash),
      sessionId: normalizeString(options.sessionId || challenge.sessionId),
      deviceFingerprintHash: normalizeString(
        options.deviceFingerprintHash || challenge.deviceFingerprintHash,
      ),
      issuedAtMs: String(options.issuedAtMs || challenge.issuedAtMs || Date.now()),
      expiresAtMs: String(options.expiresAtMs || challenge.expiresAtMs || 0),
    };
  }

  async createIntent(input = {}) {
    const requestId = normalizeString(input.requestId || createRequestId(input.requestPrefix));
    const decimals = normalizePositiveInteger(input.decimals, this.tokenDecimals);
    const amountAtomic = resolveAtomicAmount({
      amount: input.amount,
      amountAtomic: input.amountAtomic,
      decimals,
    });
    const challengeResponse = await this.request("/api/payments/challenges", {
      method: "POST",
      headers: {
        ...(input.permitHash ? { "x-receipt-permit-hash": input.permitHash } : {}),
        ...(input.sessionId ? { "x-session-id": input.sessionId } : {}),
        ...(input.deviceFingerprintHash
          ? { "x-device-fingerprint-hash": input.deviceFingerprintHash }
          : {}),
        ...(input.actorId ? { "x-actor-id": input.actorId } : {}),
      },
      body: {
        requestId,
        receiptId: normalizeString(input.receiptId || input.invoiceId),
        invoiceId: normalizeString(input.invoiceId),
        quoteId: normalizeString(input.quoteId),
        source: normalizeString(input.source),
        merchantId: normalizeString(input.merchantId),
        terminalId: normalizeString(input.terminalId),
        amount: amountAtomic,
        currency: normalizeString(input.currency || this.currency),
        payer: normalizeString(input.payer),
        merchant: normalizeString(input.merchant),
        actorId: normalizeString(input.actorId || input.payer),
        permitHash: normalizeString(input.permitHash),
        sessionId: normalizeString(input.sessionId),
        deviceFingerprintHash: normalizeString(input.deviceFingerprintHash),
      },
    });
    const challenge = challengeResponse.record || {};

    return {
      challenge,
      intent: this.buildIntentFromChallenge(challenge, {
        ...input,
        amountAtomic,
        decimals,
        token: input.token || this.tokenAddress,
      }),
      response: challengeResponse,
    };
  }

  async signIntent(intent, signer, options = {}) {
    if (!signer || typeof signer.signTypedData !== "function") {
      throw new Error("A signer with signTypedData(domain, types, value) is required.");
    }

    const domain =
      options.domain ||
      options.challenge?.domain ||
      options.challengeDomain ||
      this.buildDomain();
    return signer.signTypedData(domain, PAYMENT_INTENT_TYPES, intent);
  }

  async executePayment({ intent, signature }) {
    return this.request("/api/payments/execute", {
      method: "POST",
      body: {
        intent,
        signature,
      },
    });
  }

  async verifyPayment({ requestId, intent, signature, expectedPayer } = {}) {
    return this.request("/api/payments/verify", {
      method: "POST",
      body: {
        requestId: normalizeString(requestId || intent?.requestId),
        intent: intent || null,
        signature: normalizeString(signature),
        expectedPayer: normalizeString(expectedPayer),
      },
    });
  }
}

function createHexaPaySdk(options = {}) {
  return new HexaPaySdk(options);
}

module.exports = {
  DEFAULT_HEXAPAY_DOMAIN,
  DEFAULT_PAYMENT_ASSET,
  HexaPaySdk,
  PAYMENT_INTENT_TYPES,
  buildIntentDomain,
  createHexaPaySdk,
  createRequestId,
  hashRequestId,
};
