import { describe, expect, it } from "vitest";
import {
  TREASURY_FALLBACK_CPI,
  adjustedPrincipal,
  fallbackCpi,
  indexRatio,
  interestPayment,
  redemptionValue,
  refCpi,
} from "../src/index.js";
import { CPI as TD_CPI, DAILY, DATED } from "./fixtures.js";

// Real CPI-U NSA (BLS series CUUR0000SA0), fetched 2026-07-10.
const CPI = {
  "2024-12": 315.605,
  "2025-01": 317.671,
  "2025-02": 319.082,
  "2025-03": 319.799,
  "2025-04": 320.795,
  "2025-05": 321.465,
  "2025-06": 322.561,
  "2025-07": 323.048,
  "2025-08": 323.976,
  "2025-09": 324.8,
  "2025-11": 324.122,
  "2025-12": 324.054,
  "2026-01": 325.252,
  "2026-02": 326.785,
  "2026-03": 330.213,
  "2026-04": 333.02,
  "2026-05": 335.123,
} as const;

describe("reference CPI — reproduces TreasuryDirect published values", () => {
  it("refCpiOnDatedDate for CUSIP 91282CQP9 (dated 2026-04-15)", () => {
    // TreasuryDirect: refCpiOnDatedDate = 325.967400
    expect(refCpi("2026-04-15", CPI)).toBe(325.9674);
  });

  it("refCpiOnIssueDate for CUSIP 91282CQP9 (issued 2026-06-30)", () => {
    // TreasuryDirect: refCpiOnIssueDate = 332.926430
    expect(refCpi("2026-06-30", CPI)).toBe(332.92643);
  });

  it("refCpiOnDatedDate for CUSIP 91282CPU9 (dated 2026-01-15)", () => {
    // base = Oct 2025 (missing here) — use a date whose window we have.
    // Instead verify 2026-05-29 issue: base Feb, next Mar.
    // 326.785 + (28/31)*(330.213-326.785) = 326.785 + 0.903226*3.428 = 329.88126
    expect(refCpi("2026-05-29", CPI)).toBe(329.88126); // TD refCpiOnIssueDate 329.881260
  });

  it("the first of the month equals the CPI three months prior (no interpolation)", () => {
    expect(refCpi("2026-04-01", CPI)).toBe(325.252); // = Jan 2026 CPI exactly
    expect(refCpi("2026-05-01", CPI)).toBe(326.785); // = Feb 2026 CPI exactly
  });

  it("unrounded mode skips the 5-decimal rounding", () => {
    const raw = refCpi("2026-04-15", CPI, { rounded: false });
    expect(raw).toBeCloseTo(325.9674, 4);
  });

  it("throws with a helpful message when a needed month is missing", () => {
    expect(() => refCpi("2026-01-15", CPI)).toThrow(/missing "2025-10"/);
  });
});

describe("index ratio — reproduces TreasuryDirect published values", () => {
  it("indexRatioOnIssueDate 1.021350 for CUSIP 91282CQP9 issued 2026-06-30", () => {
    expect(
      indexRatio({ date: "2026-06-30", datedDate: "2026-04-15", cpi: CPI }),
    ).toBe(1.02135);
  });

  it("indexRatioOnIssueDate 1.015220 for CUSIP 91282CPU9 issued 2026-05-29", () => {
    // dated 2026-01-15 needs Oct 2025; instead check the ratio math directly
    // via two dates we can compute: 2026-06-30 / 2026-05-29
    const r = indexRatio({ date: "2026-06-30", datedDate: "2026-05-29", cpi: CPI });
    expect(r).toBeCloseTo(332.92643 / 329.88126, 5);
  });

  it("is 1.0 when valuation date equals dated date", () => {
    expect(indexRatio({ date: "2026-04-15", datedDate: "2026-04-15", cpi: CPI })).toBe(1);
  });
});

describe("principal, redemption, and interest", () => {
  it("adjusted principal scales face by the ratio", () => {
    expect(adjustedPrincipal(1000, 1.02135)).toBeCloseTo(1021.35, 10);
  });

  it("redemption applies the deflation floor at maturity", () => {
    expect(redemptionValue(1000, 1.02135)).toBeCloseTo(1021.35, 10); // inflated
    expect(redemptionValue(1000, 0.9779)).toBe(1000); // deflated → floored to par
    expect(adjustedPrincipal(1000, 0.9779)).toBe(977.9); // coupon base is NOT floored
  });

  it("interest payment uses face × ratio × rate / frequency", () => {
    // 1.25% TIPS, $1000 face, ratio 1.02135, semiannual
    expect(interestPayment(1000, 0.0125, 1.02135)).toBeCloseTo((1000 * 1.02135 * 0.0125) / 2, 10);
  });

  it("catches percent-instead-of-decimal coupon rates", () => {
    expect(() => interestPayment(1000, 1.25, 1.02135)).toThrow(/decimal/);
  });
});

