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
      // @blobbi/core and @blobbi/react resolve through their installed package
      // exports in node_modules (file: deps on ../blobbi-kit), not source aliases.
      { find: "@", replacement: path.resolve(__dirname, "./src") },
      { find: "react", replacement: path.resolve(__dirname, "node_modules/react") },
      { find: "react-dom", replacement: path.resolve(__dirname, "node_modules/react-dom") },
    ],
    // The @blobbi/* packages are file: deps symlinked from ../blobbi-kit, which
    // has its own node_modules. Dedupe the React-context-bearing singletons so a
    // symlinked package can't pull in a second copy (which breaks useContext).
    dedupe: [
      "react",
      "react-dom",
      "react/jsx-runtime",
      "@nostrify/react",
      "@tanstack/react-query",
    ],
  },
}));