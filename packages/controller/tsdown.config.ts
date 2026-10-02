import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  // This package is a DSH runtime bundle, not an SDK surface. No workspace
  // package consumes @dsh-mywork/controller, and the delivered profile loads
  // lib/index.js only. Bundling declarations here makes rolldown-plugin-dts walk
  // the same nine-package graph a second time; on GitHub's Windows runner that
  // drove V8 to the 8 GiB heap ceiling before Gate L could reach smoke/tests.
  // Type safety remains a separate, mandatory `tsc --noEmit` gate.
  dts: false,
  clean: true,
  // The published bundle is self-contained: workspace packages are inlined,
  // while `@deepseek-ai/cordis` is never bundled because the DSH installation
  // owns the single Cordis instance every plugin must share
  // (docs/user/develop/basic/publish.md; the installed task-board plugin
  // follows the same rule).
  // The controller is the composition root: it opens the store and raises the
  // domain subsystems, so every workspace package it imports is a RUNTIME import
  // and has to be inlined here. Keeping the bundle self-contained is also what
  // lets `tests/boundaries.test.mjs` assert that the built `lib/index.js` imports
  // nothing but `@deepseek-ai/cordis` — the single Cordis instance DSH owns.
  deps: {
    alwaysBundle: [
      '@dsh-mywork/adapter-sdk',
      '@dsh-mywork/contracts',
      '@dsh-mywork/core',
      '@dsh-mywork/evidence',
      '@dsh-mywork/execution',
      '@dsh-mywork/lease',
      '@dsh-mywork/planner',
      '@dsh-mywork/scheduler',
      '@dsh-mywork/storage',
    ],
    neverBundle: ['@deepseek-ai/cordis'],
  },
})
