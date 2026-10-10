# tips-index-ratio

US **TIPS** inflation math per [31 CFR Part 356, Appendix B](https://www.ecfr.gov/current/title-31/subtitle-B/chapter-II/part-356) — reference-CPI interpolation, index ratios, inflation-adjusted principal and interest, and the deflation floor. Zero dependencies.

```
npm install tips-index-ratio
```

## Why

A Treasury Inflation-Protected Security's principal moves with the CPI, and the exact rule is fiddly: the reference CPI on any date is a **day-weighted interpolation** between the CPI-U from three and two months prior, truncated to six decimals and rounded to five, and the index ratio divides one by another (truncated and rounded the same way). Get the interpolation or the rounding slightly wrong and every downstream number drifts. npm had nothing that implements it — this package does, and it reproduces TreasuryDirect's own published figures to the digit.

```ts
import { refCpi, indexRatio, redemptionValue } from "tips-index-ratio";

// CPI-U NSA (BLS series CUUR0000SA0), keyed by month:
const cpi = { "2026-01": 325.252, "2026-02": 326.785, "2026-03": 330.213, "2026-04": 333.020 };

refCpi("2026-04-15", cpi);   // 325.9674  — matches TreasuryDirect's refCpiOnDatedDate
refCpi("2026-06-30", cpi);   // 332.92643 — matches refCpiOnIssueDate

indexRatio({ date: "2026-06-30", datedDate: "2026-04-15", cpi });
// 1.02135 — matches TreasuryDirect's indexRatioOnIssueDate

redemptionValue(1000, 0.9779); // 1000 — deflation floor guarantees par at maturity
```

## API

CPI input is the not-seasonally-adjusted CPI-U (BLS series `CUUR0000SA0`), an object keyed `"YYYY-MM"`. Dates are `"YYYY-MM-DD"` strings or `Date` objects (UTC).

- **`refCpi(date, cpi, opts?)`** — reference CPI on a date. `opts.rounded` (default `true`) applies the Treasury's truncate-to-6, round-to-5 rule. Throws a helpful error naming the exact month if the series is missing a value it needs.
- **`indexRatio({ date, datedDate, cpi }, opts?)`** — `refCpi(date) / refCpi(datedDate)`, truncated to 6 and rounded to 5 decimals. For a reopened TIPS, `datedDate` is the original dated date.
- **`fallbackCpi(month, cpi)`** — the index number Treasury substitutes when a month's CPI is not reported on time (31 CFR 356 Appendix B (iv)): the last reported CPI grown at its trailing 12-month rate, rounded to three decimals.
- **`TREASURY_FALLBACK_CPI`** — fallback values Treasury has actually announced and uses permanently: `{ "2025-10": 325.604 }`.
- **`adjustedPrincipal(face, ratio)`** — `face × ratio` (unfloored; this is the coupon base).
- **`redemptionValue(face, ratio)`** — `face × max(ratio, 1)`; the deflation floor applies only at maturity.
- **`interestPayment(face, rate, ratio, frequency?)`** — `face × ratio × rate / frequency`; `rate` is a decimal, `frequency` defaults to 2 (semiannual).

You bring the CPI series — pair it with a BLS client or TreasuryDirect's published values. The math is exact and offline: with CPI values of up to three decimals (as BLS publishes them), the truncation and rounding are done in integer arithmetic, so a value that lands exactly on a sixth-decimal tie (189.33226 / 164 = 1.154465) rounds the way Treasury's does instead of falling victim to floating point.

### October 2025

BLS never published an October 2025 CPI (federal government shutdown), so any BLS-sourced series has a hole there, and every date in December 2025 and January 2026 needs it. Treasury applied its fallback rule and uses **325.604** for all TIPS calculations. Merge it in:

```ts
import { TREASURY_FALLBACK_CPI, refCpi } from "tips-index-ratio";

const cpi = { ...blsSeries, ...TREASURY_FALLBACK_CPI };
refCpi("2026-01-15", cpi); // 324.93471 — TreasuryDirect's refCpiOnDatedDate for 91282CPU9
```

## Correctness

Cross-checked against TreasuryDirect's published daily TIPS tables for all 109 TIPS CUSIPs (1997–2026): fed the monthly CPI values Treasury used, `refCpi` and `indexRatio` reproduce all 321,833 published daily reference CPIs and index ratios exactly, along with the `refCpiOnDatedDate`, `refCpiOnIssueDate` and `indexRatioOnIssueDate` of every TIPS auction whose inputs are available. A sample of 384 CUSIP-days is committed as a test fixture.

One caveat about inputs: for January–August 2000 and May–August 2016, the CPI-U values the BLS API returns today differ slightly from the ones Treasury used (e.g. May 2016: BLS 240.229, Treasury 240.236), so reference CPIs computed from today's BLS data for dates that depend on those months won't match Treasury's tables.

## Related

Part of a small fixed-income toolkit: [`treasurydirect`](https://github.com/moshejs/treasurydirect) (fetch the TIPS records and CPI refs) · [`accrued-interest`](https://github.com/moshejs/accrued-interest) · [`day-count`](https://github.com/moshejs/day-count) · [`tbill`](https://github.com/moshejs/tbill) · [`32nds`](https://github.com/moshejs/32nds) · [`sifma-holidays`](https://github.com/moshejs/sifma-holidays) · [`newyorkfed`](https://github.com/moshejs/newyorkfed) · [`instrument-identifiers`](https://github.com/moshejs/instrument-identifiers).

## Author

Built by **[Moshe Malka](https://moshemalka.com)** — engineering leader in New York City. Studio work at [Quentin.Code](https://www.quentin.software/).

MIT © Moshe Malka
