---
id: "yt-KD--K31a70Q"
videoId: "KD--K31a70Q"
videoTitle: "Playwright for Mobile: Parallel E2E Testing Across Emulators (Taqwright)"
publishedAt: "2026-06-15T12:10:10Z"
duration: "PT1M18S"
thumbnailDefault: "https://i.ytimg.com/vi/KD--K31a70Q/default.jpg"
thumbnailMedium: "https://i.ytimg.com/vi/KD--K31a70Q/mqdefault.jpg"
thumbnailHigh: "https://i.ytimg.com/vi/KD--K31a70Q/hqdefault.jpg"
slug: "playwright-for-mobile-parallel-e2e-testing-across-emulators-taqwright"
organizations: ["198"]
presenters: []
active: true
videoSite: "youtube"
---

Spin up a ready-made mobile test suite and run it in parallel across two Android
emulators with a single command. In this demo I clone the Taqwright sample
project, install it, and run `npm run test:auto2` — Taqwright auto-discovers the
host AVDs, boots two of them, and fans the specs across both in parallel, with a
dedicated Appium session and isolated driver ports per worker. No hand-written
device pool, no manual Appium juggling.

Taqwright is E2E mobile UI testing on the Playwright runner, with a flat locator
API (getByRole / getByText / getByLabel) on top of Appium 3 — iOS and Android,
one API.

▶ Try it yourself
Demo repo:  https://github.com/Taqwright/taqwright-demo
Taqwright:  https://www.npmjs.com/package/@taqwright/taqwright
Docs:       https://www.taqwright.dev/docs

⚡ Quick start
  git clone https://github.com/Taqwright/taqwright-demo
  cd taqwright-demo
  npm install
  npm run test:auto2     # auto-discover host AVDs, run 2-wide in parallel

The four local Android run modes shown:
  npm run test:single    1 emulator, pinned udid
  npm run test:pool      2-emulator udid pool
  npm run test:auto1     auto-detect host AVDs, 1 worker
  npm run test:auto2     auto-detect host AVDs, 2 workers

Requires: Node 24/25, Appium 3 (auto-started), and two AVDs available
(Pixel_10_Pro_XL + Pixel_10_Pro_XL_2). Check with `npx taqwright devices`.

#mobiletesting #appium #playwright #androidtesting #e2etesting #testautomation
