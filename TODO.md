# PixelRig Roadmap

Vision: guides first (artist draws final pixels), solo/indie pixel artists, open source (MIT).
Target sprite heights: 32–128px. Side view first; data model must allow 4/8 directions later.

## Now
- [x] Ghost Reference polish: remembered settings, dialog preview + Apply, fit to art, tag-scoped ghosts,
      no jitter, pixel-perfect lines, head stamps, per-side/limb/segment colors, proportions + presets,
      pose dragging + save clip, travel with foot lock + footprints, per-key-pose easing
- [x] Verify Ghost Reference dialog in the real Aseprite UI (owner, #16)

## Next
- [ ] More ghost clips: walk, idle, jump, attack, hurt
- [ ] Exposure sheet: timing on 1s/2s/3s, holds, mapped to frame durations
- [ ] Motion arcs layer from marked pivots
- [ ] Secondary motion (hair, cape, tail) as ghost guide
- [ ] Rig data model in sprite properties; sockets/hitboxes via slices; engine JSON export

## Later
- [ ] 4/8 direction views
- [ ] Body types: quadruped rig + gaits (walk, trot, gallop)
- [ ] Body types: chibi / stylized proportion presets
- [ ] Body types: custom user rigs (tails, wings, tentacles)
- [ ] Pixel ops (gated on cleanup-time experiment): cutout rig, Lua RotSprite, retarget bake, smears

## Cut
- Lit sprites / normal maps (out of scope)
- ML inbetweening (quality + community risk)
- Subpixel motion from 4x source (research)
- Native helper over WebSocket (Lua sufficient)
