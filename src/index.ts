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
        `provide CPI-U NSA values for the third and second months before the target month ` +
        `(for a month BLS never published, see TREASURY_FALLBACK_CPI / fallbackCpi)`,
    );
  }
  return v;
}

/**
 * Appendix B: "we truncate calculations with regard to the Ref CPI and the
 * Index Ratio for a specific date to six decimal places, and round to five".
 * `micro` is the truncated value in millionths; returns the 5-decimal value.
 */
function roundFromMicro(micro: number): number {
  return Math.floor((micro + 5) / 10) / 1e5;
}

/** Floor of a / b for non-negative integers a, b below 2^53 — exact. */
function intDiv(a: number, b: number): number {
  return (a - (a % b)) / b;
}

/** v in thousandths when v has at most three decimals (as BLS publishes CPI-U). */
function toMilli(v: number): number | undefined {
  const m = Math.round(v * 1000);
  return Math.abs(m - v * 1000) < 1e-6 ? m : undefined;
}

/** v in hundred-thousandths when v has at most five decimals. */
function toE5(v: number): number | undefined {
  const m = Math.round(v * 1e5);
  return Math.abs(m - v * 1e5) < 1e-4 ? m : undefined;
}

/** Float fallback for inputs with more decimals than the exact path handles. */
function truncRound(x: number): number {
  return roundFromMicro(Math.floor(x * 1e6 + 1e-6));
}

/**
 * Index numbers Treasury announced for months BLS did not report in time,
 * per 31 CFR 356 Appendix B (iv)(c): once announced they are used for all
 * TIPS calculations, even if BLS publishes a value later. Merge them into a
 * BLS series: `{ ...bls, ...TREASURY_FALLBACK_CPI }`.
 *
 * - 2025-10: BLS published no October 2025 CPI (federal shutdown). 325.604 =
 *   fallbackCpi for Sep 2025 324.800 / Sep 2024 315.301, and reproduces every
 *   TreasuryDirect ref CPI for December 2025 and January 2026.
 */
export const TREASURY_FALLBACK_CPI: CpiSeries = Object.freeze({ "2025-10": 325.604 });

/**
 * The index number Treasury substitutes for a CPI that is not reported on
 * time (31 CFR 356 Appendix B (iv)): the last reported CPI, N months
 * earlier, grown at its trailing twelve-month rate —
 * `CPI[M−N] × (CPI[M−N] / CPI[M−N−12])^(N/12)` — rounded to three decimals
 * like a published CPI.
 *
 * ```ts
 * fallbackCpi("2025-10", bls); // 325.604 — Treasury's announced value
 * ```
 */
export function fallbackCpi(month: string, cpi: CpiSeries): number {
  const mm = /^(\d{4})-(\d{2})$/.exec(month);
  if (!mm || Number(mm[2]) < 1 || Number(mm[2]) > 12) {
    throw new RangeError(`Invalid month: "${month}" (expected YYYY-MM)`);
  }
  const y = Number(mm[1]);
  const m = Number(mm[2]);
  for (let n = 1; n <= 12; n++) {
    const last = addMonths(y, m, -n);
    const v = cpi[monthKey(last.y, last.m)];
    if (v === undefined || !Number.isFinite(v) || v <= 0) continue;
    const prior = addMonths(last.y, last.m, -12);
    const base = cpiFor(cpi, prior.y, prior.m, `fallback for ${month}`);
    return Math.round(v * (v / base) ** (n / 12) * 1000) / 1000;
  }
  throw new RangeError(`No CPI reported in the 12 months before ${month}`);
}

export interface RefCpiOptions {
  /**
   * Truncate to 6 and round to 5 decimal places per 31 CFR 356 Appendix B.
   * Default true (matches TreasuryDirect's refCpi and index ratio fields).
   * Computed in exact integer arithmetic when CPI values have at most three
   * decimals, so ties at the sixth decimal round the way Treasury's do.
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
  if (!(opts.rounded ?? true)) return cpiBase + ((d - 1) / D) * (cpiNext - cpiBase);
  const b = toMilli(cpiBase);
  const n = toMilli(cpiNext);
  if (b === undefined || n === undefined) {
    return truncRound(cpiBase + ((d - 1) / D) * (cpiNext - cpiBase));
  }
  // Ref CPI in millionths = 1000 · (b·D + (d−1)·(n−b)) / D, truncated.
  return roundFromMicro(intDiv(1000 * (b * D + (d - 1) * (n - b)), D));
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
 * reference CPIs, then truncated to 6 and rounded to 5 decimals, per the
 * Treasury convention.
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
  if (!rounded) return num / den;
  // Exact: both ref CPIs are 5-decimal numbers. Floating-point division would
  // turn an exact tie such as 189.33226 / 164 = 1.154465 into 1.1544649999…
  const a = toE5(num);
  const b = toE5(den);
  if (a === undefined || b === undefined || a * 1e6 > Number.MAX_SAFE_INTEGER) {
    return truncRound(num / den);
  }
  return roundFromMicro(intDiv(a * 1e6, b));
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
