const { URL } = require("url");
const {
  MockReceiptService,
  sharedMockReceiptService,
} = require("./mock-receipt-service.cjs");
const {
  createJsonStateStoreEntry,
  isJsonStateStore,
} = require("./mock-receipt-state-store.cjs");
const { createPersistenceAuth } = require('./mock-receipt-persistence-auth.cjs');
const {
  createPaymentIntentService,
  createEvmExecutor,
} = require("./payment-intent-service.cjs");

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];

    req.on("data", (chunk) => {
      chunks.push(chunk);
    });

    req.on("end", () => {
      const rawBody = Buffer.concat(chunks).toString("utf8");

      if (!rawBody) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(rawBody));
      } catch (error) {
        reject(error);
      }
    });

    req.on("error", reject);
  });
}

function writeJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

function getRole(searchParams) {
  const role = String(searchParams.get("role") || "merchant");
  return ["merchant", "payer", "auditor"].includes(role) ? role : "merchant";
}

function getAccessContext(req, searchParams) {
  return {
    token:
      String(searchParams.get("accessToken") || "") ||
      String(req.headers["x-receipt-access-token"] || ""),
    grant:
      String(searchParams.get("accessGrant") || "") ||
      String(req.headers["x-receipt-access-grant"] || ""),
    challengeToken:
      String(searchParams.get("challengeToken") || "") ||
      String(req.headers["x-receipt-challenge-token"] || ""),
    challengeSignature:
      String(searchParams.get("challengeSignature") || "") ||
      String(req.headers["x-receipt-challenge-signature"] || ""),
    permitHash:
      String(searchParams.get("permitHash") || "") ||
      String(req.headers["x-receipt-permit-hash"] || ""),
    publicKey:
      String(searchParams.get("permitPublicKey") || "") ||
      String(req.headers["x-receipt-permit-public-key"] || ""),
  };
}

function resolveReceiptService({
  receiptService,
  receiptRegistry,
  receiptRegistryAdapter,
  challengeRegistry,
  challengeRegistryAdapter,
} = {}) {
  if (receiptService) {
    return receiptService;
  }

  if (receiptRegistry || receiptRegistryAdapter || challengeRegistry || challengeRegistryAdapter) {
    return new MockReceiptService({
      registry: receiptRegistry,
      receiptRegistryAdapter,
      challengeRegistry,
      challengeRegistryAdapter,
    });
  }

  return sharedMockReceiptService;
}

function isDebugStateEnabled() {
  return (
    String(process.env.NODE_ENV || "").toLowerCase() === "development" ||
    String(process.env.MOCK_RECEIPT_ALLOW_DEBUG_STATE || "") === "1"
  );
}

function shouldExposeStateStore(store) {
  if (!isJsonStateStore(store)) return false;
  const kind = String(store?.describe?.().kind || "").toLowerCase();
  if (!kind) return isDebugStateEnabled();
  if (kind === "http" || kind === "redis") return false;
  if (!isDebugStateEnabled()) return false;
  return kind === "memory" || kind === "file";
}

function resolveReceiptStateStores(options = {}, receiptService = null) {
  const stateStores = {};
  const providedStateStores =
    options.stateStores && typeof options.stateStores === "object" ? options.stateStores : null;

  if (providedStateStores) {
    Object.entries(providedStateStores).forEach(([storeId, store]) => {
      if (storeId && isJsonStateStore(store)) {
        stateStores[String(storeId)] = store;
      }
    });
  }

  const receiptRegistryStore = receiptService?.receiptRegistryAdapter?.stateStore;
  const challengeRegistryStore = receiptService?.challengeRegistryAdapter?.stateStore;

  if (shouldExposeStateStore(receiptRegistryStore) && !stateStores.registry) {
    stateStores.registry = receiptService.receiptRegistryAdapter.stateStore;
  }

  if (shouldExposeStateStore(challengeRegistryStore) && !stateStores.challenges) {
    stateStores.challenges = receiptService.challengeRegistryAdapter.stateStore;
  }

  return stateStores;
}

async function readStateStoreEntry(store) {
  if (!store) {
    return createJsonStateStoreEntry(null, 0);
  }

  if (typeof store.readEntry === "function") {
    return await Promise.resolve(store.readEntry());
  }

  return createJsonStateStoreEntry(await Promise.resolve(store.read()), 0);
}

