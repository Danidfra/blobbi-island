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
          // Planck (Box2D) is only used by the arcade's Pool table. Split out so
          // its ~49 kB gzipped is a separately cacheable chunk rather than
          // inflating the main gameplay bundle on every deploy.
          physics: ['planck'],
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
  // `@blobbi/react` is a LOCAL, unpublished workspace package (packages/*), so it
  // is consumed from TypeScript source through the npm workspace symlink rather
  // than from a build artifact: no build ordering, and no stale `dist` shadowing
  // an edit. Excluding it from dep pre-bundling keeps that source path honest in
  // dev. `npm run build:package` produces the publishable ESM + .d.ts output.
  optimizeDeps: {
    exclude: ['@blobbi/react'],
  },
  resolve: {
    alias: [
      // @blobbi-kit/core and @blobbi-kit/react resolve from their published
      // npm packages in node_modules — no source aliases. @blobbi/react
      // resolves through its workspace symlink, also without a source alias.
      { find: "@", replacement: path.resolve(__dirname, "./src") },
      { find: "react", replacement: path.resolve(__dirname, "node_modules/react") },
      { find: "react-dom", replacement: path.resolve(__dirname, "node_modules/react-dom") },
    ],
    // Dedupe the React-context-bearing singletons so that @blobbi-kit/* (and any
    // transitive dep) can't pull in a second copy, which would break useContext.
    dedupe: [
      "react",
      "react-dom",
      "react/jsx-runtime",
      "@nostrify/react",
      "@tanstack/react-query",
    ],
  },
}));