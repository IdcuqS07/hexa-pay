import {
  BrowserProvider,
  Contract,
  Interface,
  ZeroAddress,
  formatUnits,
  getAddress,
  keccak256,
  parseUnits,
  toUtf8Bytes,
} from "ethers";
import {
  COMPLIANCE_SCOPE_LABELS,
  CONTRACT_ABIS,
  CONTRACT_METADATA,
  CONTRACT_ORDER,
  ESCROW_STATUS_LABELS,
  INVOICE_STATUS_LABELS,
  POLICY_ACTION_LABELS,
} from "./abis.js";
import { CHAIN_METADATA } from "./config.js";

const interfaces = Object.entries(CONTRACT_ABIS).reduce((accumulator, [key, abi]) => {
  accumulator[key] = new Interface(abi);
  return accumulator;
}, {});

let fhenixModulePromise;
const ZERO_BYTES32 = `0x${"00".repeat(32)}`;
const INJECTED_WALLET_CATALOG = [
  {
    id: "rabby",
    name: "Rabby",
    iconText: "R",
    accent: "orange",
    matcher: (provider) => Boolean(provider?.isRabby),
  },
  {
    id: "coinbase",
    name: "Coinbase Wallet",
    iconText: "C",
    accent: "blue",
    matcher: (provider) => Boolean(provider?.isCoinbaseWallet),
  },
  {
    id: "brave",
    name: "Brave Wallet",
    iconText: "B",
    accent: "amber",
    matcher: (provider) => Boolean(provider?.isBraveWallet),
  },
  {
    id: "metamask",
    name: "MetaMask",
    iconText: "M",
    accent: "orange",
    matcher: (provider) =>
      Boolean(provider?.isMetaMask) && !provider?.isRabby && !provider?.isCoinbaseWallet && !provider?.isBraveWallet,
  },
  {
    id: "okx",
    name: "OKX Wallet",
    iconText: "O",
    accent: "green",
    matcher: (provider) => Boolean(provider?.isOkxWallet || provider?.isOKExWallet),
  },
  {
    id: "phantom",
    name: "Phantom",
    iconText: "P",
    accent: "violet",
    matcher: (provider) => Boolean(provider?.isPhantom),
  },
];

function getCofheInitializationOptions(chainId) {
  const normalizedChainId = String(chainId || "");

  if (normalizedChainId === "421614") {
    return { environment: "TESTNET" };
  }

  if (normalizedChainId === "31337") {
    return { environment: "LOCAL" };
  }

  throw new Error(`CoFHE is not configured for chain ${normalizedChainId || "unknown"}.`);
}

function assertTfheBrowserSupport() {
  if (typeof window === "undefined") {
    return;
  }

  if (typeof SharedArrayBuffer === "undefined" || window.crossOriginIsolated !== true) {
    const sharedArrayBufferState =
      typeof SharedArrayBuffer === "undefined" ? "missing" : "available";

    throw new Error(
      `TFHE browser runtime needs a cross-origin isolated page. crossOriginIsolated=${String(window.crossOriginIsolated)}, SharedArrayBuffer=${sharedArrayBufferState}. Serve HexaPay with COOP/COEP headers, then reload the tab.`,
    );
  }
}

function getTfheBrowserDiagnostics() {
  if (typeof window === "undefined") {
    return "";
  }

  const sharedArrayBufferState =
    typeof SharedArrayBuffer === "undefined" ? "missing" : "available";

  return `crossOriginIsolated=${String(window.crossOriginIsolated)}, SharedArrayBuffer=${sharedArrayBufferState}`;
}

function unwrapFhenixResult(result, fallbackMessage = "CoFHE request failed.") {
  if (result && typeof result === "object" && "success" in result) {
    if (result.success) {
      return result.data;
    }

    if (result.error instanceof Error) {
      throw result.error;
    }

    throw new Error(result.error?.message || fallbackMessage);
  }

  return result;
}

function coerceHandle(value) {
  if (typeof value === "bigint") {
    return value;
  }

  if (typeof value === "number") {
    return BigInt(value);
  }

  if (value && typeof value.toString === "function") {
    return BigInt(value.toString());
  }

  throw new Error("Encrypted handle is invalid.");
}

