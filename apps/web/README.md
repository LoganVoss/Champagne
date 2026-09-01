# Champagne Web

Champagne Web is a local-first, WebMCP-enabled mastering studio. A person and ChatGPT can direct the same live session, hear every result, adjust trim, fades, and speed, and prepare a 24-bit / 48 kHz WAV for a final user-controlled download. When WebMCP is unavailable, manual mode exposes Champagne's four signature styles and local mastering brief.

## Run locally

```bash
npm install
npm run dev
```

Open the local URL printed by the development server. Use **Demo** to load and switch among five included showcase tracks, or load your own WAV, AIFF, MP3, M4A, or FLAC file. Browser codec support varies by platform.

## Mastering model and manual fallback

The four Champagne signatures are safe engine baselines, not the limit of the prompt surface. They appear as selectable buttons only in manual mode. In a WebMCP-enabled browser, ChatGPT chooses the baseline through the registered tools while the page presents copyable prompt ideas instead of a constrained text field. The local fallback compiler recognizes 25 named mastering directions and combines twelve bounded controls:

- intensity, warmth, brightness, punch, and dynamics
- low end, presence, air, and width
- glue, density, and smoothness

Each direction creates and activates a descriptively named custom style for the current session. Champagne extracts every supported signal from the message; unfamiliar or metaphorical language receives a conservative adaptive finish instead of an error.

## WebMCP

The top-level studio page imperatively registers ten page-bound tools through `document.modelContext.registerTool`:

- `get_studio_state`
- `analyze_track`
- `create_mastering_take`
- `refine_mastering_take`
- `create_variations`
- `stage_comparison`
- `set_trim_fades`
- `set_track_speed`
- `commit_master`
- `download_master`

Every tool calls the same command functions used by the live studio and manual fallback. Mastering and editing mutations validate a current `expectedStateVersion`, update the visible studio, and return only after the UI has had time to commit. Mixed requests are executed in order—mastering, trim/fades, then speed—while edit-only requests preserve the current master. Speed is bounded to 50–150%, with 100% at the slider center.

`commit_master` stages a style. `download_master` prepares the current export only when the user explicitly requests one; browser security leaves the final save action on the visible **Download WAV** button.

## Privacy boundary

Audio decoding, analysis, preview rendering, playback, trim/fades, resampling, dither, and WAV encoding happen in the browser. Tool results exclude:

- audio bytes and PCM
- waveform arrays
- the local filename
- local file paths

Open **Control with ChatGPT → What ChatGPT can see** to inspect the exact compact payload exposed by the current studio.

## Audio implementation

The contest build ports Champagne’s four authoritative style identities and recipe values into a browser-native Web Audio rendering path:

- 27 Hz cleanup high-pass
- bounded low, presence, and air tone shaping
- style-dependent compression and saturation
- bounded mid/side stereo width
- linked 5 ms look-ahead peak control
- mirrored, pressure-adjustable parabolic fade curves
- deterministic TPDF dither
- 24-bit / 48 kHz PCM WAV output

The existing Swift engine remains the reference oracle. This web contest slice is a real audible implementation, but it does not claim sample-parity with the complete native Accelerate/AVFoundation DSP chain.

## Verify

```bash
npm run build
npx tsc --noEmit
```

For WebMCP verification, use ChatGPT's built-in browser or another WebMCP-enabled browser and inspect the page's registered tools before running one of the copyable demo prompts.

## Contest publishing checklist

- Choose and add a recognized open-source license before making the submission repository public.
- Keep the deployed app free and available through the judging period.
- Record a public demo under three minutes using music you own or are authorized to show.
- Show the ChatGPT conversation calling site tools, the active custom style, real-time original/master and speed changes, targeted edits that preserve the master, and the final **Download WAV** click.
