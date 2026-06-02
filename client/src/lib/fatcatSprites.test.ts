// Guards the dynamic sprite resolver: every archetype × status combo must
// resolve to a defined, bundled sprite URL, and the resolver must fall back to
// the archetype's idle sprite when a combo is missing.

import { describe, it, expect } from "vitest";
import {
  FATCAT_SPRITES,
  fatcatSprite,
  FATCAT_SPRITE_STATUSES,
  FATCAT_SPRITE_ARCHETYPES,
} from "./fatcatSprites";
import type { FatCatArchetype, FatCatStatus } from "./fatcatRoster";

describe("fatcatSprites resolver", () => {
  it("covers all 5 statuses and 18 archetypes", () => {
    expect(FATCAT_SPRITE_STATUSES).toHaveLength(5);
    expect(FATCAT_SPRITE_ARCHETYPES).toHaveLength(18);
  });

  it("resolves a defined URL for every archetype × status (90 combos)", () => {
    let count = 0;
    for (const status of FATCAT_SPRITE_STATUSES) {
      for (const archetype of FATCAT_SPRITE_ARCHETYPES) {
        const url = fatcatSprite(archetype, status);
        expect(url, `${status}/${archetype}`).toBeTruthy();
        expect(typeof url).toBe("string");
        count++;
      }
    }
    expect(count).toBe(90);
  });

  it("exposes a fully-populated lookup table", () => {
    for (const status of FATCAT_SPRITE_STATUSES) {
      for (const archetype of FATCAT_SPRITE_ARCHETYPES) {
        expect(FATCAT_SPRITES[status]?.[archetype]).toBeTruthy();
      }
    }
  });

  it("distinct statuses for the same archetype resolve to distinct sprites", () => {
    // The whole point of the swap: working ≠ idle for a given archetype.
    expect(fatcatSprite("engineer", "working")).not.toBe(fatcatSprite("engineer", "idle"));
    expect(fatcatSprite("manager", "blocked")).not.toBe(fatcatSprite("manager", "complete"));
  });

  it("falls back to the archetype's idle sprite for an unknown status", () => {
    // Cast an invalid status to prove the safe fallback path returns the idle art.
    const bogus = fatcatSprite("qa", "nonexistent" as FatCatStatus);
    expect(bogus).toBe(fatcatSprite("qa", "idle"));
  });

  it("returns defined for every roster archetype key", () => {
    const archetypes: FatCatArchetype[] = [
      "manager", "research", "editor", "writer", "analyst", "qa", "factcheck",
      "publish", "diligence", "sourceverify", "financial", "risk", "market",
      "memo", "cio", "valuation", "contrarian", "engineer",
    ];
    for (const a of archetypes) {
      expect(fatcatSprite(a, "idle")).toBeTruthy();
    }
  });
});
