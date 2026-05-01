// ─── Minimal cron parser (Stage 5.1) ────────────────────────────────────────
// We only need a tiny subset of cron semantics for the project-templates
// scheduler — no third-party dep, no surprises, easy to reason about.
//
// Supported expression: standard 5-field cron in `Europe/London` time zone.
//
//   ┌───────────── minute (0–59)
//   │ ┌─────────── hour   (0–23)
//   │ │ ┌───────── day-of-month (1–31)
//   │ │ │ ┌─────── month  (1–12)
//   │ │ │ │ ┌───── day-of-week  (0–6, Sunday = 0)
//   │ │ │ │ │
//   m h D M W
//
// Each field accepts:
//   *           — every value
//   N           — exact value
//   N-M         — inclusive range
//   N,M,P       — comma list
//   * /n        — every n-th value (step from 0 / range start)
//   N-M/n       — stepped range
//
// What we deliberately DO NOT support (out of scope for 5.1):
//   • Names (MON, JAN, …) — use 0–6 / 1–12.
//   • Special strings (@hourly, @reboot, …).
//   • Day-of-month + day-of-week OR-semantics — we treat them with AND.
//     For our seed templates only one of D / W is constrained at a time,
//     so this is fine; if we ever need OR we can add a flag.
//   • Seconds field — we tick once per minute.
//
// Time zone: every match is computed against Europe/London, including DST.
// We don't trust `Date.UTC` arithmetic; instead we read each candidate epoch
// back through `Intl.DateTimeFormat({ timeZone: "Europe/London" })` to get
// the real wall-clock fields. This is slow (a few hundred μs per probe) but
// only runs once per template per tick — utterly fine for our scale.
// ─────────────────────────────────────────────────────────────────────────────

const TZ = "Europe/London";

interface ParsedField {
  /** Sorted, deduped list of integers this field matches. */
  values: number[];
}

interface ParsedCron {
  minute: ParsedField;
  hour: ParsedField;
  dom: ParsedField;
  month: ParsedField;
  dow: ParsedField;
  /** True when day-of-month is wildcard (`*`), false when constrained. */
  domStar: boolean;
  /** True when day-of-week is wildcard (`*`), false when constrained. */
  dowStar: boolean;
}

// Parse a single field like "0", "*", "*/5", "1-5", "0,15,30,45", "9-17/2".
function parseField(raw: string, min: number, max: number): ParsedField {
  if (!raw || typeof raw !== "string") {
    throw new Error(`cron: empty field (expected ${min}-${max})`);
  }
  const out = new Set<number>();
  for (const part of raw.split(",")) {
    const piece = part.trim();
    if (!piece) throw new Error(`cron: empty field segment in "${raw}"`);

    // Split off optional /step.
    let body = piece;
    let step = 1;
    const slashAt = piece.indexOf("/");
    if (slashAt !== -1) {
      body = piece.slice(0, slashAt);
      const stepStr = piece.slice(slashAt + 1);
      const stepNum = Number(stepStr);
      if (!Number.isInteger(stepNum) || stepNum < 1) {
        throw new Error(`cron: bad step "${stepStr}" in "${piece}"`);
      }
      step = stepNum;
    }

    // Resolve range bounds.
    let lo: number;
    let hi: number;
    if (body === "*") {
      lo = min;
      hi = max;
    } else if (body.includes("-")) {
      const [a, b] = body.split("-");
      lo = Number(a);
      hi = Number(b);
      if (!Number.isInteger(lo) || !Number.isInteger(hi)) {
        throw new Error(`cron: bad range "${body}"`);
      }
    } else {
      const v = Number(body);
      if (!Number.isInteger(v)) throw new Error(`cron: bad value "${body}"`);
      lo = v;
      hi = v;
    }

    if (lo < min || hi > max || lo > hi) {
      throw new Error(`cron: range ${lo}-${hi} out of bounds (${min}-${max})`);
    }

    for (let v = lo; v <= hi; v += step) out.add(v);
  }
  return { values: Array.from(out).sort((a, b) => a - b) };
}

export function parseCron(expr: string): ParsedCron {
  const cleaned = expr.trim().replace(/\s+/g, " ");
  const parts = cleaned.split(" ");
  if (parts.length !== 5) {
    throw new Error(
      `cron: expected 5 fields ("m h D M W"), got ${parts.length} in "${expr}"`,
    );
  }
  const [m, h, D, M, W] = parts;
  return {
    minute: parseField(m, 0, 59),
    hour: parseField(h, 0, 23),
    dom: parseField(D, 1, 31),
    month: parseField(M, 1, 12),
    // Cron treats both 0 and 7 as Sunday. We canonicalise to 0–6 by validating
    // the raw string against 0–7 then dropping 7s (Sunday is already 0).
    dow: (() => {
      const f = parseField(W, 0, 7);
      const cleanedDow = Array.from(new Set(f.values.map((v) => (v === 7 ? 0 : v))))
        .sort((a, b) => a - b);
      return { values: cleanedDow };
    })(),
    domStar: D.trim() === "*",
    dowStar: W.trim() === "*",
  };
}

