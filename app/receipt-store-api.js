import { ReceiptStore } from "./receipt-store.js";
import { normalizeReceiptRecord, ReceiptRoles } from "./receipt-types.js";

export const API_RECEIPT_STORE_SYNC_KEY = "hexapay.privateQuotes.apiSync.v1";
const API_RECEIPT_SOURCE_OF_TRUTH = {
  mode: "mock-api",
  authority: "api-receipt-store",
  readiness: "shared-adapter-ready",
};

function normalizeAccessContext(accessContext) {
  if (!accessContext || typeof accessContext !== "object") {
    return {
      token: "",
      grant: "",
      challengeToken: "",
      challengeSignature: "",
      permitHash: "",
      publicKey: "",
      signGrantChallenge: null,
    };
  }

  return {
    token: String(accessContext.token || ""),
    grant: String(accessContext.grant || ""),
    challengeToken: String(accessContext.challengeToken || ""),
    challengeSignature: String(accessContext.challengeSignature || ""),
    permitHash: String(accessContext.permitHash || ""),
    publicKey: String(accessContext.publicKey || ""),
    signGrantChallenge:
      typeof accessContext.signGrantChallenge === "function" ? accessContext.signGrantChallenge : null,
  };
}

function createAccessContextHeaders(accessContext) {
  const normalizedAccessContext = normalizeAccessContext(accessContext);
  const headers = {};

  if (normalizedAccessContext.token) {
    headers["x-receipt-access-token"] = normalizedAccessContext.token;
  }

  if (normalizedAccessContext.grant) {
    headers["x-receipt-access-grant"] = normalizedAccessContext.grant;
  }

  if (normalizedAccessContext.challengeToken) {
    headers["x-receipt-challenge-token"] = normalizedAccessContext.challengeToken;
  }

  if (normalizedAccessContext.challengeSignature) {
    headers["x-receipt-challenge-signature"] = normalizedAccessContext.challengeSignature;
  }

  if (normalizedAccessContext.permitHash) {
    headers["x-receipt-permit-hash"] = normalizedAccessContext.permitHash;
  }

  if (normalizedAccessContext.publicKey) {
    headers["x-receipt-permit-public-key"] = normalizedAccessContext.publicKey;
  }

  return headers;
}

function resolveReceiptApiOrigin(baseUrl = "") {
  if (baseUrl) {
    return String(baseUrl);
  }

  if (typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin;
  }

  return "http://localhost";
}

function notifyApiReceiptChange() {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(API_RECEIPT_STORE_SYNC_KEY, String(Date.now()));
  } catch (error) {
    error;
  }
}

async function readJson(response) {
  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    const error = new Error(payload?.error || "Receipt API request failed.");
    error.code = payload?.code || "";
    error.accessPolicy = payload?.accessPolicy || null;
    error.statusCode = response.status;
    throw error;
  }

  return payload;
}

function shouldIssueReceiptGrant(role, quoteId) {
  return Boolean(String(quoteId || "")) && role !== ReceiptRoles.AUDITOR;
}

function isRetryableReceiptGrantChallengeError(error) {
  return [
    "receipt-challenge-consumed",
    "receipt-challenge-expired",
    "receipt-challenge-unrecognized",
  ].includes(String(error?.code || ""));
}

export class ApiReceiptStore extends ReceiptStore {
  constructor({ accessContextResolver, baseUrl = "" } = {}) {
    super();
    this.accessContextResolver =
      typeof accessContextResolver === "function" ? accessContextResolver : null;
    this.baseUrl = String(baseUrl || "");
    this.receiptGrantCache = new Map();
  }

  resolveAccessContext({ role = ReceiptRoles.MERCHANT, quoteId = "", action = "read" } = {}) {
    if (!this.accessContextResolver) {
      return normalizeAccessContext(null);
    }

    try {
      return normalizeAccessContext(
        this.accessContextResolver({
          role,
          quoteId: String(quoteId || ""),
          action,
        }),
      );
    } catch (error) {
      error;
      return normalizeAccessContext(null);
    }
  }

  createUrl(pathname) {
    return new URL(pathname, resolveReceiptApiOrigin(this.baseUrl));
  }

  createReceiptGrantCacheKey(role, quoteId, accessContext) {
    return [
      String(role || ReceiptRoles.MERCHANT),
      String(quoteId || ""),
      String(accessContext?.token || ""),
    ].join(":");
  }

