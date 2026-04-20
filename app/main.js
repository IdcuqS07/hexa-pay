import { formatUnits } from "ethers";
import {
  DEFAULT_CHAIN_ID,
  getAddressConfig,
  getChainMetadata,
  loadDeploymentManifest,
  saveAddressConfig,
} from "../src/contracts/config.js";
import {
  buildEncryptedAmount,
  createRuntime,
  describeEscrowStatus,
  describeInvoiceStatus,
  describePolicyAction,
  describeScope,
  formatTransactionError,
  getContract,
  getExplorerLink,
  getFhenixState,
  hashText,
  isConfiguredAddress,
  listInjectedWallets,
  normalizeAddress,
  parseAmountToUnits,
  parseScopeList,
  parseTimestamp,
  parseUint,
  readCoreSnapshot,
  readSealedValue,
  readTokenSnapshot,
  sendWrite,
  shortAddress,
  switchWalletChain,
  toDisplayObject,
} from "../src/contracts/client.js";
import {
  formatPrivateQuoteReceiptTime,
  createPrivateQuote,
  getPrivateQuoteErrorMessage,
  loadPrivateQuoteConfig,
} from "./private-quote.js";
import { createReceiptAccessContext } from "./receipt-access-context.js";
import {
  createReceiptStore,
  getReceiptStoreChangeKey,
} from "./receipt-store-factory.js";
import { ReceiptRoles } from "./receipt-types.js";
import {
  appendPrivateQuoteStoreMode,
  getPrivateQuoteStoreMode,
  getPrivateQuoteStoreModeLabel,
  setPrivateQuoteStoreMode,
  PRIVATE_QUOTE_STORE_MODE_STORAGE_KEY,
} from "./config.js";
import { mountPaymentIntentWidget } from "./payment-intent-widget.js";

const RECENT_ACTIVITY_STORAGE_KEY = "hexapay_recent_activity_v1";
const WALLET_SESSION_STORAGE_KEY = "hexapay_wallet_session_v1";
const WALLET_PROVIDER_STORAGE_KEY = "hexapay_wallet_provider_v1";
const APP_VIEWS = new Set([
  "dashboard",
  "send",
  "treasury",
  "invoices",
  "private-quotes",
  "policy",
  "escrow",
  "compliance",
  "analytics",
  "activity",
]);

const state = {
  activeView: getInitialView(),
  selectedChainId: DEFAULT_CHAIN_ID,
  addresses: getAddressConfig(DEFAULT_CHAIN_ID),
  manifest: null,
  runtime: createDefaultRuntime(),
  fhenix: createDefaultFhenixState(),
  coreSnapshot: null,
  tokenSnapshot: null,
  companySnapshot: null,
  recentActivity: [],
  privateBalance: createDefaultPrivateBalance(),
  invoiceSnapshots: {},
  policySnapshots: {},
  escrowSnapshots: {},
  complianceSnapshots: {},
  analyticsSnapshots: {},
  analyticsExposure: null,
  privateQuoteConfig: null,
  latestQuote: null,
  latestReceipt: null,
  latestAuditorReceipt: null,
  allowReceiptGrantSignature: false,
  privateQuoteResult: null,
  notice: {
    tone: "muted",
    summary:
      "Load the deployment manifest and connect a wallet to start revealing, sending, and settling inside this app.",
  },
  busyCommand: "",
  busyAction: "",
  forms: createDefaultForms(),
};

let boundWalletProvider = null;
let boundWalletAccountsChanged = null;
let boundWalletChainChanged = null;
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

