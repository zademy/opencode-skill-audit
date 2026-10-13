import tseslint from "typescript-eslint"

export default tseslint.config(
  { ignores: ["node_modules/", "dist/", ".agents/"] },
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts", "**/*.tsx"],
    rules: {
      // The plugin reads OpenCode's v2 data cache defensively on purpose: an
      // accessor that moves or vanishes should drop one segment, never throw
      // during render and blank the whole footer.
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
)
