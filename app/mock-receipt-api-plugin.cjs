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
const {
  sharedPaymentLedger,
} = require("./payment-ledger.cjs");
const {
  createPaymentReconciliationStoreAdapter,
  sharedPaymentReconciliationStore,
} = require("./payment-reconciliation-store.cjs");
const {
  createEvmExternalSettlementRecorder,
  createEvmPaymentReconciliationVerifier,
} = require("./payment-reconciliation-worker.cjs");
const {
  createWorkflowInvoiceContextResolver,
} = require("./payment-reconciliation-invoice-context.cjs");

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
  const paymentLedgerStore =
    options.paymentLedger?.stateStore ||
    options.paymentLedgerAdapter?.stateStore ||
    options.paymentIntentService?.paymentLedger?.stateStore ||
    null;
  const paymentReconciliationStore =
    options.paymentReconciliationStore?.stateStore ||
    options.paymentReconciliationAdapter?.stateStore ||
    options.paymentIntentService?.paymentReconciliationWorker?.reconciliationStore?.stateStore ||
    null;

  if (shouldExposeStateStore(receiptRegistryStore) && !stateStores.registry) {
    stateStores.registry = receiptService.receiptRegistryAdapter.stateStore;
  }

  if (shouldExposeStateStore(challengeRegistryStore) && !stateStores.challenges) {
    stateStores.challenges = receiptService.challengeRegistryAdapter.stateStore;
  }

  if (shouldExposeStateStore(paymentLedgerStore) && !stateStores.payments) {
    stateStores.payments = paymentLedgerStore;
  }

  if (shouldExposeStateStore(paymentReconciliationStore) && !stateStores["payment-reconciliation"]) {
    stateStores["payment-reconciliation"] = paymentReconciliationStore;
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
  const paymentLedger = options.paymentLedger || options.paymentLedgerAdapter || sharedPaymentLedger;
  const paymentReconciliationStore =
    options.paymentReconciliationStore ||
    options.paymentReconciliationAdapter ||
    sharedPaymentReconciliationStore ||
    createPaymentReconciliationStoreAdapter();
  const stateStores = resolveReceiptStateStores(
    {
      ...options,
      paymentLedger,
      paymentReconciliationStore,
    },
    receiptService,
  );
  const persistenceAuth = createPersistenceAuth(options.persistenceAuth || {});
  
  // Initialize payment intent service
  let paymentIntentService = null;
  
  const hasExecutorEnv =
    process.env.ARB_SEPOLIA_RPC_URL &&
    process.env.HEXAPAY_EXECUTOR_PRIVATE_KEY &&
    process.env.HEXAPAY_EXECUTOR_CONTRACT_ADDRESS;
  const hasReconciliationBridgeEnv =
    (process.env.HEXAPAY_RECONCILIATION_RPC_URL || process.env.ARB_SEPOLIA_RPC_URL) &&
    (process.env.HEXAPAY_RECONCILIATION_PRIVATE_KEY || process.env.HEXAPAY_EXECUTOR_PRIVATE_KEY) &&
    process.env.HEXAPAY_EXTERNAL_SETTLEMENT_BRIDGE_ADDRESS &&
    process.env.HEXAPAY_EXECUTOR_CONTRACT_ADDRESS;
  const invoiceContextResolver =
    options.invoiceContextResolver ||
    createWorkflowInvoiceContextResolver({
      rpcUrl: process.env.HEXAPAY_RECONCILIATION_RPC_URL || process.env.ARB_SEPOLIA_RPC_URL,
      privateKey:
        process.env.HEXAPAY_RECONCILIATION_PRIVATE_KEY ||
        process.env.HEXAPAY_EXECUTOR_PRIVATE_KEY ||
        process.env.PRIVATE_KEY,
    });
  const paymentReconciliationVerifier =
    options.paymentReconciliationVerifier ||
    (hasExecutorEnv
      ? createEvmPaymentReconciliationVerifier({
          rpcUrl: process.env.HEXAPAY_RECONCILIATION_RPC_URL || process.env.ARB_SEPOLIA_RPC_URL,
          executorAddress: process.env.HEXAPAY_EXECUTOR_CONTRACT_ADDRESS,
          settlementTokenAddress:
            process.env.SETTLEMENT_TOKEN_ADDRESS ||
            process.env.VITE_HEXAPAY_PAYMENT_TOKEN_ADDRESS ||
            process.env.VITE_SETTLEMENT_TOKEN_ADDRESS ||
            "",
          invoiceContextResolver,
          requireInvoiceContext: String(process.env.HEXAPAY_REQUIRE_INVOICE_CONTEXT || "") === "1",
        })
      : null);
  const paymentReconciliationRecorder =
    options.paymentReconciliationRecorder ||
    (hasReconciliationBridgeEnv
      ? createEvmExternalSettlementRecorder({
          rpcUrl: process.env.HEXAPAY_RECONCILIATION_RPC_URL || process.env.ARB_SEPOLIA_RPC_URL,
          privateKey:
            process.env.HEXAPAY_RECONCILIATION_PRIVATE_KEY ||
            process.env.HEXAPAY_EXECUTOR_PRIVATE_KEY,
          contractAddress: process.env.HEXAPAY_EXTERNAL_SETTLEMENT_BRIDGE_ADDRESS,
          abi: [
            "function recordExternalSettlementReceipt(bytes32 invoiceId, bytes32 intentHash, bytes32 requestIdHash, bytes32 txHash, address payerWallet, address merchant, address token, uint128 observedAmount) external returns (bytes32)",
          ],
        })
      : null);

  console.log("[payment-intent] env check:", {
    rpcUrl: Boolean(process.env.ARB_SEPOLIA_RPC_URL),
    privateKey: Boolean(process.env.HEXAPAY_EXECUTOR_PRIVATE_KEY),
    contractAddress: process.env.HEXAPAY_EXECUTOR_CONTRACT_ADDRESS || null,
    chainId: process.env.HEXAPAY_CHAIN_ID || null,
    challengeRegistry: Boolean(receiptService?.challengeRegistryAdapter),
    settlementTokenAddress:
      process.env.SETTLEMENT_TOKEN_ADDRESS ||
      process.env.VITE_HEXAPAY_PAYMENT_TOKEN_ADDRESS ||
      process.env.VITE_SETTLEMENT_TOKEN_ADDRESS ||
      null,
    reconciliationBridgeAddress: process.env.HEXAPAY_EXTERNAL_SETTLEMENT_BRIDGE_ADDRESS || null,
    invoiceContextMode:
      String(process.env.HEXAPAY_REQUIRE_INVOICE_CONTEXT || "") === "1"
        ? "strict"
        : "best_effort",
  });

  if (options.paymentIntentService) {
    paymentIntentService = options.paymentIntentService;
    console.log("[payment-intent] using injected service");
  } else if (hasExecutorEnv) {
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
        executorAddress: process.env.HEXAPAY_EXECUTOR_CONTRACT_ADDRESS,
        domainName: process.env.HEXAPAY_EIP712_NAME || "HexaPay",
        domainVersion: process.env.HEXAPAY_EIP712_VERSION || "1",
        executor,
        paymentLedger,
        reconciliationStore: paymentReconciliationStore,
        reconciliationVerifier: paymentReconciliationVerifier,
        reconciliationRecorder: paymentReconciliationRecorder,
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
            invoiceId: body.invoiceId,
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

      if (req.method === "GET" && url.pathname === "/api/payments/list") {
        try {
          const result = await paymentIntentService.listPayments({
            wallet: url.searchParams.get("wallet") || "",
            merchant: url.searchParams.get("merchant") || "",
            payer: url.searchParams.get("payer") || "",
            status: url.searchParams.get("status") || "",
            invoiceId: url.searchParams.get("invoiceId") || "",
            limit: url.searchParams.get("limit") || "",
          });
          writeJson(res, 200, {
            ok: true,
            ...result,
          });
        } catch (error) {
          writeJson(res, 500, {
            error: error.message || "Payment list failed",
            code: error.code || "payment_list_failed",
          });
        }
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/payments/reconciliation/candidates") {
        try {
          const result = await paymentIntentService.listReconciliationCandidates({
            invoiceId: url.searchParams.get("invoiceId") || "",
            limit: url.searchParams.get("limit") || "",
            eligibleOnly: url.searchParams.get("eligibleOnly") !== "0",
          });
          writeJson(res, 200, {
            ok: true,
            ...result,
          });
        } catch (error) {
          writeJson(res, 500, {
            error: error.message || "Payment reconciliation candidate lookup failed",
            code: error.code || "payment_reconciliation_candidates_failed",
          });
        }
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/payments/reconciliation/records") {
        try {
          const result = await paymentIntentService.listReconciliationRecords({
            wallet: url.searchParams.get("wallet") || "",
            merchant: url.searchParams.get("merchant") || "",
            payer: url.searchParams.get("payer") || "",
            state: url.searchParams.get("state") || "",
            recordId: url.searchParams.get("recordId") || "",
            settlementId: url.searchParams.get("settlementId") || "",
            requestId: url.searchParams.get("requestId") || "",
            txHash: url.searchParams.get("txHash") || "",
            invoiceId: url.searchParams.get("invoiceId") || "",
            limit: url.searchParams.get("limit") || "",
          });
          writeJson(res, 200, {
            ok: true,
            ...result,
          });
        } catch (error) {
          writeJson(res, 500, {
            error: error.message || "Payment reconciliation record lookup failed",
            code: error.code || "payment_reconciliation_records_failed",
          });
        }
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/payments/reconciliation/run") {
        let body = {};
        try {
          body = await readRequestBody(req);
        } catch {
          writeJson(res, 400, { error: "Invalid JSON payload" });
          return;
        }

        try {
          const result = await paymentIntentService.runReconciliation({
            invoiceId: body.invoiceId || url.searchParams.get("invoiceId") || "",
            limit: body.limit || url.searchParams.get("limit") || "",
            autoRecord:
              body.autoRecord === undefined
                ? url.searchParams.get("autoRecord") !== "0"
                : body.autoRecord !== false,
            retryExceptions:
              body.retryExceptions === undefined
                ? url.searchParams.get("retryExceptions") !== "0"
                : body.retryExceptions !== false,
          });
          writeJson(res, 200, {
            ok: true,
            ...result,
          });
        } catch (error) {
          writeJson(res, 500, {
            error: error.message || "Payment reconciliation run failed",
            code: error.code || "payment_reconciliation_run_failed",
          });
        }
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/payments/_debug/ledger") {
        if (!isDebugStateEnabled()) {
          writeJson(res, 404, { error: "Not found" });
          return;
        }

        try {
          const snapshot = await paymentIntentService.getPaymentLedgerSnapshot({
            includeRecords: url.searchParams.get("records") === "1",
          });
          writeJson(res, 200, snapshot);
        } catch (error) {
          writeJson(res, 500, {
            error: error.message || "Payment ledger snapshot failed",
            code: error.code || "payment_ledger_snapshot_failed",
          });
        }
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/payments/_debug/reconciliation") {
        if (!isDebugStateEnabled()) {
          writeJson(res, 404, { error: "Not found" });
          return;
        }

        try {
          const snapshot = await paymentIntentService.getPaymentReconciliationSnapshot({
            includeRecords: url.searchParams.get("records") === "1",
          });
          writeJson(res, 200, snapshot);
        } catch (error) {
          writeJson(res, 500, {
            error: error.message || "Payment reconciliation snapshot failed",
            code: error.code || "payment_reconciliation_snapshot_failed",
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
