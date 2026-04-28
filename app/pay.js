import {
  createRuntime,
  getExplorerLink,
  getFhenixState,
  shortAddress,
  switchWalletChain,
} from "../src/contracts/client.js";
import { DEFAULT_CHAIN_ID, getChainMetadata } from "../src/contracts/config.js";
import {
  canSettlePrivateQuote,
  formatPrivateQuoteExpiry,
  formatPrivateQuoteReceiptTime,
  getPrivateQuoteErrorMessage,
  loadPrivateQuoteConfig,
  readPrivateQuote,
  settlePrivateQuote,
} from "./private-quote.js";
import { createReceiptAccessContext } from "./receipt-access-context.js";
import {
  createReceiptStore,
  getReceiptStoreChangeKey,
} from "./receipt-store-factory.js";
import { createReceiptRecord, ReceiptRoles } from "./receipt-types.js";
import {
  appendPrivateQuoteStoreMode,
  getPrivateQuoteStoreMode,
  PRIVATE_QUOTE_STORE_MODE_STORAGE_KEY,
} from "./config.js";
import { mountPaymentIntentWidget } from "./payment-intent-widget.js";
import { getShareablePaymentIntentPayloadFromUrl } from "./payment-intent-share.js";
import {
  getStoredWalletProviderId,
  isWalletSessionEnabled,
  setStoredWalletProviderId,
  setWalletSessionEnabled,
  WALLET_PROVIDER_STORAGE_KEY,
  WALLET_SESSION_STORAGE_KEY,
} from "./wallet-session.js";
import * as reconciliationUi from "./payment-reconciliation-ui.js";

const state = {
  config: null,
  runtime: {
    walletAvailable: false,
    provider: null,
    signer: null,
    account: "",
    chainId: "",
    connected: false,
    walletId: "",
    walletName: "",
  },
  fhenix: createDefaultFhenixState(),
  quoteId: new URL(window.location.href).searchParams.get("id") || "",
  intentRequest: getShareablePaymentIntentPayloadFromUrl(),
  intentExecution: null,
  reconciliation: {
    records: [],
    authority: null,
    loading: false,
    error: "",
    syncedAt: 0,
  },
  quote: null,
  quoteError: "",
  latestReceipt: null,
  allowReceiptGrantSignature: false,
  busyCommand: "",
  notice: "Loading private quote route...",
};

let receiptStoreMode = getPrivateQuoteStoreMode();
let receiptStore = createReceiptStore(receiptStoreMode, {
  accessContextResolver: ({ role, quoteId, action }) =>
      createReceiptAccessContext({
        role,
        quoteId,
        action,
        runtime: state.runtime,
        fhenix: state.fhenix,
        allowGrantSignature: state.allowReceiptGrantSignature,
      }),
});
let receiptStoreChangeKey = getReceiptStoreChangeKey(receiptStoreMode);
let boundWalletProvider = null;
let boundWalletAccountsChanged = null;
let boundWalletChainChanged = null;

function isReceiptAccessDeniedError(error, codes = []) {
  if (!error || Number(error.statusCode || 0) !== 403) {
    return false;
  }

  if (!Array.isArray(codes) || codes.length === 0) {
    return true;
  }

  return codes.includes(String(error.code || ""));
}

