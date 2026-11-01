-- Clip: keyframed channels over normalized cycle time t in [0, 1).
--   channels: name -> { keys = {{t, v}, ...}, repeat = n }
--   marks:    key poses { t, name, ease } ; ease shapes spacing until the next mark
--   params:   sliders that scale/add named channels

local Clip = {}

Clip.readJson = nil -- set by loader
Clip.EASES = { "Linear", "Ease in", "Ease out", "Ease in-out", "Hold" }

local function sortKeys(keys)
  table.sort(keys, function(a, b) return a[1] < b[1] end)
end

local function normalize(data)
  data.channels = data.channels or {}
  for _, ch in pairs(data.channels) do sortKeys(ch.keys) end
  data.sided = data.sided or {}
  data.sideOffset = data.sideOffset or 0.5
  data.params = data.params or {}
  data.marks = data.marks or {}
  table.sort(data.marks, function(a, b) return a.t < b.t end)
  return data
end

function Clip.load(path, origin)
  local data = normalize(Clip.readJson(path))
  data.origin = origin
  return data
end

function Clip.fromData(data, origin)
  local c = normalize(data)
  c.origin = origin
  return c
end

local function deepCopy(v)
  if type(v) ~= "table" then return v end
  local t = {}
  for k, x in pairs(v) do t[k] = deepCopy(x) end
  return t
end

function Clip.clone(clip) return deepCopy(clip) end

-- Serializable copy (no runtime fields).
function Clip.export(clip)
  local c = deepCopy(clip)
  c.origin = nil
  return c
end

-- Sample keys at channel-local time tt (cyclic, keys sorted).
local function sampleKeys(keys, tt, interp)
  local n = #keys
  if n == 0 then return 0 end
  if n == 1 then return keys[1][2] end

  local i = n -- wrap segment when tt < first key
  for k = 1, n do
    if keys[k][1] <= tt then i = k else break end
  end
  local j = i % n + 1
  local t0, t1 = keys[i][1], keys[j][1]
  if t1 <= t0 then t1 = t1 + 1 end
  local x = tt
  if x < t0 then x = x + 1 end
  local u = (x - t0) / (t1 - t0)

  local p1, p2 = keys[i][2], keys[j][2]
  if interp == "linear" then return p1 + (p2 - p1) * u end

  -- Cyclic Catmull-Rom
  local p0 = keys[(i - 2) % n + 1][2]
  local p3 = keys[j % n + 1][2]
  local u2, u3 = u * u, u * u * u
  return 0.5 * ((2 * p1) + (-p0 + p2) * u
    + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u2
    + (-p0 + 3 * p1 - 3 * p2 + p3) * u3)
end

local function chTime(ch, t)
  return (t * (ch["repeat"] or 1)) % 1.0
end

local function buildMods(clip, values)
  local mods = {}
  for _, p in ipairs(clip.params) do
    local v = values and values[p.id]
    if v == nil then v = p.default end
    for _, chName in ipairs(p.channels) do
      mods[chName] = mods[chName] or {}
      table.insert(mods[chName], { op = p.op, v = v })
    end
  end
  return mods
end

local function applyMods(v, list)
  if not list then return v end
  for _, m in ipairs(list) do
    if m.op == "scale" then v = v * (m.v / 100)
    elseif m.op == "add" then v = v + m.v end
  end
  return v
end

-- Inverse of applyMods; nil if not invertible (scale 0).
local function unapplyMods(v, list)
  if not list then return v end
  for i = #list, 1, -1 do
    local m = list[i]
    if m.op == "scale" then
      if m.v == 0 then return nil end
      v = v / (m.v / 100)
    elseif m.op == "add" then v = v - m.v end
  end
  return v
end

function Clip.isSided(clip, name)
  local prefix = name:match("^([^%.]+)%.")
  for _, s in ipairs(clip.sided) do
    if s == prefix then return true end
  end
  return false
end

