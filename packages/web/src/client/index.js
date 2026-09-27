window.__ModuleLoader__.load({
  id: '@dsh-mywork/web',
  factory: (require) => {
    /**
     * The browser half of `@dsh-mywork/web`.
     *
     * The page module system evaluates this file as a CLASSIC script, never as an
     * ES module (`scripts/publint-all.ts:183` in the platform: "`lib/client.js`
     * is evaluated by the page module system as a classic script"), so the whole
     * file is one `window.__ModuleLoader__.load({ id, factory })` registration
     * whose factory is a lazy CJS function. The installed 0.4.3 task-board bundle
     * and the platform's own decoration template have exactly this shape, and the
     * envelope is the file's FIRST line on purpose: a bundle whose registration
     * is buried under a header reads as an ES module to every scanner that looks
     * at the top of the file.
     *
     * This file is hand-written, not a bundler product. `scripts/build-client.mjs`
     * copies it to `lib/client.js` AFTER tsdown's `clean: true` has wiped `lib/`
     * (defect R-08), and the copy is what the platform serves.
     *
     * `require` is the page module table: `react`, `react/jsx-runtime` and
     * `@deepseek-ai/dsh-client-store` are baseline words every bundle may ask for
     * (`packages/client/web/src/platform.ts` PLATFORM_MODULES); any other
     * specifier would need a `dsh.client.external` declaration in `package.json`.
     */

    var module = { exports: {} }
    var exports = module.exports

    /** Cordis services the browser half waits for before `apply` runs. */
    const inject = []

    /**
     * Mount the browser half for one client row.
     *
     * F-59 extends this: the board page, its `data-mw-*` anchors and its
     * slot-store view state. This step owns the manifest, the classic-script
     * envelope and the plugin face the Loader mounts.
     */
    function apply() {}

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