function isInvalidQuoteMessage(message) {
  return /missing quote id|quote was not found|payment link came from an older local deployment|not deployed on the current local chain|configured contract\. the local deployment address or quote link is likely stale|invalid quote/i.test(
    String(message || ""),
  );
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

async function syncReceiptState() {
  if (!state.quoteId) {
    state.latestReceipt = null;
    return;
  }

  try {
    state.latestReceipt = await receiptStore.getReceiptByQuoteId(state.quoteId, ReceiptRoles.PAYER);
  } catch (error) {
    if (
      isReceiptAccessDeniedError(error, [
        "participant-context-required",
        "viewer-participant-mismatch",
        "receipt-participant-missing",
        "receipt-grant-invalid",
        "receipt-grant-proof-required",
        "receipt-challenge-invalid",
        "receipt-challenge-expired",
        "receipt-challenge-consumed",
        "receipt-challenge-unrecognized",
        "receipt-challenge-signature-invalid",
        "receipt-challenge-role-mismatch",
        "receipt-challenge-context-mismatch",
      ])
    ) {
      state.latestReceipt = null;
      return;
    }

    throw error;
  } finally {
    state.allowReceiptGrantSignature = false;
  }
}

function createDefaultFhenixState() {
  return {
    mode: "offline",
    client: null,
    permitHash: "",
    publicKey: "",
    error: "",
  };
}

function syncReceiptStoreMode(mode = getPrivateQuoteStoreMode()) {
  receiptStoreMode = mode;
  receiptStore = createReceiptStore(receiptStoreMode, {
    accessContextResolver: ({ role, quoteId, action }) =>
      createReceiptAccessContext({
        role,
        quoteId,
        action,
        runtime: state.runtime,
        fhenix: state.fhenix,
        allowGrantSignature: state.allowReceiptGrantSignature,
      }),
  });
  receiptStoreChangeKey = getReceiptStoreChangeKey(receiptStoreMode);
}

function getPayRouteTargetChainId() {
  if (hasSharedIntentRoute()) {
    return DEFAULT_CHAIN_ID;
  }

  return String(state.config?.chainId || DEFAULT_CHAIN_ID);
}

function getSharedIntentNotice() {
  if (state.intentExecution?.txHash) {
    return "Shared payment request settled successfully.";
  }

  return state.runtime.connected
    ? "Shared payment request ready. Review the payment rail below."
    : "Connect a wallet to settle the shared payment request.";
}

function getSharedIntentStatusLabel() {
  return state.intentExecution?.txHash ? "Rail settled" : "Waiting for payer";
}

function extractApiErrorMessage(payload, fallback) {
  return String(payload?.error || payload?.message || payload?.details || fallback);
}

function normalizeReconciliationRecord(record = {}) {
  return {
    recordId: String(record.recordId || ""),
    settlementId: String(record.settlementId || ""),
    requestId: String(record.requestId || ""),
    invoiceId: String(record.invoiceId || ""),
    state: String(record.reconciliationState || record.state || ""),
    reason: String(record.reconciliationReason || record.reason || ""),
    verificationReason: String(record.verificationReason || ""),
    sourceTxHash: String(record.txHash || ""),
    bridgeTxHash: String(record.bridgeTxHash || ""),
    amount: String(record.amount || ""),
    currency: String(record.currency || "USDC"),
    confirmedAt: Number(
      record?.lifecycle?.appliedAt ||
        record?.lifecycle?.recordedAt ||
        record?.lifecycle?.submittedAt ||
        record?.lifecycle?.eligibleAt ||
        record?.lifecycle?.observedAt ||
        record?.updatedAt ||
        Date.now(),
    ),
    explorerUrl: getExplorerLink(DEFAULT_CHAIN_ID, String(record.bridgeTxHash || record.txHash || "")),
  };
}

function getLatestIntentReconciliationRecord() {
  return state.reconciliation.records[0] || null;
}

async function syncIntentReconciliation({ silent = true } = {}) {
  if (!hasSharedIntentRoute() || !state.intentRequest?.invoiceId) {
    state.reconciliation = {
      records: [],
      authority: null,
      loading: false,
      error: "",
      syncedAt: 0,
    };
    return;
  }

  if (!silent) {
    state.reconciliation.loading = true;
    state.reconciliation.error = "";
    render();
  }

  try {
    const url = new URL("/api/payments/reconciliation/records", window.location.origin);
    url.searchParams.set("invoiceId", state.intentRequest.invoiceId);
    url.searchParams.set("limit", "6");

    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(
        extractApiErrorMessage(payload, `Payment reconciliation request failed (${response.status})`),
      );
    }

    const records = Array.isArray(payload.records)
      ? payload.records.map((record) => normalizeReconciliationRecord(record))
      : [];

    state.reconciliation = {
      records,
      authority: payload.authority && typeof payload.authority === "object" ? payload.authority : null,
      loading: false,
      error: "",
      syncedAt: Date.now(),
    };
  } catch (error) {
    state.reconciliation = {
      records: [],
      authority: null,
      loading: false,
      error: String(error?.message || "Payment reconciliation is unavailable."),
      syncedAt: Date.now(),
    };
  } finally {
    if (!silent) {
      render();
    }
  }
}

function getPreferredWalletId(walletId = "") {
  return walletId || state.runtime.walletId || getStoredWalletProviderId();
}

function detachWalletListeners() {
  if (!boundWalletProvider) {
    return;
  }

  boundWalletProvider.removeListener?.("accountsChanged", boundWalletAccountsChanged);
  boundWalletProvider.removeListener?.("chainChanged", boundWalletChainChanged);
  boundWalletProvider = null;
  boundWalletAccountsChanged = null;
  boundWalletChainChanged = null;
}

async function syncRuntimeDependentState() {
  state.allowReceiptGrantSignature = state.runtime.connected;
  await syncReceiptState();

  if (hasSharedIntentRoute()) {
    await syncIntentReconciliation({ silent: true });
    state.notice = getSharedIntentNotice();
    render();
    return;
  }

  await refreshQuote({ silent: true });
}

function syncWalletListeners(walletProvider) {
  if (boundWalletProvider === walletProvider) {
    return;
  }

  detachWalletListeners();

  if (!walletProvider) {
    return;
  }

  boundWalletAccountsChanged = async () => {
    try {
      await refreshRuntime({ requestAccounts: false });
      await syncRuntimeDependentState();
    } catch (error) {
      state.notice = getPrivateQuoteErrorMessage(error);
      render();
    }
  };
  boundWalletChainChanged = async () => {
    try {
      await refreshRuntime({ requestAccounts: false });
      await syncRuntimeDependentState();
    } catch (error) {
      state.notice = getPrivateQuoteErrorMessage(error);
      render();
    }
  };

  walletProvider.on?.("accountsChanged", boundWalletAccountsChanged);
  walletProvider.on?.("chainChanged", boundWalletChainChanged);
  boundWalletProvider = walletProvider;
}

