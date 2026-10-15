import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/integracion/**/*.test.ts'],
    globalSetup: ['tests/integracion/globalSetup.ts'],
    // Comparten una sola base: en serie para que una prueba no pise los datos de otra.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 90_000,
  },
});
