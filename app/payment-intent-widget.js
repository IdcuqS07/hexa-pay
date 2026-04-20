// payment-intent-widget.js
import { BrowserProvider, Contract, parseUnits } from "ethers";

const DEFAULT_HEXAPAY_EXECUTOR_CONTRACT =
  "0x7AD0bB5220E664A1057d101069c0309f9302c075";
const DEFAULT_PAYMENT_ASSET = {
  symbol: "USDC",
  decimals: 6,
  token: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d",
};

const PAYMENT_RUNTIME = {
  chainId: Number(import.meta.env.VITE_HEXAPAY_CHAIN_ID || 421614),
  executorAddress: String(
    import.meta.env.VITE_HEXAPAY_EXECUTOR_CONTRACT ||
      DEFAULT_HEXAPAY_EXECUTOR_CONTRACT,
  ),
  asset: {
    symbol: String(
      import.meta.env.VITE_HEXAPAY_PAYMENT_TOKEN_SYMBOL ||
        DEFAULT_PAYMENT_ASSET.symbol,
    ),
    decimals: Number(
      import.meta.env.VITE_HEXAPAY_PAYMENT_TOKEN_DECIMALS ||
        DEFAULT_PAYMENT_ASSET.decimals,
    ),
    token: String(
      import.meta.env.VITE_HEXAPAY_PAYMENT_TOKEN_ADDRESS ||
        import.meta.env.VITE_SETTLEMENT_TOKEN_ADDRESS ||
        DEFAULT_PAYMENT_ASSET.token,
    ),
  },
};

const HEXAPAY_DOMAIN = {
  name: "HexaPay",
  version: "1",
  chainId: PAYMENT_RUNTIME.chainId,
  verifyingContract: PAYMENT_RUNTIME.executorAddress,
};

const USDC_ASSET = PAYMENT_RUNTIME.asset;

const USDC_ABI = [
  "function approve(address spender, uint256 value) external returns (bool)",
  "function allowance(address owner, address spender) external view returns (uint256)",
  "function balanceOf(address owner) external view returns (uint256)",
];

const PAYMENT_INTENT_TYPES = {
  PaymentIntent: [
    { name: "challengeId", type: "string" },
    { name: "requestId", type: "string" },
    { name: "receiptId", type: "string" },
    { name: "quoteId", type: "string" },
    { name: "merchantId", type: "string" },
    { name: "terminalId", type: "string" },
    { name: "payer", type: "address" },
    { name: "merchant", type: "address" },
    { name: "token", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "currency", type: "string" },
    { name: "decimals", type: "uint8" },
    { name: "permitHash", type: "string" },
    { name: "sessionId", type: "string" },
    { name: "deviceFingerprintHash", type: "string" },
    { name: "issuedAtMs", type: "uint256" },
    { name: "expiresAtMs", type: "uint256" },
  ],
};

function createRequestId(prefix = "req_hexapay") {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function shortHash(value) {
  if (!value) return "-";
  return `${value.slice(0, 8)}...${value.slice(-6)}`;
}

function getExplorerUrl(txHash) {
  return txHash ? `https://sepolia.arbiscan.io/tx/${txHash}` : "";
}

async function postJson(url, body, headers = {}) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || `Request failed: ${response.status}`);
    error.code = data.code || "request_failed";
    error.details = data.details || null;
    throw error;
  }
  return data;
}

async function getSignerAndAddress() {
  if (!window.ethereum) {
    throw new Error("Wallet not found");
  }
  const provider = new BrowserProvider(window.ethereum);
  const signer = await provider.getSigner();
  const address = await signer.getAddress();
  return { provider, signer, address };
}

async function ensureArbSepolia() {
  if (!window.ethereum) {
    throw new Error("Wallet not found");
  }
  const provider = new BrowserProvider(window.ethereum);
  const network = await provider.getNetwork();
  if (Number(network.chainId) === 421614) return true;

  try {
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: "0x66eee" }],
    });
    return true;
  } catch {
    throw new Error("Please switch wallet network to Arbitrum Sepolia.");
  }
}

