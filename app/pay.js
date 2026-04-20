import { createRuntime, getFhenixState, shortAddress, switchWalletChain } from "../src/contracts/client.js";
import { getChainMetadata } from "../src/contracts/config.js";
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
  getPrivateQuoteStoreModeLabel,
  PRIVATE_QUOTE_STORE_MODE_STORAGE_KEY,
} from "./config.js";

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

function render() {
  const notice = document.querySelector("[data-pay-notice]");
  const chainPill = document.querySelector("[data-pay-chain]");
  const modulePill = document.querySelector("[data-pay-module]");
  const statusPill = document.querySelector("[data-pay-status]");
  const route = document.querySelector("[data-pay-route]");
  const summary = document.querySelector("[data-pay-summary]");
  const actionRow = document.querySelector("[data-pay-actions]");
  const backLink = document.querySelector("[data-pay-back-link]");
  const connectButton = document.querySelector('[data-command="connect-wallet"]');
  const switchButton = document.querySelector('[data-command="switch-chain"]');
  const refreshButton = document.querySelector('[data-command="refresh-quote"]');
  const payButton = document.querySelector('[data-command="pay-quote"]');
  const quoteNotice = document.querySelector("[data-pay-quote-notice]");
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
      <div class="summary-row">
        <span>Receipt Store</span>
        <strong>${getPrivateQuoteStoreModeLabel(receiptStoreMode)}</strong>
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
        <span>Receipt Store</span>
        <strong>${getPrivateQuoteStoreModeLabel(receiptStoreMode)}</strong>
      </div>
      <div class="summary-row">
        <span>Wallet</span>
        <strong>${state.runtime.connected ? `${shortAddress(state.runtime.account)} · ${getChainMetadata(state.runtime.chainId).shortLabel}` : "Connect wallet"}</strong>
      </div>
    `;
  }

  if (state.runtime.connected) {
    connectButton.textContent = shortAddress(state.runtime.account, 4, 4);
  } else if (state.busyCommand === "connect-wallet") {
    connectButton.textContent = "Connecting...";
  } else {
    connectButton.textContent = "Connect Wallet";
  }

  connectButton.disabled = state.busyCommand !== "";
  refreshButton.disabled = state.busyCommand !== "";
  switchButton.hidden = !config || !state.runtime.walletAvailable || state.runtime.chainId === config.chainId;
  switchButton.disabled = state.busyCommand !== "";
  switchButton.textContent =
    state.busyCommand === "switch-chain"
      ? "Switching..."
      : `Switch to ${config ? getChainMetadata(config.chainId).shortLabel : "target"}`;

  if (actionRow) {
    actionRow.hidden = !canPayQuote;
  }

  payButton.hidden = !canPayQuote;
  payButton.disabled =
    !canPayQuote ||
    state.busyCommand !== "" ||
    !state.runtime.connected ||
    state.runtime.chainId !== config?.chainId;
  payButton.textContent = state.busyCommand === "pay-quote" ? "Processing..." : "Pay Now";

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

async function refreshRuntime({ requestAccounts = false } = {}) {
  const runtime = await createRuntime({
    requestAccounts,
    walletId: state.runtime.walletId || "",
  });
  state.runtime = runtime;
  state.fhenix = runtime.connected ? await getFhenixState(runtime) : createDefaultFhenixState();
}

async function refreshQuote() {
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
    state.busyCommand = "refresh-quote";
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
    state.busyCommand = "";
    render();
  }
}

async function handleConnectWallet() {
  try {
    state.busyCommand = "connect-wallet";
    render();
    await refreshRuntime({ requestAccounts: true });
    state.allowReceiptGrantSignature = true;
    await syncReceiptState();
    state.notice =
      state.config && state.runtime.chainId !== state.config.chainId
        ? `Wallet connected. Switch to ${getChainMetadata(state.config.chainId).label} to settle this quote.`
        : "Wallet connected.";
  } catch (error) {
    state.notice = getPrivateQuoteErrorMessage(error);
  } finally {
    state.busyCommand = "";
    render();
  }
}

async function handleSwitchChain() {
  if (!state.config) {
    return;
  }

  try {
    state.busyCommand = "switch-chain";
    render();
    await switchWalletChain(state.config.chainId, state.runtime.walletId || "");
    await refreshRuntime({ requestAccounts: false });
    state.allowReceiptGrantSignature = true;
    await syncReceiptState();
    state.notice = `Wallet switched to ${getChainMetadata(state.config.chainId).label}.`;
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
  await refreshQuote();
}

bootstrap();