async function writeStateStoreEntry(store, value, expectedRevision) {
  if (typeof store.writeEntry === "function") {
    return await Promise.resolve(
      store.writeEntry(value, {
        expectedRevision,
      }),
    );
  }

  await Promise.resolve(store.write(value));
  const entry = await readStateStoreEntry(store);
  return {
    ok: true,
    conflict: false,
    ...entry,
  };
}

async function clearStateStoreEntry(store, expectedRevision) {
  if (typeof store.clearEntry === "function") {
    return await Promise.resolve(
      store.clearEntry({
        expectedRevision,
      }),
    );
  }

  await Promise.resolve(store.clear());
  const entry = await readStateStoreEntry(store);
  return {
    ok: true,
    conflict: false,
    ...entry,
  };
}

function createReceiptApiMiddleware(options = {}) {
  const receiptService = resolveReceiptService(options);
  const stateStores = resolveReceiptStateStores(options, receiptService);
  const persistenceAuth = createPersistenceAuth(options.persistenceAuth || {});
  
  // Initialize payment intent service
  let paymentIntentService = null;
  
  const hasExecutorEnv =
    process.env.ARB_SEPOLIA_RPC_URL &&
    process.env.HEXAPAY_EXECUTOR_PRIVATE_KEY &&
    process.env.HEXAPAY_EXECUTOR_CONTRACT_ADDRESS;

  console.log("[payment-intent] env check:", {
    rpcUrl: Boolean(process.env.ARB_SEPOLIA_RPC_URL),
    privateKey: Boolean(process.env.HEXAPAY_EXECUTOR_PRIVATE_KEY),
    contractAddress: process.env.HEXAPAY_EXECUTOR_CONTRACT_ADDRESS || null,
    chainId: process.env.HEXAPAY_CHAIN_ID || null,
    challengeRegistry: Boolean(receiptService?.challengeRegistryAdapter),
  });

  if (hasExecutorEnv) {
    try {
      const executor = options.paymentExecutor || createEvmExecutor({
        rpcUrl: process.env.ARB_SEPOLIA_RPC_URL,
        privateKey: process.env.HEXAPAY_EXECUTOR_PRIVATE_KEY,
        contractAddress: process.env.HEXAPAY_EXECUTOR_CONTRACT_ADDRESS,
        abi: [
          "function executePayment(bytes32 intentHash, bytes32 requestIdHash, address token, address payer, address merchant, uint256 amount) external",
        ],
      });

      paymentIntentService = options.paymentIntentService || createPaymentIntentService({
        challengeRegistry: receiptService.challengeRegistryAdapter,
        chainId: Number(process.env.HEXAPAY_CHAIN_ID || 421614),
        verifyingContract: process.env.HEXAPAY_EXECUTOR_CONTRACT_ADDRESS,
        domainName: process.env.HEXAPAY_EIP712_NAME || "HexaPay",
        domainVersion: process.env.HEXAPAY_EIP712_VERSION || "1",
        executor,
      });

      console.log("[payment-intent] service initialized successfully");
    } catch (error) {
      console.error("[payment-intent-service] init failed:", error);
      paymentIntentService = null;
    }
  } else {
    console.warn("[payment-intent-service] missing env; service disabled");
  }
  
  return async function receiptApiMiddleware(req, res, next) {
    const origin = req.headers.host ? `http://${req.headers.host}` : "http://localhost";
    const url = new URL(req.url || "/", origin);

    if (!url.pathname.startsWith("/api/receipts") && !url.pathname.startsWith("/api/payments")) {
      next();
      return;
    }

    if (url.pathname.startsWith("/api/receipts/_state/")) {
      if (!isDebugStateEnabled()) {
        writeJson(res, 404, { error: "Not found" });
        return;
      }
      if (!persistenceAuth.requireAuth(req, res, ["admin"])) return;

      const storeId = decodeURIComponent(url.pathname.replace("/api/receipts/_state/", ""));
      const stateStore = stateStores[String(storeId || "")] || null;

      if (!stateStore) {
        writeJson(res, 404, { error: "State store not found" });
        return;
      }

      if (req.method === "GET") {
        const entry = await readStateStoreEntry(stateStore);
        writeJson(res, 200, {
          entry,
          store:
            typeof stateStore.describe === "function"
              ? stateStore.describe()
              : { kind: "custom" },
        });
        return;
      }

      if (req.method === "PUT") {
        let payload = {};

        try {
          payload = await readRequestBody(req);
        } catch (error) {
          writeJson(res, 400, { error: "Invalid JSON payload" });
          return;
        }

        const result = await writeStateStoreEntry(
          stateStore,
          payload?.value ?? null,
          payload?.expectedRevision,
        );
        const statusCode = result.ok ? 200 : 409;
        writeJson(res, statusCode, {
          ok: Boolean(result.ok),
          conflict: Boolean(result.conflict),
          entry: createJsonStateStoreEntry(result.value, result.revision),
          store:
            typeof stateStore.describe === "function"
              ? stateStore.describe()
              : { kind: "custom" },
        });
        return;
      }

      if (req.method === "DELETE") {
        let payload = {};

        try {
          payload = await readRequestBody(req);
        } catch (error) {
          payload = {};
        }

        const result = await clearStateStoreEntry(stateStore, payload?.expectedRevision);
        const statusCode = result.ok ? 200 : 409;
        writeJson(res, statusCode, {
          ok: Boolean(result.ok),
          conflict: Boolean(result.conflict),
          entry: createJsonStateStoreEntry(result.value, result.revision),
          store:
            typeof stateStore.describe === "function"
              ? stateStore.describe()
              : { kind: "custom" },
        });
        return;
      }

      writeJson(res, 405, { error: "Method not allowed" });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/receipts") {
      const role = getRole(url.searchParams);
      const accessContext = getAccessContext(req, url.searchParams);
      const result = await receiptService.listReceipts(role, accessContext);

      if (result.status !== "ok") {
        writeJson(res, result.statusCode || 403, {
          error: result.error || "Receipt access denied.",
          code: result.code || "receipt_access_denied",
          accessPolicy: result.accessPolicy || null,
        });
        return;
      }

      writeJson(res, 200, result.receipts);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/receipts/_debug/challenges") {
      if (!isDebugStateEnabled()) {
        writeJson(res, 404, { error: "Not found" });
        return;
      }
      if (!persistenceAuth.requireAuth(req, res, ["admin"])) return;

      const includeRecords =
        ["1", "true", "yes"].includes(String(url.searchParams.get("records") || "").toLowerCase());
      const result =
        typeof receiptService.getReceiptGrantChallengeSnapshot === "function"
          ? await receiptService.getReceiptGrantChallengeSnapshot({ includeRecords })
          : {
              status: "ok",
              statusCode: 200,
              summary: null,
              records: [],
            };

      writeJson(res, result.statusCode || 200, {
        summary: result.summary || null,
        records: Array.isArray(result.records) ? result.records : [],
        storage: result.storage || null,
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/receipts/_debug/registry") {
      if (!isDebugStateEnabled()) {
        writeJson(res, 404, { error: "Not found" });
        return;
      }
      if (!persistenceAuth.requireAuth(req, res, ["admin"])) return;

      const includeRecords =
        ["1", "true", "yes"].includes(String(url.searchParams.get("records") || "").toLowerCase());
      const result =
        typeof receiptService.getReceiptRegistrySnapshot === "function"
          ? await receiptService.getReceiptRegistrySnapshot({ includeRecords })
          : {
              status: "ok",
              statusCode: 200,
              summary: null,
              records: [],
            };

      writeJson(res, result.statusCode || 200, {
        summary: result.summary || null,
        records: Array.isArray(result.records) ? result.records : [],
        storage: result.storage || null,
      });
      return;
    }

    if (req.method === "GET" && url.pathname.startsWith("/api/receipts/")) {
      const role = getRole(url.searchParams);
      const accessContext = getAccessContext(req, url.searchParams);
      const quoteId = decodeURIComponent(url.pathname.replace("/api/receipts/", ""));
      const result = await receiptService.getReceiptByQuoteId(quoteId, role, accessContext);

      if (result.status === "not_found") {
        writeJson(res, 404, { error: result.error || "Receipt not found" });
        return;
      }

      if (result.status !== "ok") {
        writeJson(res, result.statusCode || 403, {
          error: result.error || "Receipt access denied.",
          code: result.code || "receipt_access_denied",
          accessPolicy: result.accessPolicy || null,
        });
        return;
      }

      writeJson(res, 200, result.receipt);
      return;
    }

    if (req.method === "POST" && url.pathname.startsWith("/api/receipts/") && url.pathname.endsWith("/challenge")) {
      const role = getRole(url.searchParams);
      const accessContext = getAccessContext(req, url.searchParams);
      const quoteId = decodeURIComponent(
        url.pathname.replace("/api/receipts/", "").replace(/\/challenge$/, ""),
      );
      const result = await receiptService.issueReceiptGrantChallenge(quoteId, role, accessContext);

      if (result.status === "not_found") {
        writeJson(res, 404, { error: result.error || "Receipt not found" });
        return;
      }

      if (result.status !== "ok") {
        writeJson(res, result.statusCode || 403, {
          error: result.error || "Receipt access denied.",
          code: result.code || "receipt_access_denied",
          accessPolicy: result.accessPolicy || null,
        });
        return;
      }

      writeJson(res, 200, {
        challengeToken: String(result.challengeToken || ""),
        message: String(result.message || ""),
      });
      return;
    }

    if (req.method === "POST" && url.pathname.startsWith("/api/receipts/") && url.pathname.endsWith("/grant")) {
      const role = getRole(url.searchParams);
      const accessContext = getAccessContext(req, url.searchParams);
      const quoteId = decodeURIComponent(
        url.pathname.replace("/api/receipts/", "").replace(/\/grant$/, ""),
      );
      const result = await receiptService.issueReceiptGrant(quoteId, role, accessContext);

      if (result.status === "not_found") {
        writeJson(res, 404, { error: result.error || "Receipt not found" });
        return;
      }

      if (result.status !== "ok") {
        writeJson(res, result.statusCode || 403, {
          error: result.error || "Receipt access denied.",
          code: result.code || "receipt_access_denied",
          accessPolicy: result.accessPolicy || null,
        });
        return;
      }

      writeJson(res, 200, {
        grant: String(result.grant || ""),
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/receipts") {
      try {
        const payload = await readRequestBody(req);
        const receipt = await receiptService.saveReceipt(payload);

        if (!receipt) {
          writeJson(res, 400, { error: "Invalid receipt payload" });
          return;
        }

        writeJson(res, 201, receipt);
      } catch (error) {
        writeJson(res, 400, { error: "Invalid JSON payload" });
      }
      return;
    }

    // Payment intent routes
    if (url.pathname.startsWith("/api/payments")) {
      if (!paymentIntentService) {
        writeJson(res, 503, { 
          error: "Payment intent service not configured",
          code: "service_unavailable"
        });
        return;
      }

      // Create payment challenge
      if (req.method === "POST" && url.pathname === "/api/payments/challenges") {
        let body = {};
        try {
          body = await readRequestBody(req);
        } catch {
          writeJson(res, 400, { error: "Invalid JSON payload" });
          return;
        }

        try {
          const result = await paymentIntentService.createChallenge({
            requestId: body.requestId,
            receiptId: body.receiptId,
            quoteId: body.quoteId,
            merchantId: body.merchantId,
            terminalId: body.terminalId,
            amount: body.amount,
            currency: body.currency,
            payer: body.payer,
            merchant: body.merchant,
            actorId: body.actorId || body.payer,
            permitHash: req.headers["x-receipt-permit-hash"] || body.permitHash || "",
            sessionId: req.headers["x-session-id"] || body.sessionId || "",
            deviceFingerprintHash: req.headers["x-device-fingerprint-hash"] || body.deviceFingerprintHash || "",
          });

          // Return the result directly - it already has challengeId and expiresAtMs
          writeJson(res, 200, {
            ok: true,
            record: result,
          });
        } catch (error) {
          writeJson(res, 400, {
            error: error.message || "Challenge creation failed",
            code: error.code || "challenge_creation_failed",
          });
        }
        return;
      }

      // Execute signed intent
      if (req.method === "POST" && url.pathname === "/api/payments/execute") {
        let body = {};
        try {
          body = await readRequestBody(req);
        } catch {
          writeJson(res, 400, { error: "Invalid JSON payload" });
          return;
        }

        try {
          const result = await paymentIntentService.executeSignedIntent({
            intent: body.intent,
            signature: body.signature,
          });
          writeJson(res, 200, result);
        } catch (error) {
          writeJson(res, 400, {
            error: error.message || "Payment execution failed",
            code: error.code || "payment_execution_failed",
            details: error.details || null,
          });
        }
        return;
      }

      writeJson(res, 404, { error: "Payment endpoint not found" });
      return;
    }

    writeJson(res, 405, { error: "Method not allowed" });
  };
}

function createMockReceiptApiPlugin(options = {}) {
  return {
    name: "mock-receipt-api",
    configureServer(server) {
      server.middlewares.use(createReceiptApiMiddleware(options));
    },
    configurePreviewServer(server) {
      server.middlewares.use(createReceiptApiMiddleware(options));
    },
  };
}

module.exports = {
  createReceiptApiMiddleware,
  createMockReceiptApiPlugin,
};