function serializeErrorMessage(error) {
  if (!error) {
    return "Unknown error";
  }

  const primaryMessage =
    error.shortMessage ||
    error.reason ||
    error.error?.message ||
    error.info?.error?.message ||
    error.message ||
    String(error);

  const code = error.code ? `[${error.code}] ` : "";
  const causeMessage =
    error.cause?.shortMessage ||
    error.cause?.reason ||
    error.cause?.error?.message ||
    error.cause?.message ||
    error.cause?.cause?.message ||
    "";

  if (causeMessage && causeMessage !== primaryMessage) {
    return `${code}${primaryMessage} Cause: ${causeMessage}`;
  }

  return `${code}${primaryMessage}`;
}

function extractRevertData(error) {
  const candidates = [
    error?.data,
    error?.error?.data,
    error?.info?.error?.data,
    error?.cause?.data,
    error?.cause?.error?.data,
    error?.receipt?.revertReason,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && /^0x[0-9a-fA-F]+$/.test(candidate)) {
      return candidate;
    }
  }

  const messageMatch = String(error?.message || "").match(/data="(0x[0-9a-fA-F]+)"/);
  if (messageMatch?.[1]) {
    return messageMatch[1];
  }

  return "";
}

function humanizeIdentifier(value) {
  return String(value || "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/^./, (character) => character.toUpperCase());
}

function decodeContractError(contractKey, error) {
  if (!contractKey) {
    return null;
  }

  const revertData = extractRevertData(error);
  if (!revertData) {
    return null;
  }

  try {
    const parsed = getContractInterface(contractKey).parseError(revertData);

    return {
      name: parsed.name,
      signature: parsed.signature,
      args: toDisplayObject(parsed.args),
      label: humanizeIdentifier(parsed.name),
      revertData,
    };
  } catch (parsingError) {
    parsingError;
    return null;
  }
}

async function loadFhenixModule() {
  if (!fhenixModulePromise) {
    fhenixModulePromise = import("cofhejs/web");
  }

  return fhenixModulePromise;
}

export function getInterfaces() {
  return interfaces;
}

export function getExplorerLink(chainId, hash) {
  const metadata = CHAIN_METADATA[String(chainId)];

  if (!metadata?.explorerUrl || !hash) {
    return "";
  }

  return `${metadata.explorerUrl.replace(/\/$/, "")}/tx/${hash}`;
}

export function shortAddress(value, head = 6, tail = 4) {
  if (!value || typeof value !== "string") {
    return "Not set";
  }

  if (value.length <= head + tail + 2) {
    return value;
  }

  return `${value.slice(0, head + 2)}...${value.slice(-tail)}`;
}

function getInjectedProviderCandidates() {
  if (typeof window === "undefined") {
    return [];
  }

  const candidates = [];
  const seen = new Set();

  const registerCandidate = (provider) => {
    if (!provider || typeof provider !== "object" || seen.has(provider)) {
      return;
    }

    seen.add(provider);
    candidates.push(provider);
  };

  if (Array.isArray(window.ethereum?.providers) && window.ethereum.providers.length > 0) {
    window.ethereum.providers.forEach(registerCandidate);
    return candidates;
  }

  registerCandidate(window.ethereum);

  return candidates;
}

function getFallbackWalletId(provider, index) {
  const nameCandidate =
    provider?.providerInfo?.rdns ||
    provider?.providerInfo?.name ||
    provider?.rdns ||
    provider?.name ||
    provider?.constructor?.name ||
    "";
  const normalized = String(nameCandidate)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalized || `browser-wallet-${index + 1}`;
}

function describeInjectedWallet(provider, index) {
  const knownWallet = INJECTED_WALLET_CATALOG.find((candidate) => candidate.matcher(provider));

  if (knownWallet) {
    return {
      id: knownWallet.id,
      name: knownWallet.name,
      iconText: knownWallet.iconText,
      accent: knownWallet.accent,
      installed: true,
      provider,
    };
  }

  const fallbackName =
    provider?.providerInfo?.name || provider?.name || provider?.constructor?.name || "Browser Wallet";

  return {
    id: getFallbackWalletId(provider, index),
    name: fallbackName,
    iconText: String(fallbackName).trim().slice(0, 1).toUpperCase() || "W",
    accent: "slate",
    installed: true,
    provider,
  };
}

function hasWalletProviderInfo(wallet) {
  return Boolean(wallet?.provider?.providerInfo?.name || wallet?.provider?.providerInfo?.rdns);
}

function dedupeInjectedWallets(wallets) {
  const uniqueWallets = new Map();

  for (const wallet of wallets) {
    if (!wallet?.id) {
      continue;
    }

    const existingWallet = uniqueWallets.get(wallet.id);

    if (!existingWallet) {
      uniqueWallets.set(wallet.id, wallet);
      continue;
    }

    if (!hasWalletProviderInfo(existingWallet) && hasWalletProviderInfo(wallet)) {
      uniqueWallets.set(wallet.id, wallet);
    }
  }

  return Array.from(uniqueWallets.values());
}

function serializeWalletDescriptor(wallet) {
  if (!wallet) {
    return null;
  }

  return Object.fromEntries(
    Object.entries(wallet).filter(([key]) => key !== "provider"),
  );
}

function resolveInjectedWallet(walletId = "") {
  const wallets = dedupeInjectedWallets(
    getInjectedProviderCandidates().map((provider, index) =>
      describeInjectedWallet(provider, index),
    ),
  );
  const selectedWallet =
    wallets.find((wallet) => wallet.id === walletId) ||
    wallets.find((wallet) => wallet.id === "metamask") ||
    wallets[0] ||
    null;

  return {
    wallets,
    selectedWallet,
    provider: selectedWallet?.provider || null,
  };
}

export function listInjectedWallets() {
  return resolveInjectedWallet().wallets.map(serializeWalletDescriptor).filter(Boolean);
}

export function normalizeAddress(value) {
  if (!value || typeof value !== "string") {
    return "";
  }

  try {
    return getAddress(value.trim());
  } catch (error) {
    return "";
  }
}

export function isConfiguredAddress(value) {
  const normalized = normalizeAddress(value);
  return normalized !== "" && normalized !== ZeroAddress;
}

export function getContractInterface(contractKey) {
  return interfaces[contractKey];
}

export function getContract(contractKey, address, runner) {
  const normalizedAddress = normalizeAddress(address);

  if (!normalizedAddress) {
    throw new Error(`${CONTRACT_METADATA[contractKey]?.shortLabel || contractKey} address is not configured.`);
  }

  return new Contract(normalizedAddress, CONTRACT_ABIS[contractKey], runner);
}

export function hashText(value, fallbackValue = "") {
  const candidate = String(value || fallbackValue || "").trim();

  if (/^0x[a-fA-F0-9]{64}$/.test(candidate)) {
    return candidate;
  }

  return keccak256(toUtf8Bytes(candidate));
}

export function parseAmountToUnits(value, decimals = 18) {
  const trimmed = String(value || "").trim();

  if (!trimmed) {
    throw new Error("Amount is required.");
  }

  return parseUnits(trimmed, decimals);
}

export function parseUint(value, label = "Value") {
  const trimmed = String(value || "").trim();

  if (!trimmed) {
    throw new Error(`${label} is required.`);
  }

  if (!/^\d+$/.test(trimmed)) {
    throw new Error(`${label} must be an integer.`);
  }

  return BigInt(trimmed);
}

export function parseTimestamp(value, label = "Timestamp") {
  const trimmed = String(value || "").trim();

  if (!trimmed) {
    throw new Error(`${label} is required.`);
  }

  if (/^\d+$/.test(trimmed)) {
    return BigInt(trimmed);
  }

  const asDate = new Date(trimmed);
  if (Number.isNaN(asDate.getTime())) {
    throw new Error(`${label} is invalid.`);
  }

  return BigInt(Math.floor(asDate.getTime() / 1000));
}

export function parseScopeList(value) {
  const trimmed = String(value || "").trim();

  if (!trimmed) {
    throw new Error("At least one compliance scope is required.");
  }

  const scopes = trimmed
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      if (!/^\d+$/.test(part)) {
        throw new Error("Compliance scopes must be comma-separated integers.");
      }

      const numeric = Number(part);

      if (numeric < 0 || numeric >= COMPLIANCE_SCOPE_LABELS.length) {
        throw new Error("Compliance scope is out of range.");
      }

      return numeric;
    });

  if (!scopes.length) {
    throw new Error("At least one compliance scope is required.");
  }

  return scopes;
}

