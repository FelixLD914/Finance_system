# Design QA

## Comparison target

- Source visual truth: `C:\Users\admin\.codex\generated_images\019f8d58-8451-7cd1-9bf6-66c400d6d9c3\call_IZFnrTSdxNA8TyE5EUzgcvh5.png`
- Browser-rendered implementation: `D:\AI\gpt_codex\finan_system_DIV_Part\zwt-finance-ui-prototype\implementation-final.png`
- Full-view comparison: `D:\AI\gpt_codex\finan_system_DIV_Part\zwt-finance-ui-prototype\design-qa-comparison.png`
- Focused table comparison: `D:\AI\gpt_codex\finan_system_DIV_Part\zwt-finance-ui-prototype\design-qa-focus-table.png`
- Focused detail comparison: `D:\AI\gpt_codex\finan_system_DIV_Part\zwt-finance-ui-prototype\design-qa-focus-detail.png`
- Source pixels: 1487 × 1058.
- Implementation pixels: 1487 × 1058.
- CSS viewport: 1487 × 1058.
- Device scale factor: 1.
- Density normalization: none; both artifacts were compared at native equal pixel dimensions.
- State: WHT task list, June 2026, `ZWT202606BK101` selected, status `Pending Review`, task inspector open.

## Findings

No actionable P0, P1 or P2 differences remain.

- Fonts and typography: the Cormorant Garamond / Noto Serif SC Variable display pair and DM Sans / Noto Sans SC Variable operational pair preserve the source hierarchy across Latin and Simplified Chinese. Chinese fonts are bundled locally as weight-variable Unicode-range assets, with Microsoft YaHei UI and other Windows fonts retained only as fallbacks. Table and inspector text are slightly larger and darker than the generated mock to improve real UI legibility; this is an acceptable P3 accessibility refinement.
- Chinese rendering check: both bundled Chinese families report loaded through the browser Font Loading API. At the 1487 × 1058 reference viewport, `WHT 开票管理` remains on one line, the page has no root-level horizontal overflow, and the browser console is clean.
- Localization check: the interface defaults to `zh-CN`; navigation, filters, table columns, status tags, detail labels, workflow actions and the new-task dialog render from language resources. Switching to `en-US` changes labels only and keeps task identifiers, enum codes and task data unchanged. A clean browser load reported no console warnings or errors.
- Spacing and layout rhythm: sidebar, workspace, filter row, table density and inspector boundary align with the source. The inspector starts with the filter surface and keeps the approval controls visible.
- Colors and visual tokens: warm ivory surfaces, near-black text, camel primary action, sage success, amber pending and stone draft states match the source direction without decorative gradients.
- Image quality and asset fidelity: the selected visual contains no photographic or illustrative assets. All operational icons use the Ant Design icon family; no placeholder, handcrafted SVG or CSS-art substitute is present.
- Copy and content: stable UI labels follow the source. Mock data intentionally corrects generated-image business inconsistencies by using PND 3 / PND 53 and book number `202606` for normal issuance.
- Icons and controls: navigation, filters, selection controls, status labels, pagination and task actions use one consistent component family and match the source scale.
- Accessibility: semantic buttons and form labels are present, contrast is sufficient, focusable controls use component-library focus states, and reduced-motion preferences disable decorative transitions.
- Responsive behavior: 1536 × 1060 and 1487 × 1058 desktop layouts retain the full split workspace. At 1024 × 768 the inspector becomes a closable overlay without clipping its persistent actions.

## Comparison history

1. Initial pass:
   - P1: inspector proportions and vertical start did not match the source.
   - P2: table required horizontal scrolling and hid right-side columns.
   - P2: review actions fell below the first viewport.
   - Fixes: changed inspector width to a responsive 23.5vw band, aligned its top with the filter surface, reduced table column widths, and introduced a persistent bottom action area.

2. Second pass:
   - P2: navigation indentation truncated `Administration`.
   - P2: table selection used radio controls instead of the source checkboxes.
   - P2: approval timeline hid its last step behind the action area.
   - Fixes: corrected menu padding, changed to single-active checkbox selection, compacted the timeline, and reduced action-area height.

3. Final pass:
   - Full-view and focused comparisons show no remaining P0/P1/P2 mismatch.
   - Remaining differences are P3 readability and business-data corrections noted above.

## Primary interactions tested

- Company/task-number search reduces the list to the expected match.
- Selecting a row updates and opens the task inspector.
- New WHT task creates a draft without assigning a formal number.
- Review opens the approval confirmation.
- Approve & Lock updates the workflow to the downloadable formal-file state.
- Responsive inspector behavior was checked at 1024 × 768.
- Browser console: 0 errors and 0 warnings after final navigation.
- Production build: passed.
- Sites packaging tests: 4 passed, 0 failed.

## Implementation checklist

- [x] Match selected visual hierarchy and palette.
- [x] Keep WHT list, filters and inspector functional.
- [x] Keep review actions visible.
- [x] Use component-library icons and local fonts.
- [x] Verify build, browser console and responsive layout.

## Follow-up polish

- P3: production implementation can lazy-load Ant Design module chunks to reduce the prototype bundle warning.
- P3: Thai font metrics should be checked again after the project language policy is confirmed.

final result: passed
