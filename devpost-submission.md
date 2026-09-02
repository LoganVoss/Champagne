# Devpost draft — Champagne

> Draft for review. Nothing in this file has been submitted to Devpost.

## Title

Champagne — Agentic Music Mastering

## One-line summary

A local-first mastering studio where people and ChatGPT direct the same
audible master in real time through WebMCP.

## Problem

Mastering is a listening problem disguised as a control problem. An artist can
describe the feeling a track needs—more weight, less glare, wider space,
punchier drums—but conventional software makes them translate that thought
into knobs and then wait through repeated renders. Agents have the opposite
problem: they can discuss music, but generic browser automation cannot safely
operate an audio instrument, hear the result, or know whether a click landed on
the right take.

## Solution

Champagne turns a mastering session into a shared, audible conversation. A
person loads a local track or clicks **Demo** to switch among five bundled
DeltaX tracks. In a WebMCP-enabled browser, the page offers readable prompt
ideas that can be copied directly into ChatGPT. ChatGPT turns that musical
direction into typed site-tool calls, and Champagne renders the resulting
master locally. The person can switch between Original and Mastered, adjust
trim, curved fades, and speed, and download when the result is ready. In a
regular browser, the interface stays intentionally simple: four proven
signature styles plus the same direct audio controls.

ChatGPT can operate the same session through WebMCP: read compact state,
analyze the track, create a take, refine one dimension, create variations,
stage a comparison, set trim/fades and speed, and commit a take. The person
completes the final save with the visible **Download WAV** button. Edit-only
prompts preserve the current master. Audio bytes, waveform samples, filename,
and local path never leave the browser.

## Why this is a strong WebMCP use case

WebMCP is useful when an agent should operate a real page capability with
semantic precision and visible consequences. Champagne is not a chatbot next
to an audio app; the agent and the person direct one instrument. A typed
`create_mastering_take` call carries musical priorities, constraints, a
bounded adjustment set, and the studio's current state version. The page
returns a receipt and an audible result. The person can listen immediately,
refine their direction through ChatGPT, or ask for a new variation.

This is safer and more expressive than asking an agent to guess at coordinates,
and more useful than limiting natural language to four preset buttons. The
WebMCP surface makes the connection obvious: the site tools are the same
commands the visible controls use, and every mutation appears in the studio for
the human to hear and approve.

## What people and agents can do together now

Before Champagne, a person could manually adjust a desktop mastering tool or
ask an agent for abstract advice, but the two sides did not share a reliable
audible state. In this build:

1. ChatGPT reads the current track status and compact measurements.
2. The person states a musical goal in natural language.
3. ChatGPT can create a named take with several priorities and constraints;
   Champagne renders it locally and makes it the active Mastered take.
4. The person listens to the result, switches Original/Mastered, and gives
   feedback grounded in what they actually hear.
5. ChatGPT can refine one dimension, create contrasting siblings, or stage a
   comparison without destroying the source or the previous take.
6. The person or agent applies the requested trim, fade, and speed changes; the
   person completes the final save with the visible **Download WAV** button.

That loop—semantic intent → local audible render → human listening → precise
agent refinement—was difficult to make trustworthy with ordinary browser
automation.

## How WebMCP is implemented

`apps/web/lib/webmcp.ts` checks for the page's `document.modelContext` and
imperatively registers nine tools:

- `get_studio_state`
- `analyze_track`
- `create_mastering_take`
- `refine_mastering_take`
- `create_variations`
- `stage_comparison`
- `set_trim_fades`
- `set_track_speed`
- `commit_master`

Each tool has an explicit JSON input schema, safe bounds, read/write
annotations, and an abort signal. `apps/web/components/champagne-studio.tsx`
exposes a typed command API. The four manual signature controls and nine
WebMCP tools call that same API. Mutations validate `expectedStateVersion`,
update the visible studio, and return after the state commit.
`get_studio_state` and tool results are intentionally redacted.

ChatGPT maps natural language into four proven baselines and 12 bounded
controls: intensity, warmth, brightness, punch, dynamics, low end, presence,
air, width, glue, density, and smoothness. Champagne performs the audio
rendering deterministically inside the browser; audio is not uploaded to a
remote rendering service.

## How AI was used

ChatGPT is the connected agent client beside the page: it interprets a
person's direction and calls the page-bound WebMCP tools. The audio engine
remains deterministic and bounded, and WebMCP payloads never include audio
bytes, waveform samples, filenames, or local paths.

## How Codex was used

Codex helped translate the existing SwiftUI/AVFoundation product into a
browser architecture, implement the TypeScript/Web Audio renderer and
WebMCP command surface, iterate on the interface from live testing, add
state/version safeguards and privacy boundaries, verify builds, and document
the dated migration. The native Swift app remains in the repository as the
reference implementation.

## Key features

