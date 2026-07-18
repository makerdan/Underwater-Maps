---
name: Live-mode follow e2e pitfalls
description: Non-obvious behaviors when e2e-testing GPS follow mode / live mode in bathyscan
---
- `enterLiveMode` auto-engages follow when GPS is active. Specs must NOT blindly click the follow toggle — check `aria-pressed` first, or a "turn on" click actually turns follow OFF.
- Headless e2e uses TourScene's no-WebGL stub-canvas branch, so any logic living in a `useFrame` callback (e.g. the follow out-of-bounds check) never executes. Extract such logic into a pure lib function (`followBoundsCheck.ts` → `runFollowBoundsCheck`) and mount a dev-only store-subscribing watcher (`StubFollowBoundsWatcher`) in the stub branch.
- `seedTerrain` in tests must use a REAL preset dataset id and its real bbox (e.g. lake-ray-roberts near GPS mock 33.41/-97.03); a synthetic id 404s in the load pipeline and disrupts the whole flow.
- Text assertions against dataset titles must scope visibility (`.locator("visible=true").first()`) — DatasetPanel renders hidden spans with the same text.
