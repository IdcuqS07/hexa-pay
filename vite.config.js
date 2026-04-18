const { resolve } = require("path");
const { defineConfig } = require("vite");

const isolationHeaders = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
};

module.exports = defineConfig({
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
        hexapay: resolve(__dirname, "hexapay.html"),
      },
    },
  }
});
