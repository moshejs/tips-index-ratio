# tips-index-ratio

US **TIPS** inflation math per [31 CFR Part 356, Appendix B](https://www.ecfr.gov/current/title-31/subtitle-B/chapter-II/part-356) — reference-CPI interpolation, index ratios, inflation-adjusted principal and interest, and the deflation floor. Zero dependencies.

```
npm install tips-index-ratio
```

## Why

A Treasury Inflation-Protected Security's principal moves with the CPI, and the exact rule is fiddly: the reference CPI on any date is a **day-weighted interpolation** between the CPI-U from three and two months prior, rounded to five decimals, and the index ratio divides one by another. Get the interpolation or the rounding slightly wrong and every downstream number drifts. npm had nothing that implements it — this package does, and it reproduces TreasuryDirect's own published figures to the digit.

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

- **`refCpi(date, cpi, opts?)`** — reference CPI on a date. `opts.rounded` (default `true`) applies the Treasury's 5-decimal rounding. Throws a helpful error naming the exact month if the series is missing a value it needs.
- **`indexRatio({ date, datedDate, cpi }, opts?)`** — `refCpi(date) / refCpi(datedDate)`, rounded to 5 decimals.
- **`adjustedPrincipal(face, ratio)`** — `face × ratio` (unfloored; this is the coupon base).
- **`redemptionValue(face, ratio)`** — `face × max(ratio, 1)`; the deflation floor applies only at maturity.
- **`interestPayment(face, rate, ratio, frequency?)`** — `face × ratio × rate / frequency`; `rate` is a decimal, `frequency` defaults to 2 (semiannual).

You bring the CPI series — pair it with a BLS client or TreasuryDirect's published values. The math is exact and offline.

## Correctness

Test vectors are live TreasuryDirect TIPS auction records: for real CUSIPs the package reproduces the published `refCpiOnDatedDate`, `refCpiOnIssueDate`, and `indexRatioOnIssueDate` exactly, using real BLS CPI-U figures as input.

## Related

Part of a small fixed-income toolkit: [`treasurydirect`](https://github.com/moshejs/treasurydirect) (fetch the TIPS records and CPI refs) · [`accrued-interest`](https://github.com/moshejs/accrued-interest) · [`day-count`](https://github.com/moshejs/day-count) · [`tbill`](https://github.com/moshejs/tbill) · [`32nds`](https://github.com/moshejs/32nds) · [`sifma-holidays`](https://github.com/moshejs/sifma-holidays) · [`newyorkfed`](https://github.com/moshejs/newyorkfed) · [`instrument-identifiers`](https://github.com/moshejs/instrument-identifiers).

## Author

Built by **[Moshe Malka](https://moshemalka.com)** — engineering leader in New York City. Studio work at [Quentin.Code](https://www.quentin.software/).

MIT © Moshe Malka
