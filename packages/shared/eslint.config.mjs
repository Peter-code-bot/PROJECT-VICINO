import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";

const eslintConfig = defineConfig([
  ...tseslint.configs.recommended,
  globalIgnores([
    "dist/**",
    "node_modules/**",
    "*.tsbuildinfo",
  ]),
]);

export default eslintConfig;
