import { describe, it, expect } from "vitest";
import {
  DEFAULT_OFFICE_VIEW,
  STABLE_VIEWS,
  EXPERIMENTAL_VIEWS,
  isOfficeView,
  isExperimentalView,
  selectableViews,
  resolveOfficeView,
} from "./officeView";

describe("officeView config", () => {
  it("defaults to a stable, non-experimental view", () => {
    expect(STABLE_VIEWS).toContain(DEFAULT_OFFICE_VIEW);
    expect(isExperimentalView(DEFAULT_OFFICE_VIEW)).toBe(false);
  });

  it("classifies the FatCat modes as experimental", () => {
    expect(EXPERIMENTAL_VIEWS).toEqual(["iso", "mission"]);
    expect(isExperimentalView("iso")).toBe(true);
    expect(isExperimentalView("mission")).toBe(true);
    expect(isExperimentalView("board")).toBe(false);
  });

  it("only exposes stable views unless the preview is enabled", () => {
    expect(selectableViews(false)).toEqual(["sims", "board"]);
    expect(selectableViews(true)).toEqual(["sims", "board", "iso", "mission"]);
  });
});

describe("isOfficeView", () => {
  it("accepts known views and rejects junk", () => {
    expect(isOfficeView("board")).toBe(true);
    expect(isOfficeView("iso")).toBe(true);
    expect(isOfficeView("nope")).toBe(false);
    expect(isOfficeView(undefined)).toBe(false);
    expect(isOfficeView(null)).toBe(false);
    expect(isOfficeView(42)).toBe(false);
  });
});

describe("resolveOfficeView fallback safety", () => {
  it("falls back to the default for unknown or missing values", () => {
    expect(resolveOfficeView(undefined, false)).toBe(DEFAULT_OFFICE_VIEW);
    expect(resolveOfficeView("garbage", true)).toBe(DEFAULT_OFFICE_VIEW);
    expect(resolveOfficeView(null, true)).toBe(DEFAULT_OFFICE_VIEW);
  });

  it("never resolves to an experimental mode when the preview is disabled", () => {
    expect(resolveOfficeView("iso", false)).toBe(DEFAULT_OFFICE_VIEW);
    expect(resolveOfficeView("mission", false)).toBe(DEFAULT_OFFICE_VIEW);
  });

  it("honours a persisted experimental mode only when the preview is enabled", () => {
    expect(resolveOfficeView("iso", true)).toBe("iso");
    expect(resolveOfficeView("mission", true)).toBe("mission");
  });

  it("passes stable views through regardless of the preview flag", () => {
    expect(resolveOfficeView("board", false)).toBe("board");
    expect(resolveOfficeView("sims", false)).toBe("sims");
    expect(resolveOfficeView("board", true)).toBe("board");
  });

  it("resolved value is always a real, currently-selectable view", () => {
    for (const allow of [false, true]) {
      for (const req of ["sims", "board", "iso", "mission", "junk", undefined]) {
        const resolved = resolveOfficeView(req, allow);
        expect(selectableViews(allow)).toContain(resolved);
      }
    }
  });
});
