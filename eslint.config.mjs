import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

const config = [
  ...nextVitals,
  ...nextTs,
  // The React Compiler rules are advice for code compiled by it; this app isn't, so they warn.
  {
    rules: {
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/immutability': 'warn',
      'react-hooks/preserve-manual-memoization': 'warn',
      'import/no-anonymous-default-export': 'off', // i18n/messages/*.mjs are plain data files
    },
  },
  { ignores: ['.next/**', 'node_modules/**', 'lib/i18n-ta.ts', 'lib/i18n-si.ts', 'public/sw.js', 'next-env.d.ts'] },
];
export default config;
