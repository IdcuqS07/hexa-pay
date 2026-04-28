export const WALLET_SESSION_STORAGE_KEY = "hexapay_wallet_session_v1";
export const WALLET_PROVIDER_STORAGE_KEY = "hexapay_wallet_provider_v1";

export function isWalletSessionEnabled() {
  if (typeof window === "undefined") {
    return true;
  }

  return window.localStorage.getItem(WALLET_SESSION_STORAGE_KEY) !== "disabled";
}

export function setWalletSessionEnabled(enabled) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(WALLET_SESSION_STORAGE_KEY, enabled ? "enabled" : "disabled");
}

export function getStoredWalletProviderId() {
  if (typeof window === "undefined") {
    return "";
  }

  return window.localStorage.getItem(WALLET_PROVIDER_STORAGE_KEY) || "";
}

export function setStoredWalletProviderId(walletId) {
  if (typeof window === "undefined") {
    return;
  }

  if (!walletId) {
    window.localStorage.removeItem(WALLET_PROVIDER_STORAGE_KEY);
    return;
  }

  window.localStorage.setItem(WALLET_PROVIDER_STORAGE_KEY, walletId);
}
