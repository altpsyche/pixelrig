# PixelRig

Animation toolkit for Aseprite. Guides first: PixelRig generates reference poses, timing and motion guides; the artist draws the final pixels.

Open source (MIT). Built for solo and indie pixel artists, tuned for characters 32–128px tall. Side view today; the data model leaves room for 4/8 directions.

## Status

| Module | State |
| --- | --- |
| Ghost Reference | Working |
| Clips, exposure sheet, arcs, secondary motion, rig export | Planned, see [TODO.md](TODO.md) |

## Ghost Reference

View → Ghost Reference... opens a dialog with an animated preview over your art. Nothing touches the sprite until **Apply**, which writes one undo step: a reference layer (never exported) with one ghost pose per frame.

**Preview.** Play, scrub, step frames. Your art is drawn under the ghost so you can line them up.

**Motion tab.**
- Clip (Run built in, plus your saved clips) and Range: *All frames* or any tag. Each range gets its own ghost layer, so a sprite can hold a run ghost on `run` and another on `sprint`.
- Frames, FPS, loop over range, set frame durations, key pose tags.
- Clip sliders (Run: stride, knee drive, bounce, lean, arm swing).
- Travel: root motion that locks planted feet (no foot slide), footprints and ground line to check it.

**Body tab.** Presets (Default, Heroic, Chibi, Stocky) or custom head / torso / arms / legs / bulk. Facing.

**Place tab.** Fit to art: uses the selection, else the active layer, else all visible art. Height, ground line, center X. A new ghost auto-fits on first open.

**Look tab.** Stick, Capsule, Joints + arcs. Line width, pixel-perfect 1px lines, color schemes: Mono, Near / Far, Limbs (debug: one color per limb and side), Segments (debug: one color per bone). Opacity.

**Pose tab.** Pause and drag joints in the preview to edit the current frame (knee, ankle, toe, elbow, hand, neck, head). Far limbs share the near limb's curve half a cycle later, so editing one edits both. Set spacing per key pose: Linear, Ease in, Ease out, Ease in-out, Hold. Save the result as your own clip, or Apply and the edits are kept with the ghost.

Settings persist on the ghost layer: reopen the dialog with the ghost layer selected and everything comes back.

Pixel quality: the figure snaps to whole pixels as one unit (no 1px wobble), 1px chains drop L-corner doubles, small heads use hand-shaped circle stamps.

### Clips

A motion is one JSON file. Built-ins live in `clips/`; saved clips go to `<aseprite config>/pixelrig/clips/`.

- `channels`: keyframes `[t, value]` over a normalized cycle `t ∈ [0, 1)`, smooth cyclic interpolation, optional `repeat`
- `sided` + `sideOffset`: author the near limb only; the far limb samples the same curve offset in time
- `params`: sliders that `scale` or `add` to named channels
- `marks`: key poses `{ t, name, ease }`; become one-frame tags; `ease` shapes spacing to the next mark

Skeleton proportions live in `rigs/<name>.json`, normalized to standing height.

## Layout

| File | Role |
| --- | --- |
| `main.lua` | Command registration |
| `modules.lua` | Module loader, clip library (built-in + user) |
| `ui.lua` | Dialog: preview canvas, transport, tabs, pose dragging |
| `ghost.lua` | Build frames, travel/foot lock, render, apply, scopes, persistence, fit, preview composite |
| `clip.lua` | Clip sampling, param mods, key pose easing, key editing |
| `rig.lua` | Side-view FK, ground solve, proportion presets |
| `render.lua` | Rasterizer: chains, pixel-perfect, capsules, styles, footprints |
| `stamps.lua` | Hand-shaped pixel circles |
| `colors.lua` | Color schemes |
| `util.lua` | JSON IO, table helpers |

## Development

```sh
tools/dev-install.sh               # link checkout into ~/.config/aseprite/extensions/pixelrig
tools/test.sh /path/to/aseprite    # headless tests + render sheets in tests/out/
```

`tests/headless.lua` covers build, render, travel, easing, pose edits and sprite apply. `tests/ui_mock.lua` drives the dialog through a mock `Dialog` (batch mode has no UI).

Aseprite ignores symlinked extension directories, so `dev-install.sh` makes a real directory of per-file symlinks. Rerun it after adding top-level files.
