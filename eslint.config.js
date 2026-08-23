import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";
import htmlEslint from "@html-eslint/eslint-plugin";
import htmlParser from "@html-eslint/parser";
import customRules from "./eslint-rules/index.js";

export default tseslint.config(
  { ignores: ["dist", "packages/*/dist"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    linterOptions: {
      noInlineConfig: true, // Prevents all eslint-disable comments
      reportUnusedDisableDirectives: "error", // Reports unused disable directives as errors
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
      "custom": customRules,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          "argsIgnorePattern": "^_",
          "varsIgnorePattern": "^_",
          "ignoreRestSiblings": true,
        },
      ],
      "custom/no-placeholder-comments": "error",
      "no-warning-comments": [
        "error",
        { terms: ["fixme"] },
      ],
    },
  },
  {
    // The safety layer's one architectural rule, enforced where it is cheapest
    // to notice: OUTSIDE `src/safety/`, code consumes CAPABILITIES.
    //
    // `useIslandSafetyPolicy`, the `IslandSafetyPolicy` type, the provider and
    // the pure admission helpers are all freely importable — those are the
    // capability surface. What is restricted is everything that would let a call
    // site ask *who the player is* instead: the profile union, the two policy
    // literals and the resolver. A feature that reaches for those has found a
    // missing capability, and the fix is to add one rather than to branch on a
    // profile. See `src/safety/island-safety-policy.ts` and
    // `docs/family-safety-policy.md`.
    //
    // Tests are exempt: asserting the matrix is exactly what they are for.
    // `src/safety/boundaries.test.ts` is the belt to this rule's braces — it
    // checks the real import graph, so a relative-path import cannot slip past.
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/safety/**", "src/**/*.test.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@/safety",
              importNames: [
                "ExperienceProfile",
                "EXPERIENCE_PROFILES",
                "isExperienceProfile",
                "STANDARD_POLICY",
                "FAMILY_POLICY",
                "resolveSafetyPolicy",
                "ACTIVE_EXPERIENCE_PROFILE",
                "IslandSafetyPolicyContext",
              ],
              message:
                "Consume a capability, not a profile: use useIslandSafetyPolicy() and read the capability you need (adding one to IslandSafetyPolicy if it is missing).",
            },
          ],
          patterns: [
            {
              group: ["@/safety/*", "**/safety/*"],
              message:
                "Import the safety layer through its barrel ('@/safety'), which is where the capability surface is defined.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["**/*.html"],
    plugins: {
      "@html-eslint": htmlEslint,
      "custom": customRules,
    },
    languageOptions: {
      parser: htmlParser,
    },
    rules: {
      "@html-eslint/require-title": "error",
      "@html-eslint/require-meta-charset": "error",
      "@html-eslint/require-meta-description": "error",
      "@html-eslint/require-meta-viewport": "error",
      "@html-eslint/require-open-graph-protocol": [
        "error",
        [
          "og:type",
          "og:title",
          "og:description",
        ],
      ],
      "custom/no-inline-script": "error",
      "custom/require-webmanifest": "error",
    },
  }
);
