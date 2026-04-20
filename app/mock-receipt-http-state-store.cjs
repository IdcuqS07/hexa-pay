const {
  createJsonStateStoreEntry,
} = require("./mock-receipt-state-store.cjs");

function parseScopeList(raw) {
  return String(raw || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function uniqueScopeList(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function mergeHeaders(base = {}, extra = {}) {
  return {
    ...base,
    ...extra,
  };
}

function buildPersistenceAuthHeaders(options = {}) {
  const token = String(
    options.token ||
      process.env.MOCK_RECEIPT_PERSISTENCE_TOKEN ||
      "",
  ).trim();

  const scopes = uniqueScopeList([
    ...parseScopeList(options.scopes),
    ...parseScopeList(process.env.MOCK_RECEIPT_PERSISTENCE_CLIENT_SCOPES),
  ]);

  const headers = {
    ...(options.headers && typeof options.headers === "object" ? options.headers : {}),
  };

  if (token && !headers.authorization) {
    headers.authorization = `Bearer ${token}`;
  }

  if (scopes.length > 0 && !headers["x-mock-receipt-scopes"]) {
    headers["x-mock-receipt-scopes"] = scopes.join(",");
  }

  return headers;
}

function withRequiredScopes(baseHeaders = {}, requiredScopes = []) {
  const existingScopes = parseScopeList(baseHeaders["x-mock-receipt-scopes"]);
  const mergedScopes = uniqueScopeList([...existingScopes, ...requiredScopes]);

  return {
    ...baseHeaders,
    ...(mergedScopes.length > 0
      ? { "x-mock-receipt-scopes": mergedScopes.join(",") }
      : {}),
  };
}

function normalizeRevision(revision) {
  return Math.max(0, Number(revision || 0));
}

function resolveStateStoreApiOrigin(baseUrl = "") {
  if (baseUrl) {
    return String(baseUrl);
  }

  if (typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin;
  }

  return "http://localhost";
}

async function readJson(response) {
  return await response.json().catch(() => null);
}

function normalizeStateEntry(payload) {
  if (!payload || typeof payload !== "object") {
    return createJsonStateStoreEntry(null, 0);
  }

  if (payload.entry && typeof payload.entry === "object") {
    return createJsonStateStoreEntry(payload.entry.value, payload.entry.revision);
  }

  return createJsonStateStoreEntry(payload.value, payload.revision);
}

class HttpJsonStateStore {
  constructor({ baseUrl = "", storeId = "", fetchImpl, headers, scopes, token, scopeMap } = {}) {
    this.baseUrl = String(baseUrl || "");
    this.storeId = String(storeId || "");
    this.fetchImpl =
      typeof fetchImpl === "function"
        ? fetchImpl
        : typeof globalThis.fetch === "function"
          ? (...args) => globalThis.fetch(...args)
          : null;
    this.headers = buildPersistenceAuthHeaders({
      headers: headers || {},
      scopes: scopes || "",
      token: token || "",
    });
    this.scopeMap =
      scopeMap && typeof scopeMap === "object"
        ? scopeMap
        : {
            get: ["admin"],
            set: ["admin"],
            delete: ["admin"],
            cas: ["admin"],
            debug: ["admin"],
          };
    this.lastKnownRevision = 0;
  }

  describe() {
    return {
      kind: "http",
      baseUrl: resolveStateStoreApiOrigin(this.baseUrl),
      storeId: this.storeId,
      revision: this.lastKnownRevision,
    };
  }

  resolveScopes(operation) {
    const scopes = this.scopeMap[operation];
    return Array.isArray(scopes) ? scopes : [];
  }

  buildRequestHeaders(extraHeaders = {}, requiredScopes = []) {
    return mergeHeaders(
      withRequiredScopes(this.headers, requiredScopes),
      extraHeaders,
    );
  }

  createUrl() {
    return new URL(
      `/api/receipts/_state/${encodeURIComponent(this.storeId)}`,
      resolveStateStoreApiOrigin(this.baseUrl),
    );
  }

  async request(method, body = null, operation = "", requiredScopes = []) {
    if (!this.fetchImpl) {
      throw new Error("HTTP state store fetch implementation is not available.");
    }

    const headers = this.buildRequestHeaders(
      {
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      [
        ...this.resolveScopes(operation),
        ...(Array.isArray(requiredScopes) ? requiredScopes : []),
      ],
    );

    const response = await this.fetchImpl(this.createUrl().toString(), {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    const payload = await readJson(response);

    if (!response.ok && response.status !== 409 && response.status !== 404) {
      const error = new Error(payload?.error || "HTTP state store request failed.");
      error.statusCode = response.status;
      throw error;
    }

    return {
      response,
      payload,
    };
  }

  async readEntry() {
    const { response, payload } = await this.request("GET", null, "get");

    if (response.status === 404) {
      this.lastKnownRevision = 0;
      return createJsonStateStoreEntry(null, 0);
    }

    const entry = normalizeStateEntry(payload);
    this.lastKnownRevision = normalizeRevision(entry.revision);
    return entry;
  }

  async read() {
    return (await this.readEntry()).value;
  }

  async writeEntry(value, { expectedRevision } = {}) {
    const operation = expectedRevision !== undefined && expectedRevision !== null ? "cas" : "set";
    const { response, payload } = await this.request("PUT", {
      value,
      expectedRevision:
        expectedRevision === undefined || expectedRevision === null
          ? null
          : normalizeRevision(expectedRevision),
    }, operation);
    const entry = normalizeStateEntry(payload);
    this.lastKnownRevision = normalizeRevision(entry.revision);

    return {
      ok: response.status !== 409,
      conflict: response.status === 409,
      ...entry,
    };
  }

  async write(value, options = {}) {
    return (await this.writeEntry(value, options)).value;
  }

  async clearEntry({ expectedRevision } = {}) {
    const { response, payload } = await this.request("DELETE", {
      expectedRevision:
        expectedRevision === undefined || expectedRevision === null
          ? null
          : normalizeRevision(expectedRevision),
    }, "delete");
    const entry = normalizeStateEntry(payload);
    this.lastKnownRevision = normalizeRevision(entry.revision);

    return {
      ok: response.status !== 409,
      conflict: response.status === 409,
      ...entry,
    };
  }

  async clear(options = {}) {
    return await this.clearEntry(options);
  }
}

module.exports = {
  HttpJsonStateStore,
  buildPersistenceAuthHeaders,
  withRequiredScopes,
};
