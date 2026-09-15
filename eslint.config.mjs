// ESLint 9 flat config. `next lint` was removed in Next 16, so `npm run lint` calls eslint
// directly and this file replaces the old .eslintrc.json — eslint-config-next 16 already ships
// its configs in flat form, so there is nothing to compat-wrap.
import next from "eslint-config-next/core-web-vitals";

const config = [
  // Build output and vendored code. eslint walks the whole tree otherwise and lints .next/.
  {
    ignores: [".next/**", "out/**", "node_modules/**", ".vercel/**", "next-env.d.ts"],
  },
  ...next,
];

export default config;