export function toDisplayObject(value) {
  if (typeof value === "bigint") {
    return value.toString();
  }

  if (Array.isArray(value)) {
    return value.map((entry) => toDisplayObject(entry));
  }

  if (value && typeof value.toObject === "function") {
    try {
      return toDisplayObject(value.toObject());
    } catch (error) {
      error;
    }
  }

  if (value && typeof value === "object") {
    return Object.entries(value).reduce((accumulator, [key, entry]) => {
      if (/^\d+$/.test(key)) {
        return accumulator;
      }

      accumulator[key] = toDisplayObject(entry);
      return accumulator;
    }, {});
  }

  return value;
}

export function formatTransactionError(error, contractKey = "") {
  const decoded = decodeContractError(contractKey, error);

  if (decoded && /unknown custom error/i.test(serializeErrorMessage(error))) {
    return decoded.label;
  }

  return serializeErrorMessage(error);
}

export function getTransactionErrorDetails(error, contractKey = "") {
  if (!error) {
    return {
      message: "Unknown error",
    };
  }

  const details = {
    code: error.code || "",
    shortMessage: error.shortMessage || "",
    reason: error.reason || error.info?.error?.message || "",
    message: error.message || String(error),
    cause:
      error.cause?.shortMessage ||
      error.cause?.reason ||
      error.cause?.error?.message ||
      error.cause?.message ||
      "",
  };
  const decoded = decodeContractError(contractKey, error);

  if (decoded) {
    details.decodedError = decoded.name;
    details.decodedErrorLabel = decoded.label;
    details.revertData = decoded.revertData;
  }

  return Object.fromEntries(Object.entries(details).filter(([, value]) => value));
}