async function ensureUsdcApproval(executorAddress, humanAmount) {
  if (!window.ethereum) {
    throw new Error("Wallet not found");
  }

  const provider = new BrowserProvider(window.ethereum);
  const signer = await provider.getSigner();
  const owner = await signer.getAddress();

  const usdc = new Contract(USDC_ASSET.token, USDC_ABI, signer);
  const amount = parseUnits(String(humanAmount), USDC_ASSET.decimals);

  const spenderAddress = String(executorAddress || PAYMENT_RUNTIME.executorAddress || "");
  if (!spenderAddress) {
    throw new Error("Executor address is not configured.");
  }

  const allowance = await usdc.allowance(owner, spenderAddress);
  if (allowance >= amount) {
    return { approved: true, skipped: true };
  }

  // Let the wallet estimate gas params so injected providers with limited RPC
  // support do not fail on optional fee methods like eth_maxPriorityFeePerGas.
  const tx = await usdc.approve(spenderAddress, amount);
  await tx.wait();

  return { approved: true, skipped: false, txHash: tx.hash };
}

function formatPaymentRailError(error) {
  const rawMessage = String(error?.message || "Payment execution gagal.");
  const lowerMessage = rawMessage.toLowerCase();
  const rpcHint =
    "MetaMask RPC Arbitrum Sepolia sedang error. Ganti RPC network ke https://sepolia-rollup.arbitrum.io/rpc lalu refresh halaman.";

  if (
    lowerMessage.includes("user denied") ||
    lowerMessage.includes("action_rejected") ||
    lowerMessage.includes("transaction signature")
  ) {
    return "Transaksi dibatalkan dari wallet.";
  }

  if (
    lowerMessage.includes("rpc endpoint returned http client error") ||
    lowerMessage.includes("rpc endpoint returned too many errors") ||
    lowerMessage.includes("eth_maxpriorityfeepergas") ||
    lowerMessage.includes("could not coalesce error")
  ) {
    return rpcHint;
  }

  if (lowerMessage.includes("insufficient funds")) {
    return "Saldo ETH pada wallet aktif tidak cukup untuk gas transaksi.";
  }

  return rawMessage;
}

async function signIntent(intent, domain = HEXAPAY_DOMAIN) {
  const { signer } = await getSignerAndAddress();
  return signer.signTypedData(domain, PAYMENT_INTENT_TYPES, intent);
}

function buildIntent({
  challengeId,
  requestId,
  receiptId,
  quoteId,
  merchantId,
  terminalId,
  payer,
  merchant,
  amount,
  currency,
  permitHash = "",
  sessionId = "",
  deviceFingerprintHash = "",
  expiresAtMs,
}) {
  return {
    challengeId: String(challengeId),
    requestId: String(requestId),
    receiptId: String(receiptId || ""),
    quoteId: String(quoteId || ""),
    merchantId: String(merchantId),
    terminalId: String(terminalId),
    payer: String(payer),
    merchant: String(merchant),
    token: String(USDC_ASSET.token),
    amount: String(parseUnits(String(amount), USDC_ASSET.decimals)),
    currency: String(currency || USDC_ASSET.symbol),
    decimals: String(USDC_ASSET.decimals),
    permitHash: String(permitHash || ""),
    sessionId: String(sessionId || ""),
    deviceFingerprintHash: String(deviceFingerprintHash || ""),
    issuedAtMs: String(Date.now()),
    expiresAtMs: String(expiresAtMs),
  };
}

