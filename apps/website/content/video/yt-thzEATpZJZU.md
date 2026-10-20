---
id: "yt-thzEATpZJZU"
videoId: "thzEATpZJZU"
videoTitle: "Taqwright Agent Debugs Mobile Apps For You (and it actually works)"
publishedAt: "2026-06-01T09:47:50Z"
thumbnailDefault: "https://i.ytimg.com/vi/thzEATpZJZU/default.jpg"
thumbnailMedium: "https://i.ytimg.com/vi/thzEATpZJZU/mqdefault.jpg"
thumbnailHigh: "https://i.ytimg.com/vi/thzEATpZJZU/hqdefault.jpg"
slug: "taqwright-agent-debugs-mobile-apps-for-you-and-it-actually-works"
organizations: ["198"]
presenters: []
active: true
videoSite: "youtube"
---

What happens when you hand an AI agent a vague GitHub bug report and say "go reproduce this"?

In this video I use taqwright (https://www.taqwright.ai/) + lime-cli to drive a real Android emulator straight from a
plain-English goal — no hand-written test scripts. The AI logs into the app, navigates the
UI, runs the exact search from the bug report, and reproduces the failure live. Then we trace
it from the screen all the way down to the exact line of Flutter source that causes it.

🐛 The bug: searching "red" in a dress shopping app returns two BLACK dresses too.
🤖 The workflow: report → reproduce on device (AI-driven) → root-cause in code → fix.

🔧 Tools used:
• taqwright — Playwright-style mobile UI automation on Appium 3
• lime-cli — AI QA agent that turns an English goal into a real device run
• Flutter demo app from the taqelah! community

00:00  The bug report (GitHub issue)
00:15  Letting the AI reproduce it from one English sentence
02:20  Ground truth: what the screen actually shows
04:38  Root cause — the exact line in the Flutter source
04:45  The fix + how to re-verify
