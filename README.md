# PixelRig

Animation toolkit for Aseprite: rigging, motion reference and timing tools that output plain pixels on normal layers.

## Status

| Module | State |
| --- | --- |
| Ghost Reference | Working: procedural pose ghost on a reference layer, live preview |
| Everything else | Design stage, see design doc |

## Ghost Reference

View → Ghost Reference... generates a side-view pose ghost on a reference layer (not exported) for every frame of a motion cycle.

- Styles: Stick, Capsule, Joints + arcs (motion trails for hand, toe, head)
- Placement: height px, ground line, center X, facing
- Timing: frame count, FPS, optional frame durations, loop across all frames
- Per-clip sliders defined in the clip file (Run: stride, knee drive, bounce, lean, arm swing)
- Key pose tags (contact, down, pass, up, flight)

### Adding motions

A motion is one JSON file in `clips/`. No code changes.

- `channels`: keyframes `[t, value]` over a normalized cycle `t ∈ [0, 1)`, smooth cyclic interpolation, optional `repeat`
- `sided` + `sideOffset`: author the near limb only; the far limb samples the same curve offset in time
- `params`: sliders that `scale` or `add` to named channels
- `marks`: pose labels turned into one-frame tags

Skeleton proportions live in `rigs/<name>.json`, normalized to standing height.

## Layout

| File | Role |
| --- | --- |
| `main.lua` | Command registration, dialog, live preview debounce |
| `clip.lua` | Clip loading, sampling, param modifiers |
| `rig.lua` | Side-view forward kinematics, ground solve |
| `render.lua` | Pixel rasterizer (Bresenham, capsules, rings), styles |
| `ghost.lua` | Reference layer, frames, cels, tags, color modes |
| `util.lua` | JSON to plain Lua tables |

## Development

```sh
tools/dev-install.sh                         # link checkout into ~/.config/aseprite/extensions/pixelrig
tools/test.sh /path/to/aseprite              # headless render, sheets in tests/out/
```

Aseprite ignores symlinked extension directories, so `dev-install.sh` makes a real directory of per-file symlinks. Rerun it after adding top-level files.
