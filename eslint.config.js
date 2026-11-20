import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/coverage/**",
      "**/node_modules/**",
      "**/fixture-vault/**",
      "**/.big-fixture/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
);
