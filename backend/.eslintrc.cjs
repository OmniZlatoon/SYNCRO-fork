module.exports = {
  root: true,
  env: {
    node: true,
    es2022: true,
    jest: true,
  },
  parser: "@typescript-eslint/parser",
  parserOptions: {
    project: "./tsconfig.json",
    tsconfigRootDir: __dirname,
  },
  plugins: ["@typescript-eslint"],
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
  ],
  rules: {
    "@typescript-eslint/no-explicit-any": "error",
    "@typescript-eslint/no-floating-promises": "error",
    "no-console": "warn",
    "@typescript-eslint/no-unused-vars": "error",
  },
  overrides: [
    {
      // Plain JS/CJS files (scripts, config files) don't have a tsconfig —
      // disable type-aware rules that require parserOptions.project.
      files: ["*.js", "*.cjs", "*.mjs"],
      parserOptions: {
        project: null,
      },
      rules: {
        "@typescript-eslint/no-floating-promises": "off",
        "@typescript-eslint/no-explicit-any": "off",
        "@typescript-eslint/no-unused-vars": "off",
        "@typescript-eslint/no-require-imports": "off",
      },
    },
  ],
};