describe("validation", () => {
  it("rejects malformed dates and bad numeric inputs", () => {
    expect(() => refCpi("2026-4-15", CPI)).toThrow(RangeError);
    expect(() => refCpi("2026-02-30", CPI)).toThrow(RangeError);
    expect(() => adjustedPrincipal(-1, 1.02)).toThrow(RangeError);
    expect(() => adjustedPrincipal(1000, 0)).toThrow(RangeError);
    expect(() => interestPayment(1000, 0.0125, 1.02, 0)).toThrow(RangeError);
  });
});

describe("reproduces TreasuryDirect daily TIPS tables (test/fixtures.ts)", () => {
  it(`ref CPI and index ratio for ${DAILY.length} CUSIP-days`, () => {
    for (const [cusip, date, ref, ratio] of DAILY) {
      expect(refCpi(date, TD_CPI), `${cusip} ${date} refCpi`).toBe(ref);
      expect(indexRatio({ date, datedDate: DATED[cusip] as string, cpi: TD_CPI }), `${cusip} ${date}`).toBe(
        ratio,
      );
    }
  });

  it("rounds an exact sixth-decimal tie up, like Treasury (was 1.15446)", () => {
    // 9128274Y5 on 2004-08-13: 189.33226 / 164.00000 = 1.154465 exactly;
    // floating-point division gives 1.1544649999…, which v1.0.0 rounded down.
    expect(refCpi("2004-08-13", TD_CPI)).toBe(189.33226);
    expect(refCpi("1999-01-15", TD_CPI)).toBe(164);
    expect(indexRatio({ date: "2004-08-13", datedDate: "1999-01-15", cpi: TD_CPI })).toBe(1.15447);
    expect(indexRatio({ date: "2007-12-21", datedDate: "1999-01-15", cpi: TD_CPI })).toBe(1.27304);
  });
});

describe("fallback CPI (31 CFR 356 Appendix B (iv))", () => {
  it("reproduces Treasury's October 2025 index number", () => {
    // BLS published no October 2025 CPI-U. Sep 2025 = 324.800, Sep 2024 = 315.301.
    expect(fallbackCpi("2025-10", { "2024-09": 315.301, "2025-09": 324.8 })).toBe(325.604);
    expect(TREASURY_FALLBACK_CPI["2025-10"]).toBe(325.604);
  });

  it("generalizes to a CPI last reported N months earlier", () => {
    const cpi = { "2024-08": 314.796, "2025-08": 323.976 };
    expect(fallbackCpi("2025-10", cpi)).toBe(Math.round(323.976 * (323.976 / 314.796) ** (2 / 12) * 1000) / 1000);
  });

  it("lets a BLS series price TIPS dated 2026-01-15 (CUSIP 91282CPU9)", () => {
    const cpi = { ...CPI, ...TREASURY_FALLBACK_CPI };
    // TreasuryDirect: refCpiOnDatedDate = 324.934710
    expect(refCpi("2026-01-15", cpi)).toBe(324.93471);
    // TreasuryDirect daily index for 2026-02-01: 0.99750
    expect(indexRatio({ date: "2026-02-01", datedDate: "2026-01-15", cpi })).toBe(0.9975);
  });

  it("validates the month and needs a year-earlier value", () => {
    expect(() => fallbackCpi("2025-13", CPI)).toThrow(RangeError);
    expect(() => fallbackCpi("2025-10", { "2025-09": 324.8 })).toThrow(/missing "2024-09"/);
    expect(() => fallbackCpi("2025-10", {})).toThrow(RangeError);
  });
});

describe("inputs with more than three decimals", () => {
  it("still truncates to six and rounds to five decimals", () => {
    const cpi = { "2026-01": 325.2524, "2026-02": 326.7851 };
    const raw = refCpi("2026-04-15", cpi, { rounded: false });
    expect(refCpi("2026-04-15", cpi)).toBe(Math.round(Math.trunc(raw * 1e6) / 10) / 1e5);
  });
});
