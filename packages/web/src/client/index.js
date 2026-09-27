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

    const react = require('react')
    const { defineStore } = require('@deepseek-ai/dsh-client-store')

    var module = { exports: {} }
    var exports = module.exports

    /** The panel id the sidebar row and the `main` seat must share (`B-26`). */
    const MYWORK_PANEL_ID = 'mywork'

    /** The layout seat the board page is contributed to. */
    const PANEL_SEAT = 'main'

    /** Column-filter value meaning "no filter"; also the view state's default. */
    const ALL_COLUMNS = 'all'

    /**
     * The board's view state, declared as a slot-store handle.
     *
     * The filter and the expanded card are VIEW state, so they live in the slot
     * store the page is registered with (D18) instead of in the component: the
     * seat keeps one instance per handle and scope, so an unmount/remount of the
     * panel — the layout mounts the `main` occupant only while the board is the
     * selected panel — does not lose them, and `persist` rehydrates them after a
     * page reload. A handle is constructed here, in `apply` world, and never at
     * module level: a module-level handle would be a singleton disguised as
     * module-cache identity across plugin reloads.
     * @returns the store handle the page is registered with.
     */
    function createBoardViewStore() {
      return defineStore({
        init: () => ({ columnFilter: ALL_COLUMNS, expandedCardId: null }),
        persist: 'dsh-mywork.web.board-view',
        actions: {
          selectColumn: (draft, columnId) => { draft.columnFilter = columnId },
          toggleCard: (draft, cardId) => {
            draft.expandedCardId = draft.expandedCardId === cardId ? null : cardId
          },
        },
      })
    }

    /**
     * The board page.
     *
     * Every anchor carries the `data-mw` prefix (D18): the shell keeps its own
     * namespace for the boot and automatic-focus markers it stamps, and the 0.4.3
     * precedent keeps a private namespace for the same reason. The page reads its
     * view state through the seat's `useStore` and writes it through the seat's
     * baked `actions` — it holds no state of its own.
     * @param props - the seat's store share (`useStore`/`actions`) plus the face.
     * @returns the board page element.
     */
    function BoardPanel(props) {
      const view = props.useStore(snapshot => snapshot)
      const columns = props.columns
      const cards = props.cards
      const visible = view.columnFilter === ALL_COLUMNS
        ? cards
        : cards.filter(card => card.columnId === view.columnFilter)
      return react.createElement('section', {
        'data-mw-panel': MYWORK_PANEL_ID,
        'data-mw-board': '',
        'data-mw-column-filter': view.columnFilter,
      }, [
        react.createElement('div', { key: 'columns' }, columns.map(column => react.createElement('button', {
          key: column.id,
          type: 'button',
          'data-mw-column-option': column.id,
          'data-mw-column-active': view.columnFilter === column.id ? '' : undefined,
          onClick: () => props.actions.selectColumn(column.id),
        }, column.title))),
        react.createElement('div', { key: 'cards' }, visible.map(card => react.createElement('article', {
          key: card.id,
          'data-mw-card': card.id,
          'data-mw-card-expanded': view.expandedCardId === card.id ? '' : undefined,
          onClick: () => props.actions.toggleCard(card.id),
        }, card.title))),
      ])
    }

    /** Cordis services the browser half waits for before `apply` runs. */
    const inject = ['slots']

    /**
     * Mount the browser half for one client row.
     *
     * The registration is wrapped in `ctx.slots.inject` so it fires only once the
     * layout declares the `main` seat: load order between this bundle and the
     * shell's own entries does not matter, and a shell that never declares the
     * seat leaves the board absent instead of failing boot. The sidebar row, the
     * `id === key` contract test and the full dispose wiring are `B-26`; the id
     * constant above is already the one it will use, so that step extends this
     * registration instead of rewriting it.
     * @param ctx - the client root context (service: `slots`).
     */
    function apply(ctx) {
      const viewStore = createBoardViewStore()
      ctx.effect(() => ctx.slots.inject(PANEL_SEAT, () => ctx.slots.register({
        name: PANEL_SEAT,
        key: MYWORK_PANEL_ID,
        store: viewStore,
        // The board's data source is the host transport, which arrives with the
        // surface steps (`B-*`); until then the page renders an empty board.
        inject: () => ({ columns: [], cards: [] }),
      }, BoardPanel)))
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
