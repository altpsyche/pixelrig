# PixelRig

The vocabulary of PixelRig, a guides-first animation toolkit for Aseprite: motion data, the ghost
it renders, and the timing of the artist's own drawings.

## Motion

**Clip**:
One motion as data: channels, key poses and params. Built-in or saved by the artist. It has no
pixels.
_Avoid_: animation (that is the artist's frames), motion file

**Channel**:
One animated value of a clip, such as `leg.thigh`, keyed over cycle time `t ∈ [0, 1)`.
_Avoid_: track, curve

**Sided channel**:
A channel authored for the near limb; the far limb samples the same curve `sideOffset` later, so
editing one side edits both.

**Key**:
One channel's value at one time.
_Avoid_: keyframe (ambiguous with Aseprite frames)

**Key pose**:
A named moment of a whole clip (`contact`, `pass`) that owns the spacing (ease) until the next key
pose; it becomes a one-frame tag.
_Avoid_: mark (in prose; `marks` stays the clip-file field name), keyframe

**Param**:
A clip-declared slider that scales or offsets channels (stride, bounce).

**Rig**:
Skeleton proportions, normalized to standing height 1.0.
_Avoid_: skeleton (that is a solved pose)

**Proportions**:
Multipliers on a rig (head, torso, arms, legs, bulk); a **preset** is a named set of them.

**Pose**:
A clip sampled at one time: its channel values.

**Skeleton**:
A pose solved to joint positions by forward kinematics and grounded.

## Ghost

**Ghost**:
The rendered guide figure, drawn over the artist's art.
_Avoid_: onion skin, reference image

**Ghost layer**:
The reference layer that holds a ghost, marked `pixelrig-ghost`, never exported.

**Range**:
Where a PixelRig tool works: all frames, or one tag. One ghost layer per range.
_Avoid_: scope (in prose; `scope` stays the settings field name), selection

**Build**:
Every frame of a cycle solved and placed for given settings.

**Preview**:
Rendering in a dialog only; it never changes the sprite.

**Apply**:
Writing to the sprite, as one undo step.

**Travel**:
Root motion that locks planted feet. A **footprint** is a planted foot's mark on the ground line.

**Style**:
How a ghost is drawn: Stick, Capsule, or Joints + arcs.

**Color scheme**:
How a ghost is colored (Mono, Near / Far, Limbs, Segments); each scheme has its own **color
slots**.

**Near / far**:
The limb side nearer to or farther from the viewer.
_Avoid_: left / right

## Timing

**Drawing**:
One Aseprite frame of the artist's animation, as the exposure sheet sees it. Every frame is one
drawing; PixelRig never merges or splits them.
_Avoid_: cel (that is one layer's image in a frame), keyframe

**Base rate**:
The sprite's timing grid in base frames per second, stored per sprite; default 12.
_Avoid_: FPS (in prose; the ghost's FPS field shows the base rate)

**Base frame**:
One tick of the base rate (at 12, 1000/12 ≈ 83 ms).

**Exposure**:
How many base frames a drawing is held: a whole number, 1 or more. "On 2s" means an exposure of 2.
_Avoid_: hold count, frame count

**Off-grid**:
A drawing whose duration is not a whole number of base frames; shown at its nearest exposure and
flagged, and left as it is until the artist edits it.

**Hold**:
An exposure longer than the drawings around it, usually on a key drawing.

**Drawing role**:
What a drawing is in the animation: key, breakdown, or inbetween (the default). Stored on the
timing layer.
_Avoid_: mark (that is a clip key pose), drawing type

**Exposure sheet**:
The PixelRig tool that shows and edits each drawing's exposure and drawing role over a range.
_Avoid_: dope sheet, X-sheet, timeline

**Timing layer**:
The hidden reference layer `PixelRig: timing` that holds drawing roles, one cel per drawing that has
a role.
