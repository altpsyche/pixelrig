# The ghost may change the artist's timeline only when the artist opts in

PixelRig's constitution says it writes only to layers and tags it owns. A ghost needs as many frames
as its cycle, and the clip has a natural timing, so Apply can be useful when it adds frames to a
short sprite or sets the cycle's frame durations; but both change the artist's timeline, which the
artist owns. The owner ruled on 2026-11-01 (#17): **adding frames and setting frame durations are
allowed, each only behind an explicit option that is off by default and that the artist turns
on.** A ghost may remember the option with its settings once the artist has turned it on; it is
never on for a ghost the artist has not set it for. Without the option, the ghost fills the frames
the sprite already has and leaves every duration as it is. Both changes stay inside Apply's single
undo step.

## Considered options

- **Never.** The ghost fills existing frames only. Safest, but an artist starting from one frame
  must add frames by hand before the ghost is useful.
- **Adding frames allowed, durations never.** Leaves timing to a later exposure sheet, but the
  ghost's FPS would then mean nothing on the sprite.
- **Keep the old behaviour** (frames added whenever the cycle is longer, durations opt-in). The
  automatic frame add surprises the artist and moved their active frame (#3).

## Consequences

- Apply's frame adding becomes an option, off by default (#27).
- The exposure sheet (Phase 3, #24) works within this rule: it changes durations only when the
  artist asks it to.
