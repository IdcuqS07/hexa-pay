import { formatUnits } from "ethers";
import {
  DEFAULT_CHAIN_ID,
  getAddressConfig,
  getChainMetadata,
  loadDeploymentManifest,
  saveAddressConfig,
} from "./contracts/config.js";
import {
  buildEncryptedAmount,
  createRuntime,
  describeInvoiceStatus,
  explainFhenixMode,
  formatTransactionError,
  getContract,
  getExplorerLink,
  getFhenixState,
  hashText,
  isConfiguredAddress,
  listInjectedWallets,
  normalizeAddress,
  parseAmountToUnits,
  parseTimestamp,
  readCoreSnapshot,
  readSealedValue,
  readTokenSnapshot,
  sendWrite,
  shortAddress,
  switchWalletChain,
} from "./contracts/client.js";

const RECENT_ACTIVITY_STORAGE_KEY = "hexapay_recent_activity_v1";
const WALLET_SESSION_STORAGE_KEY = "hexapay_wallet_session_v1";
const WALLET_PROVIDER_STORAGE_KEY = "hexapay_wallet_provider_v1";
const SIDEBAR_TABS = ["control", "ledger", "focus"];
const FEATURE_LANES = [
  {
    id: "wallet",
    label: "Wallet",
    navCopy: "Connect + privacy",
    statusLabel: "Core control",
    statusTone: "is-blue",
    kicker: "Wallet Control",
    title: "Private finance runtime",
    summary:
      "Connect the wallet, align the selected chain, sync the manifest, and control when private balances are revealed in this session.",
  },
  {
    id: "treasury",
    label: "Treasury",
    navCopy: "Encrypted payout rail",
    statusLabel: "Live rail",
    statusTone: "is-blue",
    kicker: "Treasury",
    title: "Encrypted payments",
    summary:
      "Send confidential payments over the live settlement rail without exposing raw amounts in the public transaction payload.",
  },
  {
    id: "company",
    label: "Company",
    navCopy: "Business identity",
    statusLabel: "Live setup",
    statusTone: "is-green",
    kicker: "Business Identity",
    title: "Company registry",
    summary:
      "Register the operating company before using the app as a business account for invoices and controlled finance operations.",
  },
  {
    id: "invoice",
    label: "Invoices",
    navCopy: "Create + settle",
    statusLabel: "Live workflow",
    statusTone: "is-violet",
    kicker: "Invoices",
    title: "Confidential invoice lifecycle",
    summary:
      "Issue, approve, settle, and inspect invoice status in one focused AP and AR workflow lane.",
  },
  {
    id: "activity",
    label: "Activity",
    navCopy: "Ledger + focus",
    statusLabel: "Private log",
    statusTone: "is-muted",
    kicker: "Activity",
    title: "Masked transaction ledger",
    summary:
      "Review confirmed encrypted activity, inspect masked traces, and keep invoice-linked actions visible without overwhelming the main workflow lanes.",
  },
];

const state = {
  root: null,
  selectedChainId: DEFAULT_CHAIN_ID,
  addresses: getAddressConfig(DEFAULT_CHAIN_ID),
  manifest: null,
  runtime: createDefaultRuntime(),
  fhenix: createDefaultFhenixState(),
  coreSnapshot: null,
  tokenSnapshot: null,
  busyCommand: "",
  busyAction: "",
  activeFeature: "treasury",
  activeSidebarTab: "control",
  walletModalOpen: false,
  walletMenuOpen: false,
  recentActivity: [],
  currentInvoiceId: "",
  invoiceSnapshots: {},
  privateBalance: createDefaultPrivateBalance(),
  stage: {
    step: 0,
    title: "Private flow idle",
    detail: "Connect a wallet to initialize the HexaPay app.",
  },
  notice: {
    tone: "muted",
    title: "HexaPay app ready",
    summary: "Connect a wallet on Arbitrum Sepolia to use live encrypted actions.",
    meta: ["Manifest will auto-sync from deployment.json when available."],
    actionHref: "",
    actionLabel: "",
  },
  drafts: createDefaultDrafts(),
};
let boundWalletProvider = null;
let boundWalletAccountsChanged = null;
let boundWalletChainChanged = null;

function createDefaultRuntime() {
  const wallets = listInjectedWallets();

  return {
    walletAvailable: wallets.length > 0,
    provider: null,
    signer: null,
    account: "",
    chainId: "",
    connected: false,
    walletId: "",
    walletName: "",
    walletAccent: "slate",
    walletProvider: null,
    wallets,
  };
}

function createDefaultFhenixState() {
  return {
    mode: "offline",
    client: null,
    permitHash: "",
    error: "",
  };
}

function createDefaultPrivateBalance() {
  return {
    revealed: false,
    loaded: false,
    formattedBalance: "",
    clearBalance: "",
    sealedBalance: "",
    publicKey: "",
  };
}

function createDefaultDrafts() {
  const dueAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const localDueAt = new Date(dueAt.getTime() - dueAt.getTimezoneOffset() * 60 * 1000)
    .toISOString()
    .slice(0, 16);

  return {
    registerCompany: {
      companyName: "HexaPay Ops",
      ensName: "",
      companyId: "HEXAPAY-001",
    },
    sendPayment: {
      recipient: "",
      amount: "0.001",
      referenceHash: "PAY-2026-001",
    },
    createInvoice: {
      company: "",
      payer: "",
      amount: "0.001",
      metadataHash: "invoice-2026-001",
      dueAt: localDueAt,
    },
    approveInvoice: {
      invoiceId: "",
    },
    payInvoice: {
      invoiceId: "",
      amount: "0.001",
    },
    monitorInvoice: {
      invoiceId: "",
    },
  };
}

function isWalletSessionEnabled() {
  if (typeof window === "undefined") {
    return true;
  }

  return window.localStorage.getItem(WALLET_SESSION_STORAGE_KEY) !== "disabled";
}

function setWalletSessionEnabled(enabled) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(WALLET_SESSION_STORAGE_KEY, enabled ? "enabled" : "disabled");
}

function getStoredWalletProviderId() {
  if (typeof window === "undefined") {
    return "";
  }

  return window.localStorage.getItem(WALLET_PROVIDER_STORAGE_KEY) || "";
}

function setStoredWalletProviderId(walletId) {
  if (typeof window === "undefined") {
    return;
  }

  if (!walletId) {
    window.localStorage.removeItem(WALLET_PROVIDER_STORAGE_KEY);
    return;
  }

  window.localStorage.setItem(WALLET_PROVIDER_STORAGE_KEY, walletId);
}

function getWalletOptions() {
  return state.runtime.wallets?.length ? state.runtime.wallets : listInjectedWallets();
}

function getActiveWalletDescriptor(walletId = state.runtime.walletId || getStoredWalletProviderId()) {
  const wallets = getWalletOptions();

  return wallets.find((wallet) => wallet.id === walletId) || wallets[0] || null;
}

function getConnectingWalletId() {
  return state.busyCommand.startsWith("connect:") ? state.busyCommand.slice("connect:".length) : "";
}