function createWidgetStyles() {
  return `
    .hp-pay-card {
      position: relative;
      overflow: hidden;
      border-radius: 28px;
      border: 1px solid rgba(34, 211, 238, 0.12);
      background: linear-gradient(180deg, rgba(7,17,31,0.96), rgba(2,8,23,0.98));
      padding: 24px;
      box-shadow: 0 0 60px rgba(34, 211, 238, 0.08);
      margin-top: 24px;
    }
    .hp-pay-card::before {
      content: "";
      position: absolute;
      inset: 0;
      pointer-events: none;
      background:
        radial-gradient(circle at top right, rgba(34,211,238,0.12), transparent 35%),
        radial-gradient(circle at bottom left, rgba(168,85,247,0.10), transparent 35%);
    }
    .hp-pay-inner { position: relative; z-index: 1; }
    .hp-pay-top {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 16px;
      flex-wrap: wrap;
    }
    .hp-pay-kicker {
      display: inline-flex;
      border: 1px solid rgba(34,211,238,0.15);
      background: rgba(34,211,238,0.05);
      color: #67e8f9;
      border-radius: 999px;
      padding: 6px 12px;
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.22em;
      text-transform: uppercase;
    }
    .hp-pay-title {
      margin: 10px 0 0;
      color: #fff;
      font-size: 32px;
      line-height: 1.1;
      font-weight: 700;
      letter-spacing: -0.02em;
      max-width: 820px;
    }
    .hp-pay-subtitle {
      margin: 12px 0 0;
      color: #a9b6c9;
      font-size: 15px;
      max-width: 760px;
    }
    .hp-pay-badges {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
      margin-top: 18px;
    }
    .hp-pay-pill, .hp-pay-status {
      display: inline-flex;
      align-items: center;
      border-radius: 999px;
      padding: 10px 14px;
      font-size: 12px;
      font-weight: 600;
      border: 1px solid rgba(34,211,238,0.15);
      background: rgba(34,211,238,0.05);
      color: #67e8f9;
    }
    .hp-pay-status.idle { color: #cbd5e1; border-color: rgba(148,163,184,0.2); background: rgba(15,23,42,0.6); }
    .hp-pay-status.connecting_wallet,
    .hp-pay-status.switching_network,
    .hp-pay-status.creating_challenge { color: #67e8f9; border-color: rgba(34,211,238,0.25); background: rgba(34,211,238,0.06); }
    .hp-pay-status.signing_intent { color: #c4b5fd; border-color: rgba(168,85,247,0.24); background: rgba(168,85,247,0.06); }
    .hp-pay-status.executing_payment { color: #fbbf24; border-color: rgba(251,191,36,0.24); background: rgba(251,191,36,0.06); }
    .hp-pay-status.success { color: #86efac; border-color: rgba(34,197,94,0.24); background: rgba(34,197,94,0.06); }
    .hp-pay-status.error { color: #fda4af; border-color: rgba(244,63,94,0.24); background: rgba(244,63,94,0.06); }
    
    .hp-pay-grid {
      display: grid;
      grid-template-columns: minmax(0, 1.25fr) minmax(320px, 0.95fr);
      gap: 24px;
      margin-top: 28px;
    }
    .hp-panel {
      border-radius: 24px;
      border: 1px solid rgba(30,41,59,0.9);
      background: rgba(0,0,0,0.18);
      padding: 20px;
    }
    .hp-panel-title {
      color: #fff;
      font-size: 14px;
      font-weight: 600;
      margin-bottom: 14px;
    }
    .hp-form-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 16px;
    }
    .hp-field.full { grid-column: 1 / -1; }
    .hp-label {
      display: block;
      margin-bottom: 6px;
      font-size: 11px;
      color: #8ea0b8;
      letter-spacing: 0.18em;
      text-transform: uppercase;
      font-weight: 600;
    }
    .hp-input {
      width: 100%;
      box-sizing: border-box;
      border-radius: 18px;
      border: 1px solid rgba(30,41,59,0.95);
      background: rgba(2,8,23,0.9);
      color: white;
      padding: 14px 16px;
      outline: none;
      font-size: 15px;
    }
    .hp-input:focus {
      border-color: rgba(34,211,238,0.35);
      box-shadow: 0 0 0 3px rgba(34,211,238,0.08);
    }
    .hp-actions {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
      margin-top: 18px;
    }
    .hp-btn-primary, .hp-btn-secondary {
      border-radius: 18px;
      padding: 14px 18px;
      font-weight: 700;
      font-size: 15px;
      cursor: pointer;
      transition: 160ms ease;
      text-decoration: none;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border: 1px solid transparent;
    }
    .hp-btn-primary {
      background: #22d3ee;
      color: #03121d;
    }
    .hp-btn-primary:hover { opacity: 0.92; }
    .hp-btn-primary[disabled] {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .hp-btn-secondary {
      color: #67e8f9;
      background: rgba(34,211,238,0.05);
      border-color: rgba(34,211,238,0.16);
    }
    .hp-steps {
      display: grid;
      gap: 14px;
    }
    .hp-step {
      display: flex;
      align-items: center;
      gap: 12px;
      color: #64748b;
    }
    .hp-step.active, .hp-step.done { color: #fff; }
    .hp-step-dot {
      width: 30px;
      height: 30px;
      border-radius: 999px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 12px;
      font-weight: 700;
      border: 1px solid rgba(51,65,85,1);
      background: rgba(15,23,42,0.85);
      color: #64748b;
      flex: 0 0 auto;
    }
    .hp-step.active .hp-step-dot {
      border-color: rgba(34,211,238,0.25);
      background: rgba(34,211,238,0.08);
      color: #67e8f9;
    }
    .hp-step.done .hp-step-dot {
      border-color: rgba(34,197,94,0.25);
      background: rgba(34,197,94,0.08);
      color: #86efac;
    }
    .hp-details {
      display: grid;
      gap: 12px;
      font-size: 14px;
    }
    .hp-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }
    .hp-key { color: #8ea0b8; }
    .hp-value { color: #fff; text-align: right; word-break: break-all; }
    .hp-alert {
      margin-top: 16px;
      border-radius: 18px;
      padding: 14px 16px;
      font-size: 14px;
    }
    .hp-alert.error {
      border: 1px solid rgba(244,63,94,0.18);
      background: rgba(244,63,94,0.08);
      color: #fecdd3;
    }
    .hp-alert.success {
      border: 1px solid rgba(34,197,94,0.18);
      background: rgba(34,197,94,0.08);
      color: #bbf7d0;
    }
    @media (max-width: 1100px) {
      .hp-pay-grid { grid-template-columns: 1fr; }
      .hp-pay-title { font-size: 28px; }
    }
    @media (max-width: 720px) {
      .hp-form-grid { grid-template-columns: 1fr; }
      .hp-pay-title { font-size: 24px; }
    }
  `;
}

