import { CONTRACT_METADATA, CONTRACT_ORDER } from "./abis.js";

const STORAGE_KEY = "hexapay.contract-addresses.v1";
const SELECTED_CHAIN_KEY = "hexapay.selected-chain.v2";

export const DEFAULT_CHAIN_ID = "421614";

export const CHAIN_METADATA = {
  "421614": {
    chainId: "421614",
    chainHex: "0x66eee",
    label: "Arbitrum Sepolia",
    shortLabel: "Arb Sepolia",
    rpcUrl: "https://sepolia-rollup.arbitrum.io/rpc",
    explorerUrl: "https://sepolia.arbiscan.io",
    nativeCurrency: {
      name: "Arbitrum Sepolia ETH",
      symbol: "ETH",
      decimals: 18,
    },
  },
  "8008420": {
    chainId: "8008420",
    chainHex: "0x7a32e4",
    label: "Fhenix Helium (Legacy)",
    shortLabel: "Helium",
    rpcUrl: "https://api.helium.fhenix.zone",
    explorerUrl: "https://explorer.helium.fhenix.zone",
    nativeCurrency: {
      name: "tFHE",
      symbol: "tFHE",
      decimals: 18,
    },
  },
  "31337": {
    chainId: "31337",
    chainHex: "0x7a69",
    label: "Hardhat Local",
    shortLabel: "Local",
    rpcUrl: "http://127.0.0.1:8545",
    explorerUrl: "",
    nativeCurrency: {
      name: "ETH",
      symbol: "ETH",
      decimals: 18,
    },
  },
};

const NETWORK_TO_CHAIN_ID = {
  "arb-sepolia": "421614",
  arbitrumSepolia: "421614",
  "arbitrum-sepolia": "421614",
  arbSepolia: "421614",
  fhenix: "8008420",
  fhenixTestnet: "8008420",
  localhost: "31337",
  hardhat: "31337",
};

function emptyAddressMap() {
  return CONTRACT_ORDER.reduce((accumulator, key) => {
    accumulator[key] = "";
    return accumulator;
  }, {});
}

export function getChainMetadata(chainId) {
  return CHAIN_METADATA[String(chainId)] || {
    chainId: String(chainId || DEFAULT_CHAIN_ID),
    chainHex: chainId ? `0x${Number(chainId).toString(16)}` : "0x0",
    label: `Chain ${chainId || DEFAULT_CHAIN_ID}`,
    shortLabel: "Custom",
    rpcUrl: "",
    explorerUrl: "",
    nativeCurrency: {
      name: "Native",
      symbol: "NATIVE",
      decimals: 18,
    },
  };
}

export function getLastSelectedChainId() {
  if (typeof window === "undefined") {
    return DEFAULT_CHAIN_ID;
  }

  return window.localStorage.getItem(SELECTED_CHAIN_KEY) || DEFAULT_CHAIN_ID;
}

export function setLastSelectedChainId(chainId) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(SELECTED_CHAIN_KEY, String(chainId));
}

function readStoredConfigs() {
  if (typeof window === "undefined") {
    return {};
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (error) {
    console.warn("Failed to parse stored HexaPay config:", error);
    return {};
  }
}

function writeStoredConfigs(configs) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(configs));
}

function getEnvDefaults() {
  return {
    core: import.meta.env[CONTRACT_METADATA.core.envKey] || "",
    workflow: import.meta.env[CONTRACT_METADATA.workflow.envKey] || "",
    escrow: import.meta.env[CONTRACT_METADATA.escrow.envKey] || "",
    compliance: import.meta.env[CONTRACT_METADATA.compliance.envKey] || "",
    analytics: import.meta.env[CONTRACT_METADATA.analytics.envKey] || "",
  };
}

export function getAddressConfig(chainId) {
  const allConfigs = readStoredConfigs();
  const savedChainConfig = allConfigs[String(chainId)] || {};

  return {
    ...emptyAddressMap(),
    ...getEnvDefaults(),
    ...savedChainConfig,
  };
}

export function saveAddressConfig(chainId, addresses) {
  const allConfigs = readStoredConfigs();
  allConfigs[String(chainId)] = {
    ...emptyAddressMap(),
    ...addresses,
  };
  writeStoredConfigs(allConfigs);
}

export function resetAddressConfig(chainId) {
  const allConfigs = readStoredConfigs();
  delete allConfigs[String(chainId)];
  writeStoredConfigs(allConfigs);
  return getAddressConfig(chainId);
}

export function normalizeDeploymentManifest(payload) {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const chainId =
    payload.chainId?.toString() ||
    payload.ui?.chainId?.toString() ||
    NETWORK_TO_CHAIN_ID[payload.network] ||
    DEFAULT_CHAIN_ID;

  const addresses = {
    core: payload.ui?.addresses?.core || payload.core || payload.hexaPay || "",
    workflow: payload.ui?.addresses?.workflow || payload.workflow || payload.workflowModule || "",
    escrow: payload.ui?.addresses?.escrow || payload.escrow || payload.escrowModule || "",
    compliance:
      payload.ui?.addresses?.compliance || payload.compliance || payload.complianceModule || "",
    analytics:
      payload.ui?.addresses?.analytics || payload.analytics || payload.analyticsModule || "",
  };

  return {
    chainId,
    network: payload.network || getChainMetadata(chainId).shortLabel,
    deployedAt: payload.deployedAt || "",
    source: payload.source || "/deployment.json",
    addresses,
    raw: payload,
  };
}

export async function loadDeploymentManifest() {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const response = await fetch(`/deployment.json?t=${Date.now()}`, {
      cache: "no-store",
    });

    if (!response.ok) {
      return null;
    }

    const payload = await response.json();
    return normalizeDeploymentManifest(payload);
  } catch (error) {
    return null;
  }
}