export async function createRuntime({ requestAccounts = false, suppressAccounts = false, walletId = "" } = {}) {
  const { wallets, selectedWallet, provider: walletProvider } = resolveInjectedWallet(walletId);

  if (!walletProvider) {
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
      wallets: wallets.map(serializeWalletDescriptor).filter(Boolean),
    };
  }

  const provider = new BrowserProvider(walletProvider, "any");

  if (requestAccounts) {
    await provider.send("eth_requestAccounts", []);
  }

  const network = await provider.getNetwork();
  const accounts = suppressAccounts ? [] : await provider.send("eth_accounts", []);
  const account = accounts[0] ? normalizeAddress(accounts[0]) : "";

  return {
    walletAvailable: true,
    provider,
    signer: account ? await provider.getSigner() : null,
    account,
    chainId: network.chainId.toString(),
    connected: Boolean(account),
    walletId: selectedWallet?.id || "",
    walletName: selectedWallet?.name || "",
    walletAccent: selectedWallet?.accent || "slate",
    walletProvider,
    wallets: wallets.map(serializeWalletDescriptor).filter(Boolean),
  };
}

export async function switchWalletChain(chainId, walletId = "") {
  const { provider: walletProvider } = resolveInjectedWallet(walletId);

  if (!walletProvider) {
    throw new Error("Wallet not found.");
  }

  const metadata = CHAIN_METADATA[String(chainId)];

  if (!metadata) {
    throw new Error("Unknown chain preset.");
  }

  try {
    await walletProvider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: metadata.chainHex }],
    });
  } catch (error) {
    if (error.code === 4902 && metadata.rpcUrl) {
      await walletProvider.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: metadata.chainHex,
            chainName: metadata.label,
            rpcUrls: [metadata.rpcUrl],
            blockExplorerUrls: metadata.explorerUrl ? [metadata.explorerUrl] : [],
            nativeCurrency: metadata.nativeCurrency,
          },
        ],
      });
      return;
    }

    throw error;
  }
}