function hasSharedIntentRoute() {
  return Boolean(
    state.intentRequest &&
      state.intentRequest.amount &&
      state.intentRequest.merchantAddress,
  );
}

function renderSharedIntentWidget() {
  const container = document.querySelector("[data-pay-intent-widget]");

  if (!container || !hasSharedIntentRoute()) {
    return;
  }

  const request = state.intentRequest;
  const widgetOptions = {
    permitHash: "",
    sessionId: "sess_hexapay_pay_route",
    deviceFingerprintHash: "dev_hexapay_pay_route",
    merchantId: request.merchantId || "",
    terminalId: request.terminalId || "",
    receiptId: request.receiptId || "",
    quoteId: request.quoteId || "",
    linkedInvoiceId: request.invoiceId || "",
    merchantAddress: request.merchantAddress || "",
    amount: request.amount || "",
    currency: request.currency || "USDC",
    clearOnSuccess: false,
    prefillRevision: [
      request.invoiceId,
      request.merchantId,
      request.amount,
      request.merchantAddress,
    ].join(":"),
    connectedWalletAddress: state.runtime.connected ? state.runtime.account : "",
    walletSessionActive: state.runtime.connected,
    executorAddress: import.meta.env.VITE_HEXAPAY_EXECUTOR_CONTRACT || "",
    onSuccess: (result) => {
      state.intentExecution = {
        payer: result.payer || "",
        txHash: result.txHash || "",
        blockNumber: result.blockNumber || "",
        settledAt: Date.now(),
      };
      state.notice = "Shared payment request settled successfully.";
      syncIntentReconciliation({ silent: true }).then(() => render());
      render();
    },
    onError: (error) => {
      state.notice = String(error?.message || "Shared payment request failed.");
      render();
    },
  };

  if (!container.dataset.mounted) {
    container.__paymentIntentWidget = mountPaymentIntentWidget(container, widgetOptions);
    container.dataset.mounted = "true";
    return;
  }

  container.__paymentIntentWidget?.update?.(widgetOptions);
}

