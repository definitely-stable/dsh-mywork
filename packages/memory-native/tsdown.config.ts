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
  // The provider throws the canonical §42 error, so `@dsh-mywork/core` is a
  // runtime import and both workspace packages are inlined: the same
  // self-contained shape the scheduler, the planner, and the adapters use.
  // The fabric reads the code off the thrown value rather than by class
  // identity, so an inlined copy cannot turn a conflict into an outage.
  deps: {
    alwaysBundle: ['@dsh-mywork/contracts', '@dsh-mywork/core'],
  },
})
