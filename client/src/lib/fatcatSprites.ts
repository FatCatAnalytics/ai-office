// Dynamic FatCat sprite resolver.
//
// Maps (archetype, status) → a bundled, hashed sprite URL. Sprite PNGs live at
//   attached_assets/fatcat/sprites/<status>/<status>_<archetype>.png
// (5 statuses × 18 archetypes = 90 transparent PNGs). The keys map 1:1 to
// FatCatStatus and FatCatArchetype in ./fatcatRoster — no remapping.
//
// We use Vite's import.meta.glob (eager, '?url') so the bundler fingerprints
// every sprite and we get the production URL at module-eval time. A build-time
// assertion catches any missing combo; at runtime we fall back to the same
// archetype's idle sprite so a card never renders a broken image.

import type { FatCatArchetype, FatCatStatus } from "./fatcatRoster";

const STATUSES: FatCatStatus[] = ["idle", "working", "verifying", "blocked", "complete"];
const ARCHETYPES: FatCatArchetype[] = [
  "manager", "research", "editor", "writer", "analyst", "qa", "factcheck",
  "publish", "diligence", "sourceverify", "financial", "risk", "market",
  "memo", "cio", "valuation", "contrarian", "engineer",
];

// Eagerly import every sprite as a URL string. Key is the resolved module path.
const modules = import.meta.glob<string>(
  "../../../attached_assets/fatcat/sprites/**/*.png",
  { eager: true, query: "?url", import: "default" },
);

// Pull "<status>_<archetype>" out of a "/…/<status>/<status>_<archetype>.png" path.
function parseKey(path: string): { status: string; archetype: string } | null {
  const file = path.split("/").pop();
  if (!file) return null;
  const base = file.replace(/\.png$/i, "");
  const idx = base.indexOf("_");
  if (idx < 0) return null;
  return { status: base.slice(0, idx), archetype: base.slice(idx + 1) };
}

function buildLookup(): Record<FatCatStatus, Record<FatCatArchetype, string>> {
  // Index the globbed URLs by status+archetype.
  const byKey = new Map<string, string>();
  for (const [path, url] of Object.entries(modules)) {
    const parsed = parseKey(path);
    if (parsed) byKey.set(`${parsed.status}_${parsed.archetype}`, url as string);
  }

  const lookup = {} as Record<FatCatStatus, Record<FatCatArchetype, string>>;
  for (const status of STATUSES) {
    const row = {} as Record<FatCatArchetype, string>;
    for (const archetype of ARCHETYPES) {
      const direct = byKey.get(`${status}_${archetype}`);
      // Fallback to the idle sprite of the same archetype if a combo is missing.
      const fallback = byKey.get(`idle_${archetype}`);
      const url = direct ?? fallback;
      if (url) row[archetype] = url;
    }
    lookup[status] = row;
  }
  return lookup;
}

export const FATCAT_SPRITES: Record<FatCatStatus, Record<FatCatArchetype, string>> = buildLookup();

/**
 * Resolve the sprite URL for an (archetype, status) pair. Falls back to the
 * archetype's idle sprite, then to any sprite for that archetype, so a card
 * always has something to render even if an asset is somehow absent.
 */
export function fatcatSprite(archetype: FatCatArchetype, status: FatCatStatus): string | undefined {
  return (
    FATCAT_SPRITES[status]?.[archetype] ??
    FATCAT_SPRITES.idle?.[archetype]
  );
}

export const FATCAT_SPRITE_STATUSES = STATUSES;
export const FATCAT_SPRITE_ARCHETYPES = ARCHETYPES;