function closeWalletChrome() {
  state.walletModalOpen = false;
  state.walletMenuOpen = false;
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

function syncWalletListeners(walletProvider) {
  if (boundWalletProvider === walletProvider) {
    return;
  }

  detachWalletListeners();

  if (!walletProvider) {
    return;
  }

  boundWalletAccountsChanged = async () => {
    await refreshAppState({ silent: true, walletId: state.runtime.walletId || getStoredWalletProviderId() });
  };
  boundWalletChainChanged = async () => {
    await refreshAppState({ silent: true, walletId: state.runtime.walletId || getStoredWalletProviderId() });
  };
  walletProvider.on?.("accountsChanged", boundWalletAccountsChanged);
  walletProvider.on?.("chainChanged", boundWalletChainChanged);
  boundWalletProvider = walletProvider;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getNoticeToneClass(tone) {
  if (tone === "good") {
    return "is-good";
  }

  if (tone === "warn") {
    return "is-warn";
  }

  if (tone === "bad") {
    return "is-bad";
  }

  return "is-muted";
}

function formatRelativeTime(timestamp) {
  const numeric = Number(timestamp || 0);

  if (!numeric) {
    return "Saved earlier";
  }

  const diff = Date.now() - numeric;

  if (diff < 60_000) {
    return "Just now";
  }

  if (diff < 3_600_000) {
    return `${Math.max(1, Math.floor(diff / 60_000))}m ago`;
  }

  if (diff < 86_400_000) {
    return `${Math.max(1, Math.floor(diff / 3_600_000))}h ago`;
  }

  return `${Math.max(1, Math.floor(diff / 86_400_000))}d ago`;
}

function maskTrace(value) {
  const text = String(value || "");
  const hasHexPrefix = text.startsWith("0x");
  const raw = hasHexPrefix ? text.slice(2) : text;

  if (!raw) {
    return "Trace locked";
  }

  const head = raw.slice(0, 4);
  const tail = raw.slice(-4);
  const hidden = "~".repeat(Math.max(8, Math.min(18, raw.length - head.length - tail.length || 8)));

  return `${hasHexPrefix ? "0x" : ""}${head}${hidden}${tail}`;
}

function getModulePillClass(module) {
  if (module === "Invoices") {
    return "is-violet";
  }

  if (module === "Treasury") {
    return "is-blue";
  }

  if (module === "Identity") {
    return "is-green";
  }

  return "is-muted";
}

function getFeatureConfig(featureId = state.activeFeature) {
  return FEATURE_LANES.find((feature) => feature.id === featureId) || FEATURE_LANES[0];
}

function shouldShowStageRail() {
  return state.stage.step > 0;
}

function setCurrentInvoice(invoiceId, { revealSidebar = true } = {}) {
  if (!invoiceId) {
    return;
  }

  state.activeFeature = "invoice";
  state.currentInvoiceId = invoiceId;
  state.drafts.approveInvoice.invoiceId = invoiceId;
  state.drafts.payInvoice.invoiceId = invoiceId;
  state.drafts.monitorInvoice.invoiceId = invoiceId;

  if (revealSidebar) {
    state.activeSidebarTab = "focus";
  }
}

function loadRecentActivity() {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(RECENT_ACTIVITY_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed
          .filter((entry) => entry && typeof entry === "object")
          .map((entry, index) => ({
            ...entry,
            confirmedAt: Number(entry.confirmedAt || 0) || Date.now() - index * 60_000,
          }))
      : [];
  } catch (error) {
    return [];
  }
}

function saveRecentActivity() {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(RECENT_ACTIVITY_STORAGE_KEY, JSON.stringify(state.recentActivity));
  } catch (error) {
    error;
  }
}

function recordRecentActivity(title, module, receipt) {
  const entry = {
    hash: receipt.hash,
    title,
    module,
    blockNumber: String(receipt.blockNumber || ""),
    explorerUrl: receipt.explorerUrl || "",
    identifiers: receipt.identifiers || {},
    confirmedAt: Date.now(),
  };

  state.recentActivity = [entry, ...state.recentActivity.filter((item) => item.hash !== entry.hash)].slice(0, 6);
  saveRecentActivity();
}

function setNotice(notice) {
  state.notice = {
    tone: notice.tone || "muted",
    title: notice.title || "HexaPay update",
    summary: notice.summary || "",
    meta: notice.meta || [],
    actionHref: notice.actionHref || "",
    actionLabel: notice.actionLabel || "",
  };
}

function setStage(step, title, detail) {
  state.stage = {
    step,
    title,
    detail,
  };
}

function requireConfiguredContractAddress(contractKey) {
  const address = state.addresses[contractKey];

  if (!isConfiguredAddress(address)) {
    throw new Error(`HexaPay ${contractKey} module is not configured.`);
  }

  return address;
}

function requireConnectedRuntime() {
  if (!state.runtime.connected || !state.runtime.provider) {
    throw new Error("Connect a wallet first.");
  }
}

function requireAlignedProvider() {
  requireConnectedRuntime();

  if (state.runtime.chainId !== state.selectedChainId) {
    throw new Error(`Switch wallet to ${getChainMetadata(state.selectedChainId).label} first.`);
  }

  return state.runtime.provider;
}

function requireAlignedReadRunner() {
  const provider = requireAlignedProvider();
  return state.runtime.signer || provider;
}

function requireFhenixReady() {
  if (state.fhenix.mode !== "ready" || !state.fhenix.client) {
    throw new Error("CoFHE is not ready. Connect the wallet on Arbitrum Sepolia first.");
  }
}

function getSettlementContext() {
  const tokenAddress =
    state.coreSnapshot?.settlementToken || state.manifest?.raw?.settlementToken || "";
  const vaultAddress = state.coreSnapshot?.vault || state.manifest?.raw?.vault || "";
  const decimals = Number(state.tokenSnapshot?.decimals || 6);
  const symbol = state.tokenSnapshot?.symbol || "USDC";

  return {
    tokenAddress: isConfiguredAddress(tokenAddress) ? tokenAddress : "",
    vaultAddress: isConfiguredAddress(vaultAddress) ? vaultAddress : "",
    decimals,
    symbol,
  };
}

function formatSettlementAmount(value) {
  const settlement = getSettlementContext();

  try {
    const formatted = Number(formatUnits(value, settlement.decimals));
    return `${formatted.toLocaleString(undefined, {
      minimumFractionDigits: formatted >= 1 ? 1 : 0,
      maximumFractionDigits: 6,
    })} ${settlement.symbol}`;
  } catch (error) {
    return `${String(value)} ${settlement.symbol}`;
  }
}

function formatTimestamp(timestamp) {
  const numeric = Number(timestamp || 0);

  if (!numeric) {
    return "Not available";
  }

  return new Date(numeric * 1000).toLocaleString();
}

function upsertInvoiceSnapshot(invoiceId, partial) {
  if (!invoiceId) {
    return;
  }

  const key = String(invoiceId).toLowerCase();
  state.invoiceSnapshots[key] = {
    ...(state.invoiceSnapshots[key] || {}),
    ...(partial || {}),
    invoiceId,
  };
  setCurrentInvoice(invoiceId);
}

function getInvoiceSnapshot(invoiceId) {
  if (!invoiceId) {
    return null;
  }

  return state.invoiceSnapshots[String(invoiceId).toLowerCase()] || null;
}

function getInvoiceVisualState() {
  const snapshot = getInvoiceSnapshot(state.currentInvoiceId);

  if (!snapshot) {
    return null;
  }

  const rawStatus = snapshot.status !== undefined ? String(snapshot.status) : "";
  const rawStatusLabel = snapshot.statusLabel || (rawStatus ? describeInvoiceStatus(rawStatus) : "");
  const clearOutstanding = snapshot.clearOutstanding !== undefined ? String(snapshot.clearOutstanding) : "";
  const formattedOutstanding = snapshot.formattedOutstanding || "";
  let visualLabel = rawStatusLabel || "Pending";
  let tone = rawStatus === "4" ? "is-good" : rawStatus === "3" ? "is-warn" : "is-muted";

  if (clearOutstanding === "0") {
    visualLabel = "Paid in full";
    tone = "is-good";
  } else if (rawStatus === "3") {
    visualLabel = "Partially paid";
    tone = "is-warn";
  }

  return {
    ...snapshot,
    visualLabel,
    tone,
    rawStatusLabel,
    formattedOutstanding,
  };
}

function getDraftValue(draftKey, field) {
  return state.drafts[draftKey]?.[field] || "";
}

function renderField(draftKey, field) {
  const value = getDraftValue(draftKey, field.name);
  const type = field.type || "text";
  const shared = [
    `name="${escapeHtml(field.name)}"`,
    `data-app-field="true"`,
    `data-draft-key="${escapeHtml(draftKey)}"`,
    field.placeholder ? `placeholder="${escapeHtml(field.placeholder)}"` : "",
    field.inputmode ? `inputmode="${escapeHtml(field.inputmode)}"` : "",
  ]
    .filter(Boolean)
    .join(" ");

  return `
    <label class="ha-field">
      <span>${escapeHtml(field.label)}</span>
      <input type="${escapeHtml(type)}" value="${escapeHtml(value)}" ${shared}>
      ${field.hint ? `<small>${escapeHtml(field.hint)}</small>` : ""}
    </label>
  `;
}

function renderNotice() {
  const toneClass = getNoticeToneClass(state.notice.tone);
  const cinematic = state.notice.tone === "good" && state.stage.step >= 3;
  const latestEntry = state.recentActivity[0];
  const badgeLabel =
    state.notice.tone === "good"
      ? "Verified"
      : state.notice.tone === "warn"
        ? "Pending"
        : state.notice.tone === "bad"
          ? "Attention"
          : "Standby";
  const visualTitle = cinematic ? "Verification captured" : "Live private workflow signal";
  const visualCopy = cinematic
    ? "The latest encrypted action cleared wallet approval and on-chain confirmation."
    : "Wallet, manifest, and encrypted runtime state are reflected here in real time.";

  return `
    <section class="ha-panel ha-notice ${toneClass} ${cinematic ? "is-cinematic" : ""}">
      <div class="ha-notice-backdrop" aria-hidden="true"></div>
      <div class="ha-notice-layout">
        <div class="ha-notice-copy">
          <div class="ha-panel-head">
            <div>
              <span class="ha-kicker">App Status</span>
              <h2>${escapeHtml(state.notice.title)}</h2>
            </div>
            <span class="ha-pill ${toneClass}">${escapeHtml(badgeLabel)}</span>
          </div>
          <p class="ha-panel-copy">${escapeHtml(state.notice.summary)}</p>
          ${
            state.notice.meta.length
              ? `
                <div class="ha-meta-list">
                  ${state.notice.meta.map((item) => `<span class="ha-meta-chip">${escapeHtml(item)}</span>`).join("")}
                </div>
              `
              : ""
          }
          ${
            state.notice.actionHref
              ? `<a class="ha-inline-link" href="${escapeHtml(state.notice.actionHref)}" target="_blank" rel="noreferrer">${escapeHtml(state.notice.actionLabel || "Open in explorer")}</a>`
              : ""
          }
        </div>
        <div class="ha-notice-visual">
          <div class="ha-notice-orbit">
            <span class="ha-notice-ring"></span>
            <span class="ha-notice-ring is-delayed"></span>
            <span class="ha-pill ${toneClass}">${escapeHtml(badgeLabel)}</span>
            <strong>${escapeHtml(visualTitle)}</strong>
            <small>${escapeHtml(visualCopy)}</small>
          </div>
          <div class="ha-notice-trace">
            <span>Latest trace</span>
            <strong>${escapeHtml(latestEntry ? maskTrace(latestEntry.hash) : "No confirmed trace yet")}</strong>
            <small>${escapeHtml(latestEntry ? formatRelativeTime(latestEntry.confirmedAt) : "Your first live confirmation will appear here.")}</small>
          </div>
        </div>
      </div>
    </section>
  `;
}

function renderStageRail() {
  return `
    <section class="ha-panel ha-stage-panel">
      <div class="ha-panel-head">
        <div>
          <span class="ha-kicker">Secure Flow</span>
          <h2>${escapeHtml(state.stage.title)}</h2>
        </div>
      </div>
      <p class="ha-panel-copy">${escapeHtml(state.stage.detail)}</p>
      <div class="ha-stage-rail">
        <div class="ha-stage-node ${state.stage.step >= 1 ? "is-active is-blue" : ""}">
          <strong>Encrypted</strong>
          <span>Protected input</span>
        </div>
        <div class="ha-stage-link ${state.stage.step >= 2 ? "is-active" : ""}"></div>
        <div class="ha-stage-node ${state.stage.step >= 2 ? "is-active is-violet" : ""}">
          <strong>Computing</strong>
          <span>Workflow executing</span>
        </div>
        <div class="ha-stage-link ${state.stage.step >= 3 ? "is-active" : ""}"></div>
        <div class="ha-stage-node ${state.stage.step >= 3 ? "is-active is-green" : ""}">
          <strong>Verified</strong>
          <span>Outcome confirmed</span>
        </div>
      </div>
    </section>
  `;
}

function renderBalanceCard() {
  const loading = state.busyAction === "balance";
  const displayValue =
    state.privateBalance.loaded && state.privateBalance.revealed
      ? state.privateBalance.formattedBalance
      : "Encrypted";
  const subtitle =
    state.privateBalance.loaded && state.privateBalance.revealed
      ? "Locally revealed for this session."
      : "Masked by default until you intentionally reveal it.";

  return `
    <article class="ha-card ha-balance-card">
      <div class="ha-card-head">
        <div>
          <span class="ha-kicker">Private Balance</span>
          <h3>${escapeHtml(displayValue)}</h3>
        </div>
        <span class="ha-pill ${state.privateBalance.revealed ? "is-good" : "is-muted"}">${state.privateBalance.revealed ? "Revealed" : "Hidden"}</span>
      </div>
      <p class="ha-card-copy">${escapeHtml(subtitle)}</p>
      <div class="ha-card-actions">
        <button type="button" class="ha-btn ha-btn-primary" data-command="reveal-balance" ${loading ? "disabled" : ""}>
          ${loading ? "Revealing..." : "Reveal Locally"}
        </button>
        ${
          state.privateBalance.revealed
            ? `<button type="button" class="ha-btn ha-btn-secondary" data-command="hide-balance">Hide Again</button>`
            : ""
        }
      </div>
      ${
        state.privateBalance.loaded
          ? `
            <div class="ha-card-foot">
              <span>Handle ${escapeHtml(shortAddress(state.privateBalance.sealedBalance, 8, 6))}</span>
              <span>${escapeHtml(shortAddress(state.privateBalance.publicKey, 8, 6))}</span>
            </div>
          `
          : ""
      }
    </article>
  `;
}

function renderOverviewCard() {
  const fhenixState = explainFhenixMode(state.fhenix);
  const chain = getChainMetadata(state.selectedChainId);
  const manifestState = state.manifest ? "Manifest synced" : "Manifest pending";

  return `
    <article class="ha-card ha-overview-card">
      <div class="ha-card-head">
        <div>
          <span class="ha-kicker">Live App</span>
          <h3>Private finance on ${escapeHtml(chain.shortLabel)}</h3>
        </div>
        <span class="ha-pill ${fhenixState.tone === "good" ? "is-good" : fhenixState.tone === "warn" ? "is-warn" : "is-muted"}">${escapeHtml(fhenixState.label)}</span>
      </div>
      <div class="ha-stat-grid">
        <div class="ha-stat">
          <span>Wallet</span>
          <strong>${escapeHtml(state.runtime.connected ? shortAddress(state.runtime.account) : "Not connected")}</strong>
        </div>
        <div class="ha-stat">
          <span>Manifest</span>
          <strong>${escapeHtml(manifestState)}</strong>
        </div>
        <div class="ha-stat">
          <span>Settlement</span>
          <strong>${escapeHtml(getSettlementContext().symbol)}</strong>
        </div>
        <div class="ha-stat">
          <span>Workspace</span>
          <strong>Optional</strong>
        </div>
      </div>
    </article>
  `;
}

function renderSendPaymentCard() {
  const busy = state.busyAction === "send-payment";
  const settlement = getSettlementContext();

  return `
    <article class="ha-card">
      <div class="ha-card-head">
        <div>
          <span class="ha-kicker">Encrypted Payments</span>
          <h3>Encrypt &amp; send</h3>
        </div>
      </div>
      <p class="ha-card-copy">Amounts are entered as normal ${escapeHtml(settlement.symbol)} decimals, encrypted in-browser, and submitted without exposing the raw value publicly.</p>
      <div class="ha-form-grid">
        ${renderField("sendPayment", {
          name: "recipient",
          label: "Recipient",
          placeholder: "0xRecipient",
        })}
        ${renderField("sendPayment", {
          name: "amount",
          label: `Amount (${settlement.symbol})`,
          placeholder: "0.001",
          inputmode: "decimal",
          hint: `Human-readable decimal amount. HexaPay converts it into ${settlement.decimals}-decimal encrypted units.`,
        })}
        ${renderField("sendPayment", {
          name: "referenceHash",
          label: "Reference",
          placeholder: "PAY-2026-001",
        })}
      </div>
      <div class="ha-card-actions">
        <button type="button" class="ha-btn ha-btn-primary" data-action="send-payment" ${busy ? "disabled" : ""}>
          ${busy ? "Encrypting..." : "Encrypt & Send"}
        </button>
      </div>
    </article>
  `;
}

function renderRegisterCompanyCard() {
  const busy = state.busyAction === "register-company";

  return `
    <article class="ha-card">
      <div class="ha-card-head">
        <div>
          <span class="ha-kicker">Company Identity</span>
          <h3>Register company</h3>
        </div>
      </div>
      <p class="ha-card-copy">Create a live company identity before issuing invoices or operating as a business account.</p>
      <div class="ha-form-grid">
        ${renderField("registerCompany", {
          name: "companyName",
          label: "Company name",
          placeholder: "HexaPay Ops",
        })}
        ${renderField("registerCompany", {
          name: "ensName",
          label: "ENS / alias",
          placeholder: "hexapay.eth",
        })}
        ${renderField("registerCompany", {
          name: "companyId",
          label: "Company id",
          placeholder: "HEXAPAY-001",
        })}
      </div>
      <div class="ha-card-actions">
        <button type="button" class="ha-btn ha-btn-primary" data-action="register-company" ${busy ? "disabled" : ""}>
          ${busy ? "Registering..." : "Register Company"}
        </button>
      </div>
    </article>
  `;
}

function renderCreateInvoiceCard() {
  const busy = state.busyAction === "create-invoice";
  const settlement = getSettlementContext();

  return `
    <article class="ha-card">
      <div class="ha-card-head">
        <div>
          <span class="ha-kicker">Invoice Desk</span>
          <h3>Create invoice</h3>
        </div>
      </div>
      <p class="ha-card-copy">Issue a confidential invoice with a company address, designated payer, encrypted total, and future due date.</p>
      <div class="ha-form-grid">
        ${renderField("createInvoice", {
          name: "company",
          label: "Company",
          placeholder: "0xCompany",
        })}
        ${renderField("createInvoice", {
          name: "payer",
          label: "Payer",
          placeholder: "0xPayer",
        })}
        ${renderField("createInvoice", {
          name: "amount",
          label: `Total (${settlement.symbol})`,
          placeholder: "0.001",
          inputmode: "decimal",
        })}
        ${renderField("createInvoice", {
          name: "metadataHash",
          label: "Reference",
          placeholder: "invoice-2026-001",
        })}
        ${renderField("createInvoice", {
          name: "dueAt",
          label: "Due at",
          type: "datetime-local",
        })}
      </div>
      <div class="ha-card-actions">
        <button type="button" class="ha-btn ha-btn-primary" data-action="create-invoice" ${busy ? "disabled" : ""}>
          ${busy ? "Encrypting..." : "Issue Confidential Invoice"}
        </button>
      </div>
    </article>
  `;
}

function renderInvoiceOpsCard() {
  const approveBusy = state.busyAction === "approve-invoice";
  const payBusy = state.busyAction === "pay-invoice";
  const settlement = getSettlementContext();

  return `
    <article class="ha-card">
      <div class="ha-card-head">
        <div>
          <span class="ha-kicker">Invoice Settlement</span>
          <h3>Approve &amp; pay</h3>
        </div>
      </div>
      <p class="ha-card-copy">Move a live invoice from approval to encrypted settlement using the payer wallet and confidential amount input.</p>
      <div class="ha-form-grid">
        ${renderField("approveInvoice", {
          name: "invoiceId",
          label: "Invoice id",
          placeholder: "0xInvoiceId",
        })}
        ${renderField("payInvoice", {
          name: "amount",
          label: `Payment (${settlement.symbol})`,
          placeholder: "0.001",
          inputmode: "decimal",
        })}
      </div>
      <div class="ha-card-actions">
        <button type="button" class="ha-btn ha-btn-secondary" data-action="approve-invoice" ${approveBusy ? "disabled" : ""}>
          ${approveBusy ? "Approving..." : "Approve Invoice"}
        </button>
        <button type="button" class="ha-btn ha-btn-primary" data-action="pay-invoice" ${payBusy ? "disabled" : ""}>
          ${payBusy ? "Paying..." : "Pay Invoice"}
        </button>
      </div>
    </article>
  `;
}

function renderInvoiceMonitorCard() {
  const readBusy = state.busyAction === "read-invoice";
  const outstandingBusy = state.busyAction === "read-outstanding";
  const invoice = getInvoiceVisualState();

  return `
    <article class="ha-card">
      <div class="ha-card-head">
        <div>
          <span class="ha-kicker">Invoice Monitor</span>
          <h3>Read status &amp; outstanding</h3>
        </div>
      </div>
      <p class="ha-card-copy">Inspect the current workflow status and privately reveal the remaining outstanding amount only when needed.</p>
      <div class="ha-form-grid">
        ${renderField("monitorInvoice", {
          name: "invoiceId",
          label: "Invoice id",
          placeholder: "0xInvoiceId",
        })}
      </div>
      <div class="ha-card-actions">
        <button type="button" class="ha-btn ha-btn-secondary" data-action="read-invoice" ${readBusy ? "disabled" : ""}>
          ${readBusy ? "Loading..." : "Load Invoice"}
        </button>
        <button type="button" class="ha-btn ha-btn-primary" data-action="read-outstanding" ${outstandingBusy ? "disabled" : ""}>
          ${outstandingBusy ? "Revealing..." : "Reveal Outstanding"}
        </button>
      </div>
      ${
        invoice
          ? `
            <div class="ha-invoice-summary">
              <div class="ha-summary-row">
                <span>Status</span>
                <strong class="${escapeHtml(invoice.tone)}">${escapeHtml(invoice.visualLabel)}</strong>
              </div>
              <div class="ha-summary-row">
                <span>Company</span>
                <strong>${escapeHtml(shortAddress(invoice.company || ""))}</strong>
              </div>
              <div class="ha-summary-row">
                <span>Payer</span>
                <strong>${escapeHtml(shortAddress(invoice.payer || ""))}</strong>
              </div>
              <div class="ha-summary-row">
                <span>Payments</span>
                <strong>${escapeHtml(String(invoice.paymentCount || "0"))}</strong>
              </div>
              <div class="ha-summary-row">
                <span>Outstanding</span>
                <strong>${escapeHtml(invoice.formattedOutstanding || "Reveal to inspect")}</strong>
              </div>
              <div class="ha-summary-row">
                <span>Due</span>
                <strong>${escapeHtml(formatTimestamp(invoice.dueAt))}</strong>
              </div>
            </div>
          `
          : ""
      }
    </article>
  `;
}

function renderPrivacyCard() {
  const chain = getChainMetadata(state.selectedChainId);
  const fhenixStatus = explainFhenixMode(state.fhenix);

  return `
    <section class="ha-panel">
      <div class="ha-panel-head">
        <div>
          <span class="ha-kicker">Privacy Controls</span>
          <h2>Secure finance state</h2>
        </div>
      </div>
      <div class="ha-data-list">
        <div><span>Manifest</span><strong>${escapeHtml(state.manifest ? "Live suite synced" : "Waiting for deployment.json")}</strong></div>
        <div><span>Core</span><strong>${escapeHtml(isConfiguredAddress(state.addresses.core) ? shortAddress(state.addresses.core) : "Not configured")}</strong></div>
        <div><span>FHE mode</span><strong>${escapeHtml(fhenixStatus.label)}</strong></div>
        <div><span>Selected chain</span><strong>${escapeHtml(chain.shortLabel)}</strong></div>
      </div>
      <p class="ha-panel-copy">${escapeHtml(fhenixStatus.detail)}</p>
      <div class="ha-panel-actions">
        <button type="button" class="ha-btn ha-btn-secondary" data-command="sync-manifest" ${state.busyCommand === "sync-manifest" ? "disabled" : ""}>
          ${state.busyCommand === "sync-manifest" ? "Syncing..." : "Sync Manifest"}
        </button>
        <a class="ha-btn ha-btn-ghost" href="./hexapay.html?entry=launch-app">Open Workspace</a>
      </div>
    </section>
  `;
}

function renderRecentActivity() {
  if (!state.recentActivity.length) {
    return `
      <div class="ha-empty ha-empty-ledger">
        <strong>Private ledger is waiting for its first confirmation.</strong>
        <p>Encrypted payments and invoice actions will appear here as masked traces once the first live transaction settles.</p>
      </div>
    `;
  }

  return `
    <div class="ha-activity-list">
      ${state.recentActivity
        .map((entry) => {
          const identifier =
            entry.identifiers?.invoiceId ||
            entry.identifiers?.paymentId ||
            entry.identifiers?.roomId ||
            entry.identifiers?.checkpointId ||
            "";
          const identifierLabel = entry.identifiers?.invoiceId
            ? "Invoice focus"
            : entry.identifiers?.paymentId
              ? "Payment ref"
              : "Private ref";

          return `
            <article class="ha-activity-item">
              <div class="ha-activity-topline">
                <span class="ha-pill ${getModulePillClass(entry.module)}">${escapeHtml(entry.module)}</span>
                <span class="ha-activity-time">${escapeHtml(formatRelativeTime(entry.confirmedAt))}</span>
              </div>
              <div class="ha-activity-head">
                <div>
                  <strong>${escapeHtml(entry.title)}</strong>
                  <p>Confirmed on-chain while the product view keeps the trace masked until you intentionally inspect it.</p>
                </div>
                <span class="ha-pill is-good">Confirmed</span>
              </div>
              <div class="ha-activity-trace">
                <span>Masked tx trace</span>
                <strong>${escapeHtml(maskTrace(entry.hash))}</strong>
              </div>
              <div class="ha-activity-grid">
                <div>
                  <span>Tx hash</span>
                  <strong>${escapeHtml(shortAddress(entry.hash, 6, 6))}</strong>
                </div>
                ${
                  entry.blockNumber
                    ? `
                      <div>
                        <span>Block</span>
                        <strong>#${escapeHtml(entry.blockNumber)}</strong>
                      </div>
                    `
                    : ""
                }
                ${
                  identifier
                    ? `
                      <div>
                        <span>${escapeHtml(identifierLabel)}</span>
                        <strong>${escapeHtml(shortAddress(identifier, 8, 8))}</strong>
                      </div>
                    `
                    : ""
                }
              </div>
              <div class="ha-activity-actions">
                ${
                  identifier
                    ? `
                      <div class="ha-activity-identifier">
                        <span>${escapeHtml(identifierLabel)}</span>
                        <strong>${escapeHtml(maskTrace(identifier))}</strong>
                      </div>
                    `
                    : "<div></div>"
                }
                <div class="ha-activity-links">
                  ${
                    entry.identifiers?.invoiceId
                      ? `<button type="button" class="ha-inline-action" data-select-invoice="${escapeHtml(entry.identifiers.invoiceId)}">Focus invoice</button>`
                      : ""
                  }
                  ${
                    entry.explorerUrl
                      ? `<a class="ha-inline-link" href="${escapeHtml(entry.explorerUrl)}" target="_blank" rel="noreferrer">Open explorer</a>`
                      : ""
                  }
                </div>
              </div>
            </article>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderFocusPanel(invoice) {
  if (!invoice) {
    return `
      <section class="ha-panel ha-focus-panel">
        <div class="ha-panel-head">
          <div>
            <span class="ha-kicker">Invoice Focus</span>
            <h2>Waiting for invoice signal</h2>
          </div>
        </div>
        <p class="ha-panel-copy">Create, read, or select an invoice from Ledger to pin it into this private lens.</p>
        <div class="ha-empty">
          The focus view will show masked invoice references, outstanding posture, and settlement progress once an invoice is active.
        </div>
      </section>
    `;
  }

  const milestones = [
    {
      label: "Issued",
      active: true,
      detail: shortAddress(invoice.company || "", 6, 4) || "Company tracked",
    },
    {
      label: "Approved",
      active: ["2", "3", "4"].includes(String(invoice.status || "")) || Number(invoice.paymentCount || "0") > 0,
      detail: invoice.rawStatusLabel || "Pending approval",
    },
    {
      label: "Settled",
      active: invoice.clearOutstanding === "0" || String(invoice.status || "") === "4",
      detail: invoice.formattedOutstanding || "Outstanding hidden",
    },
  ];

  return `
    <section class="ha-panel ha-focus-panel">
      <div class="ha-focus-hero">
        <div>
          <span class="ha-kicker">Invoice Focus</span>
          <h2>${escapeHtml(invoice.visualLabel)}</h2>
          <p class="ha-panel-copy">A pinned lens for the current confidential invoice, including masked references and private settlement posture.</p>
        </div>
        <span class="ha-pill ${escapeHtml(invoice.tone)}">${escapeHtml(invoice.rawStatusLabel || "Live")}</span>
      </div>
      <div class="ha-focus-trace">
        <span>Tracked invoice</span>
        <strong>${escapeHtml(maskTrace(invoice.invoiceId))}</strong>
      </div>
      <div class="ha-focus-milestones">
        ${milestones
          .map(
            (item) => `
              <div class="ha-focus-step ${item.active ? "is-active" : ""}">
                <span>${escapeHtml(item.label)}</span>
                <strong>${escapeHtml(item.detail)}</strong>
              </div>
            `,
          )
          .join("")}
      </div>
      <div class="ha-data-list">
        <div><span>Invoice</span><strong>${escapeHtml(shortAddress(invoice.invoiceId, 8, 8))}</strong></div>
        <div><span>Company</span><strong>${escapeHtml(shortAddress(invoice.company || ""))}</strong></div>
        <div><span>Payer</span><strong>${escapeHtml(shortAddress(invoice.payer || ""))}</strong></div>
        <div><span>Payments</span><strong>${escapeHtml(String(invoice.paymentCount || "0"))}</strong></div>
        <div><span>Outstanding</span><strong>${escapeHtml(invoice.formattedOutstanding || "Reveal to inspect")}</strong></div>
        <div><span>Due</span><strong>${escapeHtml(formatTimestamp(invoice.dueAt))}</strong></div>
      </div>
    </section>
  `;
}

function shouldShowSidebar() {
  return state.activeFeature === "wallet";
}

function renderSidebarContent() {
  return renderPrivacyCard();
}

function renderWalletGlyph(wallet, className = "ha-wallet-glyph") {
  const iconText = wallet?.iconText || "W";
  const accent = wallet?.accent || "slate";

  return `<span class="${escapeHtml(className)}" data-wallet-accent="${escapeHtml(accent)}" aria-hidden="true">${escapeHtml(iconText)}</span>`;
}

function renderWalletMenu() {
  if (!state.runtime.connected || !state.walletMenuOpen) {
    return "";
  }

  const chain = getChainMetadata(state.selectedChainId);
  const wallet = getActiveWalletDescriptor();
  const aligned = state.runtime.chainId === state.selectedChainId;
  const switchBusy = state.busyCommand === "switch-chain";
  const disconnectBusy = state.busyCommand === "disconnect-wallet";

  return `
    <div class="ha-wallet-menu" role="menu">
      <div class="ha-wallet-menu-head">
        <div>
          <strong>${escapeHtml(state.runtime.walletName || wallet?.name || "Connected wallet")}</strong>
          <small>${escapeHtml(aligned ? chain.shortLabel : `Switch to ${chain.shortLabel}`)}</small>
        </div>
        <span class="ha-wallet-menu-status ${aligned ? "is-ready" : "is-warn"}">${escapeHtml(aligned ? "Ready" : "Mismatch")}</span>
      </div>
      <button type="button" class="ha-wallet-menu-item" data-command="copy-wallet-address" role="menuitem">
        <span>Copy address</span>
        <strong>${escapeHtml(shortAddress(state.runtime.account, 4, 4))}</strong>
      </button>
      <button type="button" class="ha-wallet-menu-item" data-command="change-wallet" role="menuitem">
        <span>Change wallet</span>
        <strong>${escapeHtml((getWalletOptions().length || 0).toString())} detected</strong>
      </button>
      ${
        aligned
          ? ""
          : `
            <button
              type="button"
              class="ha-wallet-menu-item"
              data-command="switch-chain"
              role="menuitem"
              ${switchBusy ? "disabled" : ""}
            >
              <span>${switchBusy ? "Switching network" : `Switch to ${escapeHtml(chain.shortLabel)}`}</span>
              <strong>${escapeHtml(chain.shortLabel)}</strong>
            </button>
          `
      }
      <button
        type="button"
        class="ha-wallet-menu-item is-danger"
        data-command="disconnect-wallet"
        role="menuitem"
        ${disconnectBusy ? "disabled" : ""}
      >
        <span>${disconnectBusy ? "Disconnecting" : "Disconnect"}</span>
        <strong>Session only</strong>
      </button>
    </div>
  `;
}

function renderWalletModal() {
  if (!state.walletModalOpen) {
    return "";
  }

  const wallets = getWalletOptions();
  const connectingWalletId = getConnectingWalletId();
  const preferredWalletId = state.runtime.walletId || getStoredWalletProviderId();
  const connectBusy = state.busyCommand.startsWith("connect:");

  return `
    <div class="ha-wallet-modal-layer">
      <button
        type="button"
        class="ha-wallet-modal-backdrop"
        data-command="close-wallet-modal"
        aria-label="Close wallet picker"
      ></button>
      <section class="ha-wallet-modal-card" role="dialog" aria-modal="true" aria-label="Connect wallet">
        <div class="ha-wallet-modal-head">
          <div>
            <span class="ha-kicker">Wallet Access</span>
            <h2>Choose a wallet</h2>
          </div>
          <button type="button" class="ha-wallet-modal-close" data-command="close-wallet-modal" aria-label="Close">
            <span aria-hidden="true">&times;</span>
          </button>
        </div>
        ${
          wallets.length
            ? `
              <div class="ha-wallet-option-list">
                ${wallets
                  .map((wallet) => {
                    const active = wallet.id === preferredWalletId;
                    const connecting = wallet.id === connectingWalletId;

                    return `
                      <button
                        type="button"
                        class="ha-wallet-option ${active ? "is-active" : ""}"
                        data-wallet-connect="${escapeHtml(wallet.id)}"
                        ${connectBusy ? "disabled" : ""}
                      >
                        ${renderWalletGlyph(wallet, "ha-wallet-option-glyph")}
                        <span class="ha-wallet-option-copy">
                          <strong>${escapeHtml(wallet.name)}</strong>
                          <small>${escapeHtml(active && state.runtime.connected ? "Connected in this app" : "Choose, then approve in the extension")}</small>
                        </span>
                        <span class="ha-wallet-option-badge">${escapeHtml(connecting ? "Connecting..." : "Installed")}</span>
                      </button>
                    `;
                  })
                  .join("")}
              </div>
            `
            : `
              <div class="ha-wallet-modal-empty">
                <strong>No injected wallet detected</strong>
                <p>Install MetaMask, Rabby, or another EVM wallet in this browser, then reload HexaPay.</p>
              </div>
            `
        }
        <p class="ha-wallet-modal-foot">Pick the wallet you want, then approve the connection request in that wallet extension.</p>
      </section>
    </div>
  `;
}

function renderTopbarWalletAction() {
  const wallet = getActiveWalletDescriptor();
  const connected = state.runtime.connected;
  const aligned = connected && state.runtime.chainId === state.selectedChainId;
  const connectBusy = state.busyCommand.startsWith("connect:");

  return `
    <div class="ha-topbar-wallet-actions">
      <div class="ha-wallet-shell" data-wallet-shell>
        ${
          connected
            ? `
              <button
                type="button"
                class="ha-wallet-trigger is-connected ${state.walletMenuOpen ? "is-open" : ""} ${aligned ? "" : "is-mismatch"}"
                data-command="toggle-wallet-menu"
                aria-haspopup="menu"
                aria-expanded="${state.walletMenuOpen ? "true" : "false"}"
              >
                ${renderWalletGlyph(wallet, "ha-wallet-trigger-glyph")}
                <span class="ha-wallet-trigger-copy">
                  <small>${escapeHtml(state.runtime.walletName || wallet?.name || "Wallet connected")}</small>
                  <strong>${escapeHtml(shortAddress(state.runtime.account, 4, 4))}</strong>
                </span>
                <span class="ha-wallet-trigger-caret" aria-hidden="true"></span>
              </button>
            `
            : `
              <button
                type="button"
                class="ha-wallet-trigger is-connect"
                data-command="connect-wallet"
                ${connectBusy ? "disabled" : ""}
              >
                ${renderWalletGlyph(wallet, "ha-wallet-trigger-glyph")}
                <span class="ha-wallet-trigger-copy is-single-line">
                  <strong>${escapeHtml(connectBusy ? "Connecting..." : "Connect Wallet")}</strong>
                </span>
              </button>
            `
        }
        ${renderWalletMenu()}
      </div>
    </div>
  `;
}

function renderFeatureNavbar() {
  return `
    <nav class="ha-feature-shell" aria-label="App navigation">
      <div class="ha-feature-nav">
        ${FEATURE_LANES.map((feature) => {
          const active = state.activeFeature === feature.id;

          return `
            <button
              type="button"
              class="ha-feature-tab ${active ? "is-active" : ""}"
              data-feature-nav="${escapeHtml(feature.id)}"
              aria-pressed="${active ? "true" : "false"}"
            >
              <span class="ha-feature-tab-title">${escapeHtml(feature.label)}</span>
            </button>
          `;
        }).join("")}
      </div>
    </nav>
  `;
}

function renderLedgerPanel() {
  return `
    <section class="ha-panel">
      <div class="ha-panel-head">
        <div>
          <span class="ha-kicker">Recent Activity</span>
          <h2>Masked transaction ledger</h2>
        </div>
        <span class="ha-pill is-muted">${escapeHtml(String(state.recentActivity.length || 0))} entries</span>
      </div>
      <p class="ha-panel-copy">Confirmed encrypted actions stay visible as masked traces so the app remains legible without leaking raw transaction detail.</p>
      ${renderRecentActivity()}
    </section>
  `;
}

function renderFeatureContent() {
  const feature = getFeatureConfig();

  if (feature.id === "wallet") {
    return `
      <section class="ha-section">
        <div class="ha-section-head">
          <div>
            <span class="ha-kicker">${escapeHtml(feature.kicker)}</span>
            <h2>${escapeHtml(feature.title)}</h2>
          </div>
          <span class="ha-pill ${escapeHtml(feature.statusTone)}">${escapeHtml(feature.statusLabel)}</span>
        </div>
        <p class="ha-section-copy">${escapeHtml(feature.summary)}</p>
        <div class="ha-card-grid ha-card-grid-wide">
          ${renderOverviewCard()}
          ${renderBalanceCard()}
        </div>
      </section>
    `;
  }

  if (feature.id === "treasury") {
    return `
      <section class="ha-section">
        <div class="ha-section-head">
          <div>
            <span class="ha-kicker">${escapeHtml(feature.kicker)}</span>
            <h2>${escapeHtml(feature.title)}</h2>
          </div>
          <span class="ha-pill ${escapeHtml(feature.statusTone)}">${escapeHtml(feature.statusLabel)}</span>
        </div>
        <p class="ha-section-copy">${escapeHtml(feature.summary)}</p>
        <div class="ha-card-grid">
          ${renderSendPaymentCard()}
        </div>
      </section>
    `;
  }

  if (feature.id === "company") {
    return `
      <section class="ha-section">
        <div class="ha-section-head">
          <div>
            <span class="ha-kicker">${escapeHtml(feature.kicker)}</span>
            <h2>${escapeHtml(feature.title)}</h2>
          </div>
          <span class="ha-pill ${escapeHtml(feature.statusTone)}">${escapeHtml(feature.statusLabel)}</span>
        </div>
        <p class="ha-section-copy">${escapeHtml(feature.summary)}</p>
        <div class="ha-card-grid">
          ${renderRegisterCompanyCard()}
        </div>
      </section>
    `;
  }

  if (feature.id === "invoice") {
    return `
      <section class="ha-section">
        <div class="ha-section-head">
          <div>
            <span class="ha-kicker">${escapeHtml(feature.kicker)}</span>
            <h2>${escapeHtml(feature.title)}</h2>
          </div>
          <span class="ha-pill ${escapeHtml(feature.statusTone)}">${escapeHtml(feature.statusLabel)}</span>
        </div>
        <p class="ha-section-copy">${escapeHtml(feature.summary)}</p>
        <div class="ha-card-grid ha-card-grid-wide">
          ${renderCreateInvoiceCard()}
          ${renderInvoiceOpsCard()}
          ${renderInvoiceMonitorCard()}
        </div>
      </section>
    `;
  }

  return `
    <section class="ha-section">
      <div class="ha-section-head">
        <div>
          <span class="ha-kicker">${escapeHtml(feature.kicker)}</span>
          <h2>${escapeHtml(feature.title)}</h2>
        </div>
        <span class="ha-pill ${escapeHtml(feature.statusTone)}">${escapeHtml(feature.statusLabel)}</span>
      </div>
      <p class="ha-section-copy">${escapeHtml(feature.summary)}</p>
      <div class="ha-card-grid ha-card-grid-wide">
        ${renderLedgerPanel()}
        ${renderFocusPanel(getInvoiceVisualState())}
      </div>
    </section>
  `;
}

function renderApp() {
  const invoice = getInvoiceVisualState();
  const showSidebar = shouldShowSidebar();

  state.root.innerHTML = `
    <div class="ha-shell">
      <header class="ha-topbar ${state.walletMenuOpen ? "is-wallet-menu-open" : ""}">
        <div class="ha-topbar-main">
          <a class="ha-brand" href="./index.html">
            <span class="ha-brand-mark"></span>
            <span>HexaPay App</span>
          </a>
          <p class="ha-topbar-copy">Private finance workspace for treasury, company, invoices, and masked activity.</p>
          ${renderFeatureNavbar()}
        </div>
        <div class="ha-topbar-actions">
          ${renderTopbarWalletAction()}
          <a class="ha-btn ha-btn-ghost" href="./hexapay.html?entry=launch-app">Workspace</a>
          <a class="ha-topbar-link" href="./index.html">Back to Home</a>
        </div>
      </header>

      <div class="ha-layout ${showSidebar ? "" : "is-single-column"}">
        <div class="ha-main-column">
          ${shouldShowStageRail() ? renderStageRail() : ""}
          ${renderFeatureContent()}
        </div>

        ${
          showSidebar
            ? `
              <aside class="ha-sidebar">
                <div class="ha-sidebar-stack">
                  ${renderSidebarContent(invoice)}
                </div>
              </aside>
            `
            : ""
        }
      </div>

      ${renderWalletModal()}
    </div>
  `;
}

async function refreshAppState({ requestAccounts = false, silent = false, walletId = "" } = {}) {
  const preferredWalletId = walletId || state.runtime.walletId || getStoredWalletProviderId();

  if (!silent) {
    state.busyCommand = requestAccounts ? `connect:${preferredWalletId || "default"}` : "refresh";
    renderApp();
  }

  try {
    const suppressAccounts = !requestAccounts && !isWalletSessionEnabled();
    const runtime = await createRuntime({ requestAccounts, suppressAccounts, walletId: preferredWalletId });
    const alignedProvider =
      runtime.connected && runtime.chainId === state.selectedChainId ? runtime.provider : null;
    const fhenix = alignedProvider
      ? await getFhenixState(runtime)
      : createDefaultFhenixState();

    let coreSnapshot = null;
    let tokenSnapshot = null;

    if (alignedProvider && isConfiguredAddress(state.addresses.core)) {
      coreSnapshot = await readCoreSnapshot(alignedProvider, state.addresses.core);

      if (coreSnapshot?.settlementToken) {
        tokenSnapshot = await readTokenSnapshot(
          alignedProvider,
          coreSnapshot.settlementToken,
          runtime.account,
          coreSnapshot.vault,
        );
      }
    }

    if (runtime.connected) {
      setWalletSessionEnabled(true);
    }

    if (runtime.walletId) {
      setStoredWalletProviderId(runtime.walletId);
    }

    state.runtime = runtime;
    state.fhenix = fhenix;
    state.coreSnapshot = coreSnapshot;
    state.tokenSnapshot = tokenSnapshot;
    syncWalletListeners(runtime.walletProvider);
  } catch (error) {
    setNotice({
      tone: "bad",
      title: requestAccounts ? "Wallet connection failed" : "Failed to refresh app",
      summary: formatTransactionError(error),
    });
  } finally {
    state.busyCommand = "";
    renderApp();
  }
}

function disconnectWalletSession() {
  setWalletSessionEnabled(false);
  closeWalletChrome();
  state.runtime = createDefaultRuntime();
  state.fhenix = createDefaultFhenixState();
  state.coreSnapshot = null;
  state.tokenSnapshot = null;
  state.privateBalance = createDefaultPrivateBalance();
  syncWalletListeners(null);
  setStage(0, "Private flow idle", "Connect a wallet to initialize the HexaPay app.");
  setNotice({
    tone: "muted",
    title: "Wallet disconnected from app",
    summary:
      "HexaPay cleared the active wallet session for this app. Your browser wallet extension may still stay authorized until you reconnect here.",
  });
}

async function handleWalletConnect(walletId) {
  closeWalletChrome();
  renderApp();
  await refreshAppState({ requestAccounts: true, walletId });
}

async function copyWalletAddressToClipboard() {
  if (!state.runtime.account) {
    throw new Error("No wallet is connected yet.");
  }

  if (!navigator?.clipboard?.writeText) {
    throw new Error("Clipboard access is not available in this browser.");
  }

  await navigator.clipboard.writeText(state.runtime.account);
  closeWalletChrome();
  setNotice({
    tone: "good",
    title: "Address copied",
    summary: `${shortAddress(state.runtime.account)} copied to your clipboard.`,
  });
  renderApp();
}

async function syncManifest({ silent = false } = {}) {
  if (!silent) {
    state.busyCommand = "sync-manifest";
    renderApp();
  }

  try {
    const manifest = await loadDeploymentManifest();

    if (!manifest) {
      throw new Error("No deployment.json was found for this app.");
    }

    state.manifest = manifest;
    state.selectedChainId = String(manifest.chainId || DEFAULT_CHAIN_ID);
    state.addresses = {
      ...getAddressConfig(state.selectedChainId),
      ...manifest.addresses,
    };
    saveAddressConfig(state.selectedChainId, state.addresses);

    setNotice({
      tone: "good",
      title: "App synced to live suite",
      summary: "Deployment manifest was loaded successfully for the HexaPay app.",
      meta: [
        getChainMetadata(state.selectedChainId).label,
        shortAddress(state.addresses.core),
      ],
    });
  } catch (error) {
    setNotice({
      tone: "bad",
      title: "Manifest sync failed",
      summary: formatTransactionError(error),
    });
  } finally {
    state.busyCommand = "";
    renderApp();
  }
}

async function withLiveWrite(actionId, stepTitle, module, callback) {
  state.busyAction = actionId;
  setStage(2, stepTitle, "Waiting for wallet confirmation and on-chain verification.");
  setNotice({
    tone: "warn",
    title: `${stepTitle} pending`,
    summary: "Confirm the action in your wallet to continue the private workflow.",
  });
  renderApp();

  try {
    const receipt = await callback();
    const enrichedReceipt = {
      ...receipt,
      explorerUrl: getExplorerLink(state.runtime.chainId || state.selectedChainId, receipt.hash),
    };

    recordRecentActivity(stepTitle, module, enrichedReceipt);
    setStage(3, `${stepTitle} verified`, "Transaction confirmed and the workflow outcome is now live.");
    setNotice({
      tone: "good",
      title: `${stepTitle} confirmed`,
      summary: "Transaction confirmed by the connected wallet.",
      meta: [
        shortAddress(enrichedReceipt.hash, 6, 6),
        enrichedReceipt.identifiers?.invoiceId
          ? `Invoice ${shortAddress(enrichedReceipt.identifiers.invoiceId, 8, 6)}`
          : enrichedReceipt.identifiers?.paymentId
            ? `Payment ${shortAddress(enrichedReceipt.identifiers.paymentId, 8, 6)}`
            : `Block ${String(enrichedReceipt.blockNumber || "")}`,
      ],
      actionHref: enrichedReceipt.explorerUrl,
      actionLabel: "Open in explorer",
    });

    if (enrichedReceipt.identifiers?.invoiceId) {
      upsertInvoiceSnapshot(enrichedReceipt.identifiers.invoiceId, {});
    }

    await refreshAppState({ silent: true });
  } catch (error) {
    setStage(1, `${stepTitle} interrupted`, "The protected flow did not finish. Review the wallet or runtime state and try again.");
    setNotice({
      tone: "bad",
      title: `${stepTitle} failed`,
      summary: formatTransactionError(error),
    });
  } finally {
    state.busyAction = "";
    renderApp();
  }
}

async function handleRevealBalance() {
  state.busyAction = "balance";
  setStage(1, "Revealing private balance", "Reading the balance handle and decrypting it locally.");
  renderApp();

  try {
    const response = await readSealedValue(
      state.runtime,
      state.fhenix,
      "core",
      requireConfiguredContractAddress("core"),
      "getSealedBalance",
      [],
    );

    state.privateBalance = {
      revealed: true,
      loaded: true,
      formattedBalance: formatSettlementAmount(response.clearValue),
      clearBalance: response.clearValue.toString(),
      sealedBalance: response.sealedValue,
      publicKey: response.publicKey,
    };

    setStage(3, "Balance revealed locally", "Private balance was decrypted client-side without exposing the raw handle publicly.");
    setNotice({
      tone: "good",
      title: "Private balance updated",
      summary: "Your private balance was decrypted locally for this browser session.",
      meta: [state.privateBalance.formattedBalance],
    });
  } catch (error) {
    setStage(1, "Balance read interrupted", "Wallet alignment or CoFHE readiness is required to reveal private balance.");
    setNotice({
      tone: "bad",
      title: "Private balance failed",
      summary: formatTransactionError(error),
    });
  } finally {
    state.busyAction = "";
    renderApp();
  }
}

async function handleRegisterCompany() {
  const values = state.drafts.registerCompany;

  if (!String(values.companyName || "").trim()) {
    setNotice({
      tone: "bad",
      title: "Register company failed",
      summary: "Company name is required.",
    });
    renderApp();
    return;
  }

  await withLiveWrite("register-company", "Register company", "Identity", async () =>
    sendWrite(
      state.runtime,
      "core",
      requireConfiguredContractAddress("core"),
      "registerCompany",
      [
        values.companyName.trim(),
        String(values.ensName || "").trim(),
        hashText(values.companyId, values.companyName),
      ],
    ),
  );
}

async function handleSendPayment() {
  const values = state.drafts.sendPayment;
  const recipient = normalizeAddress(values.recipient);

  if (!recipient) {
    setNotice({
      tone: "bad",
      title: "Encrypt & send failed",
      summary: "Recipient address is invalid.",
    });
    renderApp();
    return;
  }

  const settlement = getSettlementContext();
  const units = parseAmountToUnits(values.amount, settlement.decimals);
  requireFhenixReady();
  setStage(1, "Encrypting payment", "The payment amount is being encrypted in-browser before submission.");
  renderApp();

  const encrypted = await buildEncryptedAmount(state.fhenix, units.toString(), {
    allowPlaceholder: false,
  });

  await withLiveWrite("send-payment", "Encrypted payment", "Treasury", async () =>
    sendWrite(
      state.runtime,
      "core",
      requireConfiguredContractAddress("core"),
      "createPayment",
      [
        recipient,
        encrypted.payload,
        hashText(values.referenceHash, `${recipient}:${units.toString()}`),
      ],
    ),
  );
}

async function handleCreateInvoice() {
  const values = state.drafts.createInvoice;
  const company = normalizeAddress(values.company);
  const payer = normalizeAddress(values.payer);

  if (!company || !payer) {
    setNotice({
      tone: "bad",
      title: "Create invoice failed",
      summary: "Company and payer addresses must be valid.",
    });
    renderApp();
    return;
  }

  const settlement = getSettlementContext();
  const units = parseAmountToUnits(values.amount, settlement.decimals);
  requireFhenixReady();
  setStage(1, "Encrypting invoice total", "The invoice amount is being encrypted before entering the workflow.");
  renderApp();

  const encrypted = await buildEncryptedAmount(state.fhenix, units.toString(), {
    allowPlaceholder: false,
  });

  await withLiveWrite("create-invoice", "Create invoice", "Invoices", async () => {
    const receipt = await sendWrite(
      state.runtime,
      "workflow",
      requireConfiguredContractAddress("workflow"),
      "createInvoice",
      [
        company,
        payer,
        encrypted.payload,
        hashText(values.metadataHash, `${company}:${payer}`),
        parseTimestamp(values.dueAt || "", "Invoice due date"),
      ],
    );

    if (receipt.identifiers?.invoiceId) {
      upsertInvoiceSnapshot(receipt.identifiers.invoiceId, {
        company,
        payer,
      });
    }

    return receipt;
  });
}

async function handleApproveInvoice() {
  const invoiceId = hashText(state.drafts.approveInvoice.invoiceId);

  await withLiveWrite("approve-invoice", "Approve invoice", "Invoices", async () =>
    sendWrite(
      state.runtime,
      "workflow",
      requireConfiguredContractAddress("workflow"),
      "approveInvoice",
      [invoiceId],
    ),
  );
}

async function handlePayInvoice() {
  const invoiceId = hashText(state.drafts.payInvoice.invoiceId);
  const settlement = getSettlementContext();
  const units = parseAmountToUnits(state.drafts.payInvoice.amount, settlement.decimals);
  requireFhenixReady();
  setStage(1, "Encrypting invoice payment", "The settlement amount is being encrypted before submission.");
  renderApp();

  const encrypted = await buildEncryptedAmount(state.fhenix, units.toString(), {
    allowPlaceholder: false,
  });

  await withLiveWrite("pay-invoice", "Pay invoice", "Invoices", async () =>
    sendWrite(
      state.runtime,
      "workflow",
      requireConfiguredContractAddress("workflow"),
      "payInvoice",
      [invoiceId, encrypted.payload],
    ),
  );
}

async function handleReadInvoice() {
  state.busyAction = "read-invoice";
  renderApp();

  try {
    const invoiceId = hashText(state.drafts.monitorInvoice.invoiceId);
    const contract = getContract(
      "workflow",
      requireConfiguredContractAddress("workflow"),
      requireAlignedReadRunner(),
    );
    const invoice = await contract.getInvoice(invoiceId);
    const data = {
      invoiceId,
      issuer: invoice.issuer,
      payer: invoice.payer,
      company: invoice.company,
      createdAt: invoice.createdAt.toString(),
      dueAt: invoice.dueAt.toString(),
      metadataHash: invoice.metadataHash,
      status: invoice.status.toString(),
      statusLabel: describeInvoiceStatus(invoice.status),
      paymentCount: invoice.paymentCount.toString(),
    };

    upsertInvoiceSnapshot(invoiceId, data);
    setNotice({
      tone: "good",
      title: "Invoice loaded",
      summary: "Workflow metadata returned successfully for the selected invoice.",
      meta: [data.statusLabel, `Payments ${data.paymentCount}`],
    });
  } catch (error) {
    setNotice({
      tone: "bad",
      title: "Invoice read failed",
      summary: formatTransactionError(error),
    });
  } finally {
    state.busyAction = "";
    renderApp();
  }
}

async function handleReadOutstanding() {
  state.busyAction = "read-outstanding";
  renderApp();

  try {
    const invoiceId = hashText(state.drafts.monitorInvoice.invoiceId);
    const response = await readSealedValue(
      state.runtime,
      state.fhenix,
      "workflow",
      requireConfiguredContractAddress("workflow"),
      "getSealedInvoiceOutstanding",
      [invoiceId],
    );
    const data = {
      invoiceId,
      clearOutstanding: response.clearValue.toString(),
      formattedOutstanding: formatSettlementAmount(response.clearValue),
      publicKey: response.publicKey,
      sealedOutstanding: response.sealedValue,
    };

    upsertInvoiceSnapshot(invoiceId, data);
    setNotice({
      tone: "good",
      title: "Outstanding revealed locally",
      summary: "Encrypted outstanding amount was decrypted in-browser for the selected invoice.",
      meta: [data.formattedOutstanding],
    });
  } catch (error) {
    setNotice({
      tone: "bad",
      title: "Outstanding read failed",
      summary: formatTransactionError(error),
    });
  } finally {
    state.busyAction = "";
    renderApp();
  }
}

async function handleCommand(command) {
  if (command === "connect-wallet") {
    state.walletModalOpen = true;
    state.walletMenuOpen = false;
    renderApp();
    return;
  }

  if (command === "open-wallet-modal") {
    state.walletModalOpen = true;
    state.walletMenuOpen = false;
    renderApp();
    return;
  }

  if (command === "close-wallet-modal") {
    state.walletModalOpen = false;
    renderApp();
    return;
  }

  if (command === "toggle-wallet-menu") {
    state.walletMenuOpen = !state.walletMenuOpen;
    state.walletModalOpen = false;
    renderApp();
    return;
  }

  if (command === "copy-wallet-address") {
    try {
      await copyWalletAddressToClipboard();
    } catch (error) {
      setNotice({
        tone: "bad",
        title: "Copy failed",
        summary: formatTransactionError(error),
      });
      renderApp();
    }
    return;
  }

  if (command === "change-wallet") {
    state.walletMenuOpen = false;
    state.walletModalOpen = true;
    renderApp();
    return;
  }

  if (command === "disconnect-wallet") {
    state.walletMenuOpen = false;
    state.busyCommand = "disconnect-wallet";
    renderApp();
    disconnectWalletSession();
    state.busyCommand = "";
    renderApp();
    return;
  }

  if (command === "switch-chain") {
    try {
      state.walletMenuOpen = false;
      state.busyCommand = "switch-chain";
      renderApp();
      await switchWalletChain(state.selectedChainId, state.runtime.walletId || getStoredWalletProviderId());
      await refreshAppState({
        silent: true,
        walletId: state.runtime.walletId || getStoredWalletProviderId(),
      });
      setNotice({
        tone: "good",
        title: "Wallet switched",
        summary: `Wallet moved to ${getChainMetadata(state.selectedChainId).label}.`,
      });
    } catch (error) {
      setNotice({
        tone: "bad",
        title: "Chain switch failed",
        summary: formatTransactionError(error),
      });
    } finally {
      state.busyCommand = "";
      renderApp();
    }
    return;
  }

  if (command === "refresh-app") {
    await refreshAppState();
    return;
  }

  if (command === "sync-manifest") {
    await syncManifest();
    await refreshAppState({ silent: true });
    return;
  }

  if (command === "reveal-balance") {
    await handleRevealBalance();
    return;
  }

  if (command === "hide-balance") {
    state.privateBalance.revealed = false;
    setNotice({
      tone: "muted",
      title: "Balance hidden",
      summary: "Private balance is masked again in the product view.",
    });
    renderApp();
  }
}

async function handleAction(action) {
  try {
    requireAlignedProvider();

    if (action === "register-company") {
      await handleRegisterCompany();
      return;
    }

    if (action === "send-payment") {
      await handleSendPayment();
      return;
    }

    if (action === "create-invoice") {
      await handleCreateInvoice();
      return;
    }

    if (action === "approve-invoice") {
      await handleApproveInvoice();
      return;
    }

    if (action === "pay-invoice") {
      await handlePayInvoice();
      return;
    }

    if (action === "read-invoice") {
      await handleReadInvoice();
      return;
    }

    if (action === "read-outstanding") {
      await handleReadOutstanding();
    }
  } catch (error) {
    setNotice({
      tone: "bad",
      title: "Action failed",
      summary: formatTransactionError(error),
    });
    renderApp();
  }
}

function bindEvents() {
  state.root.addEventListener("input", (event) => {
    const field = event.target.closest("[data-app-field]");

    if (!field) {
      return;
    }

    const draftKey = field.dataset.draftKey;

    state.drafts[draftKey] = {
      ...(state.drafts[draftKey] || {}),
      [field.name]: field.value,
    };

    if (draftKey === "monitorInvoice" || draftKey === "approveInvoice" || draftKey === "payInvoice") {
      const value = field.value;
      state.drafts.monitorInvoice.invoiceId = value;
      state.drafts.approveInvoice.invoiceId = value;
      state.drafts.payInvoice.invoiceId = value;
    }
  });

  state.root.addEventListener("click", async (event) => {
    let shouldRenderWalletChrome = false;

    if (state.walletMenuOpen && !event.target.closest("[data-wallet-shell]")) {
      state.walletMenuOpen = false;
      shouldRenderWalletChrome = true;
    }

    const featureNavTrigger = event.target.closest("[data-feature-nav]");

    if (featureNavTrigger) {
      const { featureNav } = featureNavTrigger.dataset;

      if (getFeatureConfig(featureNav)?.id === featureNav) {
        state.activeFeature = featureNav;

        if (featureNav === "wallet") {
          state.activeSidebarTab = "control";
        }

        if (featureNav === "activity") {
          state.activeSidebarTab = state.currentInvoiceId ? "focus" : "ledger";
        }

        renderApp();
      }
      return;
    }

    const walletConnectTrigger = event.target.closest("[data-wallet-connect]");

    if (walletConnectTrigger) {
      await handleWalletConnect(walletConnectTrigger.dataset.walletConnect);
      return;
    }

    const sidebarTabTrigger = event.target.closest("[data-sidebar-tab]");

    if (sidebarTabTrigger) {
      const { sidebarTab } = sidebarTabTrigger.dataset;

      if (SIDEBAR_TABS.includes(sidebarTab)) {
        state.activeSidebarTab = sidebarTab;

        if (sidebarTab === "control") {
          state.activeFeature = "wallet";
        }

        if (sidebarTab === "ledger" || sidebarTab === "focus") {
          state.activeFeature = "activity";
        }

        renderApp();
      }
      return;
    }

    const selectInvoiceTrigger = event.target.closest("[data-select-invoice]");

    if (selectInvoiceTrigger) {
      setCurrentInvoice(selectInvoiceTrigger.dataset.selectInvoice);
      renderApp();
      return;
    }

    const commandTrigger = event.target.closest("[data-command]");

    if (commandTrigger) {
      await handleCommand(commandTrigger.dataset.command);
      return;
    }

    const actionTrigger = event.target.closest("[data-action]");

    if (actionTrigger) {
      await handleAction(actionTrigger.dataset.action);
      return;
    }

    if (shouldRenderWalletChrome) {
      renderApp();
    }
  });

  if (typeof window !== "undefined") {
    window.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || (!state.walletModalOpen && !state.walletMenuOpen)) {
        return;
      }

      closeWalletChrome();
      renderApp();
    });
  }
}

async function bootstrapManifest() {
  const manifest = await loadDeploymentManifest();

  if (!manifest) {
    return;
  }

  state.manifest = manifest;
  state.selectedChainId = String(manifest.chainId || DEFAULT_CHAIN_ID);
  state.addresses = {
    ...getAddressConfig(state.selectedChainId),
    ...manifest.addresses,
  };
  saveAddressConfig(state.selectedChainId, state.addresses);
}

export async function initHexaPayLaunchApp(root) {
  state.root = root;
  state.recentActivity = loadRecentActivity();
  renderApp();
  await bootstrapManifest();
  await refreshAppState({ silent: true });
  bindEvents();
  renderApp();
}
