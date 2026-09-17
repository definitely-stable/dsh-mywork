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
  // `@dsh-mywork/contracts` carries the event envelope and event-type
  // vocabulary; inlining it keeps the built package self-contained, while
  // `node:sqlite` stays a Node builtin the host already provides.
  deps: {
    alwaysBundle: ['@dsh-mywork/contracts'],
  },
})
