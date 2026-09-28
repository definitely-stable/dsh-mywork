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
  // The package reaches no layer: the caller injects the clock, the artifact
  // sink, and the head reader, so the only workspace import is
  // `@dsh-mywork/contracts` (the verdict vocabulary plus `GIT_SHA_LENGTH`). The
  // alias resolves it through the tsconfig path (`tsconfig.base.json` →
  // `packages/contracts/src/index.ts`) instead of a `node_modules` link, which
  // keeps this package buildable while the workspace install stays owned by the
  // composition step; `alwaysBundle` inlines it, so the built bundle imports
  // nothing but Node builtins.
  alias: {
    '@dsh-mywork/contracts': '../../packages/contracts/src/index.ts',
  },
  deps: {
    alwaysBundle: ['@dsh-mywork/contracts'],
  },
})
