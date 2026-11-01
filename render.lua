-- Render: rasterize a solved skeleton through a put(x, y, color) callback.
-- No anti-aliasing: crisp pixels for pixel art.

local Render = {}

Render.STYLES = { "Stick", "Capsule", "Joints + arcs" }

local floor, max, min, abs = math.floor, math.max, math.min, math.abs

local function line1(put, x0, y0, x1, y1, c)
  x0, y0, x1, y1 = floor(x0 + 0.5), floor(y0 + 0.5), floor(x1 + 0.5), floor(y1 + 0.5)
  local dx, dy = abs(x1 - x0), -abs(y1 - y0)
  local sx = x0 < x1 and 1 or -1
  local sy = y0 < y1 and 1 or -1
  local err = dx + dy
  while true do
    put(x0, y0, c)
    if x0 == x1 and y0 == y1 then break end
    local e2 = 2 * err
    if e2 >= dy then err = err + dy; x0 = x0 + sx end
    if e2 <= dx then err = err + dx; y0 = y0 + sy end
  end
end

local function segDist2(px, py, ax, ay, bx, by)
  local vx, vy = bx - ax, by - ay
  local wx, wy = px - ax, py - ay
  local len2 = vx * vx + vy * vy
  local t = 0
  if len2 > 0 then t = max(0, min(1, (wx * vx + wy * vy) / len2)) end
  local dx, dy = wx - t * vx, wy - t * vy
  return dx * dx + dy * dy
end

-- Thick segment with round caps; r = radius in pixels.
local function capsule(put, ax, ay, bx, by, r, c)
  if r < 0.75 then return line1(put, ax, ay, bx, by, c) end
  local r2 = r * r
  for y = floor(min(ay, by) - r), floor(max(ay, by) + r) do
    for x = floor(min(ax, bx) - r), floor(max(ax, bx) + r) do
      if segDist2(x + 0.5, y + 0.5, ax, ay, bx, by) <= r2 then put(x, y, c) end
    end
  end
end

local function disc(put, cx, cy, r, c)
  capsule(put, cx, cy, cx, cy, max(r, 0.75), c)
end

local function ring(put, cx, cy, r, t, c)
  local outer2, inner = r * r, max(0, r - t)
  local inner2 = inner * inner
  for y = floor(cy - r), floor(cy + r) do
    for x = floor(cx - r), floor(cx + r) do
      local dx, dy = x + 0.5 - cx, y + 0.5 - cy
      local d2 = dx * dx + dy * dy
      if d2 <= outer2 and d2 >= inner2 then put(x, y, c) end
    end
  end
end

-- view = { cx, groundY, height, facing (1 | -1) }
-- Returns function mapping rig point -> screen x, y.
function Render.projector(sk, view)
  local H, f = view.height, view.facing
  return function(p)
    return view.cx + f * p.x * H, view.groundY + (p.y - sk.ground) * H
  end
end

local function bone(put, P, a, b, r, c)
  local ax, ay = P(a)
  local bx, by = P(b)
  capsule(put, ax, ay, bx, by, r, c)
end

local function drawLimbs(put, P, side, hip, shoulder, w, c, which)
  if which == "leg" then
    bone(put, P, hip, side.knee, w.thigh, c)
    bone(put, P, side.knee, side.ankle, w.shin, c)
    bone(put, P, side.heel, side.toe, w.foot, c)
    bone(put, P, side.ankle, side.heel, w.foot, c)
  else
    bone(put, P, shoulder, side.elbow, w.upperArm, c)
    bone(put, P, side.elbow, side.hand, w.forearm, c)
  end
end

-- opts = { style, thickness, colors = { near, far, arc }, rig, trails }
-- trails: list of { points = { {x,y}... screen }, current = index } (Joints + arcs only)
function Render.draw(put, sk, view, opts)
  local P = Render.projector(sk, view)
  local H = view.height
  local col = opts.colors
  local style = opts.style

  local w = {}
  if style == "Capsule" then
    for k, v in pairs(opts.rig.widths) do w[k] = max(0.5, v * H) end
  else
    local r = max(0, (opts.thickness - 1) / 2)
    for _, k in ipairs({ "torso", "neck", "upperArm", "forearm", "thigh", "shin", "foot" }) do w[k] = r end
  end

  local nearC, farC = col.near, col.far
  if style == "Joints + arcs" then
    nearC, farC = col.far, col.far
    for k in pairs(w) do w[k] = 0 end
  end

  -- Back to front: far arm, far leg, torso, head, near leg, near arm.
  drawLimbs(put, P, sk.far, sk.hip, sk.shoulder, w, farC, "arm")
  drawLimbs(put, P, sk.far, sk.hip, sk.shoulder, w, farC, "leg")
  bone(put, P, sk.hip, sk.neck, w.torso, nearC)
  bone(put, P, sk.neck, sk.headBase, w.neck, nearC)

  local hx, hy = P(sk.head)
  local hr = sk.headR * H
  if style == "Capsule" then
    disc(put, hx, hy, hr, nearC)
  else
    ring(put, hx, hy, hr, max(1, opts.thickness), nearC)
    -- facing tick: short line from head edge forward
    local fx, fy = sk.face.x * view.facing, sk.face.y
    line1(put, hx + fx * hr, hy + fy * hr, hx + fx * (hr + max(2, hr * 0.4)), hy + fy * (hr + max(2, hr * 0.4)), nearC)
  end

  drawLimbs(put, P, sk.near, sk.hip, sk.shoulder, w, nearC, "leg")
  drawLimbs(put, P, sk.near, sk.hip, sk.shoulder, w, nearC, "arm")

  if style == "Joints + arcs" then
    for _, tr in ipairs(opts.trails or {}) do
      for i, p in ipairs(tr.points) do
        if i ~= tr.current then put(floor(p[1]), floor(p[2]), col.arc) end
      end
    end
    local jr = max(1, H * 0.018)
    for _, side in ipairs({ { sk.far, col.far }, { sk.near, col.near } }) do
      local s, c = side[1], side[2]
      for _, j in ipairs({ s.knee, s.ankle, s.toe, s.elbow, s.hand }) do
        local x, y = P(j); disc(put, x, y, jr, c)
      end
    end
    for _, j in ipairs({ sk.hip, sk.neck, sk.shoulder }) do
      local x, y = P(j); disc(put, x, y, jr, col.near)
    end
  end
end

-- Screen positions of joints tracked for motion arcs.
function Render.trailPoints(sk, view)
  local P = Render.projector(sk, view)
  local out = {}
  for _, key in ipairs({ "hand", "toe" }) do
    local x, y = P(sk.near[key]); out["near." .. key] = { x, y }
  end
  local x, y = P(sk.head)
  out.head = { x, y - sk.headR * view.height }
  return out
end

Render.line1 = line1
return Render
