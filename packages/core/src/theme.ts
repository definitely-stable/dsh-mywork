/**
 * Surface policy resolution (ADR022).
 *
 * The board must be readable on any theme the user runs — dark, light,
 * wallpaper, a custom skin, high contrast. Rather than shipping a palette,
 * MyWork reads the runtime {@link ThemeCapability} and the **measured** contrast
 * of the surface, and computes what opacity and contrast the surface must have.
 *
 * Two rules from ADR022 are decisions of this function, not of the CSS layer:
 *
 * - a surface carrying text is never translucent when a wallpaper is behind it,
 *   when measured contrast is below the readable threshold, or when the user
 *   asked for more contrast;
 * - motion is suppressed by capability, and the focus indicator is only ever
 *   strengthened, never removed.
 *
 * There is deliberately no colour literal here: colours come from the bridged
 * `--dsw-*` → `--mw-*` tokens, and this module only decides opacity and
 * thresholds.
 * @module
 */

import {
  MIN_FOCUS_CONTRAST_RATIO,
  MIN_TEXT_CONTRAST_RATIO,
  type SurfacePolicy,
  type ThemeCapability,
} from '@dsh-mywork/contracts'

/** What kind of surface is being resolved. */
export type SurfaceTarget =
  /** The board background and the gutters: the only place a wallpaper may show. */
  | 'canvas'
  /** A card: always opaque inside, so text keeps a known backdrop. */
  | 'card'
  /** A sticky header: opaque for the same reason, and because it scrolls over content. */
  | 'sticky-header'
  /** An overlay (menu, popover) that must dim what is behind it. */
  | 'overlay'

/** Every target, for exhaustiveness checks. */
export const SURFACE_TARGETS: readonly SurfaceTarget[] = Object.freeze([
  'canvas',
  'card',
  'sticky-header',
  'overlay',
])

/**
 * Resolve the surface policy for one target.
 *
 * Deterministic and total over the capability and the measured contrast: the
 * same inputs always give the same policy, which is what lets the five themes of
 * ADR022 be asserted without a browser. `measuredContrast` is the ratio the
 * caller measured between the surface and the text on it; a non-finite or
 * non-positive value is treated as "not measured", which is the unsafe
 * direction and therefore forces opacity rather than trusting the theme.
 * @param capability - runtime properties of the active theme.
 * @param measuredContrast - measured text/surface contrast ratio, when known.
 * @param target - the surface being resolved; defaults to a card.
 */
export function resolveSurfacePolicy(
  capability: ThemeCapability,
  measuredContrast?: number,
  target: SurfaceTarget = 'card',
): SurfacePolicy {
  const contrastKnown = typeof measuredContrast === 'number' && Number.isFinite(measuredContrast) && measuredContrast > 0
  const effectiveContrast = contrastKnown ? (measuredContrast as number) : capability.declaredContrast
  // "Not measured" is the unsafe direction: an undeclared contrast cannot be
  // assumed to be readable, so it counts as low.
  const lowContrast = effectiveContrast === undefined || effectiveContrast < MIN_TEXT_CONTRAST_RATIO

  // The first condition that forces opacity is what the Doctor reports.
  const reason = forcedOpacityReason(capability, lowContrast)

  // Text-bearing surfaces are opaque whenever anything threatens readability;
  // the canvas may stay translucent when the theme is healthy and no wallpaper
  // is active, which is what keeps a light/dark theme looking native.
  const mustBeOpaque = target !== 'canvas' || reason !== 'none'

  return Object.freeze({
    alpha: mustBeOpaque ? 1 : translucentAlpha(capability.surface),
    wallpaper: wallpaperPolicy(capability, target),
    opaque: mustBeOpaque,
    // The readable-text threshold does not move with the theme: high contrast
    // raises what the *theme* must provide, not what counts as readable.
    minContrastRatio: MIN_TEXT_CONTRAST_RATIO,
    // The focus ring is never weakened, so its floor is the same in every mode.
    minFocusContrastRatio: MIN_FOCUS_CONTRAST_RATIO,
    reduceMotion: capability.reducedMotion,
    reason,
  })
}

/**
 * The first condition that forces full opacity, or `none`.
 *
 * The order is the one ADR022 lists: a wallpaper behind the surface is the most
 * concrete reason, then measured contrast, then the user's contrast preference,
 * then a theme that renders surfaces transparent at all.
 */
function forcedOpacityReason(capability: ThemeCapability, lowContrast: boolean): SurfacePolicy['reason'] {
  if (capability.wallpaper) return 'wallpaper'
  if (lowContrast) return 'low-contrast'
  if (capability.highContrast) return 'high-contrast'
  if (capability.surface === 'transparent') return 'transparent-theme'
  return 'none'
}

/** Where the wallpaper may show for one target (ADR022). */
function wallpaperPolicy(capability: ThemeCapability, target: SurfaceTarget): SurfacePolicy['wallpaper'] {
  if (!capability.wallpaper) return 'never'
  return target === 'canvas' ? 'visible' : 'card-opaque'
}

/**
 * Background opacity for a surface that is allowed to stay translucent.
 *
 * A translucent theme keeps its character; an opaque theme is exactly 1. The
 * canvas is the only caller, so this never decides text legibility on its own.
 * @param surface - how the theme renders surfaces.
 */
function translucentAlpha(surface: ThemeCapability['surface']): number {
  switch (surface) {
    case 'opaque':
      return 1
    case 'translucent':
      return 0.85
    case 'transparent':
      return 1
  }
}

/**
 * Whether a resolved policy suppresses animation.
 *
 * Provided as its own predicate because the CSS layer asks this question per
 * transition, and because "reduced motion is honoured" should be assertable on
 * its own rather than through the whole policy object.
 * @param policy - a resolved policy.
 */
export function suppressesMotion(policy: SurfacePolicy): boolean {
  return policy.reduceMotion
}
