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
  // The domain tables (states, authority matrix, error codes) live in
  // `@dsh-mywork/contracts`; inlining them keeps every built package
  // self-contained for consumers that install one tarball.
  deps: {
    alwaysBundle: ['@dsh-mywork/contracts'],
  },
})
