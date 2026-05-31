const { resolve } = require("path");
const { defineConfig, loadEnv } = require("vite");
const react = require("@vitejs/plugin-react");
const { createMockReceiptApiPlugin } = require("./app/mock-receipt-api-plugin.cjs");

function createCleanRouteRewritePlugin() {
  const rewrites = [
    {
      pattern: /^\/app(?:\/(?:dashboard|send|treasury|invoices|private-quotes|policy|escrow|compliance|analytics|activity))?\/?$/,
      target: "/app.html",
    },
    {
      pattern: /^\/pay(?:\/[^/]+)?\/?$/,
      target: "/pay.html",
    },
    {
      pattern: /^\/audit(?:\/[^/]+)?\/?$/,
      target: "/audit.html",
    },
    {
      pattern: /^\/workspace\/?$/,
      target: "/hexapay.html",
    },
    {
      pattern: /^\/payment-intent\/?$/,
      target: "/payment-intent.html",
    },
  ];

  function shouldRewrite(requestUrl = "", headers = {}) {
    if (!requestUrl) {
      return false;
    }

    const url = new URL(requestUrl, "http://localhost");
    const accept = String(headers.accept || "");

    if (url.pathname.startsWith("/api/") || /\.[a-z0-9]+$/i.test(url.pathname)) {
      return false;
    }

    return accept.includes("text/html") || accept.includes("*/*");
  }

  function applyRewrite(req) {
    if (!req?.url || !["GET", "HEAD"].includes(String(req.method || "GET").toUpperCase())) {
      return;
    }

    if (!shouldRewrite(req.url, req.headers || {})) {
      return;
    }

    const url = new URL(req.url, "http://localhost");
    const match = rewrites.find((entry) => entry.pattern.test(url.pathname));

    if (!match) {
      return;
    }

    req.url = `${match.target}${url.search}`;
  }

  return {
    name: "hexapay-clean-route-rewrites",
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        applyRewrite(req);
        next();
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, _res, next) => {
        applyRewrite(req);
        next();
      });
    },
  };
}

const isolationHeaders = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
};

module.exports = defineConfig(({ mode }) => {
  // Load env file based on `mode` in the current working directory.
  const env = loadEnv(mode, process.cwd(), '');
  
  // Expose env to process.env for the plugin
  Object.assign(process.env, env);

  return {
    plugins: [react(), createCleanRouteRewritePlugin(), createMockReceiptApiPlugin()],
    resolve: {
      alias: [
        {
          find: /^tweetnacl$/,
          replacement: resolve(__dirname, "src/contracts/tweetnacl-shim.js"),
        },
        {
          find: /^iframe-shared-storage$/,
          replacement: resolve(__dirname, "src/contracts/iframe-shared-storage-shim.js"),
        },
      ],
    },
    optimizeDeps: {
      exclude: [
        "@cofhe/sdk",
        "@cofhe/sdk/web",
        "@cofhe/sdk/adapters",
        "@cofhe/sdk/chains",
        "iframe-shared-storage",
        "tfhe",
      ],
    },
    server: {
      port: 3000,
      open: true,
      headers: isolationHeaders,
    },
    preview: {
      headers: isolationHeaders,
    },
    worker: {
      format: "es",
    },
    build: {
      outDir: 'dist',
      assetsDir: 'assets',
      minify: 'esbuild',
      sourcemap: false,
      rollupOptions: {
        input: {
          main: resolve(__dirname, "index.html"),
          app: resolve(__dirname, "app.html"),
          pay: resolve(__dirname, "pay.html"),
          audit: resolve(__dirname, "audit.html"),
          hexapay: resolve(__dirname, "hexapay.html"),
          paymentIntent: resolve(__dirname, "payment-intent.html"),
        },
      },
    }
  };
});
