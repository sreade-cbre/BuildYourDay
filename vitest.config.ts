import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // Vitest replaces CSS with empty strings by default, which would leave the
    // brand test scanning nothing. Process CSS so raw imports see the file.
    css: { include: [/\.css(\?|$)/] },
  },
});
