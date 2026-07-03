import path from "node:path";

import react from "@vitejs/plugin-react-swc";
import { defineConfig } from "vitest/config";

// https://vitejs.dev/config/
export default defineConfig(() => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      protocol: 'ws',
      host: 'localhost',
      clientPort: 8080,
    },
  },
  plugins: [
    react(),
  ],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom'],
          router: ['react-router-dom'],
          query: ['@tanstack/react-query'],
          nostr: ['@nostrify/nostrify', '@nostrify/react', 'nostr-tools'],
          radix: ['@radix-ui/react-dialog', '@radix-ui/react-dropdown-menu', '@radix-ui/react-toast', '@radix-ui/react-tooltip'],
          icons: ['lucide-react', '@tabler/icons-react'],
          forms: ['react-hook-form', '@hookform/resolvers', 'zod'],
          utils: ['clsx', 'tailwind-merge', 'date-fns'],
        },
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    onConsoleLog(log) {
      return !log.includes("React Router Future Flag Warning");
    },
    env: {
      DEBUG_PRINT_LIMIT: '0', // Suppress DOM output that exceeds AI context windows
    },
  },
  resolve: {
    alias: [
      // Shared Blobbi packages consumed locally from the Ditto repo source.
      // NOTE: local source integration only — not published to npm.
      // Order matters: subpath aliases (`/*`) must precede the bare aliases.
      {
        find: /^@blobbi\/core\/(.*)$/,
        replacement: path.resolve(
          __dirname,
          "../ditto/packages/blobbi-core/src/$1",
        ),
      },
      {
        find: "@blobbi/core",
        replacement: path.resolve(
          __dirname,
          "../ditto/packages/blobbi-core/src/index.ts",
        ),
      },
      {
        find: /^@blobbi\/react\/(.*)$/,
        replacement: path.resolve(
          __dirname,
          "../ditto/packages/blobbi-react/src/$1",
        ),
      },
      {
        find: "@blobbi/react",
        replacement: path.resolve(
          __dirname,
          "../ditto/packages/blobbi-react/src/index.ts",
        ),
      },
      { find: "@", replacement: path.resolve(__dirname, "./src") },
      { find: "react", replacement: path.resolve(__dirname, "node_modules/react") },
      { find: "react-dom", replacement: path.resolve(__dirname, "node_modules/react-dom") },
    ],
    dedupe: ["react", "react-dom", "react/jsx-runtime"],
  },
}));