function render() {
  const notice = document.querySelector("[data-pay-notice]");
  const chainPill = document.querySelector("[data-pay-chain]");
  const modulePill = document.querySelector("[data-pay-module]");
  const statusPill = document.querySelector("[data-pay-status]");
  const route = document.querySelector("[data-pay-route]");
  const summary = document.querySelector("[data-pay-summary]");
  const kicker = document.querySelector("[data-pay-kicker]");
  const heading = document.querySelector("[data-pay-heading]");
  const panelPill = document.querySelector("[data-pay-pill]");
  const copy = document.querySelector("[data-pay-copy]");
  const actionRow = document.querySelector("[data-pay-actions]");
  const backLink = document.querySelector("[data-pay-back-link]");
  const connectButton = document.querySelector('[data-command="connect-wallet"]');
  const switchButton = document.querySelector('[data-command="switch-chain"]');
  const refreshButton = document.querySelector('[data-command="refresh-quote"]');
  const payButton = document.querySelector('[data-command="pay-quote"]');
  const quoteNotice = document.querySelector("[data-pay-quote-notice]");
  const intentShell = document.querySelector("[data-pay-intent-shell]");
  const intentSummary = document.querySelector("[data-pay-intent-summary]");
  const reconciliationDetail = document.querySelector("[data-pay-reconciliation-detail]");
  const receiptCard = document.querySelector("[data-pay-receipt]");
  const receiptQuoteId = document.querySelector("[data-pay-receipt-quote-id]");
  const receiptMerchant = document.querySelector("[data-pay-receipt-merchant]");
  const receiptPayer = document.querySelector("[data-pay-receipt-payer]");
  const receiptStatus = document.querySelector("[data-pay-receipt-status]");
  const receiptSettledAt = document.querySelector("[data-pay-receipt-settled-at]");
  const receiptTxHash = document.querySelector("[data-pay-receipt-tx-hash]");
  const config = state.config;
  const quote = state.quote;
  const quoteError = state.quoteError;
  const latestReceipt = state.latestReceipt;
  const intentRequest = state.intentRequest;
  const intentExecution = state.intentExecution;
  const reconciliationRecord = getLatestIntentReconciliationRecord();
  const isIntentRoute = hasSharedIntentRoute();
  const moduleChain = config ? getChainMetadata(config.chainId).label : "Loading";
  const quoteStatus = Number(quote?.status ?? -1);
  const isExpired = quote ? Date.now() / 1000 > Number(quote.expiresAt || 0) : false;
  const isPending = quoteStatus === 1;
  const canPayQuote = Boolean(quote) && isPending && !isExpired;
  const hasInvalidQuote = Boolean(state.quoteId) && Boolean(config) && Boolean(state.runtime.provider) && !quote && isInvalidQuoteMessage(quoteError);
  const quoteViewState = !state.quoteId
    ? "invalid"
    : quote
      ? quoteStatus === 2
        ? "settled"
        : quoteStatus === 4 || isExpired
          ? "expired"
          : quoteStatus === 1
            ? "pending"
            : quoteStatus === 3
              ? "cancelled"
              : "invalid"
      : hasInvalidQuote
        ? "invalid"
        : "loading";

  notice.textContent = state.notice;

  if (state.runtime.connected) {
    connectButton.textContent = shortAddress(state.runtime.account, 4, 4);
  } else if (state.busyCommand === "connect-wallet") {
    connectButton.textContent = "Connecting...";
  } else {
    connectButton.textContent = "Connect Wallet";
  }

  connectButton.disabled = state.busyCommand !== "";
  refreshButton.disabled = state.busyCommand !== "";

  if (isIntentRoute) {
    document.title = "HexaPay - Pay Shared Request";
    if (kicker) {
      kicker.textContent = "Shared Payment Intent";
    }
    if (heading) {
      heading.textContent = "Pay shared request";
    }
    if (panelPill) {
      panelPill.textContent = "Live rail";
    }
    if (copy) {
      copy.textContent =
        "Open the shared request, connect the payer wallet, and settle USDC through the live HexaPay payment rail.";
    }

    chainPill.textContent = "Arbitrum Sepolia";
    modulePill.textContent = "Shared intent";
    statusPill.textContent = getSharedIntentStatusLabel();

    if (backLink) {
      backLink.href = `${window.location.origin}/app.html#dashboard`;
      backLink.textContent = "Back to Dashboard";
    }

    route.textContent = "Route: /pay.html?intent=...";
    summary.innerHTML = `
      <div class="summary-row">
        <span>Status</span>
        <strong>${getSharedIntentStatusLabel()}</strong>
      </div>
      <div class="summary-row">
        <span>Merchant</span>
        <strong>${shortAddress(intentRequest.merchantAddress)}</strong>
      </div>
      <div class="summary-row">
        <span>Amount</span>
        <strong>${intentRequest.amount} ${intentRequest.currency || "USDC"}</strong>
      </div>
      <div class="summary-row">
        <span>Reference</span>
        <strong>${intentRequest.invoiceId ? shortAddress(intentRequest.invoiceId, 8, 8) : intentRequest.receiptId || intentRequest.merchantId || "Shared request"}</strong>
      </div>
      <div class="summary-row">
        <span>Reconciliation</span>
        <strong>${
          reconciliationRecord
            ? reconciliationUi.getReconciliationSemanticLabel(reconciliationRecord.state)
            : intentExecution?.txHash
              ? "Waiting for backend observation"
              : "Waiting for payment rail"
        }</strong>
      </div>
    `;

    if (intentSummary) {
      const reasonCode =
        reconciliationRecord?.reason ||
        reconciliationRecord?.verificationReason ||
        state.reconciliation.error ||
        "";
      const authority = state.reconciliation.authority;
      const authorityLabel = authority
        ? [
            reconciliationUi.formatReconciliationAuthorityValue(authority.settlementSource),
            reconciliationUi.formatReconciliationAuthorityValue(authority.orchestration),
            reconciliationUi.formatReconciliationAuthorityValue(authority.accounting),
          ]
            .filter(Boolean)
            .join(" -> ")
        : "Executor Chain -> Payment Reconciliation Store -> Workflow Contract";
      intentSummary.innerHTML = `
        <div class="summary-row">
          <span>Merchant ID</span>
          <strong>${intentRequest.merchantId || "hexapay-merchant"}</strong>
        </div>
        <div class="summary-row">
          <span>Terminal</span>
          <strong>${intentRequest.terminalId || "dashboard"}</strong>
        </div>
        <div class="summary-row">
          <span>Invoice</span>
          <strong>${intentRequest.invoiceId ? shortAddress(intentRequest.invoiceId, 8, 8) : "Not linked"}</strong>
        </div>
        <div class="summary-row">
          <span>Last tx</span>
          <strong>${intentExecution?.txHash ? shortAddress(intentExecution.txHash, 8, 8) : "Pending settlement"}</strong>
        </div>
        <div class="summary-row">
          <span>Settlement source</span>
          <strong>${escapeHtml(
            reconciliationRecord
              ? reconciliationUi.getSettlementSourceLabel(reconciliationRecord)
              : intentExecution?.txHash
                ? "Executor chain settlement"
                : "Waiting for settlement source",
          )}</strong>
        </div>
        <div class="summary-row">
          <span>Authority</span>
          <strong>${escapeHtml(authorityLabel)}</strong>
        </div>
      `;
    }

    if (reconciliationDetail) {
      const reasonCode =
        reconciliationRecord?.reason ||
        reconciliationRecord?.verificationReason ||
        state.reconciliation.error ||
        "";
      const authority = state.reconciliation.authority;
      const authorityLabel = authority
        ? [
            reconciliationUi.formatReconciliationAuthorityValue(authority.settlementSource),
            reconciliationUi.formatReconciliationAuthorityValue(authority.orchestration),
            reconciliationUi.formatReconciliationAuthorityValue(authority.accounting),
          ]
            .filter(Boolean)
            .join(" -> ")
        : "Executor Chain -> Payment Reconciliation Store -> Workflow Contract";
      const semanticLabel = reconciliationRecord
        ? reconciliationUi.getReconciliationSemanticLabel(reconciliationRecord.state)
        : intentExecution?.txHash
          ? "Waiting for backend observation"
          : "Waiting for payment rail";
      const meaning = reconciliationRecord
        ? reconciliationUi.getReconciliationSemanticMeaning(reconciliationRecord.state)
        : intentExecution?.txHash
          ? "The payment is already settled on the rail, but the backend worker has not published a reconciliation record yet."
          : "Reconciliation starts after the invoice-linked payment is settled on the rail.";
      const nextOwner = reconciliationRecord
        ? reconciliationUi.getReconciliationNextOwnerLabel(reconciliationRecord.state, reasonCode)
        : intentExecution?.txHash
          ? "HexaPay backend"
          : "Payer";
      const nextStep = reconciliationRecord
        ? reconciliationUi.getReconciliationNextStepLabel(reconciliationRecord.state, reasonCode)
        : intentExecution?.txHash
          ? "Wait for backend observation or refresh this route."
          : "Review the request and settle it on the payment rail.";
      reconciliationDetail.hidden = false;
      reconciliationDetail.innerHTML = `
        <div class="summary-row">
          <span>Reconciliation status</span>
          <strong>${escapeHtml(semanticLabel)}</strong>
        </div>
        <div class="summary-row">
          <span>Backend phase</span>
          <strong>${escapeHtml(
            reconciliationRecord
              ? reconciliationUi.getReconciliationBackendPhaseLabel(reconciliationRecord.state)
              : "Not observed",
          )}</strong>
        </div>
        <div class="summary-row">
          <span>Meaning</span>
          <strong>${escapeHtml(meaning)}</strong>
        </div>
        <div class="summary-row">
          <span>Reason code</span>
          <strong>${escapeHtml(reasonCode || "n/a")}</strong>
        </div>
        <div class="summary-row">
          <span>Who acts next</span>
          <strong>${escapeHtml(nextOwner)}</strong>
        </div>
        <div class="summary-row">
          <span>Next step</span>
          <strong>${escapeHtml(nextStep)}</strong>
        </div>
        <div class="summary-row">
          <span>Settlement source</span>
          <strong>${escapeHtml(
            reconciliationRecord
              ? reconciliationUi.getSettlementSourceLabel(reconciliationRecord)
              : intentExecution?.txHash
                ? "Executor chain settlement"
                : "Waiting for settlement source",
          )}</strong>
        </div>
        <div class="summary-row">
          <span>Reconciliation authority</span>
          <strong>${escapeHtml(authorityLabel)}</strong>
        </div>
        <div class="summary-row">
          <span>Invoice linkage</span>
          <strong>${escapeHtml(
            reconciliationRecord
              ? reconciliationUi.getInvoiceLinkageLabel(reconciliationRecord)
              : intentRequest.invoiceId
                ? "receiptId = invoiceId"
                : "Not invoice-linked",
          )}</strong>
        </div>
        <div class="summary-row">
          <span>Invoice id</span>
          <strong>${escapeHtml(
            intentRequest.invoiceId || "Not linked",
          )}</strong>
        </div>
        <div class="summary-row">
          <span>Payment tx</span>
          <strong>${escapeHtml(
            intentExecution?.txHash ||
              reconciliationRecord?.sourceTxHash ||
              "Pending settlement",
          )}</strong>
        </div>
        <div class="summary-row">
          <span>Workflow tx</span>
          <strong>${escapeHtml(
            reconciliationRecord?.bridgeTxHash || "Not recorded yet",
          )}</strong>
        </div>
        <div class="summary-row">
          <span>Amount</span>
          <strong>${escapeHtml(`${intentRequest.amount} ${intentRequest.currency || "USDC"}`)}</strong>
        </div>
        <div class="summary-row">
          <span>Applied amount</span>
          <strong>${escapeHtml(
            reconciliationRecord &&
            reconciliationUi.getReconciliationSemanticKey(reconciliationRecord.state) === "applied"
              ? "Open the merchant invoice workspace for the exact applied clear amount"
              : "Visible after workflow apply",
          )}</strong>
        </div>
        <div class="summary-row">
          <span>Remaining outstanding</span>
          <strong>${escapeHtml(
            intentRequest.invoiceId
              ? "Reveal in the invoice workspace after the merchant opens app.html"
              : "Not available",
          )}</strong>
        </div>
      `;
    }

    if (actionRow) {
      actionRow.hidden = true;
    }
    if (payButton) {
      payButton.hidden = true;
    }
    if (quoteNotice) {
      quoteNotice.hidden = true;
    }
    if (receiptCard) {
      receiptCard.hidden = true;
    }
    if (intentShell) {
      intentShell.hidden = false;
    }

    refreshButton.hidden = true;
    switchButton.hidden = true;
    renderSharedIntentWidget();
    return;
  }

  if (kicker) {
    document.title = "HexaPay - Pay Private Quote";
    kicker.textContent = "Private Quote";
  }
  if (heading) {
    heading.textContent = "Payment details";
  }
  if (panelPill) {
    panelPill.textContent = "Payer";
  }
  if (copy) {
    copy.textContent =
      "This page reuses the HexaPay wallet flow and theme, but only exposes the minimum quote metadata needed to settle the payment.";
  }
  if (intentShell) {
    intentShell.hidden = true;
  }
  if (reconciliationDetail) {
    reconciliationDetail.hidden = true;
  }

  chainPill.textContent = config ? moduleChain : "Loading network";
  modulePill.textContent = config?.isFallback ? "Local fallback" : "Configured route";
  statusPill.textContent =
    quoteViewState === "pending"
      ? "Pending"
      : quoteViewState === "settled"
        ? "Settled"
        : quoteViewState === "expired"
          ? "Expired"
          : quoteViewState === "cancelled"
            ? "Cancelled"
            : quoteViewState === "invalid"
              ? "Invalid quote"
              : state.quoteId
                ? "Waiting"
                : "Missing quote";

  if (backLink) {
    backLink.href = appendPrivateQuoteStoreMode(
      `${window.location.origin}/app.html#private-quotes`,
      receiptStoreMode,
    ).toString();
    backLink.textContent = "Back to Private Quotes";
  }

  route.textContent = state.quoteId
    ? `Route: /pay.html?id=${state.quoteId}`
    : "Missing quote id in the URL. Open this page from the generated payment link.";

  if (!state.quoteId) {
    summary.innerHTML = `
      <div class="summary-row">
        <span>Status</span>
        <strong>Invalid quote</strong>
      </div>
      <div class="summary-row">
        <span>Reason</span>
        <strong>Missing quote id in the URL</strong>
      </div>
      <div class="summary-row">
        <span>What to do</span>
        <strong>Open a fresh payment link from Private Quotes</strong>
      </div>
    `;
  } else if (hasInvalidQuote) {
    summary.innerHTML = `
      <div class="summary-row">
        <span>Status</span>
        <strong>Invalid quote</strong>
      </div>
      <div class="summary-row">
        <span>Quote ID</span>
        <strong>${state.quoteId}</strong>
      </div>
      <div class="summary-row">
        <span>Network</span>
        <strong>${moduleChain}</strong>
      </div>
      <div class="summary-row">
        <span>Reason</span>
        <strong>${quoteError}</strong>
      </div>
      <div class="summary-row">
        <span>What to do</span>
        <strong>Open a fresh payment link from Private Quotes</strong>
      </div>
    `;
  } else if (!quote) {
    summary.innerHTML = `
      <div class="summary-row">
        <span>Status</span>
        <strong>Load the quote to inspect it</strong>
      </div>
      <div class="summary-row">
        <span>Quote ID</span>
        <strong>${state.quoteId}</strong>
      </div>
      <div class="summary-row">
        <span>Network</span>
        <strong>${moduleChain}</strong>
      </div>
    `;
  } else {
    summary.innerHTML = `
      <div class="summary-row">
        <span>Status</span>
        <strong>${quote.statusLabel}</strong>
      </div>
      <div class="summary-row">
        <span>Quote ID</span>
        <strong>${quote.id}</strong>
      </div>
      <div class="summary-row">
        <span>Merchant</span>
        <strong>${shortAddress(quote.merchant)}</strong>
      </div>
      <div class="summary-row">
        <span>Payer</span>
        <strong>${shortAddress(quote.payer)}</strong>
      </div>
      <div class="summary-row">
        <span>Expires</span>
        <strong>${formatPrivateQuoteExpiry(quote.expiresAt)}</strong>
      </div>
      <div class="summary-row">
        <span>Access</span>
        <strong>${quote.accessGranted ? "Granted" : "Blind pay only"}</strong>
      </div>
      <div class="summary-row">
        <span>Wallet</span>
        <strong>${state.runtime.connected ? `${shortAddress(state.runtime.account)} · ${getChainMetadata(state.runtime.chainId).shortLabel}` : "Connect wallet"}</strong>
      </div>
    `;
  }

  switchButton.hidden = !config || !state.runtime.walletAvailable || state.runtime.chainId === config.chainId;
  switchButton.disabled = state.busyCommand !== "";
  switchButton.textContent =
    state.busyCommand === "switch-chain"
      ? "Switching..."
      : `Switch to ${config ? getChainMetadata(config.chainId).shortLabel : "target"}`;
  refreshButton.hidden = false;

  if (actionRow) {
    actionRow.hidden = !canPayQuote;
  }

  const payButtonLabel =
    state.busyCommand === "pay-quote"
      ? "Processing..."
      : !state.runtime.connected
        ? "Connect wallet to pay"
        : state.runtime.chainId !== config?.chainId
          ? `Switch to ${config ? getChainMetadata(config.chainId).shortLabel : "target"}`
          : "Pay Now";

  payButton.hidden = !canPayQuote;
  payButton.disabled =
    !canPayQuote ||
    state.busyCommand !== "" ||
    !state.runtime.connected ||
    state.runtime.chainId !== config?.chainId;
  payButton.textContent = payButtonLabel;

  if (quoteNotice) {
    let quoteNoticeMessage = "";

    if (quoteViewState === "invalid") {
      quoteNoticeMessage = quoteError || "Invalid quote route.";
    } else if (quote && !canPayQuote) {
      if (quoteStatus === 2) {
        quoteNoticeMessage = latestReceipt?.quoteId === state.quoteId
          ? "Quote already settled. Receipt is available below."
          : "Quote already settled.";
      } else if (isExpired || quoteStatus === 4) {
        quoteNoticeMessage = "Quote has expired.";
      } else if (quoteStatus === 3) {
        quoteNoticeMessage = "Quote has been cancelled.";
      } else {
        quoteNoticeMessage = "Quote is not payable.";
      }
    }

    quoteNotice.hidden = !quoteNoticeMessage;
    quoteNotice.textContent = quoteNoticeMessage;
  }

  if (!receiptCard) {
    return;
  }

  const visibleReceipt =
    latestReceipt && latestReceipt.quoteId === state.quoteId ? latestReceipt : null;

  receiptCard.hidden = !visibleReceipt;

  if (!visibleReceipt) {
    return;
  }

  receiptQuoteId.textContent = visibleReceipt.quoteId;
  receiptMerchant.textContent = visibleReceipt.merchant || "Not available";
  receiptPayer.textContent = visibleReceipt.payer || "Not available";
  receiptStatus.textContent = visibleReceipt.status || "Settled";
  receiptSettledAt.textContent = formatPrivateQuoteReceiptTime(visibleReceipt.settledAt);
  receiptTxHash.textContent = visibleReceipt.txHash || "Not available";
}

