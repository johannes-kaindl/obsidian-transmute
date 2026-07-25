// Spiegelt den Store-Review-Scan: dieselben Regeln OHNE lokale Abschwaechungen.
// Divergiert von eslint.config.mjs erst, wenn dort ein file-scoped Override dazukommt.
import tseslint from "typescript-eslint";
import obsidianmd from "eslint-plugin-obsidianmd";

export default tseslint.config(
  { ignores: ["main.js", "node_modules/", "tests/", "src/vendor/"] },
  ...tseslint.configs.recommendedTypeChecked,
  ...obsidianmd.configs.recommended,
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parserOptions: {
        project: ["./tsconfig.json"],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
);
