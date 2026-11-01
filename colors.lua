-- Colors: ghost color schemes. Resolvers map (part, side) -> {r, g, b}.
-- part: torso | neck | head | upperArm | forearm | thigh | shin | foot
-- side: near | far | center

local Colors = {}

Colors.SCHEMES = { "Mono", "Near / Far", "Limbs", "Segments" }

Colors.ARC = { 255, 150, 40 }
Colors.FOOTPRINT = { 90, 190, 60 }
Colors.GROUND = { 150, 150, 150 }

local LIMB_OF = { upperArm = "arm", forearm = "arm", thigh = "leg", shin = "leg", foot = "leg" }

local LIMBS = {
  arm = { near = { 255, 150, 0 }, far = { 0, 160, 150 } },
  leg = { near = { 230, 50, 50 }, far = { 60, 90, 230 } },
}

local SEGMENTS = {
  torso = { 0, 170, 255 }, neck = { 0, 200, 200 }, head = { 0, 120, 255 },
  upperArm = { 255, 170, 0 }, forearm = { 230, 210, 0 },
  thigh = { 230, 40, 40 }, shin = { 255, 100, 160 }, foot = { 170, 70, 255 },
}

local function dark(c, k)
  k = k or 0.55
  return { math.floor(c[1] * k), math.floor(c[2] * k), math.floor(c[3] * k) }
end

-- primary/secondary: {r, g, b}
function Colors.resolver(scheme, primary, secondary)
  if scheme == "Near / Far" then
    return function(_, side) return side == "far" and secondary or primary end
  elseif scheme == "Limbs" then
    return function(part, side)
      local limb = LIMB_OF[part]
      if limb then return LIMBS[limb][side == "far" and "far" or "near"] end
      return primary
    end
  elseif scheme == "Segments" then
    return function(part, side)
      local c = SEGMENTS[part] or primary
      return side == "far" and dark(c) or c
    end
  end
  local farC = dark(primary)
  return function(_, side) return side == "far" and farC or primary end
end

return Colors
