import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Unit tests for the route / stop logic (npm test). The database has its own
// tests in supabase/tests (run against a local Postgres, see README).
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./', import.meta.url)) } },
  test: { include: ['tests/unit/**/*.test.ts'], environment: 'node' },
});
