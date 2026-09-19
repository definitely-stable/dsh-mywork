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
  // `@dsh-mywork/contracts` carries the lease record and the `lease-store` port
  // shape; inlining it keeps the built package self-contained. `@dsh-mywork/core`
  // is imported for one pure predicate (`isCounter`) and `@dsh-mywork/storage` is
  // a TYPE-ONLY import (the migration and executor shapes), so neither leaves a
  // runtime dependency on another layer: the caller composes the migrations and
  // hands in the store.
  deps: {
    alwaysBundle: ['@dsh-mywork/contracts', '@dsh-mywork/core'],
  },
})
