# Champagne Web

Champagne Web is a local-first, WebMCP-enabled mastering studio. A person or an agent can direct the same live mastering session, hear every result, compare reversible takes, adjust trim and fades, and stage a 24-bit / 48 kHz WAV for a deliberate human download.

## Run locally

```bash
npm install
npm run dev
```

Open the local URL printed by the development server. Use **Try the demo loop** for a deterministic, rights-clear synthetic track, or load your own WAV, AIFF, MP3, M4A, or FLAC file. Browser codec support varies by platform.

## WebMCP

The top-level studio page imperatively registers eight page-bound tools through `document.modelContext.registerTool`:

- `get_studio_state`
- `analyze_track`
- `create_mastering_take`
- `refine_mastering_take`
- `create_variations`
- `stage_comparison`
- `set_trim_fades`
- `commit_master`

Every tool calls the same command functions used by the manual style controls and the on-page Mastering Brief. Mutations validate a current `expectedStateVersion`, update the visible studio, create a receipt, and return only after the UI has had time to commit.

`commit_master` stages a take but never starts a download. The user must click **Download WAV** in the studio.

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
- mirrored parabolic fades
- deterministic TPDF dither
- 24-bit / 48 kHz PCM WAV output

The existing Swift engine remains the reference oracle. This web contest slice is a real audible implementation, but it does not claim sample-parity with the complete native Accelerate/AVFoundation DSP chain.

## Verify

```bash
npm run build
npx tsc --noEmit
```

For WebMCP verification, use ChatGPT’s current built-in browser or WebMCP-enabled Chrome and inspect the page’s registered tools before running the demo prompt shown in the connection drawer.

## Contest publishing checklist

- Choose and add a recognized open-source license before making the submission repository public.
- Keep the deployed app free and available through the judging period.
- Record a public demo under three minutes using the included synthetic loop or music you own.
- Show the ChatGPT conversation calling site tools, the audible A/B/C result in Champagne, and the human-only download boundary.
