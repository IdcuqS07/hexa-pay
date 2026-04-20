import { formatPrivateQuoteReceiptTime } from "./private-quote.js";
import { createReceiptAccessContext } from "./receipt-access-context.js";
import { createReceiptStore, getReceiptStoreChangeKey } from "./receipt-store-factory.js";
import { ReceiptRoles } from "./receipt-types.js";
import {
  appendPrivateQuoteStoreMode,
  getPrivateQuoteStoreMode,
  getPrivateQuoteStoreModeLabel,
  PRIVATE_QUOTE_PHASE_LABEL,
  PRIVATE_QUOTE_STORE_MODE_STORAGE_KEY,
  setPrivateQuoteStoreMode,
} from "./config.js";

const state = {
  quoteId: new URL(window.location.href).searchParams.get("id") || "",
  receipt: null,
  busyCommand: "",
  notice: "Loading auditor receipt route...",
};

let receiptStoreMode = getPrivateQuoteStoreMode();
let receiptStore = createReceiptStore(receiptStoreMode, {
  accessContextResolver: ({ role, quoteId, action }) =>
    createReceiptAccessContext({
      role,
      quoteId,
      action,
    }),
});
let receiptStoreChangeKey = getReceiptStoreChangeKey(receiptStoreMode);

function syncReceiptStoreMode(mode, { syncUrl = true } = {}) {
  receiptStoreMode = setPrivateQuoteStoreMode(mode, { syncUrl });
  receiptStore = createReceiptStore(receiptStoreMode, {
    accessContextResolver: ({ role, quoteId, action }) =>
      createReceiptAccessContext({
        role,
        quoteId,
        action,
      }),
  });
  receiptStoreChangeKey = getReceiptStoreChangeKey(receiptStoreMode);
}

async function refreshReceipt() {
  if (!state.quoteId) {
    state.receipt = null;
    state.notice = "Missing quote id in the URL.";
    render();
    return;
  }

  try {
    state.busyCommand = "refresh-audit-receipt";
    render();
    state.receipt = await receiptStore.getReceiptByQuoteId(state.quoteId, ReceiptRoles.AUDITOR);
    state.notice = state.receipt
      ? "Auditor receipt ready. Limited visibility only."
      : `No limited receipt found for this quote in ${getPrivateQuoteStoreModeLabel(receiptStoreMode)} mode.`;
  } finally {
    state.busyCommand = "";
    render();
  }
}

