# Exposure sheet

Status: agreed with the owner in a `/grill-with-docs` session on 2026-11-01 (#24). Vocabulary:
[`GLOSSARY.md`](../../GLOSSARY.md) § Timing. Timeline changes follow
[ADR-0005](../adr/0005-timeline-changes-opt-in.md).

## Problem Statement

A pixel animator thinks in timing: this drawing on 2s, that key held for 4, ease into the contact.
Aseprite only offers raw milliseconds per frame, edited one frame at a time. Holding a key, timing
a range on 2s, or easing into a pose means arithmetic and many small edits, and the timing is hard
to read back. PixelRig's ghost has its own FPS that does not match the artist's frames, so the two
timings drift apart.

## Solution

An **exposure sheet** dialog shows each drawing in a range as a row: its **exposure** in base
frames at the sprite's **base rate**, and its **drawing role** (key, breakdown, inbetween). The
artist edits exposures and roles one row at a time, or for a selection at once: set on 1s/2s/3s,
hold keys, ease, or retime the range to a target length. A preview plays the drawings at the
staged timing. Nothing changes the sprite until **Apply**, which writes every frame duration and
role in one undo step. The ghost takes its timing from the same base rate.

## User Stories

1. As an animator, I want to see every drawing in a range with its exposure, so that I read the
   timing at a glance instead of decoding milliseconds.
2. As an animator, I want exposures in whole base frames, so that "on 2s" means what it means on
   paper.
3. As an animator, I want the base rate stored per sprite with a default of 12, so that each
   sprite keeps its own timing grid and pixel-art pacing works out of the box.
4. As an animator, I want to change a sprite's base rate without changing how it plays, so that I
   can refine the grid (12 → 24) and see "on 2s" become "on 4s".
5. As an animator, I want drawings whose durations are off the grid flagged, so that I notice
   imported or hand-typed timing that does not fit, and nothing is rounded behind my back.
6. As an animator, I want an off-grid drawing left untouched until I edit it, so that opening the
   sheet never changes my timing.
7. As an animator, I want to open the sheet on all frames or on one tag, so that I time one
   animation at a time.
8. As an animator, I want every frame to be its own drawing, so that the sheet never merges or
   deletes my frames.
9. As an animator, I want to set a drawing's exposure directly, so that I can hold any drawing for
   any whole number of base frames.
10. As an animator, I want to select several drawings and set them all on 1s, 2s or 3s, so that
    timing a run of inbetweens is one action.
11. As an animator, I want to mark drawings as key, breakdown or inbetween, so that the sheet
    reads like my thumbnails and later tools know which drawings matter.
12. As an animator, I want unmarked drawings to count as inbetweens, so that I only mark what
    matters.
13. As an animator, I want to add N base frames to every key drawing in a selection, so that I
    hold key poses in one action.
14. As an animator, I want slow-in, slow-out and slow-in-out presets over a selection, so that I
    ease into and out of poses without working out the numbers.
15. As an animator, I want to type an exposure sequence such as `3,2,1,1`, repeated or stretched
    across a selection, so that I get exactly the ease I have in mind.
16. As an animator, I want to retime a selection to a target length in seconds or base frames,
    so that an action fits the beat I need.
17. As an animator, I want a retime to keep every drawing at 1 base frame or more and to hit the
    target total exactly, so that no drawing disappears and the length is right.
18. As an animator, I want to see the staged timing play before I apply it, so that I judge the
    feel first.
19. As an animator, I want a strip that shows each drawing's exposure as a bar, with the drawing
    being shown marked, so that holds and eases are visible at a glance as the preview plays.
20. As an animator, I want to loop the preview, so that I can watch a cycle repeat.
21. As an animator, I want the ghost to show in the preview when the range has one, so that I
    time the drawings against the reference.
22. As an animator, I want Apply to write all durations and roles as one undo step, so that one
    undo reverts the whole retiming.
23. As an animator, I want closing the sheet without Apply to change nothing, so that I can
    explore timing freely.
24. As an animator, I want drawing roles kept on a hidden layer that never exports, so that my
    exported sheets and my layer stack stay clean.
25. As an animator, I want a drawing's role to stay with that drawing when I insert or delete
    frames, so that marks do not drift.
26. As an animator, I want the timing layer created only when I first set a role, so that sprites
    I only retime get no extra layer.
27. As an animator, I want the ghost's FPS to be the sprite's base rate, so that the ghost and my
    drawings share one timing grid.
28. As an animator with ghosts saved before this change, I want the old "Set frame durations"
    option ignored, so that opening an old ghost never rewrites my timing.
29. As an animator, I want to open the sheet from the View menu, from the timeline's frame
    right-click menu, and from the Ghost Reference dialog, so that it is where I look for it.
30. As an animator, I want to assign the sheet a keyboard shortcut, so that I open it fast.
31. As an animator, I want the sheet to follow my sprite if I add or remove frames while it is
    open, so that staged edits never apply to the wrong drawing.
32. As an animator on an indexed, grayscale or RGB sprite, I want the sheet to behave the same,
    so that timing never depends on colour mode.

## Implementation Decisions

- **A pure timing module.** Converting between exposures and durations, detecting off-grid
  drawings, and the bulk operations (set on N, hold keys, ease presets, typed sequences, retime)
  live in one module with no Aseprite dependency, in the style of the existing clip and rig
  modules. Its inputs and outputs are plain lists of drawings (duration in ms, role, exposure) and
  a base rate.
- **Rounding.** Every "nearest" and "round" in this spec rounds halves up.
- **Exposure ↔ duration.** Aseprite stores a frame's duration as whole milliseconds. The duration
  for an exposure is exposure × 1000 / base rate rounded to the nearest whole millisecond (at 12:
  1 → 83, 2 → 167, 5 → 417). Aseprite's Lua `duration` setter truncates rather than rounds (2/12 s
  stores 166 ms), so Apply writes `(ms + 0.5) / 1000` seconds, which stores exactly `ms`; a batch
  test pins this. A drawing's displayed exposure is the nearest whole exposure to its duration,
  minimum 1. It is **off-grid** when its duration differs from the exact value exposure × 1000 /
  base rate by 1 ms or more, so durations written by the sheet, or by tools that truncate (166 ms
  for 2 at 12), are on the grid, and 100 ms at 12 is off it.
