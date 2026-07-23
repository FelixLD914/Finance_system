# Prototype Instructions

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

Build app UI in `src/`. Keep `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs`, and `tests/sites-worker.test.mjs` intact so the same local prototype can be handed to Sites. Before a Sites handoff, run `npm run build` and `npm run test:sites`; the build must leave `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`.

## Confirmed visual direction

- Selected ideation result: option 1, "Warm Ivory Editorial Workspace".
- Treat `C:\Users\admin\.codex\generated_images\019f8d58-8451-7cd1-9bf6-66c400d6d9c3\call_IZFnrTSdxNA8TyE5EUzgcvh5.png` as the visual source of truth.
- Preserve the warm ivory paper surfaces, near-black ink, restrained camel-brown accent, serif display headings, compact operational sans-serif text, fine dividers, dense table, and right-side task inspector.
- Avoid dashboard card mosaics, decorative gradients, excessive badges, thick borders, and competing accent colors.
- Use Ant Design and its icon set with local font packages; do not rely on external CDNs.
- Chinese typography is part of the confirmed direction. Bundle the variable Noto Serif SC
  font for Chinese display text and variable Noto Sans SC for Chinese operational text;
  keep Cormorant Garamond and DM Sans for Latin glyphs. Windows system fonts are fallback
  only, not the primary source.
- For mixed Chinese and Latin display headings, keep Chinese slightly smaller with relaxed
  tracking instead of applying the Latin heading's tight negative tracking to CJK glyphs.
- The interface defaults to Simplified Chinese and supports switching to English. PostgreSQL
  columns, API properties, frontend domain keys, enum codes, permissions, and audit field
  identifiers remain stable English identifiers. Never persist translated UI labels as
  business data.
- All visible operational copy must come from the frontend language resources, including
  field labels, statuses, workflow steps, filters, actions, dialogs, validation and messages.
  Backend responses return stable codes plus parameters; the frontend chooses the language.
