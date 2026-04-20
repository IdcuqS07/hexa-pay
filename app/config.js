export const PRIVATE_QUOTE_STORE_MODE_STORAGE_KEY = "pq.storeMode";
export const PRIVATE_QUOTE_STORE_MODES = ["local", "mock-registry", "mock-api"];
export const PRIVATE_QUOTE_PHASE_LABEL = "Bootstrap";
export const DEFAULT_LIVE_PRIVATE_QUOTE_STORE_MODE = "mock-api";

export function isLocalDevelopmentHost() {
  if (typeof window === "undefined") {
    return true;
  }

  const hostname = String(window.location.hostname || "").toLowerCase();
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname.endsWith(".local")
  );
}

export function isPrivateQuoteDevControlsEnabled() {
  return (
    String(import.meta.env.VITE_ENABLE_PRIVATE_QUOTE_DEV_MODE || "") === "1" ||
    isLocalDevelopmentHost()
  );
}

export function getDefaultPrivateQuoteStoreMode() {
  return isPrivateQuoteDevControlsEnabled()
    ? "local"
    : DEFAULT_LIVE_PRIVATE_QUOTE_STORE_MODE;
}

export function isValidPrivateQuoteStoreMode(mode) {
  return PRIVATE_QUOTE_STORE_MODES.includes(String(mode || ""));
}

export function getPrivateQuoteStoreMode() {
  if (typeof window === "undefined") {
    return getDefaultPrivateQuoteStoreMode();
  }

  if (!isPrivateQuoteDevControlsEnabled()) {
    return DEFAULT_LIVE_PRIVATE_QUOTE_STORE_MODE;
  }

  const params = new URLSearchParams(window.location.search);
  const queryMode = params.get("storeMode");

  if (isValidPrivateQuoteStoreMode(queryMode)) {
    return queryMode;
  }

  try {
    const storedMode = window.localStorage.getItem(PRIVATE_QUOTE_STORE_MODE_STORAGE_KEY);

    if (isValidPrivateQuoteStoreMode(storedMode)) {
      return storedMode;
    }
  } catch (error) {
    error;
  }

  return getDefaultPrivateQuoteStoreMode();
}

export function setPrivateQuoteStoreMode(mode, { syncUrl = true } = {}) {
  const nextMode = isPrivateQuoteDevControlsEnabled()
    ? isValidPrivateQuoteStoreMode(mode)
      ? String(mode)
      : getDefaultPrivateQuoteStoreMode()
    : DEFAULT_LIVE_PRIVATE_QUOTE_STORE_MODE;

  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(PRIVATE_QUOTE_STORE_MODE_STORAGE_KEY, nextMode);
    } catch (error) {
      error;
    }

    if (syncUrl) {
      const url = new URL(window.location.href);
      if (isPrivateQuoteDevControlsEnabled()) {
        url.searchParams.set("storeMode", nextMode);
      } else {
        url.searchParams.delete("storeMode");
      }
      window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
    }
  }

  return nextMode;
}

export function getPrivateQuoteStoreModeLabel(mode = getPrivateQuoteStoreMode()) {
  switch (String(mode || "")) {
    case "mock-api":
      return "Mock API";
    case "mock-registry":
      return "Mock Registry";
    case "local":
    default:
      return "Local";
  }
}

export function appendPrivateQuoteStoreMode(url, mode = getPrivateQuoteStoreMode()) {
  const nextUrl = url instanceof URL ? new URL(url.toString()) : new URL(String(url), window.location.origin);
  const nextMode = isValidPrivateQuoteStoreMode(mode) ? String(mode) : getPrivateQuoteStoreMode();
  if (isPrivateQuoteDevControlsEnabled()) {
    nextUrl.searchParams.set("storeMode", nextMode);
  } else {
    nextUrl.searchParams.delete("storeMode");
  }
  return nextUrl;
}
