/**
 * Theme capability and surface policy (ADR022).
 *
 * DSH exposes its own `--dsw-*` token set; MyWork bridges those tokens to
 * `--mw-*` and never ships a palette of its own. Two consequences are encoded
 * here rather than left to the CSS layer:
 *
 * - the board must work on any theme — dark, light, wallpaper, high-contrast —
 *   so the runtime properties of the current theme are **capability data**, read
 *   and passed around instead of being guessed from a skin name;
 * - contrast is measured, not assumed. A surface that cannot carry readable text
 *   is made opaque by policy, which is a pure computation over the capability
 *   plus the measured contrast ratio.
 *
 * The resolution itself lives in `@dsh-mywork/core`; this module is vocabulary.
 * @module
 */

/** Colour scheme the active theme declares. */
export type ThemeMode = 'dark' | 'light'

/** Every colour scheme, for exhaustiveness checks. */
export const THEME_MODES: readonly ThemeMode[] = Object.freeze(['dark', 'light'])

/**
 * How the active theme renders surfaces.
 *
 * `transparent` is the case that forces a policy: whatever sits behind the
 * surface shows through, so text contrast is no longer a property of the theme
 * alone.
 */
export type SurfaceKind = 'opaque' | 'translucent' | 'transparent'

/** Every surface kind, from most to least opaque. */
export const SURFACE_KINDS: readonly SurfaceKind[] = Object.freeze(['opaque', 'translucent', 'transparent'])

/**
 * Runtime properties of the active theme (ADR022), read from the live
 * environment instead of inferred from a `data-dsh-skin` attribute — branching
 * on someone else's release would tie MyWork to it.
 */
export interface ThemeCapability {
  /** Colour scheme the theme declares. */
  readonly mode: ThemeMode
  /** How the theme renders surfaces. */
  readonly surface: SurfaceKind
  /** True when a background image is active (`--dsw-alias-bg-mask-photo`). */
  readonly wallpaper: boolean
  /** True when `prefers-contrast: more` is set or measured contrast is too low. */
  readonly highContrast: boolean
  /** True when `prefers-reduced-motion: reduce` is set. */
  readonly reducedMotion: boolean
  /**
   * Contrast ratio the theme itself claims for text on surface, when it
   * declares one. Absent means "not declared", which is not the same as "meets
   * the target": the measured ratio is what decides.
   */
  readonly declaredContrast?: number
}

/**
 * Contrast ratio below which text is no longer comfortably readable and the
 * surface is forced opaque (WCAG AA for normal text).
 */
export const MIN_TEXT_CONTRAST_RATIO = 4.5

/**
 * Contrast ratio a focus indicator must reach against both neighbouring
 * colours (WCAG non-text contrast). It is never removed, only strengthened.
 */
export const MIN_FOCUS_CONTRAST_RATIO = 3

/**
 * Where a surface may show the wallpaper (ADR022).
 *
 * The image is visible only in safe spaces — the board background and the
 * gutters. Inside a card, and in any sticky header, the surface is always
 * opaque so text keeps a known backdrop while it scrolls.
 */
export type WallpaperPolicy = 'visible' | 'card-opaque' | 'never'

/** Every wallpaper policy. */
export const WALLPAPER_POLICIES: readonly WallpaperPolicy[] = Object.freeze([
  'visible',
  'card-opaque',
  'never',
])

/**
 * The resolved surface policy for one surface: what the CSS layer must apply.
 *
 * Every field is computed, so two surfaces resolved from the same capability and
 * the same measured contrast behave identically, and a test can assert the
 * policy without a browser.
 */
export interface SurfacePolicy {
  /** Opacity to apply to the surface's background, in `[0, 1]`. */
  readonly alpha: number
  /** Where the wallpaper may show on this surface. */
  readonly wallpaper: WallpaperPolicy
  /** True when the surface must not be translucent even if the theme is. */
  readonly opaque: boolean
  /** Minimum contrast the surface must maintain for its text. */
  readonly minContrastRatio: number
  /** Minimum contrast a focus indicator must reach on this surface. */
  readonly minFocusContrastRatio: number
  /** True when motion must be suppressed on this surface. */
  readonly reduceMotion: boolean
  /**
   * Why the policy came out this way, for diagnostics and for the Doctor. Names
   * the first condition that forced full opacity, or `none`.
   */
  readonly reason: 'none' | 'wallpaper' | 'low-contrast' | 'high-contrast' | 'transparent-theme'
}
