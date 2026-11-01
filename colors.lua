-- Colors: ghost color schemes.
-- Each scheme declares editable color slots; resolvers map (part, side) -> {r, g, b}.
-- part: torso | neck | head | upperArm | forearm | thigh | shin | foot
-- side: near | far | center

local Colors = {}

Colors.SCHEMES = { "Mono", "Near / Far", "Limbs", "Segments" }

Colors.ARC = { 255, 150, 40 }
Colors.FOOTPRINT = { 90, 190, 60 }
Colors.GROUND = { 150, 150, 150 }

-- Slots per scheme: { id, label, default rgb }
Colors.SLOTS = {
  ["Mono"] = {
    { id = "body", label = "Body", rgb = { 0, 170, 255 } },
  },
  ["Near / Far"] = {
    { id = "body", label = "Body", rgb = { 0, 170, 255 } },
    { id = "near", label = "Near side", rgb = { 0, 170, 255 } },
    { id = "far", label = "Far side", rgb = { 235, 60, 60 } },
  },
  ["Limbs"] = {
    { id = "body", label = "Body", rgb = { 0, 170, 255 } },
    { id = "armNear", label = "Near arm", rgb = { 255, 150, 0 } },
    { id = "armFar", label = "Far arm", rgb = { 0, 160, 150 } },
    { id = "legNear", label = "Near leg", rgb = { 230, 50, 50 } },
    { id = "legFar", label = "Far leg", rgb = { 60, 90, 230 } },
  },
  ["Segments"] = {
    { id = "torso", label = "Torso", rgb = { 0, 170, 255 } },
    { id = "neck", label = "Neck", rgb = { 0, 200, 200 } },
    { id = "head", label = "Head", rgb = { 0, 120, 255 } },
    { id = "upperArm", label = "Upper arm", rgb = { 255, 170, 0 } },
    { id = "forearm", label = "Forearm", rgb = { 230, 210, 0 } },
    { id = "thigh", label = "Thigh", rgb = { 230, 40, 40 } },
    { id = "shin", label = "Shin", rgb = { 255, 100, 160 } },
    { id = "foot", label = "Foot", rgb = { 170, 70, 255 } },
  },
}

Colors.MAX_SLOTS = 8

local LIMB_OF = { upperArm = "arm", forearm = "arm", thigh = "leg", shin = "leg", foot = "leg" }

local function dark(c, k)
  k = k or 0.55
  return { math.floor(c[1] * k), math.floor(c[2] * k), math.floor(c[3] * k) }
end

-- Slot colors for a scheme: defaults overlaid with user picks (map id -> rgb).
function Colors.resolve(scheme, picks)
  local out = {}
  for _, slot in ipairs(Colors.SLOTS[scheme] or Colors.SLOTS.Mono) do
    out[slot.id] = (picks and picks[slot.id]) or slot.rgb
  end
  return out
end

-- c: map slot id -> rgb (from Colors.resolve)
function Colors.resolver(scheme, c)
  if scheme == "Near / Far" then
    return function(_, side)
      if side == "far" then return c.far end
      if side == "near" then return c.near end
      return c.body
    end
  elseif scheme == "Limbs" then
    return function(part, side)
      local limb = LIMB_OF[part]
      if not limb then return c.body end
      return c[limb .. (side == "far" and "Far" or "Near")]
    end
  elseif scheme == "Segments" then
    local darkCache = {}
    return function(part, side)
      local col = c[part] or c.torso
      if side ~= "far" then return col end
      darkCache[part] = darkCache[part] or dark(col)
      return darkCache[part]
    end
  end
  local farC = dark(c.body)
  return function(_, side) return side == "far" and farC or c.body end
end

return Colors
