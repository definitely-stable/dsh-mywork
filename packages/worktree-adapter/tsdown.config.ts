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
  // This package is the one place in the tree that spawns a process, so its
  // workspace dependencies are inlined and the built bundle stays self-contained
  // — the same shape `@dsh-mywork/execution` and `@dsh-mywork/beads-adapter` use.
  // `node:child_process`, `node:crypto`, `node:fs`, and `node:path` are Node
  // builtins and stay imports; nothing else is external.
  deps: {
    alwaysBundle: ['@dsh-mywork/contracts', '@dsh-mywork/core'],
  },
})
