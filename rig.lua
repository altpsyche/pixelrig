-- Rig: side-view forward kinematics.
-- Coordinates: body-height units, x forward (facing right), y down, hip at origin.

local Rig = {}

-- Set by the loader (Util.readJson).
Rig.readJson = nil

function Rig.load(path)
  local rig = Rig.readJson(path)
  local b = rig.bones
  -- Normalize so standing height (ground to head top) == 1.0
  local stand = b.thigh + b.shin + b.ankleH + b.torso + b.neck + 2 * b.headR
  for k, v in pairs(b) do b[k] = v / stand end
  for k, v in pairs(rig.widths) do rig.widths[k] = v / stand end
  return rig
end

local rad = math.rad
local sin, cos = math.sin, math.cos

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

  local lowest = -math.huge
  for _, side in ipairs({ sk.near, sk.far }) do
    lowest = math.max(lowest, side.toe.y, side.heel.y)
  end
  sk.ground = lowest + (pose["root.lift"] or 0)
  return sk
end

return Rig
