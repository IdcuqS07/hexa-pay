export const PRIVATE_QUOTE_STORE_MODE_STORAGE_KEY = "pq.storeMode";
export const PRIVATE_QUOTE_STORE_MODES = ["api", "registry", "local"];
export const PRIVATE_QUOTE_PHASE_LABEL = "Live";
export const DEFAULT_LIVE_PRIVATE_QUOTE_STORE_MODE = "api";
let forceLivePrivateQuoteStoreMode = false;

const PRIVATE_QUOTE_STORE_MODE_ALIASES = {
  api: "api",
  "mock-api": "api",
  registry: "registry",
  "mock-registry": "registry",
  local: "local",
};

export function normalizePrivateQuoteStoreMode(mode) {
  return PRIVATE_QUOTE_STORE_MODE_ALIASES[String(mode || "").trim().toLowerCase()] || "";
}

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
  if (forceLivePrivateQuoteStoreMode) {
    return false;
  }

  return (
    String(import.meta.env.VITE_ENABLE_PRIVATE_QUOTE_DEV_MODE || "") === "1" ||
    isLocalDevelopmentHost()
  );
}

export function setPrivateQuoteLiveModeOverride(forceLive = false) {
  forceLivePrivateQuoteStoreMode = Boolean(forceLive);
}

export function getDefaultPrivateQuoteStoreMode() {
  return DEFAULT_LIVE_PRIVATE_QUOTE_STORE_MODE;
}

export function isValidPrivateQuoteStoreMode(mode) {
  return PRIVATE_QUOTE_STORE_MODES.includes(normalizePrivateQuoteStoreMode(mode));
}

export function getPrivateQuoteStoreModeOptions() {
  const options = [
    { value: "api", label: "Receipt API" },
  ];

  if (isPrivateQuoteDevControlsEnabled()) {
    options.push(
      { value: "registry", label: "Browser Registry" },
      { value: "local", label: "Browser Local" },
    );
  }

  return options;
}

export function getPrivateQuoteStoreMode() {
  if (typeof window === "undefined") {
    return getDefaultPrivateQuoteStoreMode();
  }

  if (!isPrivateQuoteDevControlsEnabled()) {
    return DEFAULT_LIVE_PRIVATE_QUOTE_STORE_MODE;
  }

  const params = new URLSearchParams(window.location.search);
  const queryMode = normalizePrivateQuoteStoreMode(params.get("storeMode"));

  if (isValidPrivateQuoteStoreMode(queryMode)) {
    return queryMode;
  }

  try {
    const storedMode = normalizePrivateQuoteStoreMode(
      window.localStorage.getItem(PRIVATE_QUOTE_STORE_MODE_STORAGE_KEY),
    );

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
      ? normalizePrivateQuoteStoreMode(mode)
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
      if (isPrivateQuoteDevControlsEnabled() && nextMode !== DEFAULT_LIVE_PRIVATE_QUOTE_STORE_MODE) {
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
  switch (normalizePrivateQuoteStoreMode(mode)) {
    case "api":
      return "Receipt API";
    case "registry":
      return "Browser Registry";
    case "local":
    default:
      return "Browser Local";
  }
}

export function appendPrivateQuoteStoreMode(url, mode = getPrivateQuoteStoreMode()) {
  const nextUrl = url instanceof URL ? new URL(url.toString()) : new URL(String(url), window.location.origin);
  const nextMode = isValidPrivateQuoteStoreMode(mode)
    ? normalizePrivateQuoteStoreMode(mode)
    : getPrivateQuoteStoreMode();
  if (isPrivateQuoteDevControlsEnabled() && nextMode !== DEFAULT_LIVE_PRIVATE_QUOTE_STORE_MODE) {
    nextUrl.searchParams.set("storeMode", nextMode);
  } else {
    nextUrl.searchParams.delete("storeMode");
  }
  return nextUrl;
}