function createMarkup(config = {}) {
  return `
    <section class="hp-pay-card">
      <div class="hp-pay-inner">
        <div class="hp-pay-top">
          <div>
            <div class="hp-pay-kicker">HexaPay Payment Rail</div>
            <h2 class="hp-pay-title">Execute secure payments inside HexaPay</h2>
            <p class="hp-pay-subtitle">
              Approve USDC, sign an EIP-712 intent, and settle onchain through the live HexaPay rail on Arbitrum Sepolia.
            </p>
            <div class="hp-pay-badges">
              <div class="hp-pay-pill">Arb Sepolia</div>
              <div class="hp-pay-pill">Signed intent</div>
              <div class="hp-pay-pill">Onchain execution</div>
            </div>
          </div>
          <div class="hp-pay-status idle" data-role="status-badge">idle</div>
        </div>

        <div class="hp-pay-grid">
          <div class="hp-panel">
            <div class="hp-panel-title">Payment Request</div>
            <div class="hp-form-grid">
              <div class="hp-field">
                <label class="hp-label">Merchant ID</label>
                <input class="hp-input" data-field="merchantId" value="${config.merchantId || ""}" />
              </div>
              <div class="hp-field">
                <label class="hp-label">Terminal ID</label>
                <input class="hp-input" data-field="terminalId" value="${config.terminalId || ""}" />
              </div>
              <div class="hp-field">
                <label class="hp-label">Receipt ID</label>
                <input class="hp-input" data-field="receiptId" value="${config.receiptId || ""}" />
              </div>
              <div class="hp-field">
                <label class="hp-label">Quote ID</label>
                <input class="hp-input" data-field="quoteId" value="${config.quoteId || ""}" />
              </div>
              <div class="hp-field full">
                <label class="hp-label">Merchant Address</label>
                <input class="hp-input" data-field="merchantAddress" value="${config.merchantAddress || ""}" />
              </div>
              <div class="hp-field">
                <label class="hp-label">Amount</label>
                <input class="hp-input" data-field="amount" value="${config.amount || ""}" />
              </div>
              <div class="hp-field">
                <label class="hp-label">Asset</label>
                <input class="hp-input" data-field="currency" value="${config.currency || "USDC"}" readonly />
              </div>
            </div>

            <div class="hp-actions">
              <button class="hp-btn-primary" data-role="execute-btn">Execute Payment</button>
              <a class="hp-btn-secondary" data-role="explorer-link" target="_blank" rel="noreferrer" style="display:none;">View on Arbiscan</a>
            </div>
          </div>

          <div style="display:grid; gap:24px;">
            <div class="hp-panel">
              <div class="hp-panel-title">Execution Flow</div>
              <div class="hp-steps">
                <div class="hp-step" data-step="wallet"><div class="hp-step-dot">•</div><div>Wallet connected</div></div>
                <div class="hp-step" data-step="challenge"><div class="hp-step-dot">•</div><div>Challenge created</div></div>
                <div class="hp-step" data-step="signing"><div class="hp-step-dot">•</div><div>Intent signed</div></div>
                <div class="hp-step" data-step="execute"><div class="hp-step-dot">•</div><div>Payment executed</div></div>
              </div>
            </div>

            <div class="hp-panel">
              <div class="hp-panel-title">Execution Details</div>
              <div class="hp-details">
                <div class="hp-row"><div class="hp-key">Payer</div><div class="hp-value" data-out="payer">-</div></div>
                <div class="hp-row"><div class="hp-key">Request ID</div><div class="hp-value" data-out="requestId">-</div></div>
                <div class="hp-row"><div class="hp-key">Challenge ID</div><div class="hp-value" data-out="challengeId">-</div></div>
                <div class="hp-row"><div class="hp-key">Signature</div><div class="hp-value" data-out="signature">-</div></div>
                <div class="hp-row"><div class="hp-key">Tx Hash</div><div class="hp-value" data-out="txHash">-</div></div>
                <div class="hp-row"><div class="hp-key">Block Number</div><div class="hp-value" data-out="blockNumber">-</div></div>
              </div>
              <div class="hp-alert error" data-role="error-box" style="display:none;"></div>
              <div class="hp-alert success" data-role="success-box" style="display:none;">Payment executed successfully on Arbitrum Sepolia.</div>
            </div>
          </div>
        </div>
      </div>
    </section>
  `;
}