export async function getFhenixState(runtime) {
  if (!runtime?.provider || !runtime?.signer || !runtime?.account) {
    return {
      mode: "offline",
      client: null,
      permitHash: "",
      error: "",
    };
  }

  try {
    const { cofhejs } = await loadFhenixModule();
    const cofheInit = getCofheInitializationOptions(runtime.chainId);
    assertTfheBrowserSupport();

    await unwrapFhenixResult(
      await cofhejs.initializeWithEthers({
        ethersProvider: runtime.provider,
        ethersSigner: runtime.signer,
        generatePermit: true,
        ...cofheInit,
      }),
      "Failed to initialize CoFHE.",
    );

    let permit;
    try {
      permit = unwrapFhenixResult(cofhejs.getPermit());
    } catch (error) {
      permit = unwrapFhenixResult(await cofhejs.createPermit());
    }

    return {
      mode: "ready",
      client: cofhejs,
      permitHash: permit.getHash(),
      error: "",
    };
  } catch (error) {
    const diagnostics = getTfheBrowserDiagnostics();

    return {
      mode: "preview",
      client: null,
      permitHash: "",
      error: diagnostics
        ? `${serializeErrorMessage(error)} (${diagnostics})`
        : serializeErrorMessage(error),
    };
  }
}

export function hasFhenixPermit(fhenixState, contractAddress, account) {
  contractAddress;
  account;

  if (!fhenixState?.client) {
    return false;
  }

  try {
    return Boolean(fhenixState.permitHash);
  } catch (error) {
    return false;
  }
}

export async function ensurePermit(fhenixState) {
  if (!fhenixState?.client) {
    throw new Error("CoFHE client is not initialized.");
  }

  let permit;

  try {
    permit = unwrapFhenixResult(fhenixState.client.getPermit(fhenixState.permitHash || undefined));
  } catch (error) {
    permit = unwrapFhenixResult(await fhenixState.client.createPermit());
  }

  const permitHash = permit.getHash();
  const permission = unwrapFhenixResult(fhenixState.client.getPermission(permitHash));

  return {
    permit,
    permission,
    publicKey: permission.sealingKey || ZERO_BYTES32,
    permitHash,
  };
}

export async function readWithPermit(runtime, fhenixState, contractKey, address, functionName, args = []) {
  runtime;
  fhenixState;
  contractKey;
  address;
  functionName;
  args;

  throw new Error(
    "Legacy permit-backed reads are not supported on the CoFHE Arbitrum Sepolia stack. Use a sealed handle read instead.",
  );
}

export async function readSealedValue(runtime, fhenixState, contractKey, address, functionName, args = []) {
  if (!runtime?.provider) {
    throw new Error("Wallet provider is not available.");
  }

  if (!runtime?.signer) {
    throw new Error("Reconnect the wallet before reading encrypted values.");
  }

  if (!runtime?.account) {
    throw new Error("Connect a wallet to unseal encrypted values.");
  }

  if (!fhenixState?.client) {
    throw new Error("CoFHE client is not initialized.");
  }

  const { FheTypes } = await loadFhenixModule();
  const permitState = await ensurePermit(fhenixState);
  const contract = getContract(contractKey, address, runtime.signer);
  const sealedValue = await contract[functionName](...args, permitState.publicKey);
  const ciphertextHandle = coerceHandle(sealedValue);
  const clearValue = unwrapFhenixResult(
    await fhenixState.client.unseal(
      ciphertextHandle,
      FheTypes.Uint128,
      runtime.account,
      permitState.permitHash,
    ),
    "Failed to unseal encrypted value.",
  );

  return {
    sealedValue: ciphertextHandle.toString(),
    clearValue,
    publicKey: permitState.publicKey,
    permitHash: permitState.permitHash,
  };
}

