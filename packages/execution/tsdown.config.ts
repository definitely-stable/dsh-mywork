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
  // The saga's whole point is that one transaction carries the intent, its step
  // journal, its audit row, and its outbox event (§48), so `@dsh-mywork/evidence`
  // is a RUNTIME import like it is for the planner. `@dsh-mywork/storage` stays a
  // TYPE-ONLY import: the caller composes the migrations and hands in an open
  // store, which is what keeps this package buildable and testable on its own.
  deps: {
    alwaysBundle: ['@dsh-mywork/contracts', '@dsh-mywork/core', '@dsh-mywork/evidence'],
  },
})
