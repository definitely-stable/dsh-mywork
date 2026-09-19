import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: true,
  clean: true,
  // `@dsh-mywork/contracts` and `@dsh-mywork/core` carry the intent, the policy,
  // and the canonical §42 codes; `@dsh-mywork/evidence` is a RUNTIME import
  // because the staged operation commits its audit row and its integrity report
  // inside the same transaction as its state. Inlining them keeps the built
  // package self-contained. `@dsh-mywork/storage` is a TYPE-ONLY import: the
  // caller composes the migrations and hands in the open store.
  deps: {
    alwaysBundle: ['@dsh-mywork/contracts', '@dsh-mywork/core', '@dsh-mywork/evidence'],
  },
})