async function refreshRuntime({ requestAccounts = false, walletId = "" } = {}) {
  const runtime = await createRuntime({
    requestAccounts,
    suppressAccounts: !requestAccounts && !isWalletSessionEnabled(),
    walletId: getPreferredWalletId(walletId),
  });

  if (runtime.connected) {
    setWalletSessionEnabled(true);
  }

  if (runtime.walletId) {
    setStoredWalletProviderId(runtime.walletId);
  }

  state.runtime = runtime;
  state.fhenix = runtime.connected ? await getFhenixState(runtime) : createDefaultFhenixState();
  syncWalletListeners(runtime.walletProvider);
}

async function refreshQuote({ silent = false } = {}) {
  if (hasSharedIntentRoute()) {
    await syncIntentReconciliation({ silent: true });
    state.notice = getSharedIntentNotice();
    render();
    return;
  }

  if (!state.quoteId) {
    state.notice = "Missing quote id in the URL.";
    render();
    return;
  }

  if (!state.config) {
    state.notice = "Private quote module config is still loading.";
    render();
    return;
  }

  if (!state.runtime.provider) {
    state.notice = "Install or unlock a wallet to read the quote route.";
    render();
    return;
  }

  try {
    if (!silent) {
      state.busyCommand = "refresh-quote";
    }
    state.quoteError = "";
    render();
    state.quote = await readPrivateQuote({
      runner: state.runtime.signer || state.runtime.provider,
      address: state.config.address,
      quoteId: state.quoteId,
    });
    state.quoteError = "";

    if (canSettlePrivateQuote(state.quote)) {
      state.notice =
        state.runtime.connected && state.runtime.chainId === state.config.chainId
          ? "Quote is ready. Confirm the payment in the payer wallet."
          : `Quote loaded. Switch wallet to ${getChainMetadata(state.config.chainId).label} to settle.`;
    } else if (state.quote.statusLabel === "Settled") {
      state.notice =
        state.latestReceipt && state.latestReceipt.quoteId === state.quoteId
          ? "Quote already settled. Receipt ready below."
          : "Quote already settled.";
    } else if (Number(state.quote.status) === 4 || Date.now() / 1000 > Number(state.quote.expiresAt)) {
      state.notice = "Quote has expired.";
    } else {
      state.notice = `Quote loaded: ${state.quote.statusLabel}.`;
    }
  } catch (error) {
    state.notice = getPrivateQuoteErrorMessage(error);
    state.quote = null;
    state.quoteError = state.notice;
  } finally {
    if (!silent) {
      state.busyCommand = "";
    }
    render();
  }
}

