# Procurement forecast backtest (synthetic households)

Forecast of the Aug-Sep 2025 honey purchases, from data before the forecast day. Amount columns use a forecast made 21 days before the window opens (2025-08-01). Warning lead time = how many days before the window the forecast's gap upper bound was first positive (checked every 7 days up to 98).

| Household (seed) | Suppliers | Last year's bill | Forecast range | Actual | In range | Error of midpoint | Cash at window start | Real shortfall | Forecast gap (expected / upper) | Warning lead time |
|---|---|---|---|---|---|---|---|---|---|---|
| 11 | 7 | 71,980 | 65,140 - 78,820 | 77,580 | yes | -7.2% | 77,419 | 161 | 0 / 11,091 | 98 days |
| 23 | 6 | 51,670 | 48,000 - 55,340 | 46,930 | no | +10.1% | 65,906 | 0 | 0 / 0 | 91 days |
| 37 | 8 | 76,090 | 70,980 - 81,200 | 68,810 | no | +10.6% | 104,231 | 0 | 0 / 0 | no warning |
| 51 | 5 | 53,890 | 52,200 - 55,580 | 54,830 | yes | -1.7% | 61,907 | 0 | 2,534 / 10,075 | 91 days |
| 64 | 7 | 63,270 | 57,160 - 69,380 | 67,190 | yes | -5.8% | 103,410 | 0 | 0 / 0 | no warning |

- Actual inside the forecast range: 3 of 5.
- Mean absolute error of the midpoint: 7.1%.
- Households with a real shortfall: 1; warned at least 7 days ahead: 1.
- Warned although cash turned out enough: 2.

Caveat: the households are generated from the same kind of assumptions the forecaster makes (steady monthly payouts, pension and household spending; supplier bills that move up or down by up to about 20% between years). This shows the mechanics work; it is not evidence of accuracy on real farms.