  async ensureReceiptGrant(role, quoteId, accessContext) {
    if (!shouldIssueReceiptGrant(role, quoteId)) {
      return String(accessContext?.grant || "");
    }

    if (accessContext?.grant) {
      return String(accessContext.grant);
    }

    const cacheKey = this.createReceiptGrantCacheKey(role, quoteId, accessContext);

    if (this.receiptGrantCache.has(cacheKey)) {
      return this.receiptGrantCache.get(cacheKey) || "";
    }

    if (typeof accessContext?.signGrantChallenge !== "function") {
      return "";
    }

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const challengeUrl = this.createUrl(
        `/api/receipts/${encodeURIComponent(String(quoteId || ""))}/challenge`,
      );
      challengeUrl.searchParams.set("role", role);
      const challengeResponse = await fetch(challengeUrl.toString(), {
        method: "POST",
        headers: {
          Accept: "application/json",
          ...createAccessContextHeaders({
            ...accessContext,
            grant: "",
            challengeToken: "",
            challengeSignature: "",
          }),
        },
      });

      if (challengeResponse.status === 404) {
        return "";
      }

      const challengePayload = await readJson(challengeResponse).catch(() => null);
      const challengeToken = String(challengePayload?.challengeToken || "");
      const challengeMessage = String(challengePayload?.message || "");

      if (!challengeToken || !challengeMessage) {
        return "";
      }

      let challengeSignature = "";

      try {
        challengeSignature = String(
          (await accessContext.signGrantChallenge(challengeMessage)) || "",
        );
      } catch (error) {
        return "";
      }

      if (!challengeSignature) {
        return "";
      }

      const url = this.createUrl(`/api/receipts/${encodeURIComponent(String(quoteId || ""))}/grant`);
      url.searchParams.set("role", role);

      const response = await fetch(url.toString(), {
        method: "POST",
        headers: {
          Accept: "application/json",
          ...createAccessContextHeaders({
            ...accessContext,
            grant: "",
            challengeToken,
            challengeSignature,
          }),
        },
      });

      if (response.status === 404) {
        return "";
      }

      try {
        const payload = await readJson(response);
        const grant = String(payload?.grant || "");

        if (grant) {
          this.receiptGrantCache.set(cacheKey, grant);
        }

        return grant;
      } catch (error) {
        if (attempt === 0 && isRetryableReceiptGrantChallengeError(error)) {
          continue;
        }

        throw error;
      }
    }

    return "";
  }

  clearReceiptGrant(role, quoteId, accessContext) {
    this.receiptGrantCache.delete(this.createReceiptGrantCacheKey(role, quoteId, accessContext));
  }

  async saveReceipt(receipt) {
    const canonicalReceipt = normalizeReceiptRecord(receipt, {
      sourceOfTruth: API_RECEIPT_SOURCE_OF_TRUTH,
    });

    if (!canonicalReceipt) {
      return null;
    }

    const accessContext = this.resolveAccessContext({
      role: ReceiptRoles.PAYER,
      quoteId: canonicalReceipt.quoteId,
      action: "save",
    });
    const response = await fetch(this.createUrl("/api/receipts"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...createAccessContextHeaders(accessContext),
      },
      body: JSON.stringify(canonicalReceipt),
    });

    const savedReceipt = await readJson(response);
    notifyApiReceiptChange();
    return savedReceipt;
  }

  async getReceiptByQuoteId(quoteId, role = ReceiptRoles.MERCHANT) {
    const normalizedQuoteId = String(quoteId || "");

    if (!normalizedQuoteId) {
      return null;
    }

    const accessContext = this.resolveAccessContext({
      role,
      quoteId: normalizedQuoteId,
      action: "read",
    });
    const executeRead = async (grant) => {
      const url = this.createUrl(`/api/receipts/${encodeURIComponent(normalizedQuoteId)}`);
      url.searchParams.set("role", role);

      const response = await fetch(url.toString(), {
        method: "GET",
        headers: {
          Accept: "application/json",
          ...createAccessContextHeaders({
            ...accessContext,
            grant,
          }),
        },
      });

      if (response.status === 404) {
        return null;
      }

      return readJson(response);
    };

    const grant = await this.ensureReceiptGrant(role, normalizedQuoteId, accessContext);

    try {
      return await executeRead(grant);
    } catch (error) {
      if (error.code === "receipt-grant-invalid" && !accessContext.grant) {
        this.clearReceiptGrant(role, normalizedQuoteId, accessContext);
        const refreshedGrant = await this.ensureReceiptGrant(role, normalizedQuoteId, accessContext);
        return executeRead(refreshedGrant);
      }

      throw error;
    }
  }

  async listReceipts(role = ReceiptRoles.MERCHANT) {
    const accessContext = this.resolveAccessContext({
      role,
      action: "list",
    });
    const url = this.createUrl("/api/receipts");
    url.searchParams.set("role", role);

    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        Accept: "application/json",
        ...createAccessContextHeaders(accessContext),
      },
    });

    const receipts = await readJson(response);
    return Array.isArray(receipts) ? receipts : [];
  }
}