async function handleConnectWallet() {
  if (
    !hasSharedIntentRoute() &&
    state.runtime.connected &&
    state.runtime.chainId &&
    state.runtime.chainId !== getPayRouteTargetChainId()
  ) {
    await handleSwitchChain();
    return;
  }

  try {
    state.busyCommand = "connect-wallet";
    render();
    await refreshRuntime({ requestAccounts: true });
    await syncRuntimeDependentState();
    if (hasSharedIntentRoute()) {
      state.notice = "Wallet connected. Review the shared payment request below.";
    }
  } catch (error) {
    state.notice = getPrivateQuoteErrorMessage(error);
  } finally {
    state.busyCommand = "";
    render();
  }
}

async function handleSwitchChain() {
  const targetChainId = getPayRouteTargetChainId();

  if (!targetChainId) {
    return;
  }

  try {
    state.busyCommand = "switch-chain";
    render();
    await switchWalletChain(targetChainId, getPreferredWalletId());
    await refreshRuntime({ requestAccounts: false, walletId: getPreferredWalletId() });
    await syncRuntimeDependentState();
    state.notice = `Wallet switched to ${getChainMetadata(targetChainId).label}.`;
  } catch (error) {
    state.notice = getPrivateQuoteErrorMessage(error);
  } finally {
    state.busyCommand = "";
    render();
  }
}

