/**
 * tips-index-ratio — TIPS inflation math per 31 CFR Part 356, Appendix B.
 *
 * Reference CPI interpolation (three-month lag, day-weighted), index ratios,
 * inflation-adjusted principal and interest, and the deflation floor at
 * maturity. Reproduces TreasuryDirect's published refCpi and index-ratio
 * values exactly.
 *
 * CPI input is the NOT-seasonally-adjusted CPI-U (BLS series CUUR0000SA0),
 * keyed by month: `{ "2026-01": 325.252, "2026-02": 326.785, … }`.
 */

export type CpiSeries = Readonly<Record<string, number>>;

export type DateInput = string | Date;

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

interface YMD {
  y: number;
  m: number;
  d: number;
}

function toYMD(input: DateInput, label: string): YMD {
  if (input instanceof Date) {
    if (Number.isNaN(input.getTime())) throw new RangeError(`Invalid Date for ${label}`);
    return { y: input.getUTCFullYear(), m: input.getUTCMonth() + 1, d: input.getUTCDate() };
  }
  const m = DATE_RE.exec(input);
  if (!m) throw new RangeError(`Invalid date for ${label}: "${input}" (expected YYYY-MM-DD)`);
  const ymd = { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
  const check = new Date(Date.UTC(ymd.y, ymd.m - 1, ymd.d));
  if (
    check.getUTCFullYear() !== ymd.y ||
    check.getUTCMonth() + 1 !== ymd.m ||
    check.getUTCDate() !== ymd.d
  ) {
    throw new RangeError(`Invalid calendar date for ${label}: "${input}"`);
  }
  return ymd;
}

function monthKey(y: number, m: number): string {
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}`;
}

function addMonths(y: number, m: number, delta: number): { y: number; m: number } {
  const total = y * 12 + (m - 1) + delta;
  return { y: Math.floor(total / 12), m: (total % 12) + 1 };
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function cpiFor(cpi: CpiSeries, y: number, m: number, forDate: string): number {
  const key = monthKey(y, m);
  const v = cpi[key];
  if (v === undefined || !Number.isFinite(v) || v <= 0) {
    throw new RangeError(
      `CPI series is missing "${key}" (needed for reference CPI on ${forDate}); ` +
        `provide CPI-U NSA values for the third and second months before the target month`,
    );
  }
  return v;
}

function round5(x: number): number {
  return Math.round(x * 1e5) / 1e5;
}

export interface RefCpiOptions {
  /**
   * Round to 5 decimal places per the Treasury's published convention.
   * Default true (matches TreasuryDirect's refCpi fields).
   */
  rounded?: boolean;
}

/**
 * Reference CPI for a date, per Appendix B: the ref CPI for the first day of
 * month m is the CPI for month m−3; within the month it interpolates
 * day-weighted toward the CPI for month m−2.
 *
 * ```ts
 * refCpi("2026-04-15", { "2026-01": 325.252, "2026-02": 326.785 });
 * // 325.9674 — matches TreasuryDirect's refCpiOnDatedDate for CUSIP 91282CQP9
 * ```
 */
export function refCpi(date: DateInput, cpi: CpiSeries, opts: RefCpiOptions = {}): number {
  const { y, m, d } = toYMD(date, "date");
  const dateStr = `${monthKey(y, m)}-${String(d).padStart(2, "0")}`;
  const base = addMonths(y, m, -3);
  const next = addMonths(y, m, -2);
  const cpiBase = cpiFor(cpi, base.y, base.m, dateStr);
  const cpiNext = cpiFor(cpi, next.y, next.m, dateStr);
  const D = daysInMonth(y, m);
  const raw = cpiBase + ((d - 1) / D) * (cpiNext - cpiBase);
  return (opts.rounded ?? true) ? round5(raw) : raw;
}

export interface IndexRatioParams {
  /** Settlement/valuation date. */
  date: DateInput;
  /** The security's dated date (start of inflation accrual). */
  datedDate: DateInput;
  /** CPI-U NSA series covering both dates' reference months. */
  cpi: CpiSeries;
}

/**
 * Index ratio = refCPI(date) / refCPI(datedDate), computed on 5-decimal
 * reference CPIs and rounded to 5 decimals, per the Treasury convention.
 *
 * ```ts
 * indexRatio({ date: "2026-06-30", datedDate: "2026-04-15", cpi });
 * // 1.02135 — TreasuryDirect publishes indexRatioOnIssueDate 1.021350
 * ```
 */
export function indexRatio(params: IndexRatioParams, opts: RefCpiOptions = {}): number {
  const rounded = opts.rounded ?? true;
  const num = refCpi(params.date, params.cpi, { rounded });
  const den = refCpi(params.datedDate, params.cpi, { rounded });
  const ratio = num / den;
  return rounded ? round5(ratio) : ratio;
}

/** Inflation-adjusted principal: face × index ratio (no floor — see redemptionValue). */
export function adjustedPrincipal(face: number, ratio: number): number {
  checkFace(face);
  checkRatio(ratio);
  return face * ratio;
}

/**
 * Principal repaid at MATURITY: the deflation floor guarantees at least the
 * original face — `face × max(ratio, 1)`. The floor applies only at
 * redemption; coupons always use the unfloored ratio.
 */
export function redemptionValue(face: number, ratio: number): number {
  checkFace(face);
  checkRatio(ratio);
  return face * Math.max(ratio, 1);
}

/**
 * One coupon payment: `face × ratio × rate / frequency`.
 * `rate` is the annual coupon as a decimal (0.0125 for 1.25%); TIPS pay
 * semiannually (frequency 2, the default).
 */
export function interestPayment(
  face: number,
  rate: number,
  ratio: number,
  frequency = 2,
): number {
  checkFace(face);
  checkRatio(ratio);
  if (!Number.isFinite(rate) || rate < 0) throw new RangeError(`Invalid rate: ${rate}`);
  if (rate > 1) {
    throw new RangeError(
      `rate must be a decimal (got ${rate} — did you mean ${rate / 100}? e.g. 0.0125 for 1.25%)`,
    );
  }
  if (!Number.isInteger(frequency) || frequency <= 0) {
    throw new RangeError(`Invalid frequency: ${frequency}`);
  }
  return (face * ratio * rate) / frequency;
}

function checkFace(face: number): void {
  if (!Number.isFinite(face) || face <= 0) throw new RangeError(`Invalid face: ${face}`);
}

function checkRatio(ratio: number): void {
  if (!Number.isFinite(ratio) || ratio <= 0) throw new RangeError(`Invalid index ratio: ${ratio}`);
}
