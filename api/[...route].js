const { createReceiptApiMiddleware } = require("../app/mock-receipt-api-plugin.cjs");

let middlewareInstance = null;

function getMiddleware() {
  if (!middlewareInstance) {
    middlewareInstance = createReceiptApiMiddleware();
  }

  return middlewareInstance;
}

function appendQueryParams(searchParams, key, value) {
  if (value === undefined || value === null) {
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((entry) => appendQueryParams(searchParams, key, entry));
    return;
  }

  searchParams.append(key, String(value));
}

function normalizeApiUrl(req) {
  const currentUrl = typeof req.url === "string" ? req.url : "";

  if (currentUrl.startsWith("/api/")) {
    return currentUrl;
  }

  const routeValue = req?.query?.route;
  const routeSegments = Array.isArray(routeValue)
    ? routeValue
    : routeValue !== undefined
      ? [routeValue]
      : [];
  const pathname = `/api/${routeSegments.map((segment) => encodeURIComponent(String(segment))).join("/")}`;
  const searchParams = new URLSearchParams();

  Object.entries(req?.query || {}).forEach(([key, value]) => {
    if (key === "route") {
      return;
    }

    appendQueryParams(searchParams, key, value);
  });

  const queryString = searchParams.toString();
  return queryString ? `${pathname}?${queryString}` : pathname;
}

module.exports = async function handler(req, res) {
  req.url = normalizeApiUrl(req);

  return getMiddleware()(req, res, () => {
    res.statusCode = 404;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ error: "API endpoint not found" }));
  });
};

module.exports.config = {
  api: {
    bodyParser: false,
  },
};