async function handlePayQuote() {
  if (!state.config || !state.quoteId) {
    state.notice = "Quote route is incomplete.";
    render();
    return;
  }

  try {
    state.busyCommand = "pay-quote";
    render();

    if (!state.runtime.connected || !state.runtime.signer) {
      throw new Error("Connect the payer wallet first.");
    }

    if (state.runtime.chainId !== state.config.chainId) {
      throw new Error(`Switch wallet to ${getChainMetadata(state.config.chainId).label} first.`);
    }

    const result = await settlePrivateQuote({
      signer: state.runtime.signer,
      address: state.config.address,
      quoteId: state.quoteId,
      skipPreview: true,
    });

    await receiptStore.saveReceipt(createReceiptRecord({
      quoteId: state.quoteId,
      merchant: state.quote?.merchant || "",
      payer: state.quote?.payer || "",
      status: "Settled",
      settledAt: Date.now(),
      txHash: result.txHash,
      paymentLink: window.location.href,
    }));
    state.allowReceiptGrantSignature = true;
    await syncReceiptState();
    await refreshQuote();
    state.notice = "Payment settled successfully. Receipt ready.";
    render();
  } catch (error) {
    state.notice = getPrivateQuoteErrorMessage(error);
    state.busyCommand = "";
    render();
  }
}

