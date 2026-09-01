![Champagne mastering studio](ReadMe.png)

# Champagne by Logan Voss (DeltaX)

<https://loganvoss.com/>

<https://www.deltaxmusic.com/champagne>

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

## About

Champagne is a music mastering studio that enables artists and ChatGPT to put the final
touches on audio together. The artist describes the finished sound they want, and ChatGPT
uses WebMCP to select a signature style, perform bounded refinements,
coordinate trims, fades, and adjustments to the audio speed.

Champagne is designed specifically for AI-generated music. AI-generated music is naturally thin out-of-the-box. Champagne fixes this by improving the waveform's balance, dynamics, width, and levels. **Champagne makes your AI song radio-ready in seconds.**

## Why WebMCP?

Champagne is a strong fit for WebMCP because it gives artists the ability to precisely navigate the mastering process using a detailed prompt. Champagne with WebMCP creates a better user experience than manual tinkering because ChatGPT enables finer tuning beyond preset signature styles. This enables a more dialed in user experience by giving the artists more control over the final product.

## WebMCP Integration:

I implemented WebMCP by integrating nine page-bound tools through `document.modelContext.registerTool`.

They call the same command functions as the visible studio:

- Inspect: `get_studio_state`, `analyze_track`
- Master: `create_mastering_taken`, `refine_mastering_take`, `create_variations`
- Compare: `stage_comparison`, `commit_master`
- Edit: `set_trim_fades`, `set_track_speed`

ChatGPT can select a signature mastering style, refine tonal adjustments from -1 to +1, set fades up to 30 seconds and change speed from 50% to 150%.

Tonal adjustments editable by ChatGPT include:

- **Warmth**: Emphasizes richer low-mid tones; adds body and reduces a sterile feel.
- **Brightness**: Raises the sense of treble detail and edge; too much can become sharp.
- **Punch**: Makes drums and accents hit more decisively, especially at the start of notes.
- **Dynamics**: Controls contrast between quieter and louder moments. More preserves movement; less makes the track more consistently loud.
- **Low end**: Adjusts bass and sub-bass weight. More adds foundation; less cleans up boom or mud.
- **Presence**: Brings key midrange material forward, especially vocals, snare crack, guitars, and lead instruments.
- **Air**: Adds the very top-end openness and shimmer above the main brightness range.
- **Width**: Expands or narrows the stereo image. More feels larger and more immersive; too much can weaken mono compatibility.
- **Glue**: Adds cohesive compression-like binding so instruments feel like one record rather than separate elements.
- **Density:** Increases perceived fullness and sustained energy, often making the mix feel thicker and louder.
- **Smoothness**: Softens rough edges, harshness, and overly aggressive peaks for a more polished result.

Every mutation checks the studio state version, so stale agent actions cannot overwrite a new human decision. Audio is decoded, analyzed, rendered, played, and exported locally in the user’s browser. WebMCP payloads exclude audio bytes, waveforms, filenames, and local paths. The source file is never overwritten.

The artist always finishes the mastering process by clicking the Download WAV button.

**People and agents can now work together to fine tune their music, bringing the mastering process into the next dimension of technology.**

## Acknowledgements:

Champagne for macOS was created and released a few days before the contest announcement. The React/TypeScript browser studio, local Web Audio pipeline, hosted demos, and nine WebMCP tools were built for the challenge. See [CHALLENGE_DELTA.MD](CHALLENGE_DELTA.md) and [docs/swift-to-webmcp.md](docs/swift-to-webmcp.md) for details.

## Creativity / Ambition / Novelty

Other solutions exist for this type of work, but they are guarded behind individual track paywalls (up to $11.99 per song) or $100+ per year subscriptions - (**No thanks!**)

Champagne was originally designed to be one [price](https://apps.apple.com/us/app/champagne-mastering-studio/id6758863788?mt=12), unlimited masters forever.

With this [contest](https://webmcp.devpost.com/?ref_feature=challenge&ref_medium=your-open-hackathons&ref_content=Submissions+open&_gl=1*ooi7p3*_gcl_au*MTg5NTk5NTY2OS4xNzg3Njg5NDU0*_ga*MTM2NjI4MjM1OS4xNzg3Njg5NDU0*_ga_0YHJK3Y10M*czE3ODgyNzg1ODMkbzEyJGcwJHQxNzg4Mjc4NTgzJGo2MCRsMCRoMA..), I’ve decided to open source the magic physics, allowing anyone to build their own version for free. The Champagne WebMCP-enabled website will also remain online for artists to use freely, as many times as they’d like. :-)
