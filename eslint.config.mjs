import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  // Build output is never linted (the .gitignore entry alone did not
  // keep it out of `eslint .` here, so this is explicit).
  { ignores: ["dist/"] },
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