function bindEvents() {
  document.addEventListener("click", async (event) => {
    const trigger = event.target.closest("[data-command]");

    if (!trigger) {
      return;
    }

    event.preventDefault();

    if (trigger.dataset.command === "connect-wallet") {
      await handleConnectWallet();
      return;
    }

    if (trigger.dataset.command === "switch-chain") {
      await handleSwitchChain();
      return;
    }

    if (trigger.dataset.command === "refresh-quote") {
      if (state.runtime.connected && state.runtime.signer) {
        state.allowReceiptGrantSignature = true;
        await syncReceiptState();
      }
      await refreshQuote();
      return;
    }

    if (trigger.dataset.command === "pay-quote") {
      await handlePayQuote();
    }
  });

  window.addEventListener("storage", async (event) => {
    if (
      event.key === WALLET_SESSION_STORAGE_KEY ||
      event.key === WALLET_PROVIDER_STORAGE_KEY
    ) {
      try {
        await refreshRuntime({
          requestAccounts: false,
          walletId: getStoredWalletProviderId() || state.runtime.walletId,
        });
        await syncRuntimeDependentState();
      } catch (error) {
        state.notice = getPrivateQuoteErrorMessage(error);
        render();
      }
      return;
    }

    if (event.key === PRIVATE_QUOTE_STORE_MODE_STORAGE_KEY) {
      syncReceiptStoreMode(getPrivateQuoteStoreMode());
      await syncReceiptState();
      render();
      return;
    }

    if (!receiptStoreChangeKey || event.key !== receiptStoreChangeKey) {
      return;
    }

    await syncReceiptState();

    if (state.quote?.statusLabel === "Settled" && state.latestReceipt?.quoteId === state.quoteId) {
      state.notice = "Quote already settled. Receipt ready below.";
    }

    render();
  });
}

async function bootstrap() {
  syncReceiptStoreMode(getPrivateQuoteStoreMode());
  state.config = await loadPrivateQuoteConfig();
  await refreshRuntime({ requestAccounts: false });
  await syncReceiptState();
  render();
  bindEvents();
  if (hasSharedIntentRoute()) {
    await syncIntentReconciliation({ silent: true });
    state.notice = getSharedIntentNotice();
    render();
    return;
  }
  await refreshQuote();
}

bootstrap();
