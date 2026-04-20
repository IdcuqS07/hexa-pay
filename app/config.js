export const PRIVATE_QUOTE_STORE_MODE_STORAGE_KEY = "pq.storeMode";
export const PRIVATE_QUOTE_STORE_MODES = ["local", "mock-registry", "mock-api"];
export const PRIVATE_QUOTE_PHASE_LABEL = "Bootstrap";

export function isValidPrivateQuoteStoreMode(mode) {
  return PRIVATE_QUOTE_STORE_MODES.includes(String(mode || ""));
}

export function getPrivateQuoteStoreMode() {
  if (typeof window === "undefined") {
    return "local";
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

  return "local";
}

export function setPrivateQuoteStoreMode(mode, { syncUrl = true } = {}) {
  const nextMode = isValidPrivateQuoteStoreMode(mode) ? String(mode) : "local";

  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(PRIVATE_QUOTE_STORE_MODE_STORAGE_KEY, nextMode);
    } catch (error) {
      error;
    }

    if (syncUrl) {
      const url = new URL(window.location.href);
      url.searchParams.set("storeMode", nextMode);
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
  nextUrl.searchParams.set("storeMode", nextMode);
  return nextUrl;
}