- **Retime to total.** A target in seconds becomes a whole number of base frames, rounded to the
  nearest (0.55 s at 12 → 7), and the sheet shows that number before the artist confirms. Each
  exposure is then scaled by target / current and rounded by largest remainder so the total is
  exact, with no drawing below 1. When the target is smaller than the
  number of drawings, the operation is refused with a message. Ties in the remainder go to
  earlier drawings, so results are deterministic.
- **Ease.** Presets are slow-in (exposures grow toward the end), slow-out (shrink toward the end)
  and slow-in-out (longest at both ends), over the selection, with a whole-number strength `s` from
  1 to 4. For the drawing at position `i` of `n` (`t = i / (n − 1)`, or 0 when `n = 1`), the
  exposure is `1 + round(s × w)`, halves rounding up, with `w = t` for slow-in, `w = 1 − t` for
  slow-out, and `w = |2t − 1|` for slow-in-out; for example slow-in, `s = 2`, over 5 drawings gives
  1,2,2,3,3. A typed sequence is a comma-separated list of whole numbers ≥ 1; shorter than the
  selection, it repeats; the option to stretch it instead scales it across the selection by nearest
  index.
- **Hold keys.** Adds N to the exposure of every drawing in the selection whose role is key.
- **Base rate.** Stored in the sprite's PixelRig properties; default 12 when unset. Changing it in
  the sheet re-derives every exposure from the unchanged durations and re-flags off-grid drawings;
  the rate itself is written on Apply.
