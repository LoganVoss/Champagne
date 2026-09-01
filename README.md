# Champagne

Champagne is a music mastering studio where an artist and ChatGPT put the final
touches on audio together. The artist describes the sound they want; ChatGPT
uses WebMCP to choose a proven baseline, make small bounded refinements, and
coordinate trims, fades, and speed inside the live studio.

Champagne was designed especially for AI-generated music from providers like
Suno. After more than 15 years producing, I often heard AI tracks that felt thin
or unfinished. I built Champagne to bring them to life by shaping the waveform's
balance, dynamics, width, and level.

**Live studio:** [champagne.vossx.chatgpt.site](https://champagne.vossx.chatgpt.site/)

**License:** [MIT](LICENSE). See [ASSET_LICENSES.md](ASSET_LICENSES.md) for the
five showcase recordings and brand assets.

## Try it in one prompt

1. Open Champagne in ChatGPT's browser.
2. Select your own audio or click **Demo** to load a showcase track.
3. Ask ChatGPT for the complete result you want:

   > Create a vibrant, electric, and powerful master. Trim the first and last
   > second. Fade the start and finish for two seconds. Increase speed by 10%.

4. Compare **Original** and **Mastered**, then keep talking or edit by hand.
5. Click **Download WAV** when the track is ready.

Without WebMCP, Champagne opens in manual mode with four signature styles, a
local mastering brief, waveform editing, A/B playback, and a 50–150% speed
slider.

## Why WebMCP

Mastering is technical and subjective. Artists think in goals such as warm,
dominant, powerful, smooth, or airy—not in dozens of DSP parameters.

WebMCP gives ChatGPT typed controls instead of making it guess at page pixels.
It can read compact studio state, choose a safe baseline, coordinate a complete
mastering and editing pass, and use the audible result as context for the next
request.

- One prompt can combine mastering, trims, fades, and speed.
- Follow-ups preserve the current master unless the artist requests a new one.
- Manual and agent actions stay synchronized in the same live studio.
- Four proven baselines and bounded refinements keep results musical.
- The artist keeps the listening decision and final file save.

The original Champagne macOS app offered four finished mastering signatures.
The WebMCP studio turns the safe musical space behind them into a conversational
instrument—something the preset-only interface could not expose.

## How it works

Champagne registers ten page-bound tools through
`document.modelContext.registerTool`. They call the same command functions as
the visible studio:

- Inspect: `get_studio_state`, `analyze_track`
- Master: `create_mastering_take`, `refine_mastering_take`, `create_variations`
- Compare: `stage_comparison`, `commit_master`
- Edit: `set_trim_fades`, `set_track_speed`
- Prepare export: `download_master`

ChatGPT can select one baseline, refine musical controls from −1 to +1, set
fades up to 30 seconds, and change speed from 50% to 150%. The export tool can
prepare a result, but the artist clicks **Download WAV** to save it.

Every mutation checks the studio state version, so a stale agent action cannot
overwrite a newer human decision. Mastering takes are reversible, and edit-only
actions preserve the selected master.

User audio is decoded, analyzed, rendered, played, and exported locally in the
browser. WebMCP payloads exclude audio bytes, waveforms, filenames, and local
paths. The source file is never overwritten.

## Challenge work

Champagne predates the challenge as a native SwiftUI/macOS app. The
React/TypeScript browser studio, local Web Audio pipeline, hosted demos, and ten
WebMCP tools were built for the challenge. See
[CHALLENGE_DELTA.md](CHALLENGE_DELTA.md) and
[docs/swift-to-webmcp.md](docs/swift-to-webmcp.md) for details.

## Run locally

Requires Node.js 22.13 or newer.

```bash
cd apps/web
npm ci
npm run dev
```

Release checks: `npm run build` and `npx tsc --noEmit`.
