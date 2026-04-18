import { formatUnits } from "ethers";
import { CONTRACT_METADATA, CONTRACT_ORDER } from "./contracts/abis.js";
import {
  DEFAULT_CHAIN_ID,
  CHAIN_METADATA,
  getAddressConfig,
  getChainMetadata,
  getLastSelectedChainId,
  loadDeploymentManifest,
  resetAddressConfig,
  saveAddressConfig,
  setLastSelectedChainId,
} from "./contracts/config.js";
import {
  buildEncryptedAmount,
  createRuntime,
  describeEscrowStatus,
  describeInvoiceStatus,
  encodeWritePreview,
  explainFhenixMode,
  formatTransactionError,
  getTransactionErrorDetails,
  getContract,
  getExplorerLink,
  getFhenixState,
  hashText,
  inspectAddressMap,
  isConfiguredAddress,
  normalizeAddress,
  parseAmountToUnits,
  parseTimestamp,
  parseUint,
  readCoreSnapshot,
  readSealedValue,
  readTokenSnapshot,
  sendWrite,
  shortAddress,
  switchWalletChain,
  toDisplayObject,
  parseScopeList,
} from "./contracts/client.js";

const RECENT_ACTIVITY_STORAGE_KEY = "hexapay_recent_activity_v1";

const state = {
  root: null,
  selectedChainId: getLastSelectedChainId(),
  addresses: getAddressConfig(getLastSelectedChainId()),
  runtime: {
    walletAvailable: false,
    provider: null,
    signer: null,
    account: "",
    chainId: "",
    connected: false,
  },
  fhenix: {
    mode: "offline",
    client: null,
    error: "",
  },
  manifest: null,
  inspection: {},
  coreSnapshot: null,
  tokenSnapshot: null,
  busyCommand: "",
  busyAction: "",
  collapsedFeatures: {
    extended: true,
  },
  recentActivity: [],
  invoiceSnapshots: {},
  drafts: {},
  output: {
    tone: "muted",
    title: "HexaPay workspace ready",
    summary: "Connect a wallet or import deployment data to start using the contract surface.",
    data: {
      mode: "pre-deploy",
      supportedModules: CONTRACT_ORDER,
    },
    notes: [
      "Write actions support calldata preview before deployment.",
      "Encrypted actions use browser CoFHE when available and placeholder tuples in preview mode otherwise.",
    ],
  },
};

const FEATURE_SECTIONS = [
  {
    id: "setup",
    kicker: "01 / Setup",
    title: "Workspace Setup",
    description:
      "Prepare the live suite before business operations begin: register company identities, wire settlement approval, and move public funds into the confidential rail.",
    badge: "Live setup",
    tone: "good",
    verified: true,
    highlights: [
      "Company registration on the core rail",
      "Settlement approval to the vault",
      "Private wrap entry into the USDC balance rail",
    ],
    actionIds: [
      "core-register-company",
      "core-read-company",
      "core-approve-token",
      "core-wrap",
    ],
  },
  {
    id: "treasury",
    kicker: "02 / Treasury",
    title: "Confidential Treasury",
    description:
      "Operate the verified private balance layer with browser CoFHE, sealed-handle reads, and encrypted internal transfers.",
    badge: "Verified flow",
    tone: "good",
    verified: true,
    highlights: [
      "Ciphertext read + local decrypt",
      "Formatted private USDC verification output",
      "Encrypted internal payment send",
      "Async unwrap back to Circle USDC testnet",
    ],
    actionIds: [
      "core-read-balance",
      "core-create-payment",
      "core-request-unwrap",
      "core-read-withdrawal",
      "core-complete-unwrap",
    ],
  },
  {
    id: "invoices",
    kicker: "03 / Invoicing",
    title: "Invoice Workflow",
    description:
      "Run the full invoice lifecycle in one lane: issue from the company wallet, approve as payer, settle with encrypted amount, and confirm outstanding reaches zero.",
    badge: "Verified flow",
    tone: "good",
    verified: true,
    highlights: [
      "Create invoice from a registered company",
      "Approve invoice as payer",
      "Pay invoice with encrypted amount",
      "Read invoice metadata and outstanding after settlement",
    ],
    actionIds: [
      "workflow-create-invoice",
      "workflow-approve-invoice",
      "workflow-pay-invoice",
      "workflow-read-invoice",
      "workflow-read-outstanding",
    ],
  },
  {
    id: "extended",
    kicker: "04 / Extended",
    title: "Policy, Escrow, and Reporting",
    description:
      "Keep advanced suite modules available without crowding the proven treasury and invoice paths that are already succeeding in-browser.",
    badge: "Available",
    tone: "muted",
    collapsible: true,
    highlights: [
      "Workflow policy controls",
      "Escrow experiments and sealed remaining reads",
      "Compliance rooms for controlled disclosure",
      "Analytics checkpoints for reporting",
    ],
    actionIds: [
      "workflow-set-policy",
      "escrow-create",
      "escrow-read",
      "escrow-read-remaining",
      "compliance-create-room",
      "compliance-read-room",
      "analytics-checkpoint",
      "analytics-read-checkpoint",
    ],
  },
];

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getDraftValue(actionId, field) {
  const draft = state.drafts[actionId] || {};

  if (draft[field.name] !== undefined) {
    return draft[field.name];
  }

  return field.defaultValue || "";
}

function setOutput(output) {
  state.output = {
    tone: output.tone || "muted",
    title: output.title || "HexaPay update",
    summary: output.summary || "",
    data: output.data ?? {},
    notes: output.notes || [],
  };
}

