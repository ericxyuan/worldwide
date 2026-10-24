# Worldwide

A personal atlas for exploring Earth, administrative regions, and mapped settlements. Designed using the requested Fluidity plugin guidance, with the user's original `worldwide.png` icon preserved unchanged.

- GitHub: https://github.com/ericxyuan/worldwide (private).
- ChatGPT Site: https://worldwide-atlas-ericxyuan.ericxyuan.chatgpt.site (private).
- Site identity: `.openai/hosting.json`. The separate Sites source repository is managed by the Sites workflow; the GitHub destination is the `github` remote. Preserve both destinations.

## Use

Left-drag the globe to rotate. It stays in the released orientation. Use the globe/map switch to change projection; entering a country opens its planar regional map. On a planar map, drag pans and the wheel zooms.

Click to enter a region. At a leaf, click toggles visited. Space toggles the currently hovered region without entering it; genuine keyboard focus is the fallback when there is no pointer hover. It never falls back to the selected parent. The sidebar provides the same complete regional list, native and English search, keyboard focus, visited colors, and pagination for large settlement lists. Right-click or Left Arrow goes up exactly one level. Zooming out past the deliberate threshold also ascends one level, with momentum protection. Zoom-in has no arbitrary upper cap; minimum scale keeps Earth at least a quarter of the shorter map dimension. Escape returns to 3D Earth. Breadcrumbs and the up control provide pointer alternatives.

Progress counts only immediate included children. A country, province and settlement are independently selected. Marking a parent does not mark its children. Visited IDs persist in `localStorage` under `worldwide.progress.v1`, independently in each browser profile. No account, analytics, location permission or server progress store is involved. Storage failures are reported, and Export progress saves a JSON backup. Clearing browser site storage removes local progress.

Screenshot opens a preview that can be dragged/panned (or adjusted with arrow keys and wheel zoom) before Copy image or Download PNG. The image uses exactly the preview framing. Copy image composes a rectangular PNG containing the **current** map projection, rotation/pan/zoom, native labels, visited highlights, current region title, visited/total and percentage, supplied icon, legend, and source credit. It writes `image/png` with the Clipboard API from the button gesture. The preview always offers Download PNG. When image copying is unsupported or denied, feedback explicitly states that copying did not succeed. Clipboard permission is browser-dependent.

## Run and check

Node 20+; no installation or build step is needed. Runtime scripts and D3 are bundled locally.

```text
node scripts/serve.mjs
node --test tests/engine.test.mjs
node scripts/check.mjs
```

Open `http://127.0.0.1:4173/`. The production static directory is `dist/`.

The data preparation script can refresh the source snapshots. Read [DATA_SOURCES.md](DATA_SOURCES.md) first: regenerated boundary snapshots may change administrative identifiers or relationships, and native-name coverage is incomplete. Raw downloads stay in the host temporary cache; only the prepared, country-split data are published.

## Coverage and licensing

This explorer includes real worldwide map units and first-level boundaries, broad GeoNames settlement coverage, sourced UK local divisions, and China municipality districts. It does **not** claim a complete current legal hierarchy down to every town everywhere. Source years differ, some boundaries are historic, city extracts have a population threshold, and native names sometimes require an identified source-name fallback. The map and About the data explain these limits. Counts refer to bundled records.

Natural Earth is public domain. GeoNames is CC BY 4.0. The compiled geographic database also includes ODbL country metadata and OpenStreetMap/geoBoundaries data and is distributed under ODbL 1.0. Full source attribution, transformation details and exact source digests are in [DATA_SOURCES.md](DATA_SOURCES.md) and `dist/data/coverage.json`. D3's ISC notice is bundled. The application uses no copied Fluidity component code.

## Rendering and saved highlights

Pointer input is coalesced into animation frames. During camera movement, a cached geographic texture is reprojected on WebGL; supported browsers redraw the original vector boundaries after release for full still-frame detail. A Canvas fallback remains available. Region focus interpolates camera scale, rotation and translation. Globe/flat switching interpolates the actual raw projection, with a numeric inverse, rather than using a crossfade. Reduced-motion browsers settle immediately.

Visited descendant polygons and settlement points remain visible at wider stages. Only explicitly visited parents receive full parent fills. Saved country hints reload the required geometry after refresh; the grouping aliases migrate prior Hong Kong/Macao/Taiwan selections. Progress counts remain immediate-child counts.