-- Key pose spacing ------------------------------------------------------------

local function ease(kind, u)
  if kind == "Ease in" then return u * u
  elseif kind == "Ease out" then return 1 - (1 - u) * (1 - u)
  elseif kind == "Ease in-out" then
    if u < 0.5 then return 2 * u * u end
    return 1 - 2 * (1 - u) * (1 - u)
  elseif kind == "Hold" then return 0
  end
  return u
end

-- Mark segment containing t: index i, next index j, bounds t0..t1 (t1 may exceed 1).
function Clip.segmentAt(clip, t)
  local m = clip.marks
  local n = #m
  if n == 0 then return nil end
  local i = n
  for k = 1, n do
    if m[k].t <= t + 1e-9 then i = k else break end
  end
  local j = i % n + 1
  local t0, t1 = m[i].t, m[j].t
  if t1 <= t0 then t1 = t1 + 1 end
  return i, j, t0, t1
end

-- Remap cycle time through per-mark easing.
function Clip.warp(clip, t)
  local i, _, t0, t1 = Clip.segmentAt(clip, t)
  if not i then return t end
  local kind = clip.marks[i].ease
  if not kind or kind == "Linear" then return t end
  local x = t
  if x < t0 then x = x + 1 end
  local u = (x - t0) / (t1 - t0)
  return (t0 + ease(kind, u) * (t1 - t0)) % 1.0
end

-- Sampling --------------------------------------------------------------------

-- Returns pose:
--   pose["root.lift"], pose["torso.lean"], ...            (unsided)
--   pose.near["leg.thigh"], pose.far["leg.thigh"], ...    (sided)
--   pose.t = warped time used for sampling
function Clip.sample(clip, t, values)
  local mods = buildMods(clip, values)
  local interp = clip.interp or "smooth"
  local tw = Clip.warp(clip, t)
  local pose = { near = {}, far = {}, t = tw }
  for name, ch in pairs(clip.channels) do
    if Clip.isSided(clip, name) then
      pose.near[name] = applyMods(sampleKeys(ch.keys, chTime(ch, tw), interp), mods[name])
      pose.far[name] = applyMods(sampleKeys(ch.keys, chTime(ch, (tw + clip.sideOffset) % 1.0), interp), mods[name])
    else
      pose[name] = applyMods(sampleKeys(ch.keys, chTime(ch, tw), interp), mods[name])
    end
  end
  if pose["root.lift"] and pose["root.lift"] < 0 then pose["root.lift"] = 0 end
  return pose
end

-- Editing ---------------------------------------------------------------------

-- Set channel value (as displayed, i.e. after param mods) at warped time tw.
-- side: "near" | "far" | nil. Replaces a key within half a frame, else inserts.
function Clip.setPoseKey(clip, name, tw, side, value, frameCount, values)
  local ch = clip.channels[name]
  if not ch then
    ch = { keys = {} }
    clip.channels[name] = ch
  end
  local raw = unapplyMods(value, buildMods(clip, values)[name])
  if not raw then return false end

  local t = tw
  if side == "far" then t = (t + clip.sideOffset) % 1.0 end
  local tc = chTime(ch, t)
  local tol = 0.45 / frameCount * (ch["repeat"] or 1)
  for _, k in ipairs(ch.keys) do
    local d = math.abs(k[1] - tc)
    if d < tol or d > 1 - tol then
      k[1], k[2] = tc, raw -- snap key onto the edited frame
      sortKeys(ch.keys)
      return true
    end
  end
  table.insert(ch.keys, { tc, raw })
  sortKeys(ch.keys)
  return true
end

-- Frame index (0-based) -> mark name for frames that land on a mark.
function Clip.markForFrame(clip, frame0, frameCount)
  local half = 0.5 / frameCount
  local t = frame0 / frameCount
  for _, m in ipairs(clip.marks) do
    if math.abs(m.t - t) < half then return m.name end
  end
  return nil
end

return Clip
