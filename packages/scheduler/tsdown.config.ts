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
  // The runtime is pure policy plus ports: `@dsh-mywork/core` carries the
  // decision and `@dsh-mywork/contracts` the vocabulary, so both are bundled and
  // the package stays consumable on its own — the same composition the planner,
  // the execution saga, and the controller use.
  deps: {
    alwaysBundle: ['@dsh-mywork/contracts', '@dsh-mywork/core'],
  },
})
