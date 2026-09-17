import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts', 'src/testing.ts'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: true,
  clean: true,
  // The canonical error codes are read at runtime (the refusal guard compares
  // against §42), so the contracts package is inlined to keep the SDK
  // self-contained for a consumer that installs one tarball.
  deps: {
    alwaysBundle: ['@dsh-mywork/contracts'],
  },
})