export function mountPaymentIntentWidget(container, options = {}) {
  if (!container) {
    throw new Error("mountPaymentIntentWidget requires a container element.");
  }

  if (!document.getElementById("hp-payment-widget-styles")) {
    const style = document.createElement("style");
    style.id = "hp-payment-widget-styles";
    style.textContent = createWidgetStyles();
    document.head.appendChild(style);
  }

  container.innerHTML = createMarkup(options);

  const statusBadge = container.querySelector('[data-role="status-badge"]');
  const executeBtn = container.querySelector('[data-role="execute-btn"]');
  const explorerLink = container.querySelector('[data-role="explorer-link"]');
  const errorBox = container.querySelector('[data-role="error-box"]');
  const successBox = container.querySelector('[data-role="success-box"]');

  const fields = {
    merchantId: container.querySelector('[data-field="merchantId"]'),
    terminalId: container.querySelector('[data-field="terminalId"]'),
    receiptId: container.querySelector('[data-field="receiptId"]'),
    quoteId: container.querySelector('[data-field="quoteId"]'),
    merchantAddress: container.querySelector('[data-field="merchantAddress"]'),
    amount: container.querySelector('[data-field="amount"]'),
    currency: container.querySelector('[data-field="currency"]'),
  };

  const outputs = {
    payer: container.querySelector('[data-out="payer"]'),
    requestId: container.querySelector('[data-out="requestId"]'),
    challengeId: container.querySelector('[data-out="challengeId"]'),
    signature: container.querySelector('[data-out="signature"]'),
    txHash: container.querySelector('[data-out="txHash"]'),
    blockNumber: container.querySelector('[data-out="blockNumber"]'),
  };

  const steps = {
    wallet: container.querySelector('[data-step="wallet"]'),
    challenge: container.querySelector('[data-step="challenge"]'),
    signing: container.querySelector('[data-step="signing"]'),
    execute: container.querySelector('[data-step="execute"]'),
  };

  function setStatus(status) {
    statusBadge.className = `hp-pay-status ${status}`;
    statusBadge.textContent = status.replaceAll("_", " ");
  }

  function setBusy(label, busy = true) {
    executeBtn.disabled = busy;
    executeBtn.textContent = label;
  }

  function setError(message = "") {
    if (!message) {
      errorBox.style.display = "none";
      errorBox.textContent = "";
      return;
    }
    errorBox.style.display = "block";
    errorBox.textContent = message;
  }

  function setSuccess(show) {
    successBox.style.display = show ? "block" : "none";
  }

  function setStepState(activeStep, doneSteps = []) {
    Object.entries(steps).forEach(([key, el]) => {
      el.classList.remove("active", "done");
      if (doneSteps.includes(key)) {
        el.classList.add("done");
        el.querySelector(".hp-step-dot").textContent = "✓";
      } else if (key === activeStep) {
        el.classList.add("active");
        el.querySelector(".hp-step-dot").textContent = "•";
      } else {
        el.querySelector(".hp-step-dot").textContent = "•";
      }
    });
  }

  function clearOutputs() {
    outputs.challengeId.textContent = "-";
    outputs.signature.textContent = "-";
    outputs.txHash.textContent = "-";
    outputs.blockNumber.textContent = "-";
    explorerLink.style.display = "none";
    explorerLink.removeAttribute("href");
    setError("");
    setSuccess(false);
    setStepState("");
  }

  function clearFormFields() {
    fields.merchantId.value = "";
    fields.terminalId.value = "";
    fields.receiptId.value = "";
    fields.quoteId.value = "";
    fields.merchantAddress.value = "";
    fields.amount.value = "";
    fields.currency.value = options.currency || "USDC";
  }

  function resetForm({ clearFields = false } = {}) {
    if (clearFields) {
      clearFormFields();
    } else {
      fields.merchantId.value = options.merchantId || "";
      fields.terminalId.value = options.terminalId || "";
      fields.receiptId.value = options.receiptId || "";
      fields.quoteId.value = options.quoteId || "";
      fields.merchantAddress.value = options.merchantAddress || "";
      fields.amount.value = options.amount || "";
      fields.currency.value = options.currency || "USDC";
    }
    outputs.payer.textContent = "-";
    outputs.requestId.textContent = "-";
    clearOutputs();
  }

  async function handleExecute() {
    clearOutputs();
    try {
      setStatus("connecting_wallet");
      setBusy("Connecting wallet...");
      setStepState("wallet");

      await ensureArbSepolia();
      const { address: payer } = await getSignerAndAddress();
      outputs.payer.textContent = shortHash(payer);

      const requestId = createRequestId();
      outputs.requestId.textContent = shortHash(requestId);

      setStatus("creating_challenge");
      setBusy("Creating challenge...");
      setStepState("challenge", ["wallet"]);

      const challengeResponse = await postJson(
        "/api/payments/challenges",
        {
          requestId,
          receiptId: fields.receiptId.value,
          quoteId: fields.quoteId.value,
          merchantId: fields.merchantId.value,
          terminalId: fields.terminalId.value,
          amount: fields.amount.value,
          currency: fields.currency.value,
          payer,
          merchant: fields.merchantAddress.value,
          actorId: payer,
        },
        {
          ...(options.permitHash ? { "x-receipt-permit-hash": options.permitHash } : {}),
          ...(options.sessionId ? { "x-session-id": options.sessionId } : {}),
          ...(options.deviceFingerprintHash
            ? { "x-device-fingerprint-hash": options.deviceFingerprintHash }
            : {}),
          "x-actor-id": payer,
        },
      );

      const record =
        challengeResponse?.record ||
        challengeResponse?.challenge ||
        challengeResponse?.data ||
        challengeResponse;

      const challengeId = record?.challengeId || challengeResponse?.challengeId || null;
      const expiresAtMs = record?.expiresAtMs || challengeResponse?.expiresAtMs || null;

      if (!challengeId || !expiresAtMs) {
        throw new Error("Challenge response tidak lengkap.");
      }

      outputs.challengeId.textContent = shortHash(challengeId);

      const intent = buildIntent({
        challengeId,
        requestId,
        receiptId: fields.receiptId.value,
        quoteId: fields.quoteId.value,
        merchantId: fields.merchantId.value,
        terminalId: fields.terminalId.value,
        payer,
        merchant: fields.merchantAddress.value,
        amount: fields.amount.value,
        currency: fields.currency.value,
        permitHash: options.permitHash || "",
        sessionId: options.sessionId || "sess_demo_ui",
        deviceFingerprintHash: options.deviceFingerprintHash || "dev_demo_hash",
        expiresAtMs,
      });

      setStatus("signing_intent");
      setBusy("Waiting for signature...");
      setStepState("signing", ["wallet", "challenge"]);

      const executorAddress =
        options.executorAddress || PAYMENT_RUNTIME.executorAddress;
      const intentDomain = {
        ...HEXAPAY_DOMAIN,
        verifyingContract: String(executorAddress || PAYMENT_RUNTIME.executorAddress),
      };

      const signature = await signIntent(intent, record?.domain || intentDomain);
      outputs.signature.textContent = shortHash(signature);

      setStatus("executing_payment");
      setBusy("Approving USDC...");
      setStepState("execute", ["wallet", "challenge", "signing"]);

      await ensureUsdcApproval(executorAddress, fields.amount.value);

      setBusy("Executing onchain...");

      const executeResponse = await postJson("/api/payments/execute", {
        intent,
        signature,
      });

      const txHash = executeResponse?.txHash || "";
      const blockNumber = executeResponse?.blockNumber || "";

      outputs.txHash.textContent = txHash ? shortHash(txHash) : "-";
      outputs.blockNumber.textContent = blockNumber ? String(blockNumber) : "-";

      if (txHash) {
        explorerLink.href = getExplorerUrl(txHash);
        explorerLink.style.display = "inline-flex";
      }

      setStatus("success");
      setBusy("Execute Payment", false);
      setStepState("", ["wallet", "challenge", "signing", "execute"]);
      setSuccess(true);

      if (typeof options.onSuccess === "function") {
        options.onSuccess({
          payer,
          requestId,
          challengeId,
          signature,
          txHash,
          blockNumber,
          intent,
          executeResponse,
        });
      }

      // Clear user input after success so the widget is ready for a fresh request.
      setTimeout(() => {
        clearFormFields();
      }, 400);
    } catch (error) {
      setStatus("error");
      setBusy("Execute Payment", false);
      setError(formatPaymentRailError(error));
      if (typeof options.onError === "function") {
        options.onError(error);
      }
    }
  }

  executeBtn.addEventListener("click", handleExecute);

  return {
    destroy() {
      executeBtn.removeEventListener("click", handleExecute);
      container.innerHTML = "";
    },
  };
}
