const { resolve } = require("path");
const { defineConfig, loadEnv } = require("vite");
const react = require("@vitejs/plugin-react");
const { createMockReceiptApiPlugin } = require("./app/mock-receipt-api-plugin.cjs");

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
    plugins: [react(), createMockReceiptApiPlugin()],
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