// ─── London wall-clock helpers ──────────────────────────────────────────────
// Intl returns padded numeric strings; this decoder turns them into a
// well-typed record we can pattern-match against the parsed fields.
interface LondonParts {
  year: number;
  month: number;     // 1–12
  day: number;       // 1–31
  hour: number;      // 0–23
  minute: number;    // 0–59
  weekday: number;   // 0 = Sunday … 6 = Saturday
}

const LONDON_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  timeZone: TZ,
  hour12: false,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  weekday: "short",
});

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
};

function partsInLondon(d: Date): LondonParts {
  const out: Partial<LondonParts> = {};
  for (const p of LONDON_FORMATTER.formatToParts(d)) {
    switch (p.type) {
      case "year":    out.year = Number(p.value); break;
      case "month":   out.month = Number(p.value); break;
      case "day":     out.day = Number(p.value); break;
      case "hour":
        // Intl can return "24" at midnight for some locales — clamp to 0.
        out.hour = Number(p.value) % 24;
        break;
      case "minute":  out.minute = Number(p.value); break;
      case "weekday": out.weekday = WEEKDAY_INDEX[p.value] ?? 0; break;
    }
  }
  return out as LondonParts;
}

function matches(parts: LondonParts, c: ParsedCron): boolean {
  if (!c.minute.values.includes(parts.minute)) return false;
  if (!c.hour.values.includes(parts.hour)) return false;
  if (!c.month.values.includes(parts.month)) return false;
  // Standard cron: when both DOM and DOW are constrained, ANY match passes
  // (OR). When exactly one is constrained, only that one matters. When both
  // are wildcards, both pass trivially.
  const domOk = c.dom.values.includes(parts.day);
  const dowOk = c.dow.values.includes(parts.weekday);
  if (!c.domStar && !c.dowStar) return domOk || dowOk;
  if (!c.domStar) return domOk;
  if (!c.dowStar) return dowOk;
  return true;
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Compute the next epoch-ms on or AFTER `from` that satisfies the cron
 * expression in Europe/London time. Returns null if no match is found within
 * a four-year search window (which would indicate a malformed expression like
 * "0 0 31 2 *" — Feb 31st never exists).
 *
 * The algorithm advances one minute at a time. That sounds slow but for any
 * realistic cron we hit a match within a few thousand probes — well under a
 * millisecond on modern hardware. We pin the search ceiling at ~4 years
 * (≈2.1M minutes) so a bad expression fails fast at template-save time
 * instead of looping forever in the scheduler tick.
 */
export function nextRun(expr: string, from: Date = new Date()): Date | null {
  const parsed = parseCron(expr);

  // Advance to the start of the next minute so a tick at 18:00:30 doesn't
  // re-fire the same 18:00:00 slot we may have just consumed.
  const start = new Date(from.getTime());
  start.setUTCSeconds(0, 0);
  start.setUTCMinutes(start.getUTCMinutes() + 1);

  const HORIZON_MINUTES = 4 * 366 * 24 * 60; // ~4 years incl. leap days
  let cursor = start.getTime();
  for (let i = 0; i < HORIZON_MINUTES; i++) {
    const probe = new Date(cursor);
    if (matches(partsInLondon(probe), parsed)) return probe;
    cursor += 60_000;
  }
  return null;
}

/**
 * Validate a cron expression. Returns null if valid, otherwise an error
 * message suitable for surfacing to the user (template editor).
 */
export function validateCron(expr: string): string | null {
  try {
    parseCron(expr);
    // Sanity check: exercise nextRun so impossible expressions like
    // "0 0 31 2 *" fail at save time rather than silently never firing.
    if (nextRun(expr) === null) {
      return "cron: expression has no matches in the next four years";
    }
    return null;
  } catch (err: any) {
    return err?.message ?? "cron: invalid expression";
  }
}

/**
 * Human-readable description of a cron expression for the UI. Falls back to
 * the raw expression when we don't have a special-case template — keeps the
 * surface area tiny while still giving operators a sane label for the two
 * cron strings we actually ship in 5.1.
 */
export function describeCron(expr: string): string {
  const trimmed = expr.trim().replace(/\s+/g, " ");
  switch (trimmed) {
    case "0 18 * * 0":  return "Sundays at 18:00 UK";
    case "*/5 * * * *": return "Every 5 minutes";
    case "0 9 * * 1":   return "Mondays at 09:00 UK";
    case "0 * * * *":   return "Every hour, on the hour";
    case "0 0 * * *":   return "Daily at midnight UK";
    default:            return trimmed;
  }
}
