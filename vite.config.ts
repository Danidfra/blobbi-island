import path from "node:path";

import react from "@vitejs/plugin-react-swc";
import { searchForWorkspaceRoot } from "vite";
import { defineConfig } from "vitest/config";

// https://vitejs.dev/config/
export default defineConfig(() => ({
  server: {
    host: "::",
    port: 8080,
    fs: {
      // The `file:` renderer dependency lives outside the project root.
      allow: [searchForWorkspaceRoot(process.cwd()), '../blobbi-kit/packages/blobbi-renderer'],
    },
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
          utils: ['clsx', 'tailwind-merge', 'zod'],
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
  // `@blobbi/renderer` is consumed from the sibling blobbi-kit checkout through
  // an npm `file:` dependency (see package.json) until it is published. npm
  // symlinks it into node_modules, and Vite resolves the symlink to its real
  // path outside this project root, so the built `dist/` must be allowed to be
  // served in dev and is kept out of dependency pre-bundling so a rebuild in
  // blobbi-kit shows up without clearing Vite's cache. When the package is
  // published, delete the `file:` dependency, this block and the `fs.allow`
  // entry below.
  optimizeDeps: {
    exclude: ['@blobbi/renderer'],
  },
  resolve: {
    alias: [
      // @blobbi-kit/core and @blobbi-kit/react resolve from their published
      // npm packages in node_modules; no source aliases. @blobbi/renderer
      // resolves through its `file:` symlink, also without a source alias.
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