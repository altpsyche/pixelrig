-- Clip: keyframed channels over normalized cycle time t in [0, 1).
-- Pure Lua, no Aseprite API use (except json via loader).

local Clip = {}

local function sortKeys(keys)
  table.sort(keys, function(a, b) return a[1] < b[1] end)
end

-- Set by the loader (Util.readJson).
Clip.readJson = nil

function Clip.load(path)
  local data = Clip.readJson(path)
  for _, ch in pairs(data.channels) do sortKeys(ch.keys) end
  data.sided = data.sided or {}
  data.sideOffset = data.sideOffset or 0.5
  data.params = data.params or {}
  data.marks = data.marks or {}
  return data
end

-- Sample one channel at cycle time t (cyclic, keys sorted).
local function sampleChannel(ch, t, interp)
  local rep = ch["repeat"] or 1
  local tt = (t * rep) % 1.0
  local keys = ch.keys
  local n = #keys
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

-- Build channel -> modifier list from clip params and current values.
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

local function isSided(clip, name)
  local prefix = name:match("^([^%.]+)%.")
  for _, s in ipairs(clip.sided) do
    if s == prefix then return true end
  end
  return false
end

-- Returns pose:
--   pose["root.lift"], pose["torso.lean"], ...            (unsided)
--   pose.near["leg.thigh"], pose.far["leg.thigh"], ...    (sided)
function Clip.sample(clip, t, values)
  local mods = buildMods(clip, values)
  local interp = clip.interp or "smooth"
  local pose = { near = {}, far = {} }
  for name, ch in pairs(clip.channels) do
    if isSided(clip, name) then
      pose.near[name] = applyMods(sampleChannel(ch, t, interp), mods[name])
      pose.far[name] = applyMods(sampleChannel(ch, (t + clip.sideOffset) % 1.0, interp), mods[name])
    else
      pose[name] = applyMods(sampleChannel(ch, t, interp), mods[name])
    end
  end
  if pose["root.lift"] and pose["root.lift"] < 0 then pose["root.lift"] = 0 end
  return pose
end

-- Frame index (0-based) -> nearest mark name, for frames that land on a mark.
function Clip.markForFrame(clip, frame0, frameCount)
  local half = 0.5 / frameCount
  local t = frame0 / frameCount
  for _, m in ipairs(clip.marks) do
    if math.abs(m.t - t) < half then return m.name end
  end
  return nil
end

return Clip