function getInitialView() {
  if (typeof window === "undefined") {
    return "dashboard";
  }

  const view = String(window.location.hash || "").replace(/^#/, "");
  return APP_VIEWS.has(view) ? view : "dashboard";
}

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
    publicKey: "",
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

function createDefaultForms() {
  const dueAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const localDueAt = new Date(dueAt.getTime() - dueAt.getTimezoneOffset() * 60 * 1000)
    .toISOString()
    .slice(0, 16);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const localExpiresAt = new Date(expiresAt.getTime() - expiresAt.getTimezoneOffset() * 60 * 1000)
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
    privateQuote: {
      payer: "",
      amount: "1",
    },
    monitorInvoice: {
      invoiceId: "",
    },
    policyRule: {
      company: "",
      actionType: "0",
      minApprovals: "2",
      approvalTtl: "86400",
      active: "true",
    },
    createEscrow: {
      seller: "",
      arbiter: "",
      amount: "0.001",
      metadataHash: "escrow-2026-001",
      expiresAt: localExpiresAt,
    },
    monitorEscrow: {
      escrowId: "",
    },
    createCompliance: {
      subject: "",
      auditor: "",
      scopes: "2,5",
      duration: "604800",
      policyHash: "audit-policy-v1",
    },
    monitorCompliance: {
      roomId: "",
    },
    analyticsCheckpoint: {
      company: "",
      snapshotHash: "monthly-close-2026-03",
    },
    monitorAnalytics: {
      checkpointId: "",
      company: "",
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

function setNotice(summary, tone = "muted") {
  state.notice = {
    tone,
    summary,
  };
}

function normalizeView(view) {
  const normalized = String(view || "").replace(/^#/, "");
  return APP_VIEWS.has(normalized) ? normalized : "dashboard";
}

function updateViewHash(view) {
  if (typeof window === "undefined") {
    return;
  }

  const url = new URL(window.location.href);
  url.hash = view;
  window.history.replaceState({}, "", url);
}

function setActiveView(view, { updateHash = true, scrollTop = true } = {}) {
  const normalized = normalizeView(view);
  state.activeView = normalized;

  if (updateHash) {
    updateViewHash(normalized);
  }

  if (scrollTop) {
    document.querySelector(".main-content")?.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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
  const hidden = "~".repeat(Math.max(6, Math.min(16, raw.length - head.length - tail.length || 8)));

  return `${hasHexPrefix ? "0x" : ""}${head}${hidden}${tail}`;
}

function getActivityDirection(module) {
  if (module === "Treasury") {
    return "negative";
  }

  if (module === "Invoices") {
    return "positive";
  }

  return "neutral";
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

  window.localStorage.setItem(RECENT_ACTIVITY_STORAGE_KEY, JSON.stringify(state.recentActivity));
}

function clearRecentActivity() {
  state.recentActivity = [];
  saveRecentActivity();
}

function recordRecentActivity(title, module, receipt, metadata = {}) {
  const entry = {
    hash: receipt.hash,
    title,
    module,
    subtitle: metadata.subtitle || shortAddress(receipt.hash, 6, 6),
    amountDisplay: metadata.amountDisplay || "Live",
    currency: metadata.currency || module.toUpperCase(),
    direction: metadata.direction || getActivityDirection(module),
    blockNumber: String(receipt.blockNumber || ""),
    explorerUrl: receipt.explorerUrl || "",
    identifiers: receipt.identifiers || {},
    confirmedAt: Date.now(),
  };

  state.recentActivity = [entry, ...state.recentActivity.filter((item) => item.hash !== entry.hash)].slice(0, 8);
  saveRecentActivity();
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
    await refreshAppState({
      silent: true,
      walletId: state.runtime.walletId || getStoredWalletProviderId(),
    });
  };
  boundWalletChainChanged = async () => {
    await refreshAppState({
      silent: true,
      walletId: state.runtime.walletId || getStoredWalletProviderId(),
    });
  };

  walletProvider.on?.("accountsChanged", boundWalletAccountsChanged);
  walletProvider.on?.("chainChanged", boundWalletChainChanged);
  boundWalletProvider = walletProvider;
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
    return `${String(value || "0")} ${settlement.symbol}`;
  }
}

function formatTimestamp(timestamp) {
  const numeric = Number(timestamp || 0);

  if (!numeric) {
    return "Not available";
  }

  return new Date(numeric * 1000).toLocaleString();
}

async function syncPrivateQuoteConfig({ refresh = false } = {}) {
  state.privateQuoteConfig = await loadPrivateQuoteConfig({ refresh });
  return state.privateQuoteConfig;
}

async function ensurePrivateQuoteConfig() {
  return state.privateQuoteConfig || syncPrivateQuoteConfig();
}

function getPrivateQuoteChainLabel() {
  const chainId = state.privateQuoteConfig?.chainId || DEFAULT_CHAIN_ID;
  return getChainMetadata(chainId).label;
}

function requirePrivateQuoteRuntime() {
  requireConnectedRuntime();

  if (!state.runtime.signer) {
    throw new Error("Reconnect the wallet before creating a private quote.");
  }
}

function requirePrivateQuoteChain() {
  if (!state.privateQuoteConfig) {
    throw new Error("Private quote module config is still loading.");
  }

  if (state.runtime.chainId !== state.privateQuoteConfig.chainId) {
    throw new Error(`Switch wallet to ${getPrivateQuoteChainLabel()} first.`);
  }
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
  state.forms.monitorInvoice.invoiceId = invoiceId;
}

function getCurrentInvoiceSnapshot() {
  const invoiceId = state.forms.monitorInvoice.invoiceId;

  if (!invoiceId) {
    return null;
  }

  return state.invoiceSnapshots[String(invoiceId).toLowerCase()] || null;
}

function getInvoiceVisualState() {
  const snapshot = getCurrentInvoiceSnapshot();

  if (!snapshot) {
    return null;
  }

  const rawStatus = snapshot.status !== undefined ? String(snapshot.status) : "";
  const rawStatusLabel = snapshot.statusLabel || (rawStatus ? describeInvoiceStatus(rawStatus) : "");
  const clearOutstanding =
    snapshot.clearOutstanding !== undefined ? String(snapshot.clearOutstanding) : "";
  let visualLabel = rawStatusLabel || "Pending";

  if (clearOutstanding === "0") {
    visualLabel = "Paid in full";
  } else if (rawStatus === "3") {
    visualLabel = "Partially paid";
  }

  return {
    ...snapshot,
    visualLabel,
    rawStatusLabel,
  };
}

function getPolicySnapshotKey(company, actionType) {
  const normalizedCompany = normalizeAddress(company);

  if (!normalizedCompany && company) {
    return `${String(company).toLowerCase()}:${Number(actionType || 0)}`;
  }

  if (!normalizedCompany) {
    return "";
  }

  return `${normalizedCompany.toLowerCase()}:${Number(actionType || 0)}`;
}

function upsertPolicySnapshot(company, actionType, partial) {
  const key = getPolicySnapshotKey(company, actionType);

  if (!key) {
    return;
  }

  state.policySnapshots[key] = {
    ...(state.policySnapshots[key] || {}),
    ...(partial || {}),
    company: normalizeAddress(company) || company,
    actionType: String(actionType),
  };
  state.forms.policyRule.company = normalizeAddress(company) || company;
  state.forms.policyRule.actionType = String(actionType);
}

function getCurrentPolicySnapshot() {
  const key = getPolicySnapshotKey(state.forms.policyRule.company, state.forms.policyRule.actionType);
  return key ? state.policySnapshots[key] || null : null;
}

function upsertEscrowSnapshot(escrowId, partial) {
  if (!escrowId) {
    return;
  }

  const key = String(escrowId).toLowerCase();
  state.escrowSnapshots[key] = {
    ...(state.escrowSnapshots[key] || {}),
    ...(partial || {}),
    escrowId,
  };
  state.forms.monitorEscrow.escrowId = escrowId;
}

function getCurrentEscrowSnapshot() {
  const escrowId = state.forms.monitorEscrow.escrowId;

  if (!escrowId) {
    return null;
  }

  return state.escrowSnapshots[String(escrowId).toLowerCase()] || null;
}

function upsertComplianceSnapshot(roomId, partial) {
  if (!roomId) {
    return;
  }

  const key = String(roomId).toLowerCase();
  state.complianceSnapshots[key] = {
    ...(state.complianceSnapshots[key] || {}),
    ...(partial || {}),
    roomId,
  };
  state.forms.monitorCompliance.roomId = roomId;
}

function getCurrentComplianceSnapshot() {
  const roomId = state.forms.monitorCompliance.roomId;

  if (!roomId) {
    return null;
  }

  return state.complianceSnapshots[String(roomId).toLowerCase()] || null;
}

function upsertAnalyticsSnapshot(checkpointId, partial) {
  if (!checkpointId) {
    return;
  }

  const key = String(checkpointId).toLowerCase();
  state.analyticsSnapshots[key] = {
    ...(state.analyticsSnapshots[key] || {}),
    ...(partial || {}),
    checkpointId,
  };
  state.forms.monitorAnalytics.checkpointId = checkpointId;
}

function getCurrentAnalyticsSnapshot() {
  const checkpointId = state.forms.monitorAnalytics.checkpointId;

  if (!checkpointId) {
    return null;
  }

  return state.analyticsSnapshots[String(checkpointId).toLowerCase()] || null;
}

function upsertAnalyticsExposure(company, partial) {
  const normalizedCompany = normalizeAddress(company);

  if (!normalizedCompany) {
    return;
  }

  state.analyticsExposure = {
    ...(state.analyticsExposure || {}),
    ...(partial || {}),
    company: normalizedCompany,
  };
  state.forms.monitorAnalytics.company = normalizedCompany;
}

function getCurrentAnalyticsExposure() {
  const company = normalizeAddress(state.forms.monitorAnalytics.company);

  if (!company || !state.analyticsExposure) {
    return null;
  }

  return normalizeAddress(state.analyticsExposure.company) === company ? state.analyticsExposure : null;
}

function unwrapNamedResult(value, key) {
  if (!value || typeof value !== "object") {
    return value;
  }

  if (value[key] && typeof value[key] === "object") {
    return value[key];
  }

  return value;
}

function formatScopeLabels(scopes = []) {
  if (!Array.isArray(scopes) || !scopes.length) {
    return "No scopes";
  }

  return scopes
    .map((scope) => (/^\d+$/.test(String(scope)) ? describeScope(scope) : String(scope)))
    .join(", ");
}

async function readCompanySnapshot(runner, coreAddress, account) {
  if (!runner || !isConfiguredAddress(coreAddress) || !normalizeAddress(account)) {
    return null;
  }

  try {
    const contract = getContract("core", coreAddress, runner);
    const company = await contract.getCompany(account);

    return {
      companyName: company.companyName || "",
      ensName: company.ensName || "",
      companyId: company.companyId || "",
      verified: Boolean(company.verified),
      signers: Array.isArray(company.signers) ? company.signers : [],
    };
  } catch (error) {
    return null;
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

async function refreshAppState({ requestAccounts = false, silent = false, walletId = "" } = {}) {
  const preferredWalletId = walletId || state.runtime.walletId || getStoredWalletProviderId();

  if (!silent) {
    state.busyCommand = requestAccounts ? "connect-wallet" : "refresh-app";
    render();
  }

  try {
    const suppressAccounts = !requestAccounts && !isWalletSessionEnabled();
    const runtime = await createRuntime({
      requestAccounts,
      suppressAccounts,
      walletId: preferredWalletId,
    });
    const alignedProvider =
      runtime.connected && runtime.chainId === state.selectedChainId ? runtime.provider : null;
    const fhenix = alignedProvider
      ? await getFhenixState(runtime)
      : createDefaultFhenixState();

    let coreSnapshot = null;
    let tokenSnapshot = null;
    let companySnapshot = null;

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

      companySnapshot = await readCompanySnapshot(
        runtime.signer || alignedProvider,
        state.addresses.core,
        runtime.account,
      );
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
    state.companySnapshot = companySnapshot;
    syncWalletListeners(runtime.walletProvider);
    await syncLatestPrivateQuoteReceipts();

    if (!state.manifest) {
      setNotice("Sync manifest first so the app can discover the live contract suite.", "warn");
    } else if (!runtime.connected) {
      setNotice("Manifest synced. Connect a wallet to read balances and sign encrypted actions.", "muted");
    } else if (runtime.chainId !== state.selectedChainId) {
      setNotice(
        `Wallet connected on chain ${runtime.chainId}. Switch to ${getChainMetadata(state.selectedChainId).label} to continue.`,
        "warn",
      );
    } else if (fhenix.mode === "ready") {
      setNotice("Wallet, manifest, and CoFHE runtime are ready for live private actions.", "good");
    } else if (fhenix.mode === "preview") {
      setNotice(fhenix.error || "Wallet connected, but CoFHE is not ready yet.", "warn");
    } else {
      setNotice("Wallet connected. Sync and encryption reads will unlock once CoFHE is ready.", "muted");
    }
  } catch (error) {
    setNotice(formatTransactionError(error), "bad");
  } finally {
    state.busyCommand = "";
    render();
  }
}

async function disconnectWalletSession() {
  setWalletSessionEnabled(false);
  detachWalletListeners();
  state.runtime = createDefaultRuntime();
  state.fhenix = createDefaultFhenixState();
  state.coreSnapshot = null;
  state.tokenSnapshot = null;
  state.companySnapshot = null;
  state.privateBalance = createDefaultPrivateBalance();
  await syncLatestPrivateQuoteReceipts();
  setNotice("Wallet disconnected from this app session.", "muted");
}

async function syncManifest({ silent = false } = {}) {
  if (!silent) {
    state.busyCommand = "sync-manifest";
    render();
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

    setNotice(
      `Manifest synced for ${getChainMetadata(state.selectedChainId).label}. Core ${shortAddress(state.addresses.core)} is ready for reads.`,
      "good",
    );
  } catch (error) {
    setNotice(formatTransactionError(error), "bad");
  } finally {
    state.busyCommand = "";
    render();
  }
}

async function handleConnectWallet() {
  if (state.runtime.connected && state.runtime.chainId !== state.selectedChainId) {
    await handleSwitchChain();
    return;
  }

  state.allowReceiptGrantSignature = true;
  await refreshAppState({
    requestAccounts: true,
    walletId: state.runtime.walletId || getStoredWalletProviderId(),
  });
}

async function handleSwitchChain() {
  try {
    state.busyCommand = "switch-chain";
    render();
    await switchWalletChain(state.selectedChainId, state.runtime.walletId || getStoredWalletProviderId());
    state.allowReceiptGrantSignature = true;
    await refreshAppState({
      silent: true,
      walletId: state.runtime.walletId || getStoredWalletProviderId(),
    });
    setNotice(`Wallet switched to ${getChainMetadata(state.selectedChainId).label}.`, "good");
  } catch (error) {
    setNotice(formatTransactionError(error), "bad");
  } finally {
    state.busyCommand = "";
    render();
  }
}

async function handleSwitchPrivateQuoteChain() {
  const config = await ensurePrivateQuoteConfig();

  try {
    state.busyCommand = "switch-private-quote-chain";
    render();

    if (!state.runtime.connected) {
      state.allowReceiptGrantSignature = true;
      await refreshAppState({
        requestAccounts: true,
        silent: true,
        walletId: state.runtime.walletId || getStoredWalletProviderId(),
      });
    }

    await switchWalletChain(config.chainId, state.runtime.walletId || getStoredWalletProviderId());
    state.allowReceiptGrantSignature = true;
    await refreshAppState({
      silent: true,
      walletId: state.runtime.walletId || getStoredWalletProviderId(),
    });
    setNotice(`Wallet switched to ${getChainMetadata(config.chainId).label} for private quotes.`, "good");
  } catch (error) {
    setNotice(getPrivateQuoteErrorMessage(error), "bad");
  } finally {
    state.busyCommand = "";
    render();
  }
}

async function handleCopyPrivateQuoteLink() {
  try {
    const latestLink = state.latestQuote?.link || state.privateQuoteResult?.paymentLink;

    if (!latestLink) {
      throw new Error("Create a private quote first.");
    }

    await navigator.clipboard.writeText(latestLink);
    setNotice("Private quote payment link copied to clipboard.", "good");
  } catch (error) {
    setNotice(getPrivateQuoteErrorMessage(error), "bad");
  }

  render();
}

function hidePrivateBalance() {
  state.privateBalance.revealed = false;
  setNotice("Private balance is masked again in the product view.", "muted");
  render();
}

async function handleRevealBalance() {
  state.busyAction = "balance";
  setNotice("Reading the encrypted balance handle and decrypting it locally.", "warn");
  render();

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

    setNotice(`Private balance revealed locally: ${state.privateBalance.formattedBalance}.`, "good");
  } catch (error) {
    setNotice(formatTransactionError(error), "bad");
  } finally {
    state.busyAction = "";
    render();
  }
}

async function withLiveWrite(actionId, title, module, callback, metadata = {}) {
  state.busyAction = actionId;
  setNotice("Confirm the action in your wallet to continue.", "warn");
  render();

  try {
    const receipt = await callback();
    const enrichedReceipt = {
      ...receipt,
      explorerUrl: getExplorerLink(state.runtime.chainId || state.selectedChainId, receipt.hash),
    };

    recordRecentActivity(title, module, enrichedReceipt, metadata);
    await refreshAppState({ silent: true });
    setNotice(`${title} confirmed on-chain.`, "good");

    return enrichedReceipt;
  } catch (error) {
    setNotice(formatTransactionError(error), "bad");
    return null;
  } finally {
    state.busyAction = "";
    render();
  }
}

async function handleRegisterCompany() {
  requireAlignedProvider();

  const values = state.forms.registerCompany;

  if (!String(values.companyName || "").trim()) {
    throw new Error("Company name is required.");
  }

  await withLiveWrite(
    "register-company",
    "Company registered",
    "Identity",
    async () =>
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
    {
      amountDisplay: "LIVE",
      currency: "IDENTITY",
      direction: "neutral",
      subtitle: values.companyName.trim(),
    },
  );
}

async function handleSendPayment() {
  requireAlignedProvider();
  requireFhenixReady();

  const values = state.forms.sendPayment;
  const recipient = normalizeAddress(values.recipient);

  if (!recipient) {
    throw new Error("Recipient address is invalid.");
  }

  const settlement = getSettlementContext();
  const units = parseAmountToUnits(values.amount, settlement.decimals);
  const encrypted = await buildEncryptedAmount(state.fhenix, units.toString(), {
    allowPlaceholder: false,
  });

  await withLiveWrite(
    "send-payment",
    "Encrypted payment",
    "Treasury",
    async () =>
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
    {
      amountDisplay: `-${values.amount}`,
      currency: settlement.symbol,
      direction: "negative",
      subtitle: shortAddress(recipient),
    },
  );
}

async function handleCreateInvoice() {
  requireAlignedProvider();
  requireFhenixReady();

  const values = state.forms.createInvoice;
  const company = normalizeAddress(values.company);
  const payer = normalizeAddress(values.payer);

  if (!company || !payer) {
    throw new Error("Company and payer addresses must be valid.");
  }

  const settlement = getSettlementContext();
  const units = parseAmountToUnits(values.amount, settlement.decimals);
  const encrypted = await buildEncryptedAmount(state.fhenix, units.toString(), {
    allowPlaceholder: false,
  });

  const receipt = await withLiveWrite(
    "create-invoice",
    "Invoice created",
    "Invoices",
    async () =>
      sendWrite(
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
      ),
    {
      amountDisplay: `+${values.amount}`,
      currency: settlement.symbol,
      direction: "positive",
      subtitle: shortAddress(payer),
    },
  );

  if (receipt?.identifiers?.invoiceId) {
    upsertInvoiceSnapshot(receipt.identifiers.invoiceId, {
      company,
      payer,
      statusLabel: "Pending Approval",
    });
  }
}

async function handleCreatePrivateQuote() {
  await ensurePrivateQuoteConfig();
  requirePrivateQuoteRuntime();
  requirePrivateQuoteChain();

  const values = state.forms.privateQuote;
  const payer = normalizeAddress(values.payer);
  const amount = Number(String(values.amount || "").trim());

  if (!payer) {
    throw new Error("Payer address is invalid.");
  }

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Amount must be greater than zero.");
  }

  state.busyAction = "create-private-quote";
  setNotice("Confirm the private quote creation in your wallet.", "warn");
  render();

  try {
    const result = await createPrivateQuote({
      signer: state.runtime.signer,
      address: state.privateQuoteConfig.address,
      payer,
      amount,
    });

    state.latestQuote = {
      id: result.id,
      link: result.paymentLink,
      payer,
      amount,
      txHash: result.txHash,
      expiresAt: result.expiresAt,
    };
    state.privateQuoteResult = result;
    recordRecentActivity(
      "Private quote created",
      "Private Quotes",
      {
        hash: result.txHash,
        blockNumber: result.blockNumber,
        explorerUrl: getExplorerLink(state.privateQuoteConfig.chainId, result.txHash),
        identifiers: {
          quoteId: result.id,
        },
      },
      {
        amountDisplay: `+${String(values.amount).trim()}`,
        currency: "QUOTE",
        direction: "neutral",
        subtitle: shortAddress(payer),
      },
    );

    setNotice("Private quote created. Share the payment route with the payer.", "good");
  } catch (error) {
    throw new Error(getPrivateQuoteErrorMessage(error));
  } finally {
    state.busyAction = "";
    render();
  }
}

async function handleReadInvoice() {
  requireAlignedProvider();

  const invoiceId = hashText(state.forms.monitorInvoice.invoiceId);
  state.busyAction = "read-invoice";
  setNotice("Loading invoice metadata from the workflow module.", "warn");
  render();

  try {
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
    setNotice(`Invoice loaded: ${data.statusLabel}.`, "good");
  } catch (error) {
    setNotice(formatTransactionError(error), "bad");
  } finally {
    state.busyAction = "";
    render();
  }
}

async function handleReadOutstanding() {
  requireAlignedProvider();
  requireFhenixReady();

  const invoiceId = hashText(state.forms.monitorInvoice.invoiceId);
  state.busyAction = "read-outstanding";
  setNotice("Decrypting the selected invoice outstanding locally.", "warn");
  render();

  try {
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
    setNotice(`Outstanding revealed locally: ${data.formattedOutstanding}.`, "good");
  } catch (error) {
    setNotice(formatTransactionError(error), "bad");
  } finally {
    state.busyAction = "";
    render();
  }
}

async function handleSetPolicyRule() {
  requireAlignedProvider();

  const values = state.forms.policyRule;
  const company = normalizeAddress(values.company);

  if (!company) {
    throw new Error("Company address is invalid.");
  }

  const actionType = Number(values.actionType || 0);
  const minApprovals = Number(parseUint(values.minApprovals, "Minimum approvals"));
  const approvalTtl = parseTimestamp(values.approvalTtl, "Approval TTL");
  const active = values.active === "true";

  const receipt = await withLiveWrite(
    "set-policy-rule",
    "Policy rule updated",
    "Policy",
    async () =>
      sendWrite(
        state.runtime,
        "workflow",
        requireConfiguredContractAddress("workflow"),
        "setPolicyRule",
        [company, actionType, minApprovals, approvalTtl, active],
      ),
    {
      amountDisplay: active ? "ACTIVE" : "OFF",
      currency: "RULE",
      direction: "neutral",
      subtitle: describePolicyAction(actionType),
    },
  );

  if (receipt) {
    upsertPolicySnapshot(company, actionType, {
      company,
      actionLabel: describePolicyAction(actionType),
      minApprovals: String(minApprovals),
      approvalTtl: approvalTtl.toString(),
      active,
    });
  }
}

async function handleReadPolicyRule() {
  requireAlignedProvider();

  const values = state.forms.policyRule;
  const company = normalizeAddress(values.company);

  if (!company) {
    throw new Error("Company address is invalid.");
  }

  const actionType = Number(values.actionType || 0);
  state.busyAction = "read-policy-rule";
  setNotice("Loading the workflow policy rule for the selected company.", "warn");
  render();

  try {
    const contract = getContract(
      "workflow",
      requireConfiguredContractAddress("workflow"),
      requireAlignedReadRunner(),
    );
    const rule = await contract.getPolicyRule(company, actionType);
    const data = {
      company,
      actionType: String(actionType),
      actionLabel: describePolicyAction(actionType),
      minApprovals: rule.minApprovals.toString(),
      approvalTtl: rule.approvalTtl.toString(),
      active: Boolean(rule.active),
    };

    upsertPolicySnapshot(company, actionType, data);
    setNotice(
      `Policy rule loaded for ${describePolicyAction(actionType)}: ${data.active ? "active" : "inactive"}.`,
      "good",
    );
  } catch (error) {
    setNotice(formatTransactionError(error), "bad");
  } finally {
    state.busyAction = "";
    render();
  }
}

async function handleCreateEscrow() {
  requireAlignedProvider();
  requireFhenixReady();

  const values = state.forms.createEscrow;
  const seller = normalizeAddress(values.seller);
  const arbiter = normalizeAddress(values.arbiter);

  if (!seller || !arbiter) {
    throw new Error("Seller and arbiter addresses must be valid.");
  }

  const settlement = getSettlementContext();
  const units = parseAmountToUnits(values.amount, settlement.decimals);
  const encrypted = await buildEncryptedAmount(state.fhenix, units.toString(), {
    allowPlaceholder: false,
  });

  const receipt = await withLiveWrite(
    "create-escrow",
    "Escrow created",
    "Escrow",
    async () =>
      sendWrite(
        state.runtime,
        "escrow",
        requireConfiguredContractAddress("escrow"),
        "createEscrow",
        [
          seller,
          arbiter,
          encrypted.payload,
          hashText(values.metadataHash, `${seller}:${arbiter}`),
          parseTimestamp(values.expiresAt || "", "Escrow expiration"),
        ],
      ),
    {
      amountDisplay: values.amount,
      currency: settlement.symbol,
      direction: "neutral",
      subtitle: shortAddress(seller),
    },
  );

  if (receipt?.identifiers?.escrowId) {
    upsertEscrowSnapshot(receipt.identifiers.escrowId, {
      seller,
      arbiter,
      status: "0",
      statusLabel: describeEscrowStatus(0),
      expiresAt: parseTimestamp(values.expiresAt || "", "Escrow expiration").toString(),
    });
  }
}

async function handleReadEscrow() {
  requireAlignedProvider();

  const escrowId = hashText(state.forms.monitorEscrow.escrowId);
  state.busyAction = "read-escrow";
  setNotice("Loading escrow metadata from the escrow module.", "warn");
  render();

  try {
    const contract = getContract(
      "escrow",
      requireConfiguredContractAddress("escrow"),
      requireAlignedReadRunner(),
    );
    const escrow = await contract.getEscrow(escrowId);
    const data = {
      escrowId,
      buyer: escrow.buyer,
      seller: escrow.seller,
      arbiter: escrow.arbiter,
      createdAt: escrow.createdAt.toString(),
      expiresAt: escrow.expiresAt.toString(),
      metadataHash: escrow.metadataHash,
      disputeReasonHash: escrow.disputeReasonHash,
      rulingHash: escrow.rulingHash,
      status: escrow.status.toString(),
      statusLabel: describeEscrowStatus(escrow.status),
      fundingCount: escrow.fundingCount.toString(),
      releaseCount: escrow.releaseCount.toString(),
      fullyFunded: Boolean(escrow.fullyFunded),
    };

    upsertEscrowSnapshot(escrowId, data);
    setNotice(`Escrow loaded: ${data.statusLabel}.`, "good");
  } catch (error) {
    setNotice(formatTransactionError(error), "bad");
  } finally {
    state.busyAction = "";
    render();
  }
}

async function handleReadEscrowRemaining() {
  requireAlignedProvider();
  requireFhenixReady();

  const escrowId = hashText(state.forms.monitorEscrow.escrowId);
  state.busyAction = "read-escrow-remaining";
  setNotice("Decrypting the selected escrow remaining amount locally.", "warn");
  render();

  try {
    const response = await readSealedValue(
      state.runtime,
      state.fhenix,
      "escrow",
      requireConfiguredContractAddress("escrow"),
      "getSealedEscrowRemaining",
      [escrowId],
    );
    const data = {
      escrowId,
      clearRemaining: response.clearValue.toString(),
      formattedRemaining: formatSettlementAmount(response.clearValue),
      publicKey: response.publicKey,
      sealedRemaining: response.sealedValue,
    };

    upsertEscrowSnapshot(escrowId, data);
    setNotice(`Escrow remaining revealed locally: ${data.formattedRemaining}.`, "good");
  } catch (error) {
    setNotice(formatTransactionError(error), "bad");
  } finally {
    state.busyAction = "";
    render();
  }
}

async function handleCreateComplianceRoom() {
  requireAlignedProvider();

  const values = state.forms.createCompliance;
  const subject = normalizeAddress(values.subject);
  const auditor = normalizeAddress(values.auditor);

  if (!subject || !auditor) {
    throw new Error("Subject and auditor addresses must be valid.");
  }

  const scopes = parseScopeList(values.scopes);
  const receipt = await withLiveWrite(
    "create-compliance-room",
    "Compliance room created",
    "Compliance",
    async () =>
      sendWrite(
        state.runtime,
        "compliance",
        requireConfiguredContractAddress("compliance"),
        "createComplianceRoom",
        [
          subject,
          auditor,
          scopes,
          parseTimestamp(values.duration, "Compliance duration"),
          hashText(values.policyHash, `${subject}:${auditor}`),
        ],
      ),
    {
      amountDisplay: "SCOPED",
      currency: "AUDIT",
      direction: "neutral",
      subtitle: shortAddress(auditor),
    },
  );

  if (receipt?.identifiers?.roomId) {
    upsertComplianceSnapshot(receipt.identifiers.roomId, {
      subject,
      auditor,
      scopeList: scopes.map((scope) => describeScope(scope)),
      active: true,
    });
  }
}

async function handleReadComplianceRoom() {
  requireAlignedProvider();

  const roomId = hashText(state.forms.monitorCompliance.roomId);
  state.busyAction = "read-compliance-room";
  setNotice("Loading the compliance room metadata and scopes.", "warn");
  render();

  try {
    const contract = getContract(
      "compliance",
      requireConfiguredContractAddress("compliance"),
      requireAlignedReadRunner(),
    );
    const [roomResult, scopesResult] = await Promise.all([
      contract.getComplianceRoom(roomId),
      contract.getRoomScopes(roomId),
    ]);
    const room = unwrapNamedResult(toDisplayObject(roomResult), "room");
    const scopes = Array.isArray(scopesResult) ? scopesResult.map((scope) => Number(scope)) : [];
    const data = {
      roomId: room.roomId || roomId,
      subject: room.subject,
      auditor: room.auditor,
      createdAt: String(room.createdAt || "0"),
      expiresAt: String(room.expiresAt || "0"),
      policyHash: room.policyHash,
      active: Boolean(room.active),
      exists: Boolean(room.exists),
      scopes,
      scopeList: scopes.map((scope) => describeScope(scope)),
    };

    upsertComplianceSnapshot(roomId, data);
    setNotice(`Compliance room loaded: ${data.active ? "active" : "inactive"}.`, "good");
  } catch (error) {
    setNotice(formatTransactionError(error), "bad");
  } finally {
    state.busyAction = "";
    render();
  }
}

async function handleCreateAnalyticsCheckpoint() {
  requireAlignedProvider();

  const values = state.forms.analyticsCheckpoint;
  const company = normalizeAddress(values.company);

  if (!company) {
    throw new Error("Company address is invalid.");
  }

  const receipt = await withLiveWrite(
    "create-analytics-checkpoint",
    "Analytics checkpoint created",
    "Analytics",
    async () =>
      sendWrite(
        state.runtime,
        "analytics",
        requireConfiguredContractAddress("analytics"),
        "checkpointAnalytics",
        [company, hashText(values.snapshotHash, company)],
      ),
    {
      amountDisplay: "ANCHOR",
      currency: "SNAP",
      direction: "neutral",
      subtitle: shortAddress(company),
    },
  );

  if (receipt?.identifiers?.checkpointId) {
    upsertAnalyticsSnapshot(receipt.identifiers.checkpointId, {
      company,
      snapshotHash: hashText(values.snapshotHash, company),
    });
  }
}

async function handleReadAnalyticsCheckpoint() {
  requireAlignedProvider();

  const checkpointId = hashText(state.forms.monitorAnalytics.checkpointId);
  state.busyAction = "read-analytics-checkpoint";
  setNotice("Loading analytics checkpoint metadata.", "warn");
  render();

  try {
    const contract = getContract(
      "analytics",
      requireConfiguredContractAddress("analytics"),
      requireAlignedReadRunner(),
    );
    const checkpointResult = await contract.getAnalyticsCheckpoint(checkpointId);
    const checkpoint = unwrapNamedResult(toDisplayObject(checkpointResult), "checkpoint");
    const data = {
      checkpointId: checkpoint.checkpointId || checkpointId,
      company: checkpoint.company,
      snapshotHash: checkpoint.snapshotHash,
      timestamp: String(checkpoint.timestamp || "0"),
    };

    upsertAnalyticsSnapshot(checkpointId, data);
    setNotice("Analytics checkpoint loaded.", "good");
  } catch (error) {
    setNotice(formatTransactionError(error), "bad");
  } finally {
    state.busyAction = "";
    render();
  }
}

async function handleReadInvoiceExposure() {
  requireAlignedProvider();
  requireFhenixReady();

  const company = normalizeAddress(state.forms.monitorAnalytics.company);

  if (!company) {
    throw new Error("Exposure company address is invalid.");
  }

  state.busyAction = "read-invoice-exposure";
  setNotice("Decrypting invoice exposure locally for the selected company.", "warn");
  render();

  try {
    const response = await readSealedValue(
      state.runtime,
      state.fhenix,
      "analytics",
      requireConfiguredContractAddress("analytics"),
      "getSealedInvoiceExposure",
      [company],
    );

    upsertAnalyticsExposure(company, {
      invoiceExposure: response.clearValue.toString(),
      formattedInvoiceExposure: formatSettlementAmount(response.clearValue),
      invoiceExposurePublicKey: response.publicKey,
      invoiceExposureSealed: response.sealedValue,
    });
    setNotice(
      `Invoice exposure revealed locally: ${state.analyticsExposure.formattedInvoiceExposure}.`,
      "good",
    );
  } catch (error) {
    setNotice(formatTransactionError(error), "bad");
  } finally {
    state.busyAction = "";
    render();
  }
}

async function handleReadEscrowExposure() {
  requireAlignedProvider();
  requireFhenixReady();

  const company = normalizeAddress(state.forms.monitorAnalytics.company);

  if (!company) {
    throw new Error("Exposure company address is invalid.");
  }

  state.busyAction = "read-escrow-exposure";
  setNotice("Decrypting escrow exposure locally for the selected company.", "warn");
  render();

  try {
    const response = await readSealedValue(
      state.runtime,
      state.fhenix,
      "analytics",
      requireConfiguredContractAddress("analytics"),
      "getSealedEscrowExposure",
      [company],
    );

    upsertAnalyticsExposure(company, {
      escrowExposure: response.clearValue.toString(),
      formattedEscrowExposure: formatSettlementAmount(response.clearValue),
      escrowExposurePublicKey: response.publicKey,
      escrowExposureSealed: response.sealedValue,
    });
    setNotice(
      `Escrow exposure revealed locally: ${state.analyticsExposure.formattedEscrowExposure}.`,
      "good",
    );
  } catch (error) {
    setNotice(formatTransactionError(error), "bad");
  } finally {
    state.busyAction = "";
    render();
  }
}

function getBalanceCopy() {
  if (!state.manifest) {
    return {
      label: "Private Treasury Balance",
      value: "Manifest pending",
      masked: "████████",
      caption: "Sync manifest to discover the live suite.",
      tone: "neutral",
    };
  }

  if (!state.runtime.connected) {
    return {
      label: "Private Treasury Balance",
      value: "Wallet not connected",
      masked: "████████",
      caption: "Connect wallet to reveal sealed balance locally.",
      tone: "neutral",
    };
  }

  if (state.runtime.chainId !== state.selectedChainId) {
    return {
      label: "Private Treasury Balance",
      value: "Switch network",
      masked: "████████",
      caption: `Switch wallet to ${getChainMetadata(state.selectedChainId).shortLabel}.`,
      tone: "warn",
    };
  }

  if (state.privateBalance.loaded && state.privateBalance.revealed) {
    return {
      label: "Private Treasury Balance",
      value: state.privateBalance.formattedBalance,
      masked: maskTrace(state.privateBalance.sealedBalance),
      caption: "Decrypted locally for this browser session.",
      tone: "positive",
    };
  }

  return {
    label: "Private Treasury Balance",
    value: "Encrypted",
    masked: state.privateBalance.loaded ? maskTrace(state.privateBalance.sealedBalance) : "████████",
    caption: "Masked by default until you intentionally reveal it.",
    tone: "positive",
  };
}

function renderToolbar() {
  const walletCta = document.querySelector("[data-wallet-cta]");
  const switchChainButton = document.querySelector("[data-switch-chain]");
  const disconnectButton = document.querySelector("[data-disconnect-wallet]");
  const noticeSummary = document.querySelector("[data-notice-summary]");
  const chainPill = document.querySelector("[data-chain-pill]");
  const manifestPill = document.querySelector("[data-manifest-pill]");
  const fhenixPill = document.querySelector("[data-fhenix-pill]");
  const privacyStatus = document.querySelector("[data-privacy-status]");
  const walletAvatar = document.querySelector("[data-wallet-avatar]");
  const profileButton = document.querySelector(".profile-btn");
  const selectedChain = getChainMetadata(state.selectedChainId);
  const manifestLabel = state.manifest ? "Manifest synced" : "Manifest pending";
  const fhenixLabel =
    state.fhenix.mode === "ready"
      ? "CoFHE ready"
      : state.fhenix.mode === "preview"
        ? "Preview only"
        : "Offline";

  noticeSummary.textContent = state.notice.summary;
  noticeSummary.classList.toggle("is-good", state.notice.tone === "good");
  noticeSummary.classList.toggle("is-warn", state.notice.tone === "warn");
  noticeSummary.classList.toggle("is-bad", state.notice.tone === "bad");

  chainPill.textContent = selectedChain.shortLabel;
  manifestPill.textContent = manifestLabel;
  fhenixPill.textContent = fhenixLabel;

  privacyStatus.textContent = fhenixLabel;
  walletAvatar.textContent = state.runtime.connected
    ? (state.runtime.walletName || "W").slice(0, 2).toUpperCase()
    : "HX";

  if (state.runtime.connected) {
    walletCta.textContent = shortAddress(state.runtime.account, 4, 4);
  } else if (state.busyCommand === "connect-wallet") {
    walletCta.textContent = "Connecting...";
  } else {
    walletCta.textContent = "Connect Wallet";
  }

  walletCta.disabled = state.busyCommand === "connect-wallet";
  switchChainButton.hidden =
    !state.runtime.connected || state.runtime.chainId === state.selectedChainId;
  switchChainButton.textContent = `Switch to ${selectedChain.shortLabel}`;
  switchChainButton.disabled = state.busyCommand === "switch-chain";
  disconnectButton.hidden = !state.runtime.connected;
  disconnectButton.disabled = state.busyCommand === "disconnect-wallet";
  profileButton.disabled = state.busyCommand === "connect-wallet";
}

function renderBalanceCard() {
  const balanceCopy = getBalanceCopy();
  const label = document.querySelector("[data-balance-label]");
  const value = document.querySelector("[data-balance-value]");
  const masked = document.querySelector("[data-balance-encrypted]");
  const caption = document.querySelector("[data-balance-caption]");
  const status = document.querySelector("[data-balance-status]");
  const toggle = document.querySelector("[data-balance-toggle]");
  const balanceState = document.querySelector("[data-balance-state]");

  label.textContent = balanceCopy.label;
  value.textContent = balanceCopy.value;
  masked.textContent = balanceCopy.masked;
  caption.textContent = balanceCopy.caption;

  status.classList.remove("positive", "negative", "neutral", "warn");
  status.classList.add(balanceCopy.tone);

  balanceState.classList.toggle(
    "encrypted-state",
    !(state.privateBalance.loaded && state.privateBalance.revealed),
  );

  toggle.textContent =
    state.privateBalance.loaded && state.privateBalance.revealed ? "Hide Again" : "Reveal Locally";
  toggle.disabled =
    state.busyAction === "balance" ||
    !state.runtime.connected ||
    state.runtime.chainId !== state.selectedChainId ||
    !state.manifest;
}

function renderForms() {
  document.querySelectorAll("[data-field]").forEach((field) => {
    const [group, key] = field.dataset.field.split(".");
    field.value = state.forms[group]?.[key] || "";
  });

  const sendHelper = document.querySelector("[data-send-helper]");
  const buttonStates = [
    ["[data-company-button]", "register-company", "Registering...", "Register Company"],
    ["[data-send-button]", "send-payment", "Encrypting...", "Encrypt and Send"],
    ["[data-create-invoice-button]", "create-invoice", "Encrypting...", "Create Invoice"],
    ["[data-create-private-quote-button]", "create-private-quote", "Creating...", "Create Private Quote"],
    ["[data-read-invoice-button]", "read-invoice", "Loading...", "Load Invoice"],
    ["[data-read-outstanding-button]", "read-outstanding", "Revealing...", "Reveal Outstanding"],
    ["[data-set-policy-button]", "set-policy-rule", "Saving...", "Save Policy Rule"],
    ["[data-read-policy-button]", "read-policy-rule", "Loading...", "Read Policy Rule"],
    ["[data-create-escrow-button]", "create-escrow", "Encrypting...", "Create Escrow"],
    ["[data-read-escrow-button]", "read-escrow", "Loading...", "Load Escrow"],
    ["[data-read-escrow-remaining-button]", "read-escrow-remaining", "Revealing...", "Reveal Remaining"],
    ["[data-create-compliance-button]", "create-compliance-room", "Creating...", "Create Room"],
    ["[data-read-compliance-button]", "read-compliance-room", "Loading...", "Load Room"],
    ["[data-create-checkpoint-button]", "create-analytics-checkpoint", "Anchoring...", "Create Checkpoint"],
    ["[data-read-checkpoint-button]", "read-analytics-checkpoint", "Loading...", "Load Checkpoint"],
    ["[data-read-invoice-exposure-button]", "read-invoice-exposure", "Revealing...", "Reveal Invoice Exposure"],
    ["[data-read-escrow-exposure-button]", "read-escrow-exposure", "Revealing...", "Reveal Escrow Exposure"],
  ];

  buttonStates.forEach(([selector, actionId, busyText, idleText]) => {
    const button = document.querySelector(selector);

    if (!button) {
      return;
    }

    button.disabled = state.busyAction !== "";
    button.textContent = state.busyAction === actionId ? busyText : idleText;
  });

  sendHelper.textContent = state.manifest
    ? `Settlement token: ${getSettlementContext().symbol}. Sync is live for ${getChainMetadata(state.selectedChainId).shortLabel}.`
    : "Manifest is still pending. Sync deployment.json first.";
}

function renderCompanySummary() {
  const summary = document.querySelector("[data-company-summary]");
  const company = state.companySnapshot;

  if (!company?.companyName) {
    summary.innerHTML = `
      <div class="summary-row">
        <span>Status</span>
        <strong>Not registered yet</strong>
      </div>
      <div class="summary-row">
        <span>Signer</span>
        <strong>${escapeHtml(state.runtime.connected ? shortAddress(state.runtime.account) : "Connect wallet")}</strong>
      </div>
    `;
    return;
  }

  summary.innerHTML = `
    <div class="summary-row">
      <span>Status</span>
      <strong>${escapeHtml(company.verified ? "Verified" : "Registered")}</strong>
    </div>
    <div class="summary-row">
      <span>Company</span>
      <strong>${escapeHtml(company.companyName)}</strong>
    </div>
    <div class="summary-row">
      <span>ENS</span>
      <strong>${escapeHtml(company.ensName || "Not set")}</strong>
    </div>
    <div class="summary-row">
      <span>Signers</span>
      <strong>${escapeHtml(String(company.signers?.length || 0))}</strong>
    </div>
  `;
}

function renderPaymentIntentWidget() {
  const container = document.querySelector("[data-payment-intent-widget]");
  
  if (!container) {
    return;
  }

  // Only show on dashboard view
  if (state.activeView !== "dashboard") {
    container.style.display = "none";
    return;
  }

  container.style.display = "block";

  // Mount widget if not already mounted
  if (!container.dataset.mounted) {
    mountPaymentIntentWidget(container, {
      permitHash: "",
      sessionId: "sess_hexapay_ui",
      deviceFingerprintHash: "dev_hexapay_hash",
      currency: "USDC",
      amount: "",
      executorAddress: import.meta.env.VITE_HEXAPAY_EXECUTOR_CONTRACT || "",
      onSuccess: (result) => {
        console.log("Payment executed successfully:", result);
        // Optionally refresh app state or record activity
        recordRecentActivity(
          "Payment executed",
          "Payments",
          {
            hash: result.txHash,
            blockNumber: result.blockNumber,
            explorerUrl: `https://sepolia.arbiscan.io/tx/${result.txHash}`,
            identifiers: {
              requestId: result.requestId,
              challengeId: result.challengeId,
            },
          },
          {
            amountDisplay: "LIVE",
            currency: "PAYMENT",
            direction: "neutral",
            subtitle: `Request ${result.requestId.slice(0, 16)}...`,
          }
        );
        render();
      },
      onError: (error) => {
        console.error("Payment execution failed:", error);
      },
    });
    container.dataset.mounted = "true";
  }
}

function renderPrivateQuoteSummary() {
  const summary = document.querySelector("[data-private-quote-summary]");
  const helper = document.querySelector("[data-private-quote-helper]");
  const storeModeField = document.querySelector("[data-private-quote-store-mode]");
  const switchButton = document.querySelector("[data-private-quote-switch-button]");
  const resultCard = document.querySelector("[data-private-quote-result]");
  const receiptCard = document.querySelector("[data-private-quote-receipt]");
  const auditorReceiptCard = document.querySelector("[data-private-quote-auditor-receipt]");
  const quoteId = document.querySelector("[data-private-quote-id]");
  const paymentLink = document.querySelector("[data-private-quote-link]");
  const openLink = document.querySelector("[data-private-quote-open-link]");
  const receiptQuoteId = document.querySelector("[data-private-quote-receipt-quote-id]");
  const receiptMerchant = document.querySelector("[data-private-quote-receipt-merchant]");
  const receiptPayer = document.querySelector("[data-private-quote-receipt-payer]");
  const receiptStatus = document.querySelector("[data-private-quote-receipt-status]");
  const receiptSettledAt = document.querySelector("[data-private-quote-receipt-settled-at]");
  const receiptTxHash = document.querySelector("[data-private-quote-receipt-tx-hash]");
  const receiptLink = document.querySelector("[data-private-quote-receipt-link]");
  const receiptOpenLink = document.querySelector("[data-private-quote-receipt-open-link]");
  const auditorOpenLink = document.querySelector("[data-private-quote-auditor-open-link]");
  const auditorReceiptQuoteId = document.querySelector("[data-private-quote-auditor-receipt-quote-id]");
  const auditorReceiptMerchant = document.querySelector("[data-private-quote-auditor-receipt-merchant]");
  const auditorReceiptPayer = document.querySelector("[data-private-quote-auditor-receipt-payer]");
  const auditorReceiptStatus = document.querySelector("[data-private-quote-auditor-receipt-status]");
  const auditorReceiptSettledAt = document.querySelector("[data-private-quote-auditor-receipt-settled-at]");
  const auditorReceiptTxHash = document.querySelector("[data-private-quote-auditor-receipt-tx-hash]");
  const auditorReceiptVisibility = document.querySelector("[data-private-quote-auditor-receipt-visibility]");

  if (!summary || !helper || !switchButton || !resultCard || !receiptCard) {
    return;
  }

  const config = state.privateQuoteConfig;
  const latestQuote = state.latestQuote || state.privateQuoteResult;
  const latestReceipt = state.latestReceipt;
  const latestAuditorReceipt = state.latestAuditorReceipt;
  const latestQuoteId = latestQuote?.id || latestReceipt?.quoteId || "";
  const walletChain = state.runtime.connected
    ? getChainMetadata(state.runtime.chainId).shortLabel
    : "Wallet offline";
  const moduleChain = config ? getChainMetadata(config.chainId).shortLabel : "Loading";
  const storeModeLabel = getPrivateQuoteStoreModeLabel(receiptStoreMode);

  if (!config) {
    helper.textContent = "Loading private quote module config...";
  } else if (!state.runtime.connected) {
    helper.textContent = `Connect a wallet first. Private quote module is configured on ${moduleChain}.`;
  } else if (state.runtime.chainId !== config.chainId) {
    helper.textContent = `Wallet is on ${walletChain}. Switch to ${moduleChain} to create a private quote.`;
  } else {
    helper.textContent = `Private quote module ready on ${moduleChain}. Share the generated /pay.html route with the payer.`;
  }

  summary.innerHTML = `
    <div class="summary-row">
      <span>Module chain</span>
      <strong>${escapeHtml(moduleChain)}</strong>
    </div>
    <div class="summary-row">
      <span>Receipt store</span>
      <strong>${escapeHtml(storeModeLabel)}</strong>
    </div>
    <div class="summary-row">
      <span>Contract</span>
      <strong>${escapeHtml(config ? shortAddress(config.address) : "Loading...")}</strong>
    </div>
    <div class="summary-row">
      <span>Wallet</span>
      <strong>${escapeHtml(state.runtime.connected ? `${shortAddress(state.runtime.account)} · ${walletChain}` : "Connect wallet")}</strong>
    </div>
    <div class="summary-row">
      <span>Latest quote</span>
      <strong>${escapeHtml(latestQuoteId ? shortAddress(latestQuoteId, 8, 8) : "No quote created this session")}</strong>
    </div>
  `;

  switchButton.hidden = !config;
  switchButton.disabled =
    state.busyAction !== "" ||
    state.busyCommand === "connect-wallet" ||
    state.busyCommand === "switch-chain" ||
    state.busyCommand === "disconnect-wallet";
  switchButton.textContent =
    state.busyCommand === "switch-private-quote-chain"
      ? "Switching..."
      : `Switch to ${moduleChain}`;

  if (storeModeField) {
    storeModeField.value = receiptStoreMode;
    storeModeField.disabled = state.busyAction !== "" || state.busyCommand !== "";
  }

  resultCard.hidden = !latestQuote;

  if (latestQuote) {
    quoteId.textContent = latestQuote.id;
    paymentLink.textContent = latestQuote.link;
    paymentLink.href = latestQuote.link;
    openLink.href = latestQuote.link;
  }

  receiptCard.hidden = !latestReceipt;
  if (auditorReceiptCard) {
    auditorReceiptCard.hidden = !latestAuditorReceipt;
  }

  if (!latestReceipt) {
    return;
  }

  receiptQuoteId.textContent = latestReceipt.quoteId;
  receiptMerchant.textContent = latestReceipt.merchant || "Not available";
  receiptPayer.textContent = latestReceipt.payer || "Not available";
  receiptStatus.textContent = latestReceipt.status || "Settled";
  receiptSettledAt.textContent = formatPrivateQuoteReceiptTime(latestReceipt.settledAt);
  receiptTxHash.textContent = latestReceipt.txHash || "Not available";

  const receiptViewHref =
    latestReceipt.paymentLink ||
    latestQuote?.link ||
    (latestReceipt.quoteId
      ? `${window.location.origin}/pay.html?id=${encodeURIComponent(latestReceipt.quoteId)}`
      : `${window.location.origin}/pay.html`);

  if (receiptLink) {
    receiptLink.textContent = receiptViewHref;
    receiptLink.href = receiptViewHref;
  }

  if (receiptOpenLink) {
    receiptOpenLink.href = receiptViewHref;
  }

  if (auditorOpenLink) {
    const auditorViewHref = latestReceipt?.quoteId
      ? appendPrivateQuoteStoreMode(
          `${window.location.origin}/audit.html?id=${encodeURIComponent(latestReceipt.quoteId)}`,
          receiptStoreMode,
        ).toString()
      : appendPrivateQuoteStoreMode(`${window.location.origin}/audit.html`, receiptStoreMode).toString();

    auditorOpenLink.href = auditorViewHref;
  }

  if (!auditorReceiptCard) {
    return;
  }

  if (!latestAuditorReceipt) {
    return;
  }

  auditorReceiptQuoteId.textContent = latestAuditorReceipt.quoteId;
  auditorReceiptMerchant.textContent = latestAuditorReceipt.merchant || "Not available";
  auditorReceiptPayer.textContent = latestAuditorReceipt.payer || "Not available";
  auditorReceiptStatus.textContent = latestAuditorReceipt.status || "Settled";
  auditorReceiptSettledAt.textContent = formatPrivateQuoteReceiptTime(latestAuditorReceipt.settledAt);
  auditorReceiptTxHash.textContent = latestAuditorReceipt.txHash || "Not available";
  auditorReceiptVisibility.textContent = latestAuditorReceipt.visibility || "limited";
}

async function syncLatestPrivateQuoteReceipts() {
  try {
    const receipts = await receiptStore.listReceipts(ReceiptRoles.MERCHANT);
    const latestReceiptSummary = receipts[0] || null;
    state.latestReceipt = latestReceiptSummary;

    if (latestReceiptSummary?.quoteId) {
      try {
        const latestReceiptDetail = await receiptStore.getReceiptByQuoteId(
          latestReceiptSummary.quoteId,
          ReceiptRoles.MERCHANT,
        );

        if (latestReceiptDetail) {
          state.latestReceipt = {
            ...latestReceiptSummary,
            ...latestReceiptDetail,
          };
        }
      } catch (error) {
        if (
          !isReceiptAccessDeniedError(error, [
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
          throw error;
        }
      }
    }

    state.latestAuditorReceipt = state.latestReceipt?.quoteId
      ? await receiptStore.getReceiptByQuoteId(state.latestReceipt.quoteId, ReceiptRoles.AUDITOR)
      : null;
  } finally {
    state.allowReceiptGrantSignature = false;
  }
}

async function syncReceiptStoreMode(mode, { syncUrl = true } = {}) {
  receiptStoreMode = setPrivateQuoteStoreMode(mode, { syncUrl });
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
  await syncLatestPrivateQuoteReceipts();
}

function renderInvoiceSummary() {
  const summary = document.querySelector("[data-invoice-summary]");
  const invoice = getInvoiceVisualState();

  if (!invoice) {
    summary.innerHTML = `
      <div class="summary-row">
        <span>Status</span>
        <strong>No invoice selected</strong>
      </div>
      <div class="summary-row">
        <span>Outstanding</span>
        <strong>Reveal to inspect</strong>
      </div>
    `;
    return;
  }

  summary.innerHTML = `
    <div class="summary-row">
      <span>Status</span>
      <strong>${escapeHtml(invoice.visualLabel || invoice.rawStatusLabel || "Pending")}</strong>
    </div>
    <div class="summary-row">
      <span>Invoice</span>
      <strong>${escapeHtml(shortAddress(invoice.invoiceId, 8, 8))}</strong>
    </div>
    <div class="summary-row">
      <span>Payer</span>
      <strong>${escapeHtml(shortAddress(invoice.payer || ""))}</strong>
    </div>
    <div class="summary-row">
      <span>Outstanding</span>
      <strong>${escapeHtml(invoice.formattedOutstanding || "Reveal to inspect")}</strong>
    </div>
    <div class="summary-row">
      <span>Due</span>
      <strong>${escapeHtml(formatTimestamp(invoice.dueAt))}</strong>
    </div>
  `;
}

function renderPolicySummary() {
  const summary = document.querySelector("[data-policy-summary]");
  const policy = getCurrentPolicySnapshot();

  if (!policy) {
    summary.innerHTML = `
      <div class="summary-row">
        <span>Status</span>
        <strong>No company selected</strong>
      </div>
      <div class="summary-row">
        <span>Action</span>
        <strong>Choose a workflow action</strong>
      </div>
    `;
    return;
  }

  summary.innerHTML = `
    <div class="summary-row">
      <span>Status</span>
      <strong>${escapeHtml(policy.active ? "Active" : "Inactive")}</strong>
    </div>
    <div class="summary-row">
      <span>Action</span>
      <strong>${escapeHtml(policy.actionLabel || describePolicyAction(policy.actionType))}</strong>
    </div>
    <div class="summary-row">
      <span>Approvals</span>
      <strong>${escapeHtml(String(policy.minApprovals || "0"))}</strong>
    </div>
    <div class="summary-row">
      <span>TTL</span>
      <strong>${escapeHtml(`${String(policy.approvalTtl || "0")}s`)}</strong>
    </div>
    <div class="summary-row">
      <span>Company</span>
      <strong>${escapeHtml(shortAddress(policy.company || ""))}</strong>
    </div>
  `;
}

function renderEscrowSummary() {
  const summary = document.querySelector("[data-escrow-summary]");
  const escrow = getCurrentEscrowSnapshot();

  if (!escrow) {
    summary.innerHTML = `
      <div class="summary-row">
        <span>Status</span>
        <strong>No escrow selected</strong>
      </div>
      <div class="summary-row">
        <span>Remaining</span>
        <strong>Reveal to inspect</strong>
      </div>
    `;
    return;
  }

  summary.innerHTML = `
    <div class="summary-row">
      <span>Status</span>
      <strong>${escapeHtml(escrow.statusLabel || "Pending")}</strong>
    </div>
    <div class="summary-row">
      <span>Escrow</span>
      <strong>${escapeHtml(shortAddress(escrow.escrowId || "", 8, 8))}</strong>
    </div>
    <div class="summary-row">
      <span>Seller</span>
      <strong>${escapeHtml(shortAddress(escrow.seller || ""))}</strong>
    </div>
    <div class="summary-row">
      <span>Remaining</span>
      <strong>${escapeHtml(escrow.formattedRemaining || "Reveal to inspect")}</strong>
    </div>
    <div class="summary-row">
      <span>Expires</span>
      <strong>${escapeHtml(formatTimestamp(escrow.expiresAt))}</strong>
    </div>
  `;
}

function renderComplianceSummary() {
  const summary = document.querySelector("[data-compliance-summary]");
  const room = getCurrentComplianceSnapshot();

  if (!room) {
    summary.innerHTML = `
      <div class="summary-row">
        <span>Status</span>
        <strong>No room selected</strong>
      </div>
      <div class="summary-row">
        <span>Scopes</span>
        <strong>Read a room to inspect</strong>
      </div>
    `;
    return;
  }

  summary.innerHTML = `
    <div class="summary-row">
      <span>Status</span>
      <strong>${escapeHtml(room.active ? "Active" : "Inactive")}</strong>
    </div>
    <div class="summary-row">
      <span>Room</span>
      <strong>${escapeHtml(shortAddress(room.roomId || "", 8, 8))}</strong>
    </div>
    <div class="summary-row">
      <span>Auditor</span>
      <strong>${escapeHtml(shortAddress(room.auditor || ""))}</strong>
    </div>
    <div class="summary-row">
      <span>Scopes</span>
      <strong>${escapeHtml(formatScopeLabels(room.scopes || room.scopeList || []))}</strong>
    </div>
    <div class="summary-row">
      <span>Expires</span>
      <strong>${escapeHtml(formatTimestamp(room.expiresAt))}</strong>
    </div>
  `;
}

function renderAnalyticsSummary() {
  const summary = document.querySelector("[data-analytics-summary]");
  const checkpoint = getCurrentAnalyticsSnapshot();
  const exposure = getCurrentAnalyticsExposure();

  if (!checkpoint && !exposure) {
    summary.innerHTML = `
      <div class="summary-row">
        <span>Status</span>
        <strong>No checkpoint selected</strong>
      </div>
      <div class="summary-row">
        <span>Exposure</span>
        <strong>Read a company metric</strong>
      </div>
    `;
    return;
  }

  summary.innerHTML = `
    <div class="summary-row">
      <span>Checkpoint</span>
      <strong>${escapeHtml(checkpoint ? shortAddress(checkpoint.checkpointId || "", 8, 8) : "Not loaded")}</strong>
    </div>
    <div class="summary-row">
      <span>Company</span>
      <strong>${escapeHtml(shortAddress(checkpoint?.company || exposure?.company || ""))}</strong>
    </div>
    <div class="summary-row">
      <span>Invoice exposure</span>
      <strong>${escapeHtml(exposure?.formattedInvoiceExposure || "Reveal to inspect")}</strong>
    </div>
    <div class="summary-row">
      <span>Escrow exposure</span>
      <strong>${escapeHtml(exposure?.formattedEscrowExposure || "Reveal to inspect")}</strong>
    </div>
    <div class="summary-row">
      <span>Timestamp</span>
      <strong>${escapeHtml(checkpoint ? formatTimestamp(checkpoint.timestamp) : "Not loaded")}</strong>
    </div>
  `;
}

function renderContractCards() {
  const walletStatus = document.querySelector("[data-wallet-status]");
  const walletChain = document.querySelector("[data-wallet-chain]");
  const walletMeta = document.querySelector("[data-wallet-meta]");
  const walletAddress = document.querySelector("[data-wallet-address]");
  const coreBalance = document.querySelector("[data-core-balance]");
  const coreSymbol = document.querySelector("[data-core-symbol]");
  const coreMeta = document.querySelector("[data-core-meta]");
  const coreAddress = document.querySelector("[data-core-address]");
  const workflowStatus = document.querySelector("[data-workflow-status]");
  const workflowPill = document.querySelector("[data-workflow-pill]");
  const workflowMeta = document.querySelector("[data-workflow-meta]");
  const workflowAddress = document.querySelector("[data-workflow-address]");
  const escrowStatus = document.querySelector("[data-escrow-status]");
  const escrowPill = document.querySelector("[data-escrow-pill]");
  const escrowMeta = document.querySelector("[data-escrow-meta]");
  const escrowAddress = document.querySelector("[data-escrow-address]");
  const complianceStatus = document.querySelector("[data-compliance-status]");
  const compliancePill = document.querySelector("[data-compliance-pill]");
  const complianceMeta = document.querySelector("[data-compliance-meta]");
  const complianceAddress = document.querySelector("[data-compliance-address]");
  const analyticsStatus = document.querySelector("[data-analytics-status]");
  const analyticsPill = document.querySelector("[data-analytics-pill]");
  const analyticsMeta = document.querySelector("[data-analytics-meta]");
  const analyticsAddress = document.querySelector("[data-analytics-address]");

  if (state.runtime.connected) {
    walletStatus.textContent = state.runtime.walletName || "Wallet";
    walletChain.textContent =
      state.runtime.chainId === state.selectedChainId ? "Aligned" : "Mismatch";
    walletMeta.textContent = state.runtime.chainId
      ? `Connected on chain ${state.runtime.chainId}.`
      : "Wallet session is live.";
    walletAddress.textContent = state.runtime.account;
  } else {
    walletStatus.textContent = "Not connected";
    walletChain.textContent = "Offline";
    walletMeta.textContent = "No wallet session active.";
    walletAddress.textContent = "Connect wallet";
  }

  if (state.coreSnapshot) {
    coreBalance.textContent = formatSettlementAmount(state.coreSnapshot.backingBalance || "0");
    coreSymbol.textContent = getSettlementContext().symbol;
    coreMeta.textContent = `Vault ${shortAddress(state.coreSnapshot.vault)} · Fee ${state.coreSnapshot.platformFeeBps} bps`;
    coreAddress.textContent = state.addresses.core;
  } else if (state.manifest) {
    coreBalance.textContent = "Waiting";
    coreSymbol.textContent = getSettlementContext().symbol;
    coreMeta.textContent = "Manifest loaded. Connect an aligned wallet to read core state.";
    coreAddress.textContent = state.addresses.core || "Core unavailable";
  } else {
    coreBalance.textContent = "Manifest pending";
    coreSymbol.textContent = "USDC";
    coreMeta.textContent = "Backing balance and settlement token appear after live reads succeed.";
    coreAddress.textContent = "No core configured";
  }

  const invoice = getInvoiceVisualState();
  const policy = getCurrentPolicySnapshot();
  const escrow = getCurrentEscrowSnapshot();
  const room = getCurrentComplianceSnapshot();
  const checkpoint = getCurrentAnalyticsSnapshot();
  const exposure = getCurrentAnalyticsExposure();

  if (state.activeView === "policy" && policy) {
    workflowStatus.textContent = policy.active ? "Rule active" : "Rule saved";
    workflowPill.textContent = "Policy";
    workflowMeta.textContent = `${policy.actionLabel || describePolicyAction(policy.actionType)} · ${policy.minApprovals || 0} approvals`;
    workflowAddress.textContent = policy.company;
  } else if (invoice) {
    workflowStatus.textContent = invoice.visualLabel || invoice.rawStatusLabel || "Active";
    workflowPill.textContent = "Tracked";
    workflowMeta.textContent = `Outstanding ${invoice.formattedOutstanding || "hidden"} · Due ${formatTimestamp(invoice.dueAt)}`;
    workflowAddress.textContent = invoice.invoiceId;
  } else if (state.manifest) {
    workflowStatus.textContent = "Ready";
    workflowPill.textContent = "Invoices";
    workflowMeta.textContent = "Workflow module loaded. Create or load an invoice to pin it here.";
    workflowAddress.textContent = state.addresses.workflow || "No workflow configured";
  } else {
    workflowStatus.textContent = "Waiting";
    workflowPill.textContent = "Invoices";
    workflowMeta.textContent = "Latest invoice focus and outstanding state will appear here.";
    workflowAddress.textContent = "No workflow configured";
  }

  if (escrow) {
    escrowStatus.textContent = escrow.statusLabel || "Tracked";
    escrowPill.textContent = escrow.fullyFunded ? "Funded" : "Escrow";
    escrowMeta.textContent = `Remaining ${escrow.formattedRemaining || "hidden"} · Seller ${shortAddress(escrow.seller || "")}`;
    escrowAddress.textContent = escrow.escrowId;
  } else if (state.manifest) {
    escrowStatus.textContent = "Ready";
    escrowPill.textContent = "Escrow";
    escrowMeta.textContent = "Escrow module loaded. Create or load an escrow to pin it here.";
    escrowAddress.textContent = state.addresses.escrow || "No escrow configured";
  } else {
    escrowStatus.textContent = "Waiting";
    escrowPill.textContent = "Escrow";
    escrowMeta.textContent = "Latest escrow state and remaining balance will appear here.";
    escrowAddress.textContent = "No escrow configured";
  }

  if (room) {
    complianceStatus.textContent = room.active ? "Room active" : "Room inactive";
    compliancePill.textContent = "Audit";
    complianceMeta.textContent = `${formatScopeLabels(room.scopes || room.scopeList || [])} · Auditor ${shortAddress(room.auditor || "")}`;
    complianceAddress.textContent = room.roomId;
  } else if (state.manifest) {
    complianceStatus.textContent = "Ready";
    compliancePill.textContent = "Audit";
    complianceMeta.textContent = "Compliance module loaded. Create or read a room to pin it here.";
    complianceAddress.textContent = state.addresses.compliance || "No compliance configured";
  } else {
    complianceStatus.textContent = "Waiting";
    compliancePill.textContent = "Audit";
    complianceMeta.textContent = "Scoped rooms, auditors, and policy disclosure will appear here.";
    complianceAddress.textContent = "No compliance configured";
  }

  if (checkpoint || exposure) {
    analyticsStatus.textContent = checkpoint ? "Checkpointed" : "Exposure ready";
    analyticsPill.textContent = checkpoint ? "Checkpoint" : "Exposure";
    analyticsMeta.textContent = checkpoint
      ? `Snapshot ${shortAddress(checkpoint.snapshotHash || "", 6, 6)} · ${formatTimestamp(checkpoint.timestamp)}`
      : `Invoice ${exposure?.formattedInvoiceExposure || "hidden"} · Escrow ${exposure?.formattedEscrowExposure || "hidden"}`;
    analyticsAddress.textContent = checkpoint?.checkpointId || exposure?.company || state.addresses.analytics || "";
  } else if (state.manifest) {
    analyticsStatus.textContent = "Ready";
    analyticsPill.textContent = "Reporting";
    analyticsMeta.textContent = "Analytics module loaded. Anchor or read a checkpoint to pin it here.";
    analyticsAddress.textContent = state.addresses.analytics || "No analytics configured";
  } else {
    analyticsStatus.textContent = "Waiting";
    analyticsPill.textContent = "Reporting";
    analyticsMeta.textContent = "Checkpoint and sealed exposure reads will appear here.";
    analyticsAddress.textContent = "No analytics configured";
  }
}

function renderActivityList() {
  const list = document.querySelector("[data-activity-list]");

  if (!state.recentActivity.length) {
    list.innerHTML = `
      <div class="activity-item activity-item-empty">
        <div class="activity-icon received">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
            <circle cx="8" cy="8" r="6"/>
          </svg>
        </div>
        <div class="activity-details">
          <div class="activity-title">No live confirmations yet</div>
          <div class="activity-meta">
            <span class="activity-time">Sync manifest and send the first action from this app.</span>
          </div>
        </div>
        <div class="activity-amount neutral">
          <span class="amount">Standby</span>
          <span class="currency">LOG</span>
        </div>
      </div>
    `;
    return;
  }

  list.innerHTML = state.recentActivity
    .map((entry) => {
      const canFocusInvoice = Boolean(entry.identifiers?.invoiceId);
      const addressLabel =
        entry.identifiers?.invoiceId || entry.identifiers?.paymentId || entry.hash || "";

      return `
        <div class="activity-item ${canFocusInvoice ? "is-clickable" : ""}" ${
          canFocusInvoice ? `data-select-invoice="${escapeHtml(entry.identifiers.invoiceId)}"` : ""
        }>
          <div class="activity-icon ${escapeHtml(entry.direction || "neutral")}">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
              ${
                entry.direction === "negative"
                  ? '<path d="M14 2L7 9M14 2L9 14L7 9M14 2L2 7L7 9"/>'
                  : entry.direction === "positive"
                    ? '<path d="M2 14L9 7M2 14L2 8L9 7M2 14L8 14L9 7"/>'
                    : '<circle cx="8" cy="8" r="6"/>'
              }
            </svg>
          </div>
          <div class="activity-details">
            <div class="activity-title">${escapeHtml(entry.title)}</div>
            <div class="activity-meta">
              <span class="activity-time">${escapeHtml(formatRelativeTime(entry.confirmedAt))}</span>
              <span class="activity-dot">•</span>
              <span class="activity-address">${escapeHtml(maskTrace(addressLabel))}</span>
            </div>
          </div>
          <div class="activity-amount ${escapeHtml(entry.direction || "neutral")}">
            <span class="amount">${escapeHtml(entry.amountDisplay || "Live")}</span>
            <span class="currency">${escapeHtml(entry.currency || "LOG")}</span>
          </div>
        </div>
      `;
    })
    .join("");
}

function renderViewPanels() {
  document.querySelectorAll("[data-view-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.viewPanel !== state.activeView;
  });
}

function renderNavigationState() {
  const activeHash = `#${state.activeView}`;

  document.querySelectorAll(".nav-item, .bottom-nav-item").forEach((item) => {
    item.classList.toggle("active", item.getAttribute("href") === activeHash);
  });
}

function render() {
  renderToolbar();
  renderBalanceCard();
  renderForms();
  renderCompanySummary();
  renderPaymentIntentWidget();
  renderPrivateQuoteSummary();
  renderInvoiceSummary();
  renderPolicySummary();
  renderEscrowSummary();
  renderComplianceSummary();
  renderAnalyticsSummary();
  renderContractCards();
  renderActivityList();
  renderViewPanels();
  renderNavigationState();
}

async function handleCommand(command) {
  if (command === "connect-wallet") {
    await handleConnectWallet();
    return;
  }

  if (command === "switch-chain") {
    await handleSwitchChain();
    return;
  }

  if (command === "disconnect-wallet") {
    state.busyCommand = "disconnect-wallet";
    render();
    await disconnectWalletSession();
    state.busyCommand = "";
    render();
    return;
  }

  if (command === "sync-manifest") {
    await syncManifest();
    await refreshAppState({ silent: true });
    return;
  }

  if (command === "refresh-app") {
    await refreshAppState();
    return;
  }

  if (command === "toggle-balance") {
    if (state.privateBalance.loaded && state.privateBalance.revealed) {
      hidePrivateBalance();
    } else {
      await handleRevealBalance();
    }
    return;
  }

  if (command === "switch-private-quote-chain") {
    await handleSwitchPrivateQuoteChain();
    return;
  }

  if (command === "copy-private-quote-link") {
    await handleCopyPrivateQuoteLink();
    return;
  }

  if (command === "clear-activity") {
    clearRecentActivity();
    setNotice("Recent activity log cleared for this browser.", "muted");
    render();
  }
}

async function handleAction(action) {
  try {
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

    if (action === "create-private-quote") {
      await handleCreatePrivateQuote();
      return;
    }

    if (action === "set-policy-rule") {
      await handleSetPolicyRule();
      return;
    }

    if (action === "read-policy-rule") {
      await handleReadPolicyRule();
      return;
    }

    if (action === "read-invoice") {
      await handleReadInvoice();
      return;
    }

    if (action === "read-outstanding") {
      await handleReadOutstanding();
      return;
    }

    if (action === "create-escrow") {
      await handleCreateEscrow();
      return;
    }

    if (action === "read-escrow") {
      await handleReadEscrow();
      return;
    }

    if (action === "read-escrow-remaining") {
      await handleReadEscrowRemaining();
      return;
    }

    if (action === "create-compliance-room") {
      await handleCreateComplianceRoom();
      return;
    }

    if (action === "read-compliance-room") {
      await handleReadComplianceRoom();
      return;
    }

    if (action === "create-analytics-checkpoint") {
      await handleCreateAnalyticsCheckpoint();
      return;
    }

    if (action === "read-analytics-checkpoint") {
      await handleReadAnalyticsCheckpoint();
      return;
    }

    if (action === "read-invoice-exposure") {
      await handleReadInvoiceExposure();
      return;
    }

    if (action === "read-escrow-exposure") {
      await handleReadEscrowExposure();
      return;
    }
  } catch (error) {
    setNotice(error?.message || formatTransactionError(error), "bad");
    render();
  }
}

function bindEvents() {
  document.addEventListener("input", (event) => {
    const field = event.target.closest("[data-field]");

    if (!field) {
      return;
    }

    const [group, key] = field.dataset.field.split(".");
    state.forms[group] = {
      ...(state.forms[group] || {}),
      [key]: field.value,
    };
  });

  document.addEventListener("change", async (event) => {
    const storeModeField = event.target.closest("[data-private-quote-store-mode]");

    if (!storeModeField) {
      return;
    }

    await syncReceiptStoreMode(storeModeField.value);
    render();
  });

  document.addEventListener("click", async (event) => {
    const viewTrigger = event.target.closest("[data-view-target]");

    if (viewTrigger) {
      event.preventDefault();
      setActiveView(viewTrigger.dataset.viewTarget);
      render();
      return;
    }

    const anchor = event.target.closest('a[href^="#"]');

    if (anchor) {
      const view = normalizeView(anchor.getAttribute("href"));

      if (APP_VIEWS.has(view)) {
        event.preventDefault();
        setActiveView(view);
        render();
      }
      return;
    }

    const invoiceFocus = event.target.closest("[data-select-invoice]");

    if (invoiceFocus) {
      state.forms.monitorInvoice.invoiceId = invoiceFocus.dataset.selectInvoice;
      setActiveView("invoices");
      render();
      return;
    }

    const commandTrigger = event.target.closest("[data-command]");

    if (commandTrigger) {
      event.preventDefault();
      await handleCommand(commandTrigger.dataset.command);
      return;
    }

    const actionTrigger = event.target.closest("[data-action]");

    if (actionTrigger) {
      event.preventDefault();
      await handleAction(actionTrigger.dataset.action);
    }
  });

  window.addEventListener("hashchange", () => {
    setActiveView(window.location.hash, { updateHash: false, scrollTop: false });
    render();
  });

  window.addEventListener("storage", async (event) => {
    if (event.key === PRIVATE_QUOTE_STORE_MODE_STORAGE_KEY) {
      await syncReceiptStoreMode(getPrivateQuoteStoreMode(), { syncUrl: false });
      render();
      return;
    }

    if (!receiptStoreChangeKey || event.key !== receiptStoreChangeKey) {
      return;
    }

    await syncLatestPrivateQuoteReceipts();
    render();
  });
}

async function bootstrap() {
  state.recentActivity = loadRecentActivity();
  await syncReceiptStoreMode(getPrivateQuoteStoreMode(), { syncUrl: false });
  render();
  bindEvents();
  await bootstrapManifest();
  await syncPrivateQuoteConfig();
  await refreshAppState({ silent: true });
  render();
}

bootstrap();
