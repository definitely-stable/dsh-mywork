/**
 * Type face of the browser half of `@dsh-mywork/web`.
 *
 * The implementation is a hand-written classic script (`src/client/index.js`),
 * which no TypeScript program can import: this declaration describes the plugin
 * face the page module system reads from `lib/client.js`, and the slice of the
 * client context the half touches. It names platform types structurally instead
 * of importing `@deepseek-ai/dsh-client-*`, because this workspace installs
 * none of those packages — the browser supplies them as baseline modules.
 * @module @dsh-mywork/web/client
 */

/** One page registration on the layout's `main` seat. */
export interface BoardPageRegistration {
  /** The seat name the registration is dispatched through. */
  readonly name: string
  /** The panel id; it must equal the sidebar row's `id` (`B-26`). */
  readonly key: string
  /** The slot-store handle that owns the board's view state. */
  readonly store: unknown
  /** The face the page receives besides the store's `useStore`/`actions`. */
  readonly inject: () => Record<string, unknown>
}

/** The slice of `ctx.slots` the browser half uses. */
export interface ClientSlotsService {
  /**
   * Run a registration once the owning entry declares the seat.
   * @param seat - the slot key to wait for.
   * @param callback - creates the registration disposer.
   * @returns an idempotent disposer for the wait and the active registration.
   */
  inject(seat: string, callback: () => () => void): () => void
  /**
   * Register one entry on a declared seat.
   * @param options - the registration options.
   * @param component - the component the seat renders.
   * @returns the entry disposer.
   */
  register(options: BoardPageRegistration, component: unknown): () => void
}

/** The slice of the client root context the browser half uses. */
export interface ClientContext {
  /** The slot service. */
  readonly slots: ClientSlotsService
  /**
   * Run one effect for the lifetime of the plugin fiber.
   * @param callback - creates the effect's disposer.
   * @param label - optional diagnostic label.
   * @returns the effect disposer.
   */
  effect(callback: () => (() => void) | void, label?: string): () => void
}

/** Cordis services this half waits for. */
export declare const inject: readonly string[]

/**
 * Mount the browser half for one client row.
 * @param ctx - the client root context.
 */
export declare function apply(ctx: ClientContext): void
