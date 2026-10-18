import { defineConfig } from "vite-plus";

export default defineConfig({
  staged: {
    "*": "vp check --fix",
  },

  pack: {
    dts: true,
    hash: false,
    entry: { index: "src/index.ts", fetch: "src/handler/fetch.ts" },
  },

  lint: {
    plugins: ["oxc", "eslint", "typescript", "unicorn", "import", "react"],
    categories: { correctness: "error" },

    rules: {
      "eqeqeq": ["warn", "smart"],
      "no-unused-vars": ["warn", { fix: { imports: "safe-fix" } }],

      "react/rules-of-hooks": "warn",
      "react/exhaustive-deps": "warn",

      "typescript/no-explicit-any": "warn",
      "typescript/prefer-ts-expect-error": "warn",

      "typescript/unbound-method": "off",
      "typescript/restrict-template-expressions": "off",

      "vite-plus/prefer-vite-plus-imports": "error",
      "import/consistent-type-specifier-style": "warn",
    },

    options: {
      typeAware: true,
      typeCheck: true,
    },

    jsPlugins: [
      {
        name: "vite-plus",
        specifier: "vite-plus/oxlint-plugin",
      },
    ],

    ignorePatterns: [".github/**", "**/vendor/**", "**/*.gen.ts"],
  },

  fmt: {
    sortTailwindcss: { functions: ["cn", "tv", "cva", "clsx"] },

    printWidth: 140,
    proseWrap: "never",
    quoteProps: "consistent",
    htmlWhitespaceSensitivity: "ignore",

    sortImports: {
      customGroups: [{ groupName: "monorepo", elementNamePattern: ["@repo/**"], modifiers: ["value"] }],
      groups: [["type"], ["builtin", "external"], ["monorepo"], ["internal"], ["parent", "sibling", "index"]],
    },

    ignorePatterns: ["**/*.gen.ts", "**/vendor/**", "**/migrations/**"],
  },
});
