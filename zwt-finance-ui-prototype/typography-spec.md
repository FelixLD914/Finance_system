# ZWT Finance Typography Specification

## Visual thesis

Warm editorial display typography gives the finance workspace authority, while a compact
humanist sans-serif keeps dense operational data clear and stable.

## Font families

| Use | Latin | Simplified Chinese | Windows fallback |
| --- | --- | --- | --- |
| Display headings and wordmark | Cormorant Garamond | Noto Serif SC Variable | Songti SC, SimSun, Georgia |
| Navigation, forms, tables, status and body copy | DM Sans | Noto Sans SC Variable | Microsoft YaHei UI, Microsoft YaHei, PingFang SC, Segoe UI |
| Thai business data | TH SarabunPSK / TH Sarabun New | — | Sarabun, Leelawadee UI, Tahoma |

All four primary fonts are bundled with the frontend. The Chinese families use
weight-variable, Unicode-range assets so the browser downloads only the glyph ranges used
on the page. Production rendering must not depend on fonts installed on the Windows Server
or user workstation.

Thai business values must be marked with `lang="th"`. The CSS family order is
`TH SarabunPSK`, `TH Sarabun New`, bundled `Sarabun`, then Windows fallbacks. Thai body
copy is rendered at `1.28em` with a `1.2` line height so its perceived size remains
balanced with nearby Chinese and Latin text without making finance tables loose.

## Mixed-script rules

- Latin and Chinese glyphs share a line through ordered font fallback; do not wrap each
  individual word in a manually selected font.
- In display headings, Chinese is set at approximately 68% of the Latin display size with
  `0.025em` tracking. This prevents dense CJK glyphs from overpowering the editorial Latin
  title.
- Operational Chinese uses the same size and line height as nearby Latin copy.
- Do not apply negative Latin display tracking to Chinese.
- Use normal punctuation spacing for Chinese and keep identifiers such as
  `ZWT202606BK101` unbroken.

## Product tokens

```css
--font-ui: "DM Sans", "Noto Sans SC Variable", "Microsoft YaHei UI",
  "Microsoft YaHei", "PingFang SC", "Leelawadee UI", "Segoe UI", sans-serif;
--font-display: "Cormorant Garamond", "Noto Serif SC Variable", "Songti SC",
  "SimSun", Georgia, serif;
--font-thai: "TH SarabunPSK", "TH Sarabun New", "Sarabun", "Leelawadee UI",
  "Tahoma", sans-serif;
```

Ant Design's `fontFamily` theme token must use `var(--font-ui)`. Display text uses
`var(--font-display)` explicitly.

## Validation strings

- WHT 开票管理
- 正常开具：ZWT202606001 / 册码 202606
- 第一次补开：ZWT202606BK101 / 册码 2606BK1
- 发票编号日期依据开票日期，开票日期依据报关单提交日期
- บริษัท แสงไทย อินดัสทรี จำกัด / ค่าขนส่ง

Validate these strings at 100%, 125%, and 150% Windows display scaling in Microsoft Edge.
