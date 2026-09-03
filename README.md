<p align="center">
  <img src="Champagne/Assets.xcassets/AppIcon.appiconset/Icon1024x1024.png" alt="Champagne" width="240">
</p>

<h1 align="center">Champagne by Logan Voss</h1>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT"></a>
</p>

## About

Champagne is a music mastering studio that enables artists and ChatGPT to put the final
touches on audio together. The artist describes the finished sound they want, and ChatGPT
uses WebMCP to select a signature style, perform bounded refinements,
coordinate trims, fades, and adjustments to the audio speed.

Champagne is designed specifically for AI-generated music. AI-generated music is naturally thin out-of-the-box. Champagne fixes this by improving the waveform's balance, dynamics, width, and levels.

**Champagne makes your AI song radio-ready in seconds.**

## Why WebMCP?

Champagne is a strong fit for WebMCP because it gives artists the ability to precisely master a song in seconds by adjusting multiple tonal processing signals using a single prompt. Champagne with WebMCP creates a better user experience than manual tinkering because it enables specific fine tuning beyond a collection of preset signature styles, and it allows users to transform words into actions applied to the physics of each audio wave.

## WebMCP Integration:

I implemented WebMCP by integrating nine page-bound tools through `document.modelContext.registerTool`.

They call the same command functions as the visible studio:

- Inspect: `get_studio_state`, `analyze_track`
- Master: `create_mastering_take`, `refine_mastering_take`, `create_variations`
- Compare: `stage_comparison`, `commit_master`
- Edit: `set_trim_fades`, `set_track_speed`

ChatGPT can select a signature mastering style, refine tonal adjustments from -1 to +1, set fades up to 30 seconds and change speed from 50% to 150%.

Tonal adjustments editable by ChatGPT include:

- **Warmth**: Emphasizes richer low-mid tones.
- **Brightness**: Raises the sense of treble detail and edge.
- **Punch**: Makes drums and accents hit more decisively, especially at the start of notes.
- **Dynamics**: Controls contrast between quieter and louder moments.
- **Low end**: Adjusts bass and sub-bass weight.
- **Presence**: Brings key midrange material forward, especially vocals, snare crack, guitars, and lead instruments.
- **Air**: Adds the very top-end openness and shimmer above the main brightness range.
- **Width**: Expands or narrows the stereo image.
- **Glue**: Adds cohesive compression-like binding.
- **Density:** Increases perceived fullness and sustained energy.
- **Smoothness**: Softens rough edges, harshness, and overly aggressive peaks.

Before an action is applied, Champagne verifies the current studio state, ensuring that stale agent actions cannot overwrite newer human decisions. Audio is decoded, analyzed, rendered, played, and exported locally in the user’s browser. WebMCP payloads exclude audio bytes, waveforms, filenames, and local paths. The source file is never overwritten.

The artist always finishes the mastering process by clicking the Download WAV button.

## Conclusion:

**People and agents can now work together to fine tune their music, bringing the mastering process into the next dimension of technology.**

Manual (Non-WebMCP) solutions exist for this type of work, but they are guarded behind individual track paywalls (up to $11.99 per song) or $100+ per year subscriptions - (**No thanks!**)

Champagne was originally designed to be one [price](https://apps.apple.com/us/app/champagne-mastering-studio/id6758863788?mt=12), unlimited masters forever.

With this [contest](https://webmcp.devpost.com/?ref_feature=challenge&ref_medium=your-open-hackathons&ref_content=Submissions+open&_gl=1*ooi7p3*_gcl_au*MTg5NTk5NTY2OS4xNzg3Njg5NDU0*_ga*MTM2NjI4MjM1OS4xNzg3Njg5NDU0*_ga_0YHJK3Y10M*czE3ODgyNzg1ODMkbzEyJGcwJHQxNzg4Mjc4NTgzJGo2MCRsMCRoMA..), I’ve decided to open source the magic physics, allowing anyone to build their own version for free. The Champagne WebMCP-enabled website will also remain online for artists to use freely. :-)

## Acknowledgements:

Champagne for macOS was created and released a few days before the contest announcement. The React/TypeScript browser studio, local Web Audio pipeline, hosted demos, and nine WebMCP tools were built for the challenge. See [CHALLENGE_DELTA.MD](CHALLENGE_DELTA.md) and [docs/swift-to-webmcp.md](docs/swift-to-webmcp.md) for details.

## Portfolio

- <https://loganvoss.com/>
- <https://www.deltaxmusic.com/champagne>
