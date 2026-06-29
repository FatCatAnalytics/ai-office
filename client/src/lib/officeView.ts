// Office dashboard view-mode config + safe resolver.
//
// Stage 6.12 shipped two new FatCat visual modes (Isometric Office / Mission
// Control) and defaulted the dashboard to the isometric mode. That mode had a
// visual regression in production (overlapping panels, content bleed), so as of
// the 6.12.1 hotfix the experimental modes are gated behind an opt-in toggle and
// the dashboard defaults to the stable legacy "board" view. resolveOfficeView
// guarantees that a persisted or unknown mode can never strand a user on a
// broken/hidden view: anything not currently selectable falls back to the
// default.

export type OfficeView = "sims" | "board" | "iso" | "mission" | "sprite";

export const DEFAULT_OFFICE_VIEW: OfficeView = "board";

/** Views always available — the stable, shipped dashboard surfaces. */
export const STABLE_VIEWS: readonly OfficeView[] = ["sims", "board"];

/** Views still being rebuilt; only shown when the user opts into the preview. */
export const EXPERIMENTAL_VIEWS: readonly OfficeView[] = ["iso", "mission", "sprite"];

export const OFFICE_VIEW_META: Record<OfficeView, { label: string; experimental?: boolean }> = {
  sims:    { label: "Sims" },
  board:   { label: "Board" },
  iso:     { label: "Iso Office", experimental: true },
  mission: { label: "Mission Control", experimental: true },
  sprite:  { label: "Sprite Office", experimental: true },
};

export function isOfficeView(v: unknown): v is OfficeView {
  return v === "sims" || v === "board" || v === "iso" || v === "mission" || v === "sprite";
}

export function isExperimentalView(v: OfficeView): boolean {
  return EXPERIMENTAL_VIEWS.includes(v);
}

/** Views selectable right now, given whether experimental modes are enabled. */
export function selectableViews(allowExperimental: boolean): OfficeView[] {
  const keys = Object.keys(OFFICE_VIEW_META) as OfficeView[];
  return keys.filter((v) => allowExperimental || !isExperimentalView(v));
}

/**
 * Resolve a requested (possibly persisted or untrusted) view to one that is
 * safe to render now. Unknown values and experimental views requested while the
 * preview is disabled both fall back to DEFAULT_OFFICE_VIEW, so a stale
 * office_view_mode setting can never show the broken modes by default.
 */
export function resolveOfficeView(requested: unknown, allowExperimental: boolean): OfficeView {
  if (!isOfficeView(requested)) return DEFAULT_OFFICE_VIEW;
  if (isExperimentalView(requested) && !allowExperimental) return DEFAULT_OFFICE_VIEW;
  return requested;
}
