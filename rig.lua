-- Rig: side-view forward kinematics.
-- Coordinates: body-height units, x forward (facing right), y down, hip at origin.

local Rig = {}

Rig.readJson = nil -- set by loader

Rig.PRESETS = {
  { name = "Default", head = 100, torso = 100, arms = 100, legs = 100, bulk = 100 },
  { name = "Heroic",  head = 85,  torso = 105, arms = 105, legs = 112, bulk = 100 },
  { name = "Chibi",   head = 200, torso = 80,  arms = 75,  legs = 65,  bulk = 130 },
  { name = "Stocky",  head = 110, torso = 95,  arms = 90,  legs = 85,  bulk = 150 },
}

function Rig.preset(name)
  for _, p in ipairs(Rig.PRESETS) do
    if p.name == name then return p end
  end
  return nil
end

-- Scale so standing height (ground to head top) == 1.0
local function normalize(rig)
  local b = rig.bones
  local stand = b.thigh + b.shin + b.ankleH + b.torso + b.neck + 2 * b.headR
  for k, v in pairs(b) do b[k] = v / stand end
  for k, v in pairs(rig.widths) do rig.widths[k] = v / stand end
  return rig
end

function Rig.load(path)
  return normalize(Rig.readJson(path))
end

-- New rig with proportion multipliers in percent: head, torso, arms, legs, bulk.
function Rig.withProportions(base, p)
  local rig = { name = base.name, bones = {}, widths = {} }
  for k, v in pairs(base.bones) do rig.bones[k] = v end
  for k, v in pairs(base.widths) do rig.widths[k] = v end
  if not p then return rig end
  local b, w = rig.bones, rig.widths
  b.headR = b.headR * p.head / 100
  b.torso = b.torso * p.torso / 100
  b.neck = b.neck * p.torso / 100
  b.upperArm = b.upperArm * p.arms / 100
  b.forearm = b.forearm * p.arms / 100
  b.thigh = b.thigh * p.legs / 100
  b.shin = b.shin * p.legs / 100
  b.foot = b.foot * (100 + p.legs) / 200
  for k, v in pairs(w) do w[k] = v * p.bulk / 100 end
  return normalize(rig)
end

local rad, deg = math.rad, math.deg
local sin, cos, atan = math.sin, math.cos, math.atan

-- Direction from angle measured from straight down, + = forward.
local function down(a)
  a = rad(a)
  return sin(a), cos(a)
end

local function add(p, dx, dy, len)
  return { x = p.x + dx * len, y = p.y + dy * len }
end

-- Point at distance len from p along angle a (from straight down, + = forward).
local function along(p, a, len)
  local dx, dy = down(a)
  return add(p, dx, dy, len)
end

-- Angle of vector (dx, dy) measured from straight down, + = forward.
function Rig.angleFromDown(dx, dy) return deg(atan(dx, dy)) end
-- Angle of vector measured from straight up, + = forward.
function Rig.angleFromUp(dx, dy) return deg(atan(dx, -dy)) end

-- Rotate local foot-space point (x fwd, y down) by pitch (+ = toes down).
local function footPoint(ankle, pitch, lx, ly)
  local a = rad(pitch)
  return { x = ankle.x + lx * cos(a) - ly * sin(a),
           y = ankle.y + lx * sin(a) + ly * cos(a) }
end

local function solveSide(rig, hip, shoulder, s)
  local b = rig.bones
  local out = {}
  local th = s["leg.thigh"] or 0
  local shin = th - (s["leg.knee"] or 0)
  out.knee = along(hip, th, b.thigh)
  out.ankle = along(out.knee, shin, b.shin)
  local pitch = s["leg.foot"] or 0
  out.toe = footPoint(out.ankle, pitch, b.foot, b.ankleH)
  out.heel = footPoint(out.ankle, pitch, -b.heel, b.ankleH)
  if out.toe.y >= out.heel.y then
    out.lowest, out.contact = out.toe.y, "toe"
  else
    out.lowest, out.contact = out.heel.y, "heel"
  end

  local sh = s["arm.shoulder"] or 0
  local fore = sh + (s["arm.elbow"] or 0)
  out.elbow = along(shoulder, sh, b.upperArm)
  out.hand = along(out.elbow, fore, b.forearm)
  return out
end

-- Returns skeleton with all points and `ground` (y of floor line).
function Rig.solve(rig, pose)
  local b = rig.bones
  local sk = {}
  sk.hip = { x = 0, y = 0 }

  local lean = rad(pose["torso.lean"] or 0)
  local ux, uy = sin(lean), -cos(lean)
  sk.neck = add(sk.hip, ux, uy, b.torso)
  sk.shoulder = add(sk.hip, ux, uy, b.torso * 0.9)

  local tilt = lean + rad(pose["head.tilt"] or 0)
  local hx, hy = sin(tilt), -cos(tilt)
  sk.headBase = add(sk.neck, hx, hy, b.neck)
  sk.head = add(sk.neck, hx, hy, b.neck + b.headR)
  sk.headR = b.headR
  sk.face = { x = -hy, y = hx } -- forward unit vector perpendicular to head axis

  sk.near = solveSide(rig, sk.hip, sk.shoulder, pose.near)
  sk.far = solveSide(rig, sk.hip, sk.shoulder, pose.far)

  local lift = pose["root.lift"] or 0
  sk.lift = lift
  sk.ground = math.max(sk.near.lowest, sk.far.lowest) + lift
  return sk
end

return Rig
