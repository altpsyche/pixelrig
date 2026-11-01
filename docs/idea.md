# PixelRig

## 1. Vision

Pixel animation is still drawn frame by frame, per character, and the cost grows with every new
character and move. PixelRig is an Aseprite extension that takes the slow, technical parts off the
artist — pose reference, timing, spacing, arcs, secondary motion, engine data — and hands back
guides inside the editor they already use. The artist draws every final pixel. It is open source
(MIT) and built for solo and indie pixel artists first.

## 2. Principles

- **Guides first.** PixelRig generates reference and data; it never paints final art. Pixel ops
  (cutout rigs, rotation, retarget bakes) wait until an experiment shows artist cleanup costs less
  than redrawing.
- **The artist's pixels are untouchable.** PixelRig writes only to layers and tags it owns.
- **One undo step per change; previews never touch the sprite.**
- **Plain extension.** Lua only, no native helper, no network, no forked Aseprite given to users.
- **Motions are data.** A new motion is a clip file. If a motion needs code, the clip format has a
  gap, and the gap is fixed in the format.
- **Crisp at small sizes.** Output is tuned for 32–128px characters: whole-pixel snapping, no
  anti-aliasing, pixel-perfect lines.

## 3. Core Concepts

The project's vocabulary lives in [`GLOSSARY.md`](../GLOSSARY.md): motion (clip, channel, key pose,
rig, pose), the ghost (ghost layer, range, build, apply, preview, travel), and timing (drawing,
base rate, exposure, drawing role, exposure sheet).

## 4. Scope

### In scope

- Ghost reference for side-view humanoids, looping and one-shot motions.
- A motion library: run, walk, idle, jump, attack, hurt.
- Timing (exposure sheet), motion arcs, secondary motion as guides.
- Rig data and engine export (joints, sockets, hitboxes via slices).

### Explicit non-goals

- Lit sprites and normal maps.
- ML inbetweening or any AI-generated final art.
- Subpixel motion from a 4x source.
- A native helper process or a distributed Aseprite fork.
- Until later phases: 4/8-direction views and non-humanoid rigs.

## 5. Approach

A single Lua extension; the repo root is the extension. Modules, each in one file:

- `clip.lua` — sampling, params, key pose easing, key editing. Pure Lua.
- `rig.lua` — side-view forward kinematics, ground solve, proportion presets. Pure Lua.
- `render.lua`, `stamps.lua`, `colors.lua` — rasterizing a skeleton through a `put(x, y, c)`
  callback. No Aseprite objects beyond the callback.
- `ghost.lua` — the only module that touches a sprite: build, apply, scopes, persistence, fit.
- `ui.lua` — the dialog; it calls `ghost.lua` and never writes to a sprite itself.
- `modules.lua`, `main.lua`, `util.lua` — loading, command registration, JSON and table helpers.

Settings and edited clips persist in the ghost layer's `properties("pixelrig")`. Tests run in
Aseprite batch mode: `tests/headless.lua` for build, render and apply, `tests/ui_mock.lua` for the
dialog through a mock `Dialog`.

## 6. Roadmap

### Phase 0 — Foundation

- Extension skeleton, dev install, release packaging and workflow
- Project checks in `scripts/verify.sh`; CI runs them (done with the agentic workflow port)

### Phase 1 — Ghost Reference

- Run cycle ghost with preview, pose editing, travel, proportions, color schemes (shipped as
  `v0.0.1-alpha`)
- Confirm the dialog in the real Aseprite UI

### Phase 2 — Motion library

- One-shot clips: no wrap-around interpolation, held ends, airtime with grounded landing,
  independently keyed sides
- Walk, idle, jump, attack, hurt

### Phase 3 — Timing

- Exposure sheet: timing on 1s/2s/3s and holds, mapped to frame durations

### Phase 4 — Motion guides

- Motion arcs layer from marked pivots
- Secondary motion (hair, cape, tail) as a ghost guide

### Phase 5 — Rig data and export

- Rig data model in sprite properties; sockets and hitboxes via slices; engine JSON export

## 7. Success Criteria

- An artist goes from a blank sprite to a correctly timed run they drew over the ghost faster than
  without it, and says the ghost helped rather than got in the way.
- Every motion in the library ships as a clip file with no motion-specific code.
- No PixelRig action changes a pixel the artist drew, and every action undoes in one step.

## 8. Open Questions

- Oldest Aseprite version supported. Tested only on a source build (Lua API 41).
- Clip format for one-shot motions: one `loop: false` flag, or a separate clip kind?
- Whether the repo goes public, and when (MIT and open source are decided; visibility is not).
- Data model for 4/8 directions: one rig with per-direction projection, or one rig per direction?
- Gate for pixel ops: what cleanup-time result unlocks cutout rig and retarget bakes?