- ChatGPT-directed mastering through nine page-bound WebMCP tools.
- Device-local, audible browser rendering with reversible mastering takes.
- Four proven signature styles for the manual, non-WebMCP experience.
- Original/Mastered A/B listening, real-time playback, trim handles, and
  curved fade-in/fade-out handles, plus 50–150% speed control.
- State-version conflict checks, visible studio updates, and structured tool
  completion summaries.
- Five bundled DeltaX demo tracks, so reviewers do not need a local file.
- Explicit final download button; source audio is never overwritten and
  edit-only prompts never trigger a remaster.

## Architecture

- `Champagne/` — native SwiftUI/macOS app and reference DSP path.
- `apps/web/app/` — browser route, layout, and styling.
- `apps/web/components/champagne-studio.tsx` — session state, controls, and
  command API.
- `apps/web/lib/studio.ts` — style model and state semantics.
- `apps/web/lib/audio-engine.ts` — browser decode/analyze/render/export.
- `apps/web/lib/webmcp.ts` — page-bound WebMCP registration and schemas.
- `apps/web/public/` — five bundled showcase recordings and web artwork.

## Testing instructions

1. Open the [live Champagne demo](https://champagne.vossx.chatgpt.site/)
   in ChatGPT's in-app browser, or in Chrome 149+ with WebMCP enabled.
2. Click **Demo**, wait for Motorcycle by DeltaX to load, and press Play when
   the Step 1 guide appears.
3. Copy the suggested prompt when Step 2 appears, paste it into ChatGPT, and
   verify ChatGPT finds the page-loaded audio without requesting a chat
   attachment.
4. Wait for **Loading...** to finish, then play Original and Mastered to hear
   the result.
5. Prompt “keep this master, cut two seconds from each end, fade the first and
   last second, and set speed to 75%.” Confirm no new master is rendered, then
   click **Download WAV**.
6. Open the tools drawer and inspect the compact “What ChatGPT can see” payload.

For a local run:

```bash
cd apps/web
npm install
npm run dev
npm run build
npx tsc --noEmit
```

## Public demo

https://champagne.vossx.chatgpt.site/

## Public repository

https://github.com/LoganVoss/Champagne

## Demo video

Public YouTube URL: **Add before submission.**

The final video must be public, under three minutes, and include clear audio
demonstrating Champagne and its WebMCP workflow.

## Screenshot plan

Capture these frames for the final submission:

1. Home screen with the **Demo** entry point.
2. Connected ChatGPT status and the **Ask ChatGPT** suggestion surface.
3. Original/Mastered waveform and audible A/B state after a WebMCP master.
4. Visible trim/fade handles and the 50–150% speed slider after an edit prompt.
5. ChatGPT site-tools drawer plus the human-controlled **Download WAV** button.

## Readiness and known limitations

The native project predates the challenge. The web studio and WebMCP additions
are dated after August 25, 2026 and are recorded in
[`docs/challenge-evidence.md`](docs/challenge-evidence.md). The repository is
public with detected MIT license metadata. The remaining readiness items are
the final Devpost form values, public video URL, screenshots, and a last
logged-out end-to-end test of the public site.

The browser engine is intentionally a real, audible contest slice rather than
a claim of sample-for-sample parity with every native Accelerate operation.
Browser codec support varies. WebMCP support depends on the browser/client.
Session and take metadata is device-local. There is no cloud collaboration or
server-side audio storage in this build.

## TODO — official form fields

Fill these in Devpost when the submission is ready; this draft does not send
them:

- **Submitter Type (28249):** choose the accurate value.
- **Country of residence (28250):** choose the accurate country.
- **Organization name (28251):** optional; leave blank if not applicable.
- **App Status (28252):** Existing.
- **If Existing, explain what updated during submission period (28253):** use
  the existing-vs-new summary from `docs/challenge-evidence.md`.
- **Live URL (28254):** `https://champagne.vossx.chatgpt.site/`.
- **Testing instructions (28255):** use the numbered flow above.
- **URL to PUBLIC Code Repo (28256):** `https://github.com/LoganVoss/Champagne`.
- **Agent(s) or client(s) tested (28257):** ChatGPT in-app browser. Add
  WebMCP-enabled Chrome 149+ only after testing it separately.
- **AI tools leveraged (28258):** ChatGPT; Codex.
- **Level of learning (28259):** choose the accurate value.
- **Career AI value (28260):** choose the accurate value.
- **Demo video:** public YouTube URL after recording.

## Judging alignment

The draft is written to make the four official criteria easy to verify:

- **WebMCP Leverage:** nine non-trivial typed tools on one shared command
  bus, with state/version safety and audible results.
- **Execution:** runnable live site, bundled demo, local rendering, and clear
  setup instructions.
- **Potential Impact:** a concrete workflow for independent artists and
  producers who need fast, private mastering feedback.
- **Creativity & Ambition:** the agent is an instrument partner, while the
  person remains the listener and final exporter.
