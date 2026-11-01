# PixelRig

Animation toolkit for Aseprite. Guides first: PixelRig generates reference poses, timing and motion guides; the artist draws the final pixels.

Open source (MIT). Built for solo and indie pixel artists, tuned for characters 32–128px tall. Side view today; the data model leaves room for 4/8 directions.

## Install

Download the latest `.aseprite-extension` from [Releases](https://github.com/altpsyche/pixelrig/releases), then double-click it or use **Edit > Preferences > Extensions > Add Extension**. Open a sprite and go to **View > Ghost Reference...**

Tested on a current Aseprite source build (Lua API version 41) and on Aseprite v1.3-rc6 (Lua API 25). Where Aseprite has no dialog tabs (v1.3-rc6), the dialog shows a **Section** picker instead, with each tab's parts as their own sections: Motion, Clip, Travel, Body, Place, Look, Colors, Pose.

## Status

| Module | State |
| --- | --- |
| Ghost Reference | Working |
| Clips, exposure sheet, arcs, secondary motion, rig export | Planned, see [TODO.md](TODO.md) |

## Ghost Reference

View → Ghost Reference... opens a dialog with an animated preview over your art. Nothing touches the sprite until **Apply**, which writes one undo step: a reference layer (never exported) with one ghost pose per frame. Apply and Remove leave your active sprite, layer and frame where they were, even when another sprite is active.

**Preview.** Play, scrub, step frames. Your art is drawn under the ghost so you can line them up.

**Motion tab.**
- Clip (Run built in, plus your saved clips) and Range: *All frames* or any tag. Each range gets its own ghost layer, so a sprite can hold a run ghost on `run` and another on `sprint`.
- Frames, FPS, loop over range, set frame durations, key pose tags.
- Under **Clip**, the clip's sliders (Run: stride, knee drive, bounce, lean, arm swing).
- Under **Travel**, root motion that locks planted feet (no foot slide), footprints and ground line to check it.

**Body tab.** Presets (Default, Heroic, Chibi, Stocky) or custom head / torso / arms / legs / bulk. Facing.

**Place tab.** Fit to art: uses the selection, else all visible art layers together (ghost and reference layers left out), whichever layer is active. It measures the dialog's own sprite only, at the active frame when that sprite is active, else at frame 1. Height, ground line, center X. A new ghost auto-fits on first open.

**Look tab.** Stick, Capsule, Joints + arcs. Line width, pixel-perfect 1px lines, opacity. Under **Colors**, color schemes, each with its own pickers (picks are kept per scheme; Reset colors restores defaults):

| Scheme | Pickers |
| --- | --- |
| Mono | Body (far side auto-darkened) |
| Near / Far | Body, Near side, Far side |
| Limbs | Body, Near arm, Far arm, Near leg, Far leg |
| Segments | Torso, Neck, Head, Upper arm, Forearm, Thigh, Shin, Foot (far side auto-darkened) |

**Pose tab.** Pause and drag joints in the preview to edit the current frame (knee, ankle, toe, elbow, hand, neck, head). Far limbs share the near limb's curve half a cycle later, so editing one edits both. Set spacing per key pose: Linear, Ease in, Ease out, Ease in-out, Hold. Save the result as your own clip, or Apply and the edits are kept with the ghost.

Settings persist on the ghost layer: reopen the dialog with the ghost layer selected and everything comes back.

Pixel quality: the figure snaps to whole pixels as one unit (no 1px wobble), 1px chains drop L-corner doubles, small heads use hand-shaped circle stamps.

### Clips

A motion is one JSON file. Built-ins live in `clips/`; saved clips go to `<aseprite config>/pixelrig/clips/`.

- `channels`: keyframes `[t, value]` over a normalized cycle `t ∈ [0, 1)`, smooth cyclic interpolation, optional `repeat`
- `sided` + `sideOffset`: author the near limb only; the far limb samples the same curve offset in time
- `params`: sliders that `scale` or `add` to named channels
- `marks`: key poses `{ t, name, ease }`; become one-frame tags; `ease` shapes spacing to the next mark

A clip file that cannot be used (for example: a file that cannot be read or is not valid JSON, no `rig` or a rig that is missing or unreadable, a channel without `keys`, a param without `channels`) is left out of the library, and the rest still load. The dialog names the first skipped file and why on one **Skipped** line under Clip (the Motion tab, or the Motion section on Aseprite builds without tabs), with a count of any others.

**Save clip** (Pose tab) writes the clip to a file named after it, with spaces and characters a file name cannot hold replaced by `_` (`Run test` → `Run_test.json`); the clip's real name is kept inside the file. When that file already holds another clip (names that differ only in case count as the same file), the new one gets ` (2)`, ` (3)`, … (`Run/test` beside `Run test` → `Run_test (2).json`), so a save never replaces another clip. Saving under the name of one of your clips asks before replacing it, and writes that clip's own file, so the library shows what you saved. A save that cannot be written says why and leaves the file that was there as it was.

Skeleton proportions live in `rigs/<name>.json`, normalized to standing height.

## Layout

| File | Role |
| --- | --- |
| `main.lua` | Command registration |
| `modules.lua` | Module loader, clip library (built-in + user) |
| `ui.lua` | Dialog: preview canvas, transport, sections, pose dragging |
| `sections.lua` | Dialog sections: tabs where Aseprite has them, a section picker on older builds (v1.3-rc6) |
| `ghost.lua` | Build frames, travel/foot lock, render, apply, scopes, persistence, fit, preview composite |
| `clip.lua` | Clip sampling, param mods, key pose easing, key editing |
| `rig.lua` | Side-view FK, ground solve, proportion presets |
| `render.lua` | Rasterizer: chains, pixel-perfect, capsules, styles, footprints |
| `stamps.lua` | Hand-shaped pixel circles |
| `colors.lua` | Color schemes |
| `util.lua` | JSON IO, table helpers |

## Development

PixelRig is built mostly by AI agents steered by one owner, using the
[altpsyche agentic engineering](https://github.com/altpsyche/altpsyche-agentic-engineering) workflow.
Start with [`AGENTS.md`](AGENTS.md): it holds the constitution, where things live and how work is
planned, built and reviewed. [`docs/idea.md`](docs/idea.md) is the source of truth for scope and
roadmap.

```sh
scripts/install-hooks.sh                       # once per clone: pre-push runs verify.sh
ASEPRITE=/path/to/aseprite scripts/verify.sh   # everything CI runs, plus the Aseprite tests
tools/dev-install.sh               # link checkout into ~/.config/aseprite/extensions/pixelrig
tools/test.sh /path/to/aseprite    # headless tests + render sheets in tests/out/
tools/package.sh                   # build dist/*.aseprite-extension and dist/*.zip
```

### Releasing

1. Bump `version` in `package.json` and write `docs/releases/v<version>.md`. Its first line is `# PixelRig v<version>`; the rest is the release's notes, and it names no other `vX.Y.Z` (start from the last release's file and replace every version in it).
2. Merge that to `main` through a PR, as any change.
3. After `git fetch origin`, tag the merged commit on `origin/main` as `v<version>`, run `tools/release-check.sh v<version>`, which is the workflow's gate and prints the notes it will publish, then push the tag.
4. The Release workflow runs everything CI runs (`scripts/verify.sh`, through `ci.yml`) on the tagged commit. Only when that is green does it run the gate, `tools/release-check.sh`, which fails unless the tag matches `package.json`, the tagged commit is on `main`, and the notes file exists and names this version and no other. It then builds both packages, checks the archive with `tools/check-archive.sh`, and publishes the release with those notes (versions with a `-suffix` are marked pre-release). Any red step stops it before anything is published.

Every notes file in `docs/releases/` is checked against its own tag by `scripts/verify.sh`, so a wrong heading or a stale version fails in the PR, before any tag.

`tests/headless.lua` covers build, render, travel, easing, pose edits and sprite apply. `tests/ui_mock.lua` drives the dialog through a mock `Dialog` (batch mode has no UI), once with tabs and once without, as on Aseprite v1.3-rc6.

Aseprite ignores symlinked extension directories, so `dev-install.sh` makes a real directory of per-file symlinks. Rerun it after adding top-level files.