function render() {
  const notice = document.querySelector("[data-audit-notice]");
  const route = document.querySelector("[data-audit-route]");
  const summary = document.querySelector("[data-audit-summary]");
  const pageNotice = document.querySelector("[data-audit-page-notice]");
  const receiptCard = document.querySelector("[data-audit-receipt]");
  const statusChip = document.querySelector("[data-audit-status-chip]");
  const storeModeChip = document.querySelector("[data-audit-store-mode-chip]");
  const visibilityChip = document.querySelector("[data-audit-visibility-chip]");
  const phaseChip = document.querySelector("[data-audit-phase-chip]");
  const backLink = document.querySelector("[data-audit-back-link]");
  const storeModeField = document.querySelector("[data-audit-store-mode]");
  const refreshButton = document.querySelector('[data-command="refresh-audit-receipt"]');
  const receiptQuoteId = document.querySelector("[data-audit-receipt-quote-id]");
  const receiptMerchant = document.querySelector("[data-audit-receipt-merchant]");
  const receiptPayer = document.querySelector("[data-audit-receipt-payer]");
  const receiptStatus = document.querySelector("[data-audit-receipt-status]");
  const receiptSettledAt = document.querySelector("[data-audit-receipt-settled-at]");
  const receiptTxHash = document.querySelector("[data-audit-receipt-tx-hash]");
  const receiptVisibility = document.querySelector("[data-audit-receipt-visibility]");
  const receiptStoreModeValue = document.querySelector("[data-audit-receipt-store-mode]");
  const receiptPhase = document.querySelector("[data-audit-receipt-phase]");
  const storeModeLabel = getPrivateQuoteStoreModeLabel(receiptStoreMode);

  notice.textContent = state.notice;
  route.textContent = state.quoteId
    ? `Route: /audit.html?id=${state.quoteId}`
    : "Missing quote id in the URL. Open this page from a merchant receipt link.";
  statusChip.textContent = state.receipt ? "Receipt Ready" : state.quoteId ? "Missing Receipt" : "Invalid Quote";
  storeModeChip.textContent = `Store Mode: ${storeModeLabel}`;
  visibilityChip.textContent = "Visibility: Limited";
  phaseChip.textContent = `Phase: ${PRIVATE_QUOTE_PHASE_LABEL}`;

  if (backLink) {
    backLink.href = appendPrivateQuoteStoreMode(
      `${window.location.origin}/app.html#private-quotes`,
      receiptStoreMode,
    ).toString();
  }

  if (storeModeField) {
    storeModeField.value = receiptStoreMode;
    storeModeField.disabled = state.busyCommand !== "";
  }

  refreshButton.disabled = state.busyCommand !== "";
  refreshButton.textContent = state.busyCommand === "refresh-audit-receipt" ? "Refreshing..." : "Refresh Receipt";

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
        <span>Store Mode</span>
        <strong>${storeModeLabel}</strong>
      </div>
    `;
  } else if (!state.receipt) {
    summary.innerHTML = `
      <div class="summary-row">
        <span>Status</span>
        <strong>Receipt not found</strong>
      </div>
      <div class="summary-row">
        <span>Quote ID</span>
        <strong>${state.quoteId}</strong>
      </div>
      <div class="summary-row">
        <span>Store Mode</span>
        <strong>${storeModeLabel}</strong>
      </div>
      <div class="summary-row">
        <span>What to do</span>
        <strong>Open the auditor link after settlement or switch store mode</strong>
      </div>
    `;
  } else {
    summary.innerHTML = `
      <div class="summary-row">
        <span>Status</span>
        <strong>${state.receipt.status}</strong>
      </div>
      <div class="summary-row">
        <span>Quote ID</span>
        <strong>${state.receipt.quoteId}</strong>
      </div>
      <div class="summary-row">
        <span>Store Mode</span>
        <strong>${storeModeLabel}</strong>
      </div>
      <div class="summary-row">
        <span>Visibility</span>
        <strong>${state.receipt.visibility}</strong>
      </div>
    `;
  }

  const missingReceiptMessage = !state.quoteId
    ? "Invalid quote route."
    : !state.receipt
      ? `No auditor receipt found in ${storeModeLabel} mode.`
      : "";

  pageNotice.hidden = !missingReceiptMessage;
  pageNotice.textContent = missingReceiptMessage || "Auditor receipt is ready.";
  receiptCard.hidden = !state.receipt;

  if (!state.receipt) {
    return;
  }

  receiptQuoteId.textContent = state.receipt.quoteId;
  receiptMerchant.textContent = state.receipt.merchant || "Not available";
  receiptPayer.textContent = state.receipt.payer || "Not available";
  receiptStatus.textContent = state.receipt.status || "Settled";
  receiptSettledAt.textContent = formatPrivateQuoteReceiptTime(state.receipt.settledAt);
  receiptTxHash.textContent = state.receipt.txHash || "Not available";
  receiptVisibility.textContent = state.receipt.visibility || "limited";
  receiptStoreModeValue.textContent = storeModeLabel;
  receiptPhase.textContent = PRIVATE_QUOTE_PHASE_LABEL;
}

function bindEvents() {
  document.addEventListener("click", async (event) => {
    const trigger = event.target.closest("[data-command]");

    if (!trigger) {
      return;
    }

    event.preventDefault();

    if (trigger.dataset.command === "refresh-audit-receipt") {
      await refreshReceipt();
    }
  });

  document.addEventListener("change", async (event) => {
    const storeModeField = event.target.closest("[data-audit-store-mode]");

    if (!storeModeField) {
      return;
    }

    syncReceiptStoreMode(storeModeField.value);
    await refreshReceipt();
  });

  window.addEventListener("storage", async (event) => {
    if (event.key === PRIVATE_QUOTE_STORE_MODE_STORAGE_KEY) {
      syncReceiptStoreMode(getPrivateQuoteStoreMode(), { syncUrl: false });
      await refreshReceipt();
      return;
    }

    if (!receiptStoreChangeKey || event.key !== receiptStoreChangeKey) {
      return;
    }

    await refreshReceipt();
  });
}

async function bootstrap() {
  syncReceiptStoreMode(getPrivateQuoteStoreMode(), { syncUrl: false });
  render();
  bindEvents();
  await refreshReceipt();
}

bootstrap();
