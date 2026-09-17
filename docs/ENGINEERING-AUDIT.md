# Cutline engine audit — 2026-09-17

Baseline: clean `main`; production build and syntax checks pass; 21 model tests and 8 browser tests pass before changes.

The existing architecture is retained: `app.js` owns UI and command orchestration, `core.js` owns project operations/history, `engine.js` owns media playback and Canvas/Web Audio rendering, `webm.js` finalizes recorder metadata. Projects persist as version 1 JSON plus IndexedDB media. New modules will extract shared timing, snapping, metering, and effect processing, rather than introduce a second editor.

Findings:

1. Seconds are rounded inconsistently. Imports, property fields, paste, source ranges, and speed edits can leave off-frame starts/ends. Razor UI rejects valid one-frame cuts although the model permits them. Playback accumulates capped frame deltas, losing elapsed time during stalls.
2. “Vertical resize” changes panel proportions only. Fixed CSS track/clip heights and separate breakpoint overrides provide no track-height zoom.
3. Snapping excludes the playhead. Move code arbitrarily prefers one edge rather than choosing the nearest legal target, and supplies no visible feedback. Wheel zoom uses target-relative `offsetX`, shifting its anchor as the pointer crosses child elements.
4. Every drag event clones the full project, rebuilds ruler/track/clip DOM, and renders media. Hundreds of waveform elements per clip compound this work.
5. Video imports produce one combined timeline clip. Audio separation always duplicates media playback and lacks link identity or idempotence. Locked linked operations cannot be enforced without an explicit model.
6. Audio meter allocates an array per read, measures mono RMS, applies a linear display scale, and fabricates the right-channel level. Peak hold, clipping, release, and dBFS mapping are absent. Demo waveform values are synthetic.
7. Every animated property lookup sorts/copies keys. Splitting creates new linear boundary keys; easing would change after a cut. The UI has no selectable automation points or interpolation editor.
8. Color overlays are applied to the already-composited canvas, so an upper clip can affect lower tracks. Advanced image effects and per-effect bypass/reset/remove are absent.
9. Solo mutates unrelated track mute flags. Media elements are eagerly instantiated for all timeline clips. Playback errors are silently swallowed. Save validation covers only the existing limited property set.

Verification sequence: timing/zoom/razor/snap → linked A/V/meter → performance → effects/keyframes → UX → existing suites plus complete A/V workflow, production build, and visual inspection. Existing tests remain; assertions change only when required behavior intentionally changes (automatic audio placement).
