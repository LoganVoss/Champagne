# From the Swift app to a WebMCP mastering instrument

This document explains how Champagne moved from a native SwiftUI/macOS app to
a browser studio that a person and an agent can operate together. It is also a
reproducible explanation of the challenge-period work, not a claim that the
native and browser DSP paths are byte-for-byte identical.

## 1. Preserve the reference product

The pre-existing Champagne app supplied the product vocabulary and the audio
reference: SwiftUI screens, four tested mastering signatures, AVFoundation
playback/export, Accelerate-based processing, original/master A/B listening,
and trim/fade editing. Those concepts remain visible in the web build instead
of being replaced with a generic audio upload form.

The native code is still in this repository under `Champagne/`. The initial
repository commit is `8122a95` (February 6, 2026), before the WebMCP Challenge
submission window.

## 2. Split intent from platform-specific DSP

The Swift processor is a strong desktop reference, but browser code cannot
assume AVFoundation or Accelerate. The web implementation therefore ports the
style identities and musical controls into a deterministic Web Audio pipeline:

- cleanup high-pass and bounded low/presence/air shaping;
- style-dependent compression and saturation;
- bounded mid/side stereo width;
- linked look-ahead peak control;
- mirrored parabolic fade curves;
- deterministic dither and 24-bit / 48 kHz WAV encoding.

Audio is decoded, analyzed, rendered, played, and encoded in the browser. No
server receives the track. The remaining gap—full sample parity with every
native Accelerate detail—is documented as future engineering rather than
hidden behind a marketing claim.

## 3. Make every musical prompt actionable

The **Mastering Magic** field is not a four-choice switch. `apps/web/lib/studio.ts`
contains 25 named mastering directions and 12 bounded dimensions (intensity,
warmth, brightness, punch, dynamics, low end, presence, air, width, glue,
density, and smoothness). A prompt can contribute several cues at once. When a
phrase is unfamiliar or metaphorical, the compiler makes a conservative
adaptive finish and names the resulting style; it does not reject the message.

Each render is reversible, receives a user-facing name, and is saved as local
metadata in **User Presets**. The preset never stores the source PCM buffer.

## 4. Put manual and agent actions on one command bus

The React studio owns one command API for reading state, analyzing the track,
creating/refining/contrasting takes, staging comparisons, changing trim/fades,
and committing a take. Visible controls and the Mastering Magic prompt call
these same functions that WebMCP calls. That keeps a click, a prompt, and an
agent action audibly consistent.

Mutating commands accept the last `expectedStateVersion`. The studio increments
the version after a successful mutation and returns a clear conflict when a
stale action arrives. This is a small but important guard against an agent
silently undoing a person's newer listening decision.

## 5. Register semantic WebMCP tools

The page registers eight imperative tools in `apps/web/lib/webmcp.ts` using the
page's `document.modelContext`:

```ts
const modelContext = document.modelContext;

await modelContext?.registerTool({
  name: "create_mastering_take",
  title: "Create a custom mastering style",
  description: "Render one reversible style from a safe baseline and bounded musical adjustments.",
  inputSchema: {
    type: "object",
    required: ["expectedStateVersion", "baseStyle", "priorities", "constraints", "styleName", "brief"],
    additionalProperties: false,
    properties: {
      expectedStateVersion: { type: "integer", minimum: 0 },
      baseStyle: { type: "string", enum: ["full_power", "warm_presence", "modern_crisp", "dominant"] },
      priorities: { type: "array", maxItems: 5 },
      constraints: { type: "array", maxItems: 4 },
      styleName: { type: "string", minLength: 1, maxLength: 48 },
      brief: { type: "string", minLength: 1, maxLength: 240 }
    }
  },
  execute: (input, context) => commandApi.createTake(input, context?.signal)
});
```

The other registered tools are `get_studio_state`, `analyze_track`,
`refine_mastering_take`, `create_variations`, `stage_comparison`,
`set_trim_fades`, and `commit_master`. They are deliberately page-bound and
typed. Tool responses expose compact state, receipts, and measurements—not
audio bytes, waveform arrays, local filenames, or file paths.

`commit_master` stages the selected take. It never starts a download: a person
must listen and click **Download WAV**. That boundary keeps the agent useful
without making an irreversible or surprising external action.

## 6. Verify the result like a product, not a mockup

The web app is built with Vinext and checked with `npm run build` plus
`npx tsc --noEmit`. The repeatable demo uses the bundled `Motorcycle` recording,
so a reviewer can hear the result without sharing a local file. The UI exposes
the exact “What ChatGPT can see” payload and visible action receipts so the
human can inspect the agent connection.

## Challenge-period timeline

The nested web history is preserved when this repository is consolidated. The
following commits are the dated evidence for the new browser/WebMCP work:

| Date (Pacific) | Commit | Challenge addition |
| --- | --- | --- |
| Aug 29, 22:30 | `9fa097e` | First Champagne WebMCP browser studio |
| Aug 29, 22:31 | `884d795` | Live-origin metadata and social preview |
| Aug 29, 23:28 | `b6a12bf` | Expanded custom styles and simpler studio |
| Aug 29, 23:54 | `36cafc5` | Homepage and mastering-control refinement |
| Aug 29, 23:58 | `340c813` | Centered Mastering Magic invitation |
| Aug 30, 00:05 | `2810ad7` | Every mastering prompt made actionable |
| Aug 30, 00:08 | `adefc4e` | User Preset pagination and layout balance |
| Aug 30, 00:39 | `abea3ae` | Fast loading transition and direct download flow |

The root repository keeps the native baseline plus this browser source as
ordinary files, with no private dependency required to inspect or build it.
