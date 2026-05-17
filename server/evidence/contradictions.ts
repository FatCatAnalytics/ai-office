// Stage 6: Contradiction detection.
//
// Pairs claims sharing the same subject and unit, flagging any with > 25%
// relative divergence. Returns suggested contradictions for the workflow to
// persist. Conservative thresholds avoid false-positive noise — we'd rather
// miss a small disagreement than flag every rounding difference.

import type { Claim } from "@shared/schema";

export interface ContradictionFinding {
  claimAId: number;
  claimBId: number;
  severity: "low" | "medium" | "high";
  description: string;
}

export function detectContradictions(claims: Claim[]): ContradictionFinding[] {
  const findings: ContradictionFinding[] = [];
  const numeric = claims.filter((c) => c.numericValue != null && c.subject);
  for (let i = 0; i < numeric.length; i++) {
    for (let j = i + 1; j < numeric.length; j++) {
      const a = numeric[i];
      const b = numeric[j];
      if (a.subject !== b.subject) continue;
      if ((a.unit ?? "") !== (b.unit ?? "")) continue;
      const av = a.numericValue!;
      const bv = b.numericValue!;
      if (av === 0 && bv === 0) continue;
      const denom = Math.max(Math.abs(av), Math.abs(bv));
      const delta = Math.abs(av - bv) / denom;
      if (delta < 0.25) continue;
      const sev: "low" | "medium" | "high" = delta > 0.6 ? "high" : delta > 0.4 ? "medium" : "low";
      findings.push({
        claimAId: a.id,
        claimBId: b.id,
        severity: sev,
        description: `Two claims on "${a.subject}" diverge by ${(delta * 100).toFixed(0)}% (${av} ${a.unit ?? ""} vs ${bv} ${b.unit ?? ""}).`,
      });
    }
  }
  return findings;
}
