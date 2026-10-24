# Worldwide verification — 24 October 2026

## Automated checks

`node --test tests/engine.test.mjs`: 11 tests pass, exit 0. Coverage includes independent parent/child visits, immediate-child denominators, browser-profile isolation and persistence, unavailable storage, drag intent, retained rotation, one-stage back navigation, native-name search, hover-first Space targeting, wheel momentum protection, uncapped zoom-in, and continuous spring retarget/reversal.

`node scripts/check.mjs`: pass, exit 0. Audited all 240,613 source nodes and parent/child references. Included data: 255 country/territory map units; 4,330 first-level divisions; 358 sourced local units; 235,663 settlement records. Required primary counts: China 34, Canada 13, US 51 including DC, Germany 16, UK 4. Hong Kong/Macau/Taiwan are not duplicated among world countries. China classifications: 23 provinces, 5 autonomous regions, 4 municipalities, 2 SARs. The supplied icon and copied web asset have identical SHA-256 hashes.

JavaScript syntax checks passed for application, renderer, snapshot composition and preparation script. This is a buildless static site; `dist/` is the deployment output. There is no missing framework build step.

## Actual browser checks

Checked in the Codex in-app browser on Windows, at desktop 1280×800 and mobile 390×844, plus the original 676px-wide viewport.

- Globe drag changed the orientation, retained it after release and a later zoom action, and left the hierarchy at Earth. Drag did not activate a region.
- Entering Asia then China opened a planar regional view with the live Earth › Asia › China breadcrumb and a denominator of 34. Beijing opened 16 sourced district polygons with Chinese names. Province entry fitted its geometry and showed its actual included settlements.
- Space marked a region without entering it. A stale hover after filtering was found and fixed by re-hitting the live DOM after list replacement. Keyboard targeting and mouse priority are covered by regression tests. No separate tick control remains.
- Clicking a settlement toggled its visit. The province count and settlement count remained independent. Right-click ascended exactly one level. Escape restored 3D Earth.
- A single visited province plus a settlement did not mark China or Asia visited. Earth showed 0/7 visited continents while retaining the province overlay. Refresh reloaded the saved country geometry and restored the one visited polygon. Storage unit tests independently exercised two browser-profile stores.
- Native wheel input in China's view ascended to Asia. The wheel state test confirms momentum cannot skip another level within the same gesture.
- Zoom reached 18.1899×, exceeding the removed 12× limit. The minimum globe diameter measured exactly 0.25 of the shorter map dimension, including after resizing to mobile. Mobile had no horizontal overflow.
- A projection transition was observed at blend 0.72006 and finished at 1.0: it interpolates geographic projection, rather than fading between fixed images. Reduced-motion emulation finished immediately with animation false and projection 0; emulation was reset afterward.
- Screenshot preview drag changed framing while leaving the hierarchy Earth › Asia › China. Repeated preview wheel input blended into zoom 11.0232× without changing the region. Copying succeeded through the real Clipboard API and the clipboard contained `image/png` (529,044 bytes in the inspected sample). The composed PNG was inspected: native map labels, the selected province, region title, 1/34 and 3%, icon, legend and source credit were present. Copy freezes the current preview frame. Download remains available when clipboard copying is unsupported or denied; a permission-denial browser configuration was not forced.

## Rendering measurements

Before optimization, a globe drag in the 676px-wide map averaged 58.5ms between sampled frames, p95 69.4ms. The cached WebGL motion renderer reduced that sample to 9.8ms, p95 13.9ms. A subsequent desktop fit/projection transition averaged 6.9ms, p95 7.2ms over 51 frames. The final blended-wheel screenshot-preview sample averaged 6.9ms, p95 7.2ms over the last 120 sampled frames.

These are local animation-frame interval measurements, not guaranteed end-to-end display FPS or input latency on other devices. During movement the renderer uses a cached, simplified geographic texture; once movement stops the original vector geometry is redrawn for accurate still-frame detail. WebGL-unavailable browsers use Canvas and may be slower. Physical touch gestures and other browsers were not tested.

## Data limits

Counts describe included records, not every administrative unit or settlement worldwide. Boundaries have mixed vintages, including 2017 municipality district polygons. Settlement coverage has a population threshold and selected administrative seats. Some global native names require tagged fallbacks. Taiwan's branch has 21 mapped lower divisions in this Natural Earth snapshot. See DATA_SOURCES.md for exact licenses, source hashes, omitted records and transformations.