function loadRecentActivity() {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(RECENT_ACTIVITY_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];

    return Array.isArray(parsed) ? parsed : [];
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

function recordRecentActivity(action, receipt) {
  const entry = {
    hash: receipt.hash,
    title: action.title,
    module: action.section,
    explorerUrl: receipt.explorerUrl || "",
    blockNumber: String(receipt.blockNumber || ""),
    timestamp: new Date().toISOString(),
    identifiers: receipt.identifiers || {},
    eventNames: (receipt.decodedEvents || []).map((event) => event.name),
  };

  state.recentActivity = [entry, ...state.recentActivity.filter((item) => item.hash !== entry.hash)].slice(0, 6);
  saveRecentActivity();
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
}

function getInvoiceSnapshot(invoiceId) {
  if (!invoiceId) {
    return null;
  }

  return state.invoiceSnapshots[String(invoiceId).toLowerCase()] || null;
}

function getInvoiceVisualState(invoiceId, currentData = {}) {
  const snapshot = getInvoiceSnapshot(invoiceId);
  const merged = {
    ...(snapshot || {}),
    ...(currentData || {}),
  };

  if (!merged.invoiceId) {
    return null;
  }

  const rawStatus = merged.status !== undefined ? String(merged.status) : "";
  const rawStatusLabel = merged.statusLabel || (rawStatus ? describeInvoiceStatus(rawStatus) : "");
  const paymentCount = merged.paymentCount !== undefined ? String(merged.paymentCount) : "";
  const clearOutstanding = merged.clearOutstanding !== undefined ? String(merged.clearOutstanding) : "";
  const formattedOutstanding = merged.formattedOutstanding || "";

  let label = rawStatusLabel;
  let tone = rawStatus === "4" ? "is-good" : rawStatus === "3" ? "is-warn" : rawStatus ? "is-muted" : "is-muted";
  let detail = "";

  if (clearOutstanding) {
    if (clearOutstanding === "0") {
      label = "Paid in full";
      tone = "is-good";

      if (rawStatusLabel && rawStatusLabel !== "Paid") {
        detail = `Raw workflow status: ${rawStatusLabel}`;
      }
    } else if (rawStatus === "3") {
      label = "Partially paid";
      tone = "is-warn";

      if (formattedOutstanding) {
        detail = `Outstanding: ${formattedOutstanding}`;
      }
    }
  }

  return {
    paymentCount,
    clearOutstanding,
    formattedOutstanding,
    rawStatus,
    rawStatusLabel,
    label,
    tone,
    detail,
  };
}

function requireConnectedRuntime() {
  if (!state.runtime.connected || !state.runtime.provider) {
    throw new Error("Connect a wallet first.");
  }
}

function requireConfiguredContractAddress(contractKey) {
  const address = state.addresses[contractKey];

  if (!isConfiguredAddress(address)) {
    throw new Error(`${CONTRACT_METADATA[contractKey].shortLabel} address is not configured.`);
  }

  return address;
}

function requireAlignedProvider() {
  requireConnectedRuntime();

  if (state.runtime.chainId !== state.selectedChainId) {
    throw new Error(`Switch wallet to ${getChainMetadata(state.selectedChainId).label} first.`);
  }

  return state.runtime.provider;
}

function renderField(action, field) {
  const value = getDraftValue(action.id, field);
  const shared = [
    `name="${escapeHtml(field.name)}"`,
    `data-action-field="true"`,
    `data-action-id="${escapeHtml(action.id)}"`,
    field.placeholder ? `placeholder="${escapeHtml(field.placeholder)}"` : "",
  ]
    .filter(Boolean)
    .join(" ");

  if (field.type === "textarea") {
    return `
      <label class="hx-field">
        <span>${escapeHtml(field.label)}</span>
        <textarea ${shared} rows="${field.rows || 3}">${escapeHtml(value)}</textarea>
      </label>
    `;
  }

  if (field.type === "select") {
    const options = (field.options || [])
      .map((option) => {
        const selected = String(value) === String(option.value) ? "selected" : "";
        return `<option value="${escapeHtml(option.value)}" ${selected}>${escapeHtml(option.label)}</option>`;
      })
      .join("");

    return `
      <label class="hx-field">
        <span>${escapeHtml(field.label)}</span>
        <select ${shared}>${options}</select>
      </label>
    `;
  }

  return `
    <label class="hx-field">
      <span>${escapeHtml(field.label)}</span>
      <input ${shared} type="${escapeHtml(field.type || "text")}" value="${escapeHtml(value)}">
    </label>
  `;
}

function renderActionCard(action) {
  const busy = state.busyAction === action.id;
  const buttons =
    action.kind === "read"
      ? `
        <button type="button" class="hx-btn hx-btn-primary" data-run-action="${escapeHtml(action.id)}" data-run-mode="read" ${
          busy ? "disabled" : ""
        }>
          ${busy ? "Reading..." : "Run Read"}
        </button>
      `
      : `
        <button type="button" class="hx-btn hx-btn-secondary" data-run-action="${escapeHtml(action.id)}" data-run-mode="preview" ${
          busy ? "disabled" : ""
        }>
          ${busy ? "Working..." : "Preview"}
        </button>
        <button type="button" class="hx-btn hx-btn-primary" data-run-action="${escapeHtml(action.id)}" data-run-mode="send" ${
          busy ? "disabled" : ""
        }>
          ${busy ? "Working..." : "Send"}
        </button>
      `;

  return `
    <article class="hx-action-card">
      <div class="hx-action-head">
        <div>
          <span class="hx-kicker">${escapeHtml(action.section)}</span>
          <h4>${escapeHtml(action.title)}</h4>
        </div>
        <span class="hx-chip">${escapeHtml(action.kind === "read" ? "Read" : "Write")}</span>
      </div>
      <p class="hx-action-copy">${escapeHtml(action.description)}</p>
      <form class="hx-form" data-action-form="${escapeHtml(action.id)}">
        <div class="hx-field-grid">
          ${action.fields.map((field) => renderField(action, field)).join("")}
        </div>
        <div class="hx-action-row">${buttons}</div>
      </form>
    </article>
  `;
}

function renderContractCard(contractKey) {
  const metadata = CONTRACT_METADATA[contractKey];
  const address = state.addresses[contractKey] || "";
  const inspection = state.inspection[contractKey] || {};
  const configured = isConfiguredAddress(address);
  const deploymentLabel = inspection.deployed
    ? "Live"
    : configured && inspection.unknown
      ? "Configured"
      : configured
        ? "Not deployed"
        : "Unset";

  return `
    <article class="hx-registry-card">
      <div class="hx-registry-head">
        <div>
          <h4>${escapeHtml(metadata.shortLabel)}</h4>
          <p>${escapeHtml(metadata.description)}</p>
        </div>
        <span class="hx-pill ${inspection.deployed ? "is-good" : configured ? "is-warn" : "is-muted"}">
          ${escapeHtml(deploymentLabel)}
        </span>
      </div>
      <label class="hx-field">
        <span>${escapeHtml(metadata.label)} address</span>
        <input
          type="text"
          value="${escapeHtml(address)}"
          placeholder="0x..."
          data-address-input="${escapeHtml(contractKey)}"
        >
      </label>
      <div class="hx-registry-foot">
        <span>${escapeHtml(configured ? shortAddress(address) : "No address configured")}</span>
      </div>
    </article>
  `;
}

function renderSnapshotRows(snapshot) {
  if (!snapshot) {
    return `
      <div class="hx-empty">
        Configure a core address and connect a wallet on the selected chain to read live contract data.
      </div>
    `;
  }

  const rows = [
    ["Owner", shortAddress(snapshot.owner)],
    ["Fee collector", shortAddress(snapshot.feeCollector)],
    ["Settlement token", shortAddress(snapshot.settlementToken)],
    ["Vault", shortAddress(snapshot.vault)],
    ["Workflow", shortAddress(snapshot.workflowModule)],
    ["Escrow", shortAddress(snapshot.escrowModule)],
    ["Compliance", shortAddress(snapshot.complianceModule)],
    ["Analytics", shortAddress(snapshot.analyticsModule)],
    ["Platform fee", `${snapshot.platformFeeBps} bps`],
    ["Backing balance", snapshot.backingBalance],
  ];

  return rows
    .map(
      ([label, value]) => `
        <div class="hx-stat-row">
          <span>${escapeHtml(label)}</span>
          <strong>${escapeHtml(value)}</strong>
        </div>
      `,
    )
    .join("");
}

function renderTokenRows(snapshot) {
  if (!snapshot) {
    return `
      <div class="hx-empty">
        Settlement token details appear here after the core contract snapshot is available.
      </div>
    `;
  }

  const rows = [
    ["Token", `${snapshot.symbol} (${snapshot.decimals} decimals)`],
    ["Address", shortAddress(snapshot.tokenAddress)],
    ["Allowance", snapshot.allowanceFormatted],
  ];

  return rows
    .map(
      ([label, value]) => `
        <div class="hx-stat-row">
          <span>${escapeHtml(label)}</span>
          <strong>${escapeHtml(value)}</strong>
        </div>
      `,
    )
    .join("");
}

function formatSettlementAmount(value) {
  const decimals = Number(state.tokenSnapshot?.decimals || 6);
  const symbol = state.tokenSnapshot?.symbol || "USDC";

  try {
    return `${formatUnits(BigInt(value), decimals)} ${symbol}`;
  } catch (error) {
    return `${String(value)} ${symbol}`;
  }
}

function renderStatusCards() {
  const walletTone = state.runtime.connected ? "is-good" : state.runtime.walletAvailable ? "is-warn" : "is-muted";
  const walletLabel = state.runtime.connected
    ? shortAddress(state.runtime.account)
    : state.runtime.walletAvailable
      ? "Wallet detected"
      : "No wallet";
  const chainMatch = state.runtime.connected && state.runtime.chainId === state.selectedChainId;
  const chainTone = state.runtime.connected ? (chainMatch ? "is-good" : "is-warn") : "is-muted";
  const chainLabel = state.runtime.connected
    ? `${getChainMetadata(state.runtime.chainId).shortLabel}${chainMatch ? "" : " mismatch"}`
    : getChainMetadata(state.selectedChainId).shortLabel;
  const fheState = explainFhenixMode(state.fhenix);
  const manifestTone = state.manifest ? "is-good" : "is-muted";
  const manifestLabel = state.manifest ? `${state.manifest.network} manifest` : "No manifest";

  return `
    <div class="hx-status-grid">
      <article class="hx-status-card">
        <span class="hx-pill ${walletTone}">Wallet</span>
        <strong>${escapeHtml(walletLabel)}</strong>
        <p>${escapeHtml(state.runtime.connected ? "Connected for contract reads and writes." : "Required for live reads and sending transactions.")}</p>
      </article>
      <article class="hx-status-card">
        <span class="hx-pill ${chainTone}">Chain</span>
        <strong>${escapeHtml(chainLabel)}</strong>
        <p>${escapeHtml(`Selected target: ${getChainMetadata(state.selectedChainId).label}`)}</p>
      </article>
      <article class="hx-status-card">
        <span class="hx-pill ${fheState.tone === "good" ? "is-good" : fheState.tone === "warn" ? "is-warn" : "is-muted"}">FHE</span>
        <strong>${escapeHtml(fheState.label)}</strong>
        <p>${escapeHtml(fheState.detail)}</p>
      </article>
      <article class="hx-status-card">
        <span class="hx-pill ${manifestTone}">Manifest</span>
        <strong>${escapeHtml(manifestLabel)}</strong>
        <p>${escapeHtml(state.manifest ? `Found deployment for chain ${state.manifest.chainId}.` : "Import deployment.json when contracts are available.")}</p>
      </article>
    </div>
  `;
}

function renderFeatureSummaryDeck() {
  const fheState = explainFhenixMode(state.fhenix);
  const deployedModules = CONTRACT_ORDER.filter((key) => state.inspection[key]?.deployed).length;
  const backingLabel = state.coreSnapshot?.backingBalance
    ? formatSettlementAmount(state.coreSnapshot.backingBalance)
    : "Awaiting live core snapshot";
  const summaryCards = [
    {
      kicker: "Deployment",
      title: state.manifest ? "Manifest synced" : "Manifest pending",
      detail: state.manifest
        ? `${deployedModules}/${CONTRACT_ORDER.length} modules are responding on ${getChainMetadata(state.selectedChainId).shortLabel}.`
        : "Import deployment.json to populate the live suite and registry map.",
      pill: state.manifest ? "Ready" : "Pending",
      tone: state.manifest ? "is-good" : "is-muted",
    },
    {
      kicker: "FHE Runtime",
      title: fheState.label,
      detail: fheState.detail,
      pill: fheState.tone === "good" ? "Online" : fheState.tone === "warn" ? "Fallback" : "Offline",
      tone: fheState.tone === "good" ? "is-good" : fheState.tone === "warn" ? "is-warn" : "is-muted",
    },
    {
      kicker: "Treasury Rail",
      title: "Confidential balance and payment",
      detail: `Backing visibility: ${backingLabel}. Use this lane for wrap, balance reads, and internal transfer settlement.`,
      pill: state.inspection.core?.deployed ? "Live" : "Config",
      tone: state.inspection.core?.deployed ? "is-good" : "is-warn",
    },
    {
      kicker: "Invoice Lane",
      title: "Create, approve, pay, verify",
      detail:
        "Workflow cards are arranged for the end-to-end invoice flow that was just proven on Arbitrum Sepolia.",
      pill: state.inspection.workflow?.deployed ? "Proven" : "Pending",
      tone: state.inspection.workflow?.deployed ? "is-good" : "is-muted",
    },
  ];

  return `
    <div class="hx-proof-grid">
      ${summaryCards
        .map(
          (card) => `
            <article class="hx-proof-card">
              <div class="hx-proof-head">
                <span class="hx-kicker">${escapeHtml(card.kicker)}</span>
                <span class="hx-pill ${card.tone}">${escapeHtml(card.pill)}</span>
              </div>
              <strong>${escapeHtml(card.title)}</strong>
              <p>${escapeHtml(card.detail)}</p>
            </article>
          `,
        )
        .join("")}
    </div>
  `;
}

function renderOutputHighlights() {
  const data = state.output.data || {};
  const invoiceVisualState = data.invoiceId ? getInvoiceVisualState(data.invoiceId, data) : null;
  const cards = [];

  if (data.hash) {
    cards.push({
      label: "Latest tx",
      value: shortAddress(data.hash, 6, 6),
      tone: state.output.tone === "good" ? "is-good" : "is-muted",
    });
  }

  if (data.formattedBalance) {
    cards.push({
      label: "Balance",
      value: data.formattedBalance,
      tone: "is-good",
    });
  }

  if (invoiceVisualState?.label) {
    cards.push({
      label: invoiceVisualState.detail ? "Settlement view" : "Invoice status",
      value: invoiceVisualState.label,
      tone: invoiceVisualState.tone,
      detail: invoiceVisualState.detail,
    });
  }

  if (invoiceVisualState?.paymentCount) {
    cards.push({
      label: "Payments",
      value: invoiceVisualState.paymentCount,
      tone: Number(invoiceVisualState.paymentCount) > 0 ? "is-good" : "is-muted",
    });
  }

  if (invoiceVisualState?.formattedOutstanding) {
    const isZeroOutstanding = invoiceVisualState.clearOutstanding === "0";
    cards.push({
      label: "Outstanding",
      value: invoiceVisualState.formattedOutstanding,
      tone: isZeroOutstanding ? "is-good" : "is-warn",
    });
  }

  if (!cards.length) {
    return "";
  }

  return `
    <div class="hx-output-grid">
      ${cards
        .map(
          (card) => `
            <article class="hx-output-card">
              <span>${escapeHtml(card.label)}</span>
              <strong>${escapeHtml(card.value)}</strong>
              ${card.detail ? `<small>${escapeHtml(card.detail)}</small>` : ""}
              <div class="hx-output-pill ${escapeHtml(card.tone)}"></div>
            </article>
          `,
        )
        .join("")}
    </div>
  `;
}

function renderRecentActivity() {
  if (!state.recentActivity.length) {
    return `
      <div class="hx-empty">
        Successful write actions from this browser session will appear here with explorer links.
      </div>
    `;
  }

  return `
    <div class="hx-activity-list">
      ${state.recentActivity
        .map((entry) => {
          const primaryIdentifier =
            entry.identifiers?.invoiceId ||
            entry.identifiers?.paymentId ||
            entry.identifiers?.escrowId ||
            entry.identifiers?.withdrawalId ||
            entry.identifiers?.roomId ||
            "";

          return `
            <article class="hx-activity-item">
              <div class="hx-activity-head">
                <div>
                  <span class="hx-kicker">${escapeHtml(entry.module)}</span>
                  <strong>${escapeHtml(entry.title)}</strong>
                </div>
                <span class="hx-pill is-good">Confirmed</span>
              </div>
              <div class="hx-activity-meta">
                <span>Tx ${escapeHtml(shortAddress(entry.hash, 6, 6))}</span>
                ${entry.blockNumber ? `<span>Block ${escapeHtml(entry.blockNumber)}</span>` : ""}
              </div>
              ${
                primaryIdentifier
                  ? `<div class="hx-activity-identifier">${escapeHtml(shortAddress(primaryIdentifier, 8, 8))}</div>`
                  : ""
              }
              ${
                entry.explorerUrl
                  ? `<a class="hx-activity-link" href="${escapeHtml(entry.explorerUrl)}" target="_blank" rel="noreferrer">Open in explorer</a>`
                  : ""
              }
            </article>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderSidebar() {
  return `
    <aside class="hx-sidebar">
      <section class="hx-panel">
        <div class="hx-panel-head">
          <div>
            <span class="hx-kicker">Console Output</span>
            <h3>${escapeHtml(state.output.title)}</h3>
          </div>
          <span class="hx-pill ${
            state.output.tone === "good" ? "is-good" : state.output.tone === "warn" ? "is-warn" : state.output.tone === "bad" ? "is-bad" : "is-muted"
          }">${escapeHtml(state.output.tone)}</span>
        </div>
        <p class="hx-panel-copy">${escapeHtml(state.output.summary)}</p>
        ${renderOutputHighlights()}
        <pre class="hx-code-block">${escapeHtml(JSON.stringify(state.output.data, null, 2))}</pre>
        ${
          state.output.notes.length
            ? `
              <div class="hx-note-stack">
                ${state.output.notes
                  .map((note) => `<div class="hx-note-item">${escapeHtml(note)}</div>`)
                  .join("")}
              </div>
            `
            : ""
        }
      </section>
      <section class="hx-panel">
        <div class="hx-panel-head">
          <div>
            <span class="hx-kicker">Workspace</span>
            <h3>Selected environment</h3>
          </div>
        </div>
        <div class="hx-stat-row">
          <span>Chain preset</span>
          <strong>${escapeHtml(getChainMetadata(state.selectedChainId).label)}</strong>
        </div>
        <div class="hx-stat-row">
          <span>Configured modules</span>
          <strong>${CONTRACT_ORDER.filter((key) => isConfiguredAddress(state.addresses[key])).length}/${CONTRACT_ORDER.length}</strong>
        </div>
        <div class="hx-stat-row">
          <span>Deployed modules</span>
          <strong>${CONTRACT_ORDER.filter((key) => state.inspection[key]?.deployed).length}/${CONTRACT_ORDER.length}</strong>
        </div>
        ${
          state.manifest
            ? `
              <div class="hx-stat-row">
                <span>Manifest source</span>
                <strong>${escapeHtml(state.manifest.source)}</strong>
              </div>
            `
            : ""
        }
      </section>
      <section class="hx-panel">
        <div class="hx-panel-head">
          <div>
            <span class="hx-kicker">Verified Flow</span>
            <h3>Recent confirmed transactions</h3>
          </div>
        </div>
        ${renderRecentActivity()}
      </section>
    </aside>
  `;
}

function renderFeatureSections() {
  return FEATURE_SECTIONS.map((feature) => {
    const actions = feature.actionIds
      .map((actionId) => ACTIONS.find((entry) => entry.id === actionId))
      .filter(Boolean);
    const toneClass = feature.tone === "good" ? "is-good" : "is-muted";
    const collapsed = Boolean(feature.collapsible && state.collapsedFeatures[feature.id]);

    return `
      <section class="hx-feature-section ${toneClass}">
        <div class="hx-feature-layout">
          <div class="hx-feature-intro">
            <span class="hx-kicker">${escapeHtml(feature.kicker)}</span>
            <div class="hx-feature-heading">
              <div class="hx-feature-title-stack">
                <h3>${escapeHtml(feature.title)}</h3>
                <div class="hx-feature-badges">
                  <span class="hx-pill ${toneClass}">${escapeHtml(feature.badge)}</span>
                  ${
                    feature.verified
                      ? `<span class="hx-pill is-good">Verified on rollout</span>`
                      : ""
                  }
                </div>
              </div>
              ${
                feature.collapsible
                  ? `
                    <button
                      type="button"
                      class="hx-btn hx-btn-ghost hx-feature-toggle"
                      data-feature-toggle="${escapeHtml(feature.id)}"
                    >
                      ${collapsed ? "Show tools" : "Hide tools"}
                    </button>
                  `
                  : ""
              }
            </div>
            <p class="hx-panel-copy">${escapeHtml(feature.description)}</p>
            <div class="hx-feature-highlights">
              ${feature.highlights
                .map((highlight) => `<span class="hx-feature-highlight">${escapeHtml(highlight)}</span>`)
                .join("")}
            </div>
          </div>
          <div class="hx-action-grid hx-feature-action-grid ${collapsed ? "is-collapsed" : ""}">
            ${actions.map((action) => renderActionCard(action)).join("")}
          </div>
        </div>
      </section>
    `;
  }).join("");
}

function render() {
  const connectBusy = state.busyCommand === "connect";
  const switchBusy = state.busyCommand === "switch";
  const refreshBusy = state.busyCommand === "refresh";
  const importBusy = state.busyCommand === "import";
  const saveBusy = state.busyCommand === "save";
  const resetBusy = state.busyCommand === "reset";

  state.root.innerHTML = `
    <div class="hx-layout">
      <div class="hx-main">
        <section class="hx-panel">
          <div class="hx-topbar">
            <div>
              <span class="hx-kicker">HexaPay Workspace</span>
              <h2>Contract-aware operations console</h2>
              <p class="hx-panel-copy">
                Configure addresses, inspect live module status, preview calldata before deployment, and run encrypted actions when the wallet is ready.
              </p>
            </div>
            <div class="hx-topbar-controls">
              <label class="hx-field hx-field-inline">
                <span>Target chain</span>
                <select data-chain-select="true">
                  ${Object.values(CHAIN_METADATA)
                    .map(
                      (chain) => `
                        <option value="${escapeHtml(chain.chainId)}" ${
                          state.selectedChainId === chain.chainId ? "selected" : ""
                        }>
                          ${escapeHtml(chain.label)}
                        </option>
                      `,
                    )
                    .join("")}
                </select>
              </label>
              <button type="button" class="hx-btn hx-btn-primary" data-command="connect" ${connectBusy ? "disabled" : ""}>
                ${connectBusy ? "Connecting..." : state.runtime.connected ? "Reconnect Wallet" : "Connect Wallet"}
              </button>
              <button type="button" class="hx-btn hx-btn-secondary" data-command="switch" ${switchBusy ? "disabled" : ""}>
                ${switchBusy ? "Switching..." : "Switch Chain"}
              </button>
              <button type="button" class="hx-btn hx-btn-secondary" data-command="import" ${importBusy ? "disabled" : ""}>
                ${importBusy ? "Importing..." : "Import Manifest"}
              </button>
              <button type="button" class="hx-btn hx-btn-ghost" data-command="refresh" ${refreshBusy ? "disabled" : ""}>
                ${refreshBusy ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          </div>
          ${renderStatusCards()}
          ${renderFeatureSummaryDeck()}
        </section>

        <section class="hx-panel">
          <div class="hx-panel-head">
            <div>
              <span class="hx-kicker">Registry</span>
              <h3>Contract address map</h3>
            </div>
            <div class="hx-inline-actions">
              <button type="button" class="hx-btn hx-btn-secondary" data-command="save" ${saveBusy ? "disabled" : ""}>
                ${saveBusy ? "Saving..." : "Save Addresses"}
              </button>
              <button type="button" class="hx-btn hx-btn-ghost" data-command="reset" ${resetBusy ? "disabled" : ""}>
                ${resetBusy ? "Resetting..." : "Reset Chain Config"}
              </button>
            </div>
          </div>
          <div class="hx-registry-grid">
            ${CONTRACT_ORDER.map((contractKey) => renderContractCard(contractKey)).join("")}
          </div>
        </section>

        <div class="hx-snapshot-grid">
          <section class="hx-panel">
            <div class="hx-panel-head">
              <div>
                <span class="hx-kicker">Live Snapshot</span>
                <h3>Core contract</h3>
              </div>
            </div>
            ${renderSnapshotRows(state.coreSnapshot)}
          </section>
          <section class="hx-panel">
            <div class="hx-panel-head">
              <div>
                <span class="hx-kicker">Settlement</span>
                <h3>Backing token</h3>
              </div>
            </div>
            ${renderTokenRows(state.tokenSnapshot)}
          </section>
        </div>

        ${renderFeatureSections()}
      </div>
      ${renderSidebar()}
    </div>
  `;
}

function serializeForm(form) {
  const values = Object.fromEntries(new FormData(form).entries());
  return Object.keys(values).reduce((accumulator, key) => {
    accumulator[key] = typeof values[key] === "string" ? values[key].trim() : values[key];
    return accumulator;
  }, {});
}

function requireAlignedReadRunner() {
  const provider = requireAlignedProvider();

  if (
    state.runtime?.connected &&
    state.runtime.chainId === state.selectedChainId &&
    state.runtime.signer
  ) {
    return state.runtime.signer;
  }

  return provider;
}

async function refreshWorkspaceData({ requestAccounts = false, silent = false } = {}) {
  if (!silent) {
    state.busyCommand = requestAccounts ? "connect" : "refresh";
    render();
  }

  try {
    const runtime = await createRuntime({ requestAccounts });
    const alignedProvider =
      runtime.connected && runtime.chainId === state.selectedChainId ? runtime.provider : null;
    const fhenix = alignedProvider
      ? await getFhenixState(runtime)
      : { mode: "offline", client: null, permitHash: "", error: "" };
    const inspection = await inspectAddressMap(alignedProvider, state.addresses);

    let coreSnapshot = null;
    let tokenSnapshot = null;

    if (alignedProvider && inspection.core?.deployed) {
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

    state.runtime = runtime;
    state.fhenix = fhenix;
    state.inspection = inspection;
    state.coreSnapshot = coreSnapshot;
    state.tokenSnapshot = tokenSnapshot;
  } catch (error) {
    setOutput({
      tone: "bad",
      title: "Failed to refresh workspace",
      summary: formatTransactionError(error),
      data: {
        selectedChainId: state.selectedChainId,
      },
    });
  } finally {
    state.busyCommand = "";
    render();
  }
}

async function importManifest() {
  state.busyCommand = "import";
  render();

  try {
    const manifest = await loadDeploymentManifest();

    if (!manifest) {
      throw new Error("No deployment.json was found for this app.");
    }

    state.manifest = manifest;
    state.selectedChainId = String(manifest.chainId || DEFAULT_CHAIN_ID);
    setLastSelectedChainId(state.selectedChainId);
    state.addresses = {
      ...getAddressConfig(state.selectedChainId),
      ...manifest.addresses,
    };
    saveAddressConfig(state.selectedChainId, state.addresses);

    setOutput({
      tone: "good",
      title: "Manifest imported",
      summary: "HexaPay addresses were loaded into the selected chain config.",
      data: manifest,
    });

    await refreshWorkspaceData({ silent: true });
  } catch (error) {
    setOutput({
      tone: "bad",
      title: "Manifest import failed",
      summary: formatTransactionError(error),
      data: {},
    });
  } finally {
    state.busyCommand = "";
    render();
  }
}

async function runAction(actionId, mode, form) {
  const action = ACTIONS.find((entry) => entry.id === actionId);

  if (!action) {
    return;
  }

  const values = serializeForm(form);
  let prepared;
  state.drafts[actionId] = values;
  state.busyAction = actionId;
  render();

  try {
    prepared = await action.prepare(values);

    if (action.kind === "write") {
      if (mode === "preview") {
        const calldata = await encodeWritePreview(prepared.contractKey, prepared.functionName, prepared.args);

        setOutput({
          tone: "good",
          title: `${action.title} preview`,
          summary: prepared.placeholder
            ? "Calldata prepared using placeholder encrypted tuples for pre-deploy review."
            : "Calldata prepared from the current browser inputs.",
          data: {
            module: action.section,
            contract: prepared.contractKey,
            functionName: prepared.functionName,
            targetAddress: prepared.address || "Not configured",
            calldata,
            args: toDisplayObject(prepared.args),
          },
          notes: prepared.notes || [],
        });
      } else {
        requireConnectedRuntime();
        const address = prepared.address;

        if (!address) {
          throw new Error("Target contract address is not configured.");
        }

        if (prepared.placeholder) {
          throw new Error("Encrypted payload is still in preview mode. Connect a wallet on Arbitrum Sepolia to generate a live CoFHE input first.");
        }

        setOutput({
          tone: "warn",
          title: `${action.title} pending`,
          summary: "Waiting for wallet confirmation and transaction submission.",
          data: {
            mode,
            module: action.section,
            contract: prepared.contractKey,
            functionName: prepared.functionName,
            targetAddress: address,
          },
          notes: prepared.notes || [],
        });
        render();

        const receipt = await sendWrite(
          state.runtime,
          prepared.contractKey,
          address,
          prepared.functionName,
          prepared.args,
        );
        const explorerUrl = getExplorerLink(state.selectedChainId, receipt.hash);
        const enrichedReceipt = {
          ...receipt,
          explorerUrl,
        };
        recordRecentActivity(action, enrichedReceipt);

        setOutput({
          tone: "good",
          title: `${action.title} submitted`,
          summary: "Transaction confirmed by the connected wallet.",
          data: {
            module: action.section,
            hash: enrichedReceipt.hash,
            blockNumber: enrichedReceipt.blockNumber,
            status: enrichedReceipt.status,
            explorerUrl,
            ...enrichedReceipt.identifiers,
            ...(enrichedReceipt.decodedEvents?.length ? { events: enrichedReceipt.decodedEvents } : {}),
          },
          notes: explorerUrl ? ["Explorer link returned for the selected chain preset."] : [],
        });

        await refreshWorkspaceData({ silent: true });
      }
    } else {
      const result = await action.read(prepared);

      setOutput({
        tone: "good",
        title: action.title,
        summary: result.summary || "Read completed successfully.",
        data: result.data,
        notes: result.notes || [],
      });
    }
  } catch (error) {
    const contractKey = prepared?.contractKey || "";

    setOutput({
      tone: "bad",
      title: `${action.title} failed`,
      summary: formatTransactionError(error, contractKey),
      data: {
        mode,
        module: action.section,
        ...(contractKey ? { contract: contractKey } : {}),
        ...getTransactionErrorDetails(error, contractKey),
      },
    });
  } finally {
    state.busyAction = "";
    render();
  }
}

async function handleCommand(command) {
  if (command === "connect") {
    await refreshWorkspaceData({ requestAccounts: true });
    return;
  }

  if (command === "switch") {
    state.busyCommand = "switch";
    render();

    try {
      await switchWalletChain(state.selectedChainId);
      await refreshWorkspaceData({ silent: true });
      setOutput({
        tone: "good",
        title: "Chain switched",
        summary: `Wallet switched to ${getChainMetadata(state.selectedChainId).label}.`,
        data: {
          chainId: state.selectedChainId,
        },
      });
    } catch (error) {
      setOutput({
        tone: "bad",
        title: "Switch chain failed",
        summary: formatTransactionError(error),
        data: {
          targetChainId: state.selectedChainId,
        },
      });
    } finally {
      state.busyCommand = "";
      render();
    }

    return;
  }

  if (command === "refresh") {
    await refreshWorkspaceData();
    return;
  }

  if (command === "import") {
    await importManifest();
    return;
  }

  if (command === "save") {
    state.busyCommand = "save";
    render();
    saveAddressConfig(state.selectedChainId, state.addresses);
    setOutput({
      tone: "good",
      title: "Address config saved",
      summary: `Saved contract addresses for ${getChainMetadata(state.selectedChainId).label}.`,
      data: state.addresses,
    });
    state.busyCommand = "";
    await refreshWorkspaceData({ silent: true });
    render();
    return;
  }

  if (command === "reset") {
    state.busyCommand = "reset";
    render();
    state.addresses = resetAddressConfig(state.selectedChainId);
    setOutput({
      tone: "warn",
      title: "Chain config reset",
      summary: "Stored addresses for the selected chain were cleared and replaced with env defaults.",
      data: state.addresses,
    });
    state.busyCommand = "";
    await refreshWorkspaceData({ silent: true });
    render();
  }
}

function bindEvents() {
  state.root.addEventListener("click", async (event) => {
    const featureToggle = event.target.closest("[data-feature-toggle]");

    if (featureToggle) {
      const featureId = featureToggle.dataset.featureToggle;
      state.collapsedFeatures[featureId] = !state.collapsedFeatures[featureId];
      render();
      return;
    }

    const commandTrigger = event.target.closest("[data-command]");

    if (commandTrigger) {
      const command = commandTrigger.dataset.command;
      await handleCommand(command);
      return;
    }

    const actionTrigger = event.target.closest("[data-run-action]");

    if (actionTrigger) {
      const actionId = actionTrigger.dataset.runAction;
      const mode = actionTrigger.dataset.runMode;
      const form = state.root.querySelector(`[data-action-form="${actionId}"]`);

      if (form) {
        await runAction(actionId, mode, form);
      }
    }
  });

  state.root.addEventListener("input", (event) => {
    const addressInput = event.target.closest("[data-address-input]");

    if (addressInput) {
      const key = addressInput.dataset.addressInput;
      state.addresses[key] = addressInput.value.trim();
      return;
    }

    const actionField = event.target.closest("[data-action-field]");

    if (actionField) {
      const actionId = actionField.dataset.actionId;
      state.drafts[actionId] = {
        ...(state.drafts[actionId] || {}),
        [actionField.name]: actionField.value,
      };
    }
  });

  state.root.addEventListener("change", async (event) => {
    const select = event.target.closest("[data-chain-select]");

    if (!select) {
      return;
    }

    state.selectedChainId = select.value;
    setLastSelectedChainId(state.selectedChainId);
    state.addresses = getAddressConfig(state.selectedChainId);
    await refreshWorkspaceData({ silent: true });
    render();
  });

  if (typeof window !== "undefined" && window.ethereum) {
    window.ethereum.on?.("accountsChanged", async () => {
      await refreshWorkspaceData({ silent: true });
    });

    window.ethereum.on?.("chainChanged", async () => {
      await refreshWorkspaceData({ silent: true });
    });
  }
}

async function bootstrapManifest() {
  const manifest = await loadDeploymentManifest();

  if (!manifest) {
    return;
  }

  state.manifest = manifest;

  const hasConfiguredAddresses = CONTRACT_ORDER.some((key) => isConfiguredAddress(state.addresses[key]));

  if (!hasConfiguredAddresses) {
    state.selectedChainId = String(manifest.chainId || DEFAULT_CHAIN_ID);
    setLastSelectedChainId(state.selectedChainId);
    state.addresses = {
      ...getAddressConfig(state.selectedChainId),
      ...manifest.addresses,
    };
    saveAddressConfig(state.selectedChainId, state.addresses);
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

const ACTIONS = [
  {
    id: "core-approve-token",
    section: "Core",
    kind: "write",
    title: "Approve settlement token",
    description: "Approve the HexaPay vault to spend settlement tokens before wrapping them privately.",
    fields: [{ name: "amount", label: "Amount", placeholder: "100" }],
    async prepare(values) {
      const settlement = getSettlementContext();

      if (!settlement.tokenAddress || !settlement.vaultAddress) {
        throw new Error("Settlement token and vault addresses are not available yet. Refresh the live snapshot first.");
      }

      return {
        contractKey: "token",
        functionName: "approve",
        address: settlement.tokenAddress,
        args: [settlement.vaultAddress, parseAmountToUnits(values.amount, settlement.decimals)],
        notes: [
          `${settlement.symbol} uses ${settlement.decimals} decimals.`,
          `Spender: ${settlement.vaultAddress}`,
        ],
      };
    },
  },
  {
    id: "core-register-company",
    section: "Core",
    kind: "write",
    title: "Register company",
    description: "Create or update the shared company identity on the HexaPay core rail.",
    fields: [
      { name: "companyName", label: "Company name", placeholder: "Acme Treasury" },
      { name: "ensName", label: "ENS / alias", placeholder: "acme.eth" },
      { name: "companyId", label: "Company id", placeholder: "ACME-001" },
    ],
    async prepare(values) {
      const address = state.addresses.core || "";
      return {
        contractKey: "core",
        functionName: "registerCompany",
        address,
        args: [
          values.companyName,
          values.ensName,
          hashText(values.companyId, values.companyName),
        ],
        notes: ["Company id is hashed if the provided value is not already a 32-byte hash."],
      };
    },
  },
  {
    id: "core-wrap",
    section: "Core",
    kind: "write",
    title: "Wrap settlement balance",
    description: "Prepare or execute the base wrap flow into the confidential balance rail.",
    fields: [{ name: "amount", label: "Amount", placeholder: "1000" }],
    async prepare(values) {
      const settlement = getSettlementContext();
      return {
        contractKey: "core",
        functionName: "wrap",
        address: state.addresses.core || "",
        args: [parseAmountToUnits(values.amount, settlement.decimals)],
        notes: [
          `${settlement.symbol} uses ${settlement.decimals} decimals.`,
          "Live execution still requires settlement token approval to the HexaPay vault.",
        ],
      };
    },
  },
  {
    id: "core-request-unwrap",
    section: "Core",
    kind: "write",
    title: "Request unwrap",
    description: "Start the async unwrap flow from the private rail back into Circle USDC testnet.",
    fields: [{ name: "amount", label: "Amount", placeholder: "25" }],
    async prepare(values) {
      const settlement = getSettlementContext();
      const encrypted = await buildEncryptedAmount(state.fhenix, values.amount, {
        allowPlaceholder: true,
      });

      return {
        contractKey: "core",
        functionName: "unwrap",
        address: state.addresses.core || "",
        args: [encrypted.payload],
        placeholder: encrypted.placeholder,
        notes: [
          `${settlement.symbol} uses ${settlement.decimals} decimals.`,
          "unwrap() now creates an async withdrawal request. Complete it after the decrypt result is ready.",
        ],
      };
    },
  },
  {
    id: "core-read-withdrawal",
    section: "Core",
    kind: "read",
    title: "Read withdrawal",
    description: "Inspect whether an async unwrap request is ready to complete.",
    fields: [{ name: "withdrawalId", label: "Withdrawal id", placeholder: "0xWithdrawalId" }],
    async prepare(values) {
      const address = requireConfiguredContractAddress("core");
      return {
        address,
        withdrawalId: values.withdrawalId,
      };
    },
    async read(prepared) {
      const contract = getContract("core", prepared.address, requireAlignedReadRunner());
      const withdrawal = await contract.getWithdrawal(prepared.withdrawalId);

      return {
        summary: "Withdrawal status loaded from the core contract.",
        data: toDisplayObject(withdrawal),
        notes: [
          withdrawal.ready
            ? "The async decrypt result is ready. You can call completeUnwrap next."
            : "The decrypt result is still pending. Retry after a short delay.",
        ],
      };
    },
  },
  {
    id: "core-complete-unwrap",
    section: "Core",
    kind: "write",
    title: "Complete unwrap",
    description: "Finalize an async unwrap request once the decrypt result is ready.",
    fields: [{ name: "withdrawalId", label: "Withdrawal id", placeholder: "0xWithdrawalId" }],
    async prepare(values) {
      return {
        contractKey: "core",
        functionName: "completeUnwrap",
        address: state.addresses.core || "",
        args: [values.withdrawalId],
        notes: [
          "This final step releases public USDC from the HexaPay vault back to the connected wallet.",
        ],
      };
    },
  },
  {
    id: "core-create-payment",
    section: "Core",
    kind: "write",
    title: "Create confidential payment",
    description: "Send an encrypted internal payment to another business account.",
    fields: [
      { name: "recipient", label: "Recipient", placeholder: "0xRecipient" },
      { name: "amount", label: "Encrypted amount", placeholder: "2500" },
      { name: "referenceHash", label: "Reference", placeholder: "INV-2026-001" },
    ],
    async prepare(values) {
      const recipient = normalizeAddress(values.recipient);

      if (!recipient) {
        throw new Error("Recipient address is invalid.");
      }

      const encrypted = await buildEncryptedAmount(state.fhenix, values.amount, {
        allowPlaceholder: true,
      });

      return {
        contractKey: "core",
        functionName: "createPayment",
        address: state.addresses.core || "",
        args: [recipient, encrypted.payload, hashText(values.referenceHash, `${recipient}:${values.amount}`)],
        placeholder: encrypted.placeholder,
        notes: encrypted.placeholder
          ? ["Preview is using a placeholder encrypted tuple because the CoFHE client is not initialized."]
          : ["Encrypted amount was produced in-browser using the connected CoFHE client."],
      };
    },
  },
  {
    id: "core-read-balance",
    section: "Core",
    kind: "read",
    title: "Read my balance",
    description: "Fetch your balance handle from the core rail and decrypt it locally in the browser.",
    fields: [],
    async prepare() {
      const address = requireConfiguredContractAddress("core");
      requireAlignedProvider();
      return { address };
    },
    async read(prepared) {
      const response = await readSealedValue(
        state.runtime,
        state.fhenix,
        "core",
        prepared.address,
        "getSealedBalance",
        [],
      );

      return {
        summary: "Private balance handle was read from the core contract and decrypted locally.",
        data: {
          account: state.runtime.account,
          sealedBalance: response.sealedValue,
          clearBalance: response.clearValue.toString(),
          formattedBalance: formatSettlementAmount(response.clearValue),
          publicKey: response.publicKey,
        },
        notes: ["CoFHE keeps the active permit client-side and uses it only for local decrypts."],
      };
    },
  },
  {
    id: "core-read-company",
    section: "Core",
    kind: "read",
    title: "Read company profile",
    description: "Inspect company identity, ENS alias, and signer set from the core registry.",
    fields: [{ name: "company", label: "Company address", placeholder: "0xCompany" }],
    async prepare(values) {
      const runner = requireAlignedReadRunner();
      const company = normalizeAddress(values.company);

      if (!company) {
        throw new Error("Company address is invalid.");
      }

      return {
        runner,
        address: requireConfiguredContractAddress("core"),
        args: [company],
      };
    },
    async read(prepared) {
      const contract = getContract("core", prepared.address, prepared.runner);
      const result = await contract.getCompany(...prepared.args);

      return {
        summary: "Company profile returned from the core contract.",
        data: toDisplayObject(result),
      };
    },
  },
  {
    id: "workflow-create-invoice",
    section: "Workflow",
    kind: "write",
    title: "Create invoice",
    description: "Issue a confidential invoice in the workflow module.",
    fields: [
      { name: "company", label: "Company", placeholder: "0xCompany" },
      { name: "payer", label: "Payer", placeholder: "0xPayer" },
      { name: "amount", label: "Encrypted total", placeholder: "5000" },
      { name: "metadataHash", label: "Metadata reference", placeholder: "invoice-jan-2026" },
      { name: "dueAt", label: "Due at", type: "datetime-local" },
    ],
    async prepare(values) {
      const company = normalizeAddress(values.company);
      const payer = normalizeAddress(values.payer);

      if (!company || !payer) {
        throw new Error("Company and payer addresses must be valid.");
      }

      const encrypted = await buildEncryptedAmount(state.fhenix, values.amount, {
        allowPlaceholder: true,
      });

      return {
        contractKey: "workflow",
        functionName: "createInvoice",
        address: state.addresses.workflow || "",
        args: [
          company,
          payer,
          encrypted.payload,
          hashText(values.metadataHash, `${company}:${payer}`),
          parseTimestamp(values.dueAt || "", "Invoice due date"),
        ],
        placeholder: encrypted.placeholder,
      };
    },
  },
  {
    id: "workflow-approve-invoice",
    section: "Workflow",
    kind: "write",
    title: "Approve invoice",
    description: "Approve a pending invoice as the designated payer.",
    fields: [{ name: "invoiceId", label: "On-chain invoice id", placeholder: "0xInvoiceId" }],
    async prepare(values) {
      return {
        contractKey: "workflow",
        functionName: "approveInvoice",
        address: state.addresses.workflow || "",
        args: [hashText(values.invoiceId)],
      };
    },
  },
  {
    id: "workflow-pay-invoice",
    section: "Workflow",
    kind: "write",
    title: "Pay invoice",
    description: "Settle an approved invoice with an encrypted payment amount.",
    fields: [
      { name: "invoiceId", label: "On-chain invoice id", placeholder: "0xInvoiceId" },
      { name: "amount", label: "Encrypted amount", placeholder: "1000000000000000" },
    ],
    async prepare(values) {
      const encrypted = await buildEncryptedAmount(state.fhenix, values.amount, {
        allowPlaceholder: true,
      });

      return {
        contractKey: "workflow",
        functionName: "payInvoice",
        address: state.addresses.workflow || "",
        args: [hashText(values.invoiceId), encrypted.payload],
        placeholder: encrypted.placeholder,
        notes: encrypted.placeholder
          ? ["Preview is using a placeholder encrypted tuple because the CoFHE client is not initialized."]
          : ["Encrypted invoice payment amount was produced in-browser using the connected CoFHE client."],
      };
    },
  },
  {
    id: "workflow-set-policy",
    section: "Workflow",
    kind: "write",
    title: "Set policy rule",
    description: "Configure treasury approval rules for invoice, payroll, or cancellation actions.",
    fields: [
      { name: "company", label: "Company", placeholder: "0xCompany" },
      {
        name: "actionType",
        label: "Action type",
        type: "select",
        defaultValue: "0",
        options: [
          { value: "0", label: "Invoice payment" },
          { value: "1", label: "Payroll execution" },
          { value: "2", label: "Invoice cancellation" },
        ],
      },
      { name: "minApprovals", label: "Minimum approvals", type: "number", placeholder: "2" },
      { name: "approvalTtl", label: "Approval TTL (seconds)", type: "number", placeholder: "86400" },
      {
        name: "active",
        label: "Rule status",
        type: "select",
        defaultValue: "true",
        options: [
          { value: "true", label: "Active" },
          { value: "false", label: "Inactive" },
        ],
      },
    ],
    async prepare(values) {
      const company = normalizeAddress(values.company);

      if (!company) {
        throw new Error("Company address is invalid.");
      }

      return {
        contractKey: "workflow",
        functionName: "setPolicyRule",
        address: state.addresses.workflow || "",
        args: [
          company,
          Number(values.actionType),
          Number(parseUint(values.minApprovals, "Minimum approvals")),
          parseTimestamp(values.approvalTtl, "Approval TTL"),
          values.active === "true",
        ],
      };
    },
  },
  {
    id: "workflow-read-invoice",
    section: "Workflow",
    kind: "read",
    title: "Read invoice",
    description: "Inspect invoice metadata, due date, and current workflow status using the on-chain invoice id.",
    fields: [{ name: "invoiceId", label: "On-chain invoice id", placeholder: "0xInvoiceId" }],
    async prepare(values) {
      return {
        contractKey: "workflow",
        runner: requireAlignedReadRunner(),
        address: requireConfiguredContractAddress("workflow"),
        args: [hashText(values.invoiceId)],
      };
    },
    async read(prepared) {
      const contract = getContract("workflow", prepared.address, prepared.runner);
      const invoice = await contract.getInvoice(...prepared.args);
      const data = {
        invoiceId: prepared.args[0],
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

      upsertInvoiceSnapshot(prepared.args[0], data);

      return {
        summary: "Invoice metadata returned from the workflow module.",
        data,
        notes: ["Use invoiceId for follow-up reads and payments. metadataHash is a different field."],
      };
    },
  },
  {
    id: "workflow-read-outstanding",
    section: "Workflow",
    kind: "read",
    title: "Read sealed invoice outstanding",
    description: "Fetch the encrypted outstanding balance and decrypt it locally in-browser.",
    fields: [{ name: "invoiceId", label: "On-chain invoice id", placeholder: "0xInvoiceId" }],
    async prepare(values) {
      requireAlignedProvider();
      return {
        contractKey: "workflow",
        address: requireConfiguredContractAddress("workflow"),
        args: [hashText(values.invoiceId)],
      };
    },
    async read(prepared) {
      const response = await readSealedValue(
        state.runtime,
        state.fhenix,
        "workflow",
        prepared.address,
        "getSealedInvoiceOutstanding",
        prepared.args,
      );
      const data = {
        invoiceId: prepared.args[0],
        sealedOutstanding: response.sealedValue,
        clearOutstanding: response.clearValue.toString(),
        formattedOutstanding: formatSettlementAmount(response.clearValue),
        publicKey: response.publicKey,
      };

      upsertInvoiceSnapshot(prepared.args[0], data);

      return {
        summary: "Encrypted invoice outstanding amount was decrypted locally.",
        data,
      };
    },
  },
  {
    id: "escrow-create",
    section: "Escrow",
    kind: "write",
    title: "Create escrow",
    description: "Open a private buyer-seller escrow with an encrypted total commitment.",
    fields: [
      { name: "seller", label: "Seller", placeholder: "0xSeller" },
      { name: "arbiter", label: "Arbiter", placeholder: "0xArbiter" },
      { name: "amount", label: "Encrypted total", placeholder: "12000" },
      { name: "metadataHash", label: "Metadata reference", placeholder: "msa-2026-escrow" },
      { name: "expiresAt", label: "Expires at", type: "datetime-local" },
    ],
    async prepare(values) {
      const seller = normalizeAddress(values.seller);
      const arbiter = normalizeAddress(values.arbiter);

      if (!seller || !arbiter) {
        throw new Error("Seller and arbiter addresses must be valid.");
      }

      const encrypted = await buildEncryptedAmount(state.fhenix, values.amount, {
        allowPlaceholder: true,
      });

      return {
        contractKey: "escrow",
        functionName: "createEscrow",
        address: state.addresses.escrow || "",
        args: [
          seller,
          arbiter,
          encrypted.payload,
          hashText(values.metadataHash, `${seller}:${arbiter}`),
          parseTimestamp(values.expiresAt || "", "Escrow expiration"),
        ],
        placeholder: encrypted.placeholder,
      };
    },
  },
  {
    id: "escrow-read",
    section: "Escrow",
    kind: "read",
    title: "Read escrow",
    description: "Inspect public escrow metadata and current dispute or release status.",
    fields: [{ name: "escrowId", label: "Escrow id", placeholder: "ESCROW-2026-001" }],
    async prepare(values) {
      return {
        runner: requireAlignedReadRunner(),
        address: requireConfiguredContractAddress("escrow"),
        args: [hashText(values.escrowId)],
      };
    },
    async read(prepared) {
      const contract = getContract("escrow", prepared.address, prepared.runner);
      const escrow = await contract.getEscrow(...prepared.args);
      const formatted = toDisplayObject(escrow);
      formatted.statusLabel = describeEscrowStatus(escrow.status);

      return {
        summary: "Escrow metadata returned from the escrow module.",
        data: formatted,
      };
    },
  },
  {
    id: "escrow-read-remaining",
    section: "Escrow",
    kind: "read",
    title: "Read sealed remaining balance",
    description: "Fetch and locally decrypt the private remaining amount in escrow.",
    fields: [{ name: "escrowId", label: "Escrow id", placeholder: "ESCROW-2026-001" }],
    async prepare(values) {
      requireAlignedProvider();
      return {
        address: requireConfiguredContractAddress("escrow"),
        args: [hashText(values.escrowId)],
      };
    },
    async read(prepared) {
      const response = await readSealedValue(
        state.runtime,
        state.fhenix,
        "escrow",
        prepared.address,
        "getSealedEscrowRemaining",
        prepared.args,
      );

      return {
        summary: "Remaining escrow balance was decrypted locally for the connected user.",
        data: {
          escrowId: prepared.args[0],
          sealedRemaining: response.sealedValue,
          clearRemaining: response.clearValue.toString(),
          formattedRemaining: formatSettlementAmount(response.clearValue),
          publicKey: response.publicKey,
        },
      };
    },
  },
  {
    id: "compliance-create-room",
    section: "Compliance",
    kind: "write",
    title: "Create compliance room",
    description: "Open a scoped compliance workspace for a subject and auditor.",
    fields: [
      { name: "subject", label: "Subject", placeholder: "0xSubject" },
      { name: "auditor", label: "Auditor", placeholder: "0xAuditor" },
      { name: "scopes", label: "Scopes", placeholder: "0,2,5" },
      { name: "duration", label: "Duration (seconds)", type: "number", placeholder: "604800" },
      { name: "policyHash", label: "Policy reference", placeholder: "audit-policy-v1" },
    ],
    async prepare(values) {
      const subject = normalizeAddress(values.subject);
      const auditor = normalizeAddress(values.auditor);

      if (!subject || !auditor) {
        throw new Error("Subject and auditor addresses must be valid.");
      }

      return {
        contractKey: "compliance",
        functionName: "createComplianceRoom",
        address: state.addresses.compliance || "",
        args: [
          subject,
          auditor,
          parseScopeList(values.scopes),
          parseTimestamp(values.duration, "Compliance duration"),
          hashText(values.policyHash, `${subject}:${auditor}`),
        ],
      };
    },
  },
  {
    id: "compliance-read-room",
    section: "Compliance",
    kind: "read",
    title: "Read compliance room",
    description: "Inspect room lifetime, policy hash, and active state.",
    fields: [{ name: "roomId", label: "Room id", placeholder: "ROOM-2026-001" }],
    async prepare(values) {
      return {
        runner: requireAlignedReadRunner(),
        address: requireConfiguredContractAddress("compliance"),
        args: [hashText(values.roomId)],
      };
    },
    async read(prepared) {
      const contract = getContract("compliance", prepared.address, prepared.runner);
      const room = await contract.getComplianceRoom(...prepared.args);

      return {
        summary: "Compliance room returned from the compliance module.",
        data: toDisplayObject(room),
      };
    },
  },
  {
    id: "analytics-checkpoint",
    section: "Analytics",
    kind: "write",
    title: "Checkpoint analytics",
    description: "Anchor a finance reporting snapshot hash into the analytics module.",
    fields: [
      { name: "company", label: "Company", placeholder: "0xCompany" },
      { name: "snapshotHash", label: "Snapshot reference", placeholder: "monthly-close-2026-03" },
    ],
    async prepare(values) {
      const company = normalizeAddress(values.company);

      if (!company) {
        throw new Error("Company address is invalid.");
      }

      return {
        contractKey: "analytics",
        functionName: "checkpointAnalytics",
        address: state.addresses.analytics || "",
        args: [company, hashText(values.snapshotHash, company)],
      };
    },
  },
  {
    id: "analytics-read-checkpoint",
    section: "Analytics",
    kind: "read",
    title: "Read analytics checkpoint",
    description: "Inspect the stored metadata for a specific analytics checkpoint.",
    fields: [{ name: "checkpointId", label: "Checkpoint id", placeholder: "CHECKPOINT-2026-03" }],
    async prepare(values) {
      return {
        runner: requireAlignedReadRunner(),
        address: requireConfiguredContractAddress("analytics"),
        args: [hashText(values.checkpointId)],
      };
    },
    async read(prepared) {
      const contract = getContract("analytics", prepared.address, prepared.runner);
      const checkpoint = await contract.getAnalyticsCheckpoint(...prepared.args);

      return {
        summary: "Checkpoint metadata returned from the analytics module.",
        data: toDisplayObject(checkpoint),
      };
    },
  },
];

export async function initHexaPayPage(root) {
  state.root = root;
  state.recentActivity = loadRecentActivity();

  render();
  bindEvents();
  await bootstrapManifest();
  await refreshWorkspaceData({ silent: true });
  render();
}
