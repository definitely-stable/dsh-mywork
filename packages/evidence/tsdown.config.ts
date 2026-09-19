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
  // `@dsh-mywork/contracts` carries the artifact and audit vocabularies the
  // validators enumerate; inlining it keeps the built package self-contained.
  // `@dsh-mywork/storage` is a TYPE-ONLY import here (the SQL surface and the
  // migration shape), so it leaves no runtime import behind: the composition of
  // kernel and evidence migrations happens at the caller.
  deps: {
    alwaysBundle: ['@dsh-mywork/contracts'],
  },
})
