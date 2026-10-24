// Backend safety net: catches undefined identifiers (e.g. the `isCoreEarningsDoc` ReferenceError that silently
// killed every results/concall alert). `node --check` and unit tests of OTHER modules do not catch this class of bug.
// Run: npm run lint:backend
import globals from "globals";

export default [
  { ignores: ["node_modules", "dist", "scratch", "backend/tests/fixtures"] },
  {
    files: ["backend/**/*.{js,mjs}", "scripts/**/*.{js,mjs}", "node_downloader/src/**/*.js"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: { ...globals.node, ...globals.vitest }
    },
    rules: {
      "no-undef": "error",
      "no-dupe-keys": "error",
      "no-unreachable": "error",
      "no-redeclare": "error",
      "no-const-assign": "error",
      "no-use-before-define": ["error", { functions: false, classes: true, variables: false }]
    }
  }
];
