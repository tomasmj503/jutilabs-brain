import { defineConfig } from 'vitest/config';

// Pruebas rápidas (sin Docker): unitarias y de regresión. Las de integración tienen su propio config
// (vitest.integracion.config.ts) porque necesitan Postgres y Redis reales.
export default defineConfig({
  test: {
    include: ['tests/unitarias/**/*.test.ts', 'tests/regresion/**/*.test.ts'],
  },
});
