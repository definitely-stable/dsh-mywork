import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: true,
  // Deliberately the same `clean: true` as the other twelve packages. The
  // hand-written browser half (`lib/client.js`) is not a tsdown product, so it
  // is re-emitted AFTER this clean by `scripts/build-client.mjs` — chained with
  // `&&` in the build script — instead of weakening the clean (defect R-08:
  // every one of the twelve wipes `lib/`, and the executor's memory is not a
  // mechanism).
  clean: true,
})
