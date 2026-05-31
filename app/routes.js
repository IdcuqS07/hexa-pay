export const DEFAULT_APP_VIEW = "dashboard";

export const APP_ROUTE_VIEWS = [
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
];

const APP_ROUTE_VIEW_SET = new Set(APP_ROUTE_VIEWS);

function getOrigin(origin = "") {
  if (origin) {
    return origin;
  }

  if (typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin;
  }

  return "http://localhost";
}

function normalizePathname(pathname = "/") {
  const normalized = `/${String(pathname || "/")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "")}`;

  return normalized === "/" ? "/" : normalized;
}

function createUrl(input = "", origin = "") {
  if (input instanceof URL) {
    return new URL(input.toString());
  }

  if (typeof input === "object" && input?.href) {
    return new URL(String(input.href), getOrigin(origin));
  }

  return new URL(String(input || "/"), getOrigin(origin));
}

function toRelative(url) {
  return `${url.pathname}${url.search}${url.hash}`;
}

export function normalizeAppView(view = "") {
  const normalized = String(view || "").replace(/^#/, "").trim().toLowerCase();
  return APP_ROUTE_VIEW_SET.has(normalized) ? normalized : DEFAULT_APP_VIEW;
}

export function getAppViewFromLocation(locationLike = "", origin = "") {
  const url = createUrl(
    locationLike || (typeof window !== "undefined" ? window.location.href : "/"),
    origin,
  );
  const pathname = normalizePathname(url.pathname);

  if (pathname === "/app") {
    return DEFAULT_APP_VIEW;
  }

  if (pathname.startsWith("/app/")) {
    const [, , view = ""] = pathname.split("/");
    return normalizeAppView(view);
  }

  const queryView = url.searchParams.get("view");

  if (APP_ROUTE_VIEW_SET.has(String(queryView || ""))) {
    return normalizeAppView(queryView);
  }

  return normalizeAppView(url.hash);
}

export function buildAppUrl(view = DEFAULT_APP_VIEW, { origin = "", absolute = true } = {}) {
  const url = createUrl(`/app/${normalizeAppView(view)}`, origin);
  return absolute ? url.toString() : toRelative(url);
}

export function buildPaymentIntentUrl({ origin = "", absolute = true } = {}) {
  const url = createUrl("/payment-intent", origin);
  return absolute ? url.toString() : toRelative(url);
}

export function buildWorkspaceUrl(entry = "", { origin = "", absolute = true } = {}) {
  const url = createUrl("/workspace", origin);

  if (entry) {
    url.searchParams.set("entry", String(entry));
  }

  return absolute ? url.toString() : toRelative(url);
}

export function getPayQuoteIdFromLocation(locationLike = "", origin = "") {
  const url = createUrl(
    locationLike || (typeof window !== "undefined" ? window.location.href : "/pay"),
    origin,
  );
  const pathname = normalizePathname(url.pathname);

  if (pathname.startsWith("/pay/")) {
    return decodeURIComponent(pathname.slice("/pay/".length));
  }

  return String(url.searchParams.get("id") || "").trim();
}

export function buildPayUrl(
  quoteId = "",
  { origin = "", absolute = true, entry = "" } = {},
) {
  const normalizedQuoteId = String(quoteId || "").trim();
  const path = normalizedQuoteId ? `/pay/${encodeURIComponent(normalizedQuoteId)}` : "/pay";
  const url = createUrl(path, origin);

  if (entry) {
    url.searchParams.set("entry", String(entry));
  }

  return absolute ? url.toString() : toRelative(url);
}

export function buildPayIntentUrl({ origin = "", absolute = true, entry = "" } = {}) {
  const url = createUrl("/pay", origin);

  if (entry) {
    url.searchParams.set("entry", String(entry));
  }

  return absolute ? url.toString() : toRelative(url);
}

export function getAuditQuoteIdFromLocation(locationLike = "", origin = "") {
  const url = createUrl(
    locationLike || (typeof window !== "undefined" ? window.location.href : "/audit"),
    origin,
  );
  const pathname = normalizePathname(url.pathname);

  if (pathname.startsWith("/audit/")) {
    return decodeURIComponent(pathname.slice("/audit/".length));
  }

  return String(url.searchParams.get("id") || "").trim();
}

export function buildAuditUrl(quoteId = "", { origin = "", absolute = true } = {}) {
  const normalizedQuoteId = String(quoteId || "").trim();
  const path = normalizedQuoteId
    ? `/audit/${encodeURIComponent(normalizedQuoteId)}`
    : "/audit";
  const url = createUrl(path, origin);
  return absolute ? url.toString() : toRelative(url);
}
