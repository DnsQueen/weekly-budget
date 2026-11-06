import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  // Build output and the Stryker sandbox are never linted (the .gitignore
  // entry alone did not keep dist/ out of `eslint .` here, so this is
  // explicit; .stryker-tmp/ is recreated by every mutation run).
  { ignores: ["dist/", ".stryker-tmp/"] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // The frontend is plain browser JS. Only the four browser globals it
    // actually uses are declared; it is verified in the browser (E2E),
    // not by Node globals.
    files: ["public/**/*.js"],
    languageOptions: {
      globals: {
        document: "readonly",
        fetch: "readonly",
        location: "readonly",
        URLSearchParams: "readonly",
      },
    },
  },
);