export async function buildEncryptedAmount(fhenixState, value, { allowPlaceholder = false } = {}) {
  const amount = parseUint(value, "Encrypted amount");

  if (fhenixState?.client) {
    const { Encryptable, FheTypes } = await loadFhenixModule();
    const [encryptedValue] = unwrapFhenixResult(
      await fhenixState.client.encrypt([Encryptable.uint128(amount)]),
      "Failed to encrypt amount with CoFHE.",
    );

    return {
      payload: {
        ctHash: encryptedValue.ctHash,
        securityZone: Number(encryptedValue.securityZone),
        utype: Number(encryptedValue.utype || FheTypes.Uint128),
        signature: encryptedValue.signature,
      },
      placeholder: false,
      amount,
    };
  }

  if (!allowPlaceholder) {
    throw new Error("CoFHE encryption is not ready. Connect a wallet on Arbitrum Sepolia first.");
  }

  return {
    payload: {
      ctHash: 0n,
      securityZone: 0,
      utype: 6,
      signature: "0x",
    },
    placeholder: true,
    amount,
  };
}

export async function inspectContract(provider, address) {
  const normalized = normalizeAddress(address);

  if (!normalized) {
    return {
      address: "",
      configured: false,
      valid: false,
      deployed: false,
    };
  }

  if (!provider) {
    return {
      address: normalized,
      configured: true,
      valid: true,
      deployed: false,
      unknown: true,
    };
  }

  const bytecode = await provider.getCode(normalized);

  return {
    address: normalized,
    configured: true,
    valid: true,
    deployed: bytecode && bytecode !== "0x",
  };
}

export async function inspectAddressMap(provider, addresses) {
  const entries = await Promise.all(
    CONTRACT_ORDER.map(async (contractKey) => [
      contractKey,
      await inspectContract(provider, addresses[contractKey]),
    ]),
  );

  return Object.fromEntries(entries);
}

export async function readCoreSnapshot(provider, coreAddress) {
  const core = getContract("core", coreAddress, provider);

  const [
    owner,
    feeCollector,
    settlementToken,
    vault,
    workflowModule,
    escrowModule,
    complianceModule,
    analyticsModule,
    platformFeeBps,
    backingBalance,
  ] = await Promise.all([
    core.owner(),
    core.feeCollector(),
    core.settlementToken(),
    core.vault(),
    core.workflowModule(),
    core.escrowModule(),
    core.complianceModule(),
    core.analyticsModule(),
    core.platformFeeBps(),
    core.getBackingBalance(),
  ]);

  return {
    owner,
    feeCollector,
    settlementToken,
    vault,
    workflowModule,
    escrowModule,
    complianceModule,
    analyticsModule,
    platformFeeBps: platformFeeBps.toString(),
    backingBalance: backingBalance.toString(),
  };
}

export async function readTokenSnapshot(provider, tokenAddress, owner, spender) {
  if (!provider || !isConfiguredAddress(tokenAddress)) {
    return null;
  }

  const token = new Contract(tokenAddress, CONTRACT_ABIS.token, provider);

  const [decimals, symbol, allowance] = await Promise.all([
    token.decimals().catch(() => 18),
    token.symbol().catch(() => "TOKEN"),
    owner && spender ? token.allowance(owner, spender).catch(() => 0n) : 0n,
  ]);

  return {
    tokenAddress,
    decimals: Number(decimals),
    symbol,
    allowance: allowance.toString(),
    allowanceFormatted: formatUnits(allowance, decimals),
  };
}

export async function encodeWritePreview(contractKey, functionName, args) {
  const iface = getContractInterface(contractKey);
  return iface.encodeFunctionData(functionName, args);
}

function decodeReceiptEvents(contractKey, address, logs = []) {
  if (!contractKey) {
    return [];
  }

  const iface = getContractInterface(contractKey);
  const normalizedAddress = normalizeAddress(address);

  return logs.reduce((events, log) => {
    if (normalizedAddress && normalizeAddress(log.address) !== normalizedAddress) {
      return events;
    }

    try {
      const parsed = iface.parseLog(log);
      events.push({
        name: parsed.name,
        signature: parsed.signature,
        args: toDisplayObject(parsed.args),
      });
    } catch (error) {
      error;
    }

    return events;
  }, []);
}

function extractReceiptIdentifiers(events = []) {
  const identifiers = {};
  const knownKeys = [
    "invoiceId",
    "paymentId",
    "escrowId",
    "roomId",
    "actionId",
    "scheduleId",
    "checkpointId",
  ];

  for (const event of events) {
    for (const key of knownKeys) {
      const value = event?.args?.[key];

      if (value && !(key in identifiers)) {
        identifiers[key] = value;
      }
    }
  }

  return identifiers;
}

