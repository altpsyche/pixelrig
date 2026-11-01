-- Render: rasterize a solved skeleton through a put(x, y, color) callback.
-- No anti-aliasing: crisp pixels for pixel art.

return function(Stamps)
  local Render = {}

  Render.STYLES = { "Stick", "Capsule", "Joints + arcs" }

  local floor, max, min, abs = math.floor, math.max, math.min, math.abs

  local function round(v) return floor(v + 0.5) end

  -- Bresenham points from (x0,y0) to (x1,y1), appended to out with color c.
  local function linePoints(out, x0, y0, x1, y1, c)
    x0, y0, x1, y1 = round(x0), round(y0), round(x1), round(y1)
    local dx, dy = abs(x1 - x0), -abs(y1 - y0)
    local sx = x0 < x1 and 1 or -1
    local sy = y0 < y1 and 1 or -1
    local err = dx + dy
    while true do
      local last = out[#out]
      if not last or last[1] ~= x0 or last[2] ~= y0 then
        out[#out + 1] = { x0, y0, c }
      end
      if x0 == x1 and y0 == y1 then break end
      local e2 = 2 * err
      if e2 >= dy then err = err + dy; x0 = x0 + sx end
      if e2 <= dx then err = err + dx; y0 = y0 + sy end
    end
    return out
  end

  -- Drop L-corner pixels (Aseprite "pixel perfect" stroke rule).
  local function pixelPerfect(pts)
    if #pts < 3 then return pts end
    local out = { pts[1] }
    local i = 2
    while i < #pts do
      local a, b, c = out[#out], pts[i], pts[i + 1]
      local corner = (a[1] == b[1] or a[2] == b[2]) and (c[1] == b[1] or c[2] == b[2])
        and a[1] ~= c[1] and a[2] ~= c[2]
      if not corner then out[#out + 1] = b end
      i = i + 1
    end
    out[#out + 1] = pts[#pts]
    return out
  end

  local function line1(put, x0, y0, x1, y1, c)
    for _, p in ipairs(linePoints({}, x0, y0, x1, y1, c)) do put(p[1], p[2], c) end
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

  -- Chain definitions: list of {pointKey, part} pairs; first part unused.
  local function legChain(sk, side)
    local s = sk[side]
    return { { sk.hip }, { s.knee, "thigh" }, { s.ankle, "shin" }, { s.heel, "foot" }, { s.toe, "foot" } }
  end
  local function armChain(sk, side)
    local s = sk[side]
    return { { sk.shoulder }, { s.elbow, "upperArm" }, { s.hand, "forearm" } }
  end
  local function spineChain(sk)
    return { { sk.hip }, { sk.neck, "torso" }, { sk.headBase, "neck" } }
  end

  local function drawChain(put, P, chain, side, opts, widths)
    local color = opts.color
    if widths then
      for i = 2, #chain do
        local part = chain[i][2]
        local ax, ay = P(chain[i - 1][1])
        local bx, by = P(chain[i][1])
        capsule(put, ax, ay, bx, by, widths[part] or 0, color(part, side))
      end
      return
    end
    local pts = {}
    for i = 2, #chain do
      local part = chain[i][2]
      local ax, ay = P(chain[i - 1][1])
      local bx, by = P(chain[i][1])
      linePoints(pts, ax, ay, bx, by, color(part, side))
    end
    if opts.pixelPerfect then pts = pixelPerfect(pts) end
    for _, p in ipairs(pts) do put(p[1], p[2], p[3]) end
  end

  -- frame = { sk, P, H, facing }
  -- opts  = { style, thickness, pixelPerfect, color(part, side) -> pixel, rig,
  --           trails, footprints, groundLine, groundY, width, height,
  --           arcColor, footColor, groundColor }
  function Render.draw(put, frame, opts)
    local sk, P, H, facing = frame.sk, frame.P, frame.H, frame.facing
    local style = opts.style

    -- Ground line + footprints (behind figure).
    local gy = opts.groundY + 1
    if gy >= (opts.height or math.huge) then gy = opts.groundY end
    if opts.groundLine then
      for x = 0, (opts.width or 0) - 1, 2 do put(x, gy, opts.groundColor) end
    end
    for _, fp in ipairs(opts.footprints or {}) do
      for x = round(min(fp[1], fp[2])), round(max(fp[1], fp[2])) do put(x, gy, opts.footColor) end
    end

    -- Capsule widths (radius px) or nil for 1px chains.
    local widths
    if style == "Capsule" then
      widths = {}
      for k, v in pairs(opts.rig.widths) do widths[k] = max(0.5, v * H) end
    elseif opts.thickness > 1 then
      widths = {}
      local r = (opts.thickness - 1) / 2
      for _, k in ipairs({ "torso", "neck", "upperArm", "forearm", "thigh", "shin", "foot" }) do widths[k] = r end
    end

    -- Back to front: far arm, far leg, spine, head, near leg, near arm.
    drawChain(put, P, armChain(sk, "far"), "far", opts, widths)
    drawChain(put, P, legChain(sk, "far"), "far", opts, widths)
    drawChain(put, P, spineChain(sk), "center", opts, widths)

    local hx, hy = P(sk.head)
    local hr = sk.headR * H
    local headC = opts.color("head", "center")
    hx, hy = round(hx), round(hy)
    if style == "Capsule" then
      Stamps.draw(put, hx, hy, 2 * hr, true, headC)
    elseif opts.thickness <= 1 then
      Stamps.draw(put, hx, hy, 2 * hr, false, headC)
    else
      ring(put, hx, hy, hr, opts.thickness, headC)
    end
    if style ~= "Capsule" then
      local fx, fy = sk.face.x * facing, sk.face.y
      local len = max(1, round(hr * 0.5))
      line1(put, hx + fx * (hr + 0.5), hy + fy * (hr + 0.5), hx + fx * (hr + len), hy + fy * (hr + len), headC)
    end

    drawChain(put, P, legChain(sk, "near"), "near", opts, widths)
    drawChain(put, P, armChain(sk, "near"), "near", opts, widths)

    if style == "Joints + arcs" then
      for _, tr in ipairs(opts.trails or {}) do
        for i, p in ipairs(tr.points) do
          if i ~= tr.current then put(floor(p[1]), floor(p[2]), opts.arcColor) end
        end
      end
      local d = max(2, round(H * 0.04))
      local joints = {
        { sk.far.knee, "thigh", "far" }, { sk.far.ankle, "shin", "far" }, { sk.far.elbow, "upperArm", "far" },
        { sk.far.hand, "forearm", "far" }, { sk.hip, "torso", "center" }, { sk.neck, "torso", "center" },
        { sk.near.knee, "thigh", "near" }, { sk.near.ankle, "shin", "near" }, { sk.near.elbow, "upperArm", "near" },
        { sk.near.hand, "forearm", "near" },
      }
      for _, j in ipairs(joints) do
        local x, y = P(j[1])
        Stamps.draw(put, x, y, d, true, opts.color(j[2], j[3]))
      end
    end
  end

  -- Draggable joints: name -> point, with channel metadata for pose editing.
  function Render.handles(sk)
    return {
      { id = "near.knee", p = sk.near.knee, side = "near" },
      { id = "near.ankle", p = sk.near.ankle, side = "near" },
      { id = "near.toe", p = sk.near.toe, side = "near" },
      { id = "near.elbow", p = sk.near.elbow, side = "near" },
      { id = "near.hand", p = sk.near.hand, side = "near" },
      { id = "far.knee", p = sk.far.knee, side = "far" },
      { id = "far.ankle", p = sk.far.ankle, side = "far" },
      { id = "far.toe", p = sk.far.toe, side = "far" },
      { id = "far.elbow", p = sk.far.elbow, side = "far" },
      { id = "far.hand", p = sk.far.hand, side = "far" },
      { id = "neck", p = sk.neck },
      { id = "head", p = sk.head },
    }
  end

  -- Screen positions of joints tracked for motion arcs.
  function Render.trailPoints(frame)
    local sk, P = frame.sk, frame.P
    local out = {}
    for _, key in ipairs({ "hand", "toe" }) do
      local x, y = P(sk.near[key]); out["near." .. key] = { x, y }
    end
    local x, y = P(sk.head)
    out.head = { x, y - sk.headR * frame.H }
    return out
  end

  Render.line1 = line1
  Render.pixelPerfect = pixelPerfect
  return Render
end
