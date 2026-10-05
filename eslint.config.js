// @ts-check
import js from "@eslint/js";
import astro from "eslint-plugin-astro";
import { defineConfig, globalIgnores } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig(
  globalIgnores(["**/dist/", "**/.astro/", "**/.wrangler/", "output/", "apps/website/content/"]),
  js.configs.recommended,
  tseslint.configs.recommended,
  astro.configs.recommended,
  {
    languageOptions: { globals: globals.node },
    linterOptions: { reportUnusedDisableDirectives: "error" },
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", ignoreRestSiblings: true }],
      "@typescript-eslint/consistent-type-imports": ["error", { fixStyle: "inline-type-imports" }],
    },
  },
  {
    // Cloudflare Pages Functions run in the Workers runtime, not Node.
    files: ["apps/website/functions/**"],
    languageOptions: { globals: globals.serviceworker },
  },
);
