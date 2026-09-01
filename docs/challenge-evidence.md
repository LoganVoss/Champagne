# WebMCP Challenge evidence and release checklist

## Official requirements that affect Champagne

The Devpost Hackathons integration reports that Logan Voss is registered for
[The WebMCP Challenge](https://webmcp.devpost.com/), with submissions open.
The official submission requirements call for:

- a live URL judges can open in ChatGPT's in-app browser or WebMCP-enabled
  Chrome;
- a public source repository containing the complete source, assets, setup
  instructions, and a detectable open-source license visible from the repo's
  landing page/About area;
- a public YouTube demo video under three minutes with clear audio showing what
  was built and how WebMCP is used;
- a text description explaining fit, user experience, human/agent
  collaboration, and the WebMCP implementation.

The submission window ends **September 3, 2026 at 1:00 PM Pacific**. The
Wednesday target is September 2, which leaves a useful review buffer. This file
is a readiness record only; it does not submit anything.

## Existing project vs. challenge-period work

The rules explicitly allow an existing project when it is meaningfully extended
with WebMCP after August 25, 2026 and the new work is documented. Champagne's
pre-existing baseline is the native macOS SwiftUI app: local AVFoundation/
Accelerate mastering, four signatures, playback/A-B, trim/fades, and WAV
export. The browser studio, local Web Audio renderer, Mastering Magic command
surface, User Presets, shared command bus, WebMCP tools, visible receipts,
redacted state, bundled showcase tracks, real-time speed, targeted edit routing,
and the explicit human-controlled **Download WAV** action are challenge-period
additions.

## Dated code ledger

The native baseline's initial root commit is `8122a95` (February 6, 2026). The
browser work was developed in its own history after the challenge opened and is
being folded into this public root as ordinary `apps/web/` files:

| Pacific timestamp | Commit | Evidence |
| --- | --- | --- |
| 2026-08-29 22:30 | `9fa097e` | Browser studio and first WebMCP surface |
| 2026-08-29 22:31 | `884d795` | Live origin/social metadata |
| 2026-08-29 23:28 | `b6a12bf` | Custom styles and studio simplification |
| 2026-08-29 23:54 | `36cafc5` | Homepage/control refinement |
| 2026-08-29 23:58 | `340c813` | Mastering Magic centering |
| 2026-08-30 00:05 | `2810ad7` | Prompt interpretation made actionable |
| 2026-08-30 00:08 | `adefc4e` | User Preset pages and responsive balance |
| 2026-08-30 00:39 | `abea3ae` | Loading transition and direct download |
| 2026-08-31 11:25 | `8f8a8c2` | Targeted edit/download routing, track speed, five-track demo, and final studio polish |

`CHALLENGE_DELTA.md` is intentionally short enough to read on the repo front
page; this file carries the details for a reviewer who wants the audit trail.

## Public-repo verification checklist

Before sharing the link with Devpost:

- [ ] `git ls-files apps/web` shows source, public assets, and package lock;
  `node_modules`, `dist`, scratch exports, and nested `.git` are absent.
- [ ] The root `LICENSE` is MIT and appears in GitHub's detected license/About
  metadata when queried without authentication.
- [ ] The repo visibility is public when checked without a GitHub session.
- [ ] The live URL loads without a private login or local-file dependency.
- [ ] **Demo** loads Motorcycle and the arrow control switches among all five bundled tracks.
- [ ] ChatGPT's in-app browser (or Chrome 149+ with WebMCP enabled) can inspect
  the nine registered tools and complete prompt → render → targeted edit flows,
  followed by the visible **Download WAV** click.
- [ ] The video is public, under three minutes, and includes spoken audio.
- [ ] No API keys, tokens, private paths, or local credentials are committed.

## Final freeze reminder

Once a submission is actually sent, the official FAQ says not to change the
submission, public repository, or live site until winners are announced. Until
then, keep iterating in this repo and use a fork for post-deadline experiments.
