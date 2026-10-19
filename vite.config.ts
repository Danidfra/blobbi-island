import path from "node:path";

import react from "@vitejs/plugin-react-swc";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";

import { checkTravelBuild } from "./src/worlds/travel-build";

/**
 * World Travel (`src/worlds`): a setting this build cannot honour stops it, and
 * a build that carries World Travel on Nostr says so. The same guard as Blobbi
 * Home's and Blobbi Pixel's, so no Blobbi app compiles the switch off quietly.
 */
function worldTravelGuard(): Plugin {
  return {
    name: "blobbi-world-travel-guard",
    configResolved(config) {
      const check = checkTravelBuild({ travel: config.env.VITE_BLOBBI_WORLD_TRAVEL, command: config.command });
      if (!check.ok) throw new Error(check.message);
      if (check.message) config.logger.warn(check.message);
    },
  };
}

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
    worldTravelGuard(),
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
  resolve: {
    alias: [
      // @blobbi-kit/core, @blobbi-kit/react and @blobbi-kit/renderer resolve
      // from their published npm packages in node_modules; no source aliases.
      { find: "@", replacement: path.resolve(__dirname, "./src") },
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