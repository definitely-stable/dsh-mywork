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
  // The published bundle is self-contained: workspace packages are inlined,
  // while `@deepseek-ai/cordis` is never bundled because the DSH installation
  // owns the single Cordis instance every plugin must share
  // (docs/user/develop/basic/publish.md; the installed task-board plugin
  // follows the same rule).
  deps: {
    alwaysBundle: ['@dsh-mywork/adapter-sdk', '@dsh-mywork/contracts', '@dsh-mywork/core'],
    neverBundle: ['@deepseek-ai/cordis'],
  },
})
