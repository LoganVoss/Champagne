# Champagne

Champagne is a local-first mastering studio for music artists. It began as a
native SwiftUI/macOS app and now has a browser build where a person and an AI
agent can direct the same audible master together through WebMCP.

**Live demo:** [champagne-mastering.vossx.chatgpt.site](https://champagne-mastering.vossx.chatgpt.site/)

**License:** [MIT](LICENSE) (the bundled showcase recording has separate asset
notes in [ASSET_LICENSES.md](ASSET_LICENSES.md)).

## What makes the web build different

Traditional audio tools make an artist translate a musical idea into knobs,
then repeatedly stop and render to find out whether it worked. Champagne turns
that conversation into an audible, reversible command loop:

1. The artist loads a track (or clicks **Demo** for the bundled Motorcycle
   recording).
2. The artist writes a natural-language brief in **Mastering Magic**.
3. The browser extracts every useful cue, maps it to bounded mastering
   dimensions, renders a named custom style locally, and saves it in **User
   Presets**.
4. ChatGPT can read a compact studio state, create/refine/compare takes, and
   stage the next listening test with the same command functions.
5. The artist listens to Original and Mastered, adjusts trim/fade curves, and
   deliberately clicks **Download WAV**. Audio bytes never leave the device.

WebMCP is a natural fit because the agent is operating an audio instrument,
not guessing which pixels to click. The page exposes eight typed, page-bound
tools (`get_studio_state`, `analyze_track`, `create_mastering_take`,
`refine_mastering_take`, `create_variations`, `stage_comparison`,
`set_trim_fades`, and `commit_master`). Every mutation uses the same command bus
as the visible controls and an `expectedStateVersion`, so a stale agent action
cannot silently overwrite a newer human decision. Tool results are compact and
redacted: no PCM, waveform samples, local paths, or filenames are exposed.

## Two implementations, one product idea

| Layer | What it contains | Role |
| --- | --- | --- |
| Native macOS | SwiftUI, AVFoundation, Accelerate, local playback/export, trim and fades | The pre-existing Champagne mastering reference and product design |
| WebMCP browser | React/TypeScript, Web Audio rendering, local WAV encoding, Mastering Magic, User Presets, WebMCP tools | The challenge-period browser experience judges can run in ChatGPT or WebMCP-enabled Chrome |

The browser engine ports the tested Champagne style identities into a real
audible path: cleanup filtering, bounded tone shaping, compression/saturation,
stereo width, look-ahead peak control, curved fades, dither, and 24-bit / 48 kHz
WAV output. It is deliberately honest about the boundary: full sample-for-
sample parity with the complete native Accelerate chain is future engineering,
not a claim made by this contest slice.

## Run the web studio locally

```bash
cd apps/web
npm install
npm run dev
```

Use the local URL printed by Vinext. `npm run build` and `npx tsc --noEmit`
provide the release checks. WebMCP can be exercised in ChatGPT's in-app browser
or in Chrome 149+ with WebMCP enabled. Browser codec support varies, so the
bundled M4A demo is the quickest path to a repeatable run.

## Build the native app

Open [`Champagne.xcodeproj`](Champagne.xcodeproj) in Xcode on macOS and build
the `Champagne` scheme. The Swift implementation remains useful as the
reference for audio behavior and as the desktop product path.

## Swift → WebMCP migration

The migration is documented step by step in
[`docs/swift-to-webmcp.md`](docs/swift-to-webmcp.md). The short version is:

- preserve the native app's design language, style identities, local-first
  promise, and edit semantics;
- separate mastering intent from platform-specific DSP;
- implement a browser-native audible renderer and WAV encoder;
- put manual controls, prompts, and agent actions behind one typed command bus;
- register semantic page tools with `document.modelContext.registerTool`;
- add state-version checks, visible receipts, redacted state, and a human-only
  download boundary;
- verify the build, the browser flow, and the dated challenge delta.

## Challenge-period evidence

Champagne is an existing project, so the repository keeps the pre-existing
native baseline and explicitly records what was added after the challenge
opened on August 25, 2026. See:

- [`CHALLENGE_DELTA.md`](CHALLENGE_DELTA.md) — concise existing-vs-new ledger;
- [`docs/challenge-evidence.md`](docs/challenge-evidence.md) — dated commits,
  official requirements, and the public-repo verification checklist;
- [`devpost-submission.md`](devpost-submission.md) — a drafting-only submission
  narrative and the fields to finish later;
- [`docs/demo-video-script.md`](docs/demo-video-script.md) — the under-three-
  minute recording plan.

The web work is preserved as dated commits from August 29–30, 2026 and is
included as ordinary source files under `apps/web/` (not a private submodule or
gitlink).

## Privacy and safety boundaries

Decoding, analysis, rendering, playback, trim/fades, resampling, dither, and
WAV encoding happen locally in the browser. The source file is never
overwritten. WebMCP can prepare and compare a master, but only the person in
the studio crosses the final download boundary.

The project is open source under MIT; see [ASSET_LICENSES.md](ASSET_LICENSES.md)
for the bundled audio and branding notes.