- **Drawing roles on the timing layer.** A hidden reference layer named `PixelRig: timing`,
  marked as PixelRig-owned, holds one small cel per drawing that has a role; the cel's user data
  stores the role. A frame without a cel is an inbetween. Because cels belong to frames, a role
  moves with its drawing when frames are inserted or deleted. The layer is created on the first
  Apply that sets a role, and never exported.
- **The sheet's model.** Opening the sheet reads the range's drawings into a staged list (duration,
  exposure, off-grid flag, role). Every edit changes only the staged list. Apply writes, in one
  transaction: every staged duration that changed, every role change on the timing layer, and the
  base rate. Nothing else on the sprite changes; artist layers and cels are never touched.
- **ADR-0005.** Apply in the exposure sheet is the artist's explicit opt-in to change durations;
  the sheet never adds or removes frames.
- **Sprite changes while open.** When the sprite's frame count changes, or the range's tag is
  renamed, moved or deleted, while the sheet is open, the sheet reloads its staged list and says
  that unapplied edits were discarded; a deleted tag falls back to all frames.
- **Preview.** The dialog canvas plays the range's drawings (composite of visible art, ghost
  layer optional) at the staged exposures, with play, step, loop and an exposure strip below.
  It reuses the Ghost Reference preview's composite and transport.
- **Ghost Reference changes.** The ghost's FPS field shows the sprite's base rate, read-only,
  with a button that opens the exposure sheet on the same range. The "Set frame durations"
  option is removed; a saved ghost with it on loads with it ignored. A ghost's cycle frames each
  show for one base frame in its own preview.
- **Entry points.** A command "Exposure Sheet..." in the View menu beside Ghost Reference, the same
  command in the timeline's frame right-click menu (opening on the frame's tag if it has one, the
  shortest tag when tags overlap, else all frames), and a button in the Ghost Reference dialog. As
  an Aseprite command it can take a keyboard shortcut.

## Testing Decisions

A good test drives a seam with inputs an artist would produce and asserts what the artist would
see or what the sprite holds afterwards: exposures, durations, roles, flags, undo. It never
asserts how the module computes a value, and never recomputes an expected value the way the code
does; expected values are written out by hand.

- **Pure timing module, plain Lua 5.4 (runs in CI).** Exposure ↔ duration at 12 and 24; off-grid
  detection on hand-picked durations (83, 84, 100, 166, 167 ms at 12: only 100 is off-grid); set on
  N; hold keys; each ease preset and a typed sequence, repeated and stretched; retime up and down,
  exact totals, the minimum-1 rule, the refusal when the target is too short, and tie-breaking.
  Prior art: the pure-Lua suite from #12.
- **Sprite seam, Aseprite batch mode.** Reading a range's drawings, roles and base rate; Apply
  stores exactly the rounded duration (167 ms for 2 at 12, not 166) and writes durations, roles and
  base rate in one undo step, and one undo restores all of them;
  artist layers and cels are unchanged; roles follow drawings across frame insert and delete;
  the timing layer is created only on the first role and never exported; an old ghost with
  "Set frame durations" loads without writing durations. Prior art: `tests/headless.lua`.
- **Dialog, mock Dialog.** Rows render for a range; editing and bulk operations stage without
  touching the sprite; closing without Apply changes nothing; Apply calls through to the sprite
  seam; the Ghost dialog's button opens the sheet on the ghost's range. Prior art:
  `tests/ui_mock.lua`.

## Out of Scope

- Merging repeated drawings into holds, or splitting a drawing into several frames.
- Duplicating frames to bake holds for engines that ignore durations; export formats are Phase 5.
- A classic X-sheet grid with layer columns.
- Spacing charts and arcs between keys (Phase 4).
- Different base rates within one sprite.
- Engine tick units.

## Further Notes

- Builds on #12 (pure-Lua tests in CI) for the timing module's seam; if #12 has not landed, the
  first ticket adds the minimal runner.
- The Ghost Reference changes touch the same dialog as #3, #6 and #27; tickets should note the
  overlap.