async function buildWriteOverrides(runtime) {
  if (!runtime?.provider) {
    return {};
  }

  const [feeData, latestBlock] = await Promise.all([
    runtime.provider.getFeeData().catch(() => null),
    runtime.provider.getBlock("latest").catch(() => null),
  ]);

  const overrides = {};
  const priorityFloor = parseUnits("0.01", "gwei");
  const maxPriorityFeePerGas =
    feeData?.maxPriorityFeePerGas && feeData.maxPriorityFeePerGas > 0n
      ? feeData.maxPriorityFeePerGas
      : priorityFloor;
  const baseFeePerGas =
    latestBlock?.baseFeePerGas && latestBlock.baseFeePerGas > 0n
      ? latestBlock.baseFeePerGas
      : 0n;
  const suggestedMaxFeePerGas =
    feeData?.maxFeePerGas && feeData.maxFeePerGas > 0n
      ? feeData.maxFeePerGas
      : 0n;
  const bufferedBaseFee = baseFeePerGas > 0n ? (baseFeePerGas * 2n) + maxPriorityFeePerGas : 0n;
  const normalizedChainId = String(runtime?.chainId || "");

  if (normalizedChainId === "421614") {
    const gasPriceCandidates = [
      feeData?.gasPrice && feeData.gasPrice > 0n ? feeData.gasPrice : 0n,
      suggestedMaxFeePerGas,
      baseFeePerGas > 0n ? baseFeePerGas * 2n : 0n,
    ].filter((value) => value > 0n);

    if (gasPriceCandidates.length) {
      overrides.gasPrice = gasPriceCandidates.reduce((highest, value) =>
        value > highest ? value : highest,
      0n);
    }

    return overrides;
  }

  if (maxPriorityFeePerGas > 0n) {
    overrides.maxPriorityFeePerGas = maxPriorityFeePerGas;
  }

  if (suggestedMaxFeePerGas > 0n || bufferedBaseFee > 0n) {
    overrides.maxFeePerGas =
      suggestedMaxFeePerGas > bufferedBaseFee ? suggestedMaxFeePerGas : bufferedBaseFee;
  } else if (feeData?.gasPrice && feeData.gasPrice > 0n) {
    overrides.gasPrice = feeData.gasPrice;
  }

  return overrides;
}

export async function sendWrite(runtime, contractKey, address, functionName, args) {
  if (!runtime.signer) {
    throw new Error("Wallet is not connected.");
  }

  const contract = getContract(contractKey, address, runtime.signer);
  const overrides = await buildWriteOverrides(runtime);
  const transaction = await contract[functionName](...args, overrides);
  const receipt = await transaction.wait();
  const decodedEvents = decodeReceiptEvents(contractKey, address, receipt.logs || []);

  return {
    hash: transaction.hash,
    blockNumber: receipt.blockNumber,
    status: receipt.status,
    decodedEvents,
    identifiers: extractReceiptIdentifiers(decodedEvents),
  };
}

export function explainFhenixMode(fhenixState) {
  if (fhenixState.mode === "ready") {
    return {
      tone: "good",
      label: "CoFHE ready",
      detail: "Encrypted uint128 inputs and local handle unsealing are available in-browser.",
    };
  }

  if (fhenixState.mode === "preview") {
    return {
      tone: "warn",
      label: "Preview only",
      detail: fhenixState.error || "UI will use placeholder encrypted tuples for calldata previews.",
    };
  }

  return {
    tone: "muted",
    label: "Offline",
    detail: "Connect a wallet to initialize the CoFHE client.",
  };
}

export function describeInvoiceStatus(status) {
  return INVOICE_STATUS_LABELS[Number(status)] || `Status ${status}`;
}

export function describeEscrowStatus(status) {
  return ESCROW_STATUS_LABELS[Number(status)] || `Status ${status}`;
}

export function describePolicyAction(actionType) {
  return POLICY_ACTION_LABELS[Number(actionType)] || `Action ${actionType}`;
}

export function describeScope(scope) {
  return COMPLIANCE_SCOPE_LABELS[Number(scope)] || `Scope ${scope}`;
}
