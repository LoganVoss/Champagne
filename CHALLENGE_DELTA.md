# WebMCP Challenge delta

Champagne’s native macOS mastering application predates the OpenAI WebMCP Challenge. The challenge-specific work began after the contest opened on August 25, 2026.

This file is the short ledger for reviewers. The dated commit table,
architecture notes, and verification checklist live in
[`docs/challenge-evidence.md`](docs/challenge-evidence.md).

## Existing before the challenge

- Native SwiftUI mastering application
- Four Champagne mastering signatures
- Local AVFoundation/Accelerate DSP
- Original/master playback
- Trim, fades, and 24-bit WAV export

## Added for the challenge

- Browser studio in `apps/web`
- Local Web Audio decode, analysis, audible mastering previews, playback, and WAV export
- ChatGPT prompt-suggestion surface plus a manual fallback brief
- Twenty-five named mastering directions compiled across twelve bounded controls
- Reversible prompt-created custom mastering styles
- Reversible style revisions and real-time original/master switching
- Shared command functions for manual controls, the fallback brief, and WebMCP
- Ten imperative top-level WebMCP tools
- State-version conflict checks and visible WebMCP activity status
- ChatGPT session pause control
- Inspectable, redacted “What ChatGPT can see” payload
- Five artist-supplied showcase tracks with in-studio demo switching
- Real-time and exported 50–150% speed control with 100% neutral
- Agent routing that preserves the current master for cuts, fades, and speed
- Explicit final save through the visible Download WAV button
- Champagne social-preview artwork and web metadata

The web implementation is intentionally honest about its current boundary: it ports Champagne’s tested style identities and a real browser DSP path, while the full native-to-WebAssembly sample-parity program remains future engineering work.
