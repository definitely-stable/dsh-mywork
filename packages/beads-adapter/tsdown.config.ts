import { defineConfig } from 'tsdown'

export default defineConfig({
  // `index` is the library surface the tests and other packages import;
  // `plugin` is the Cordis row a profile mounts, kept separate so importing the
  // adapter never drags in the plugin loader.
  entry: ['src/index.ts', 'src/plugin.ts'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: true,
  clean: true,
  // The adapter resolves its port, its refusal vocabulary, and the canonical §42
  // codes at runtime, so both workspace dependencies are inlined and the built
  // package stays self-contained — the same shape `@dsh-mywork/controller` and
  // `@dsh-mywork/evidence` use. `@deepseek-ai/cordis` is never bundled: the DSH
  // installation owns the single Cordis instance every plugin must share.
  deps: {
    alwaysBundle: ['@dsh-mywork/contracts', '@dsh-mywork/core', '@dsh-mywork/adapter-sdk'],
    neverBundle: ['@deepseek-ai/cordis'],
  },
})
