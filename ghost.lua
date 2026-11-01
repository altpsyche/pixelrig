-- Ghost: builds pose frames from settings and writes them into reference layers.
-- One ghost layer per scope ("All frames" or a tag name).

return function(Clip, Rig, Render, Colors, Util)
  local Ghost = {}

  Ghost.MARK = "pixelrig-ghost"
  Ghost.ALL = "All frames"
  local PROPS = "pixelrig"

  Ghost.DEFAULTS = {
    clip = "Run", scope = Ghost.ALL,
    style = "Stick", facing = "Right", thickness = 1, pixelPerfect = true,
    height = 48, groundY = 63, cx = 32,
    frames = 12, fps = 12, timing = false, fillAll = true, labels = true,
    colorScheme = "Mono", opacity = 40,
    schemeColors = {}, -- schemeColors[scheme][slotId] = {r, g, b}; missing slots use scheme defaults
    travel = false, travelSpeed = 100, footprints = true, groundLine = false,
    preset = "Default",
    proportions = { head = 100, torso = 100, arms = 100, legs = 100, bulk = 100 },
    params = {},   -- params[clipName][paramId] = value
    clipData = nil -- edited clip, persisted with the ghost
  }

  -- Scopes ----------------------------------------------------------------------

  local function isGhostTag(tag)
    return (tag.data or ""):find(Ghost.MARK, 1, true) == 1
  end

  function Ghost.scopes(sprite)
    local list = { Ghost.ALL }
    for _, tag in ipairs(sprite.tags) do
      if not isGhostTag(tag) then
        table.insert(list, tag.name)
      end
    end
    return list
  end

  local function findTag(sprite, name)
    for _, tag in ipairs(sprite.tags) do
      if tag.name == name and not isGhostTag(tag) then return tag end
    end
    return nil
  end

  -- First/last frame numbers of a scope, or nil if the tag is gone.
  function Ghost.scopeRange(sprite, scope)
    if scope == Ghost.ALL then return 1, #sprite.frames end
    local tag = findTag(sprite, scope)
    if not tag then return nil end
    return tag.fromFrame.frameNumber, tag.toFrame.frameNumber
  end

  function Ghost.isGhost(layer)
    return layer and layer.data == Ghost.MARK
  end

  function Ghost.layerScope(layer)
    return layer.properties(PROPS).scope or Ghost.ALL
  end

  function Ghost.findLayer(sprite, scope)
    for _, layer in ipairs(sprite.layers) do
      if Ghost.isGhost(layer) and Ghost.layerScope(layer) == scope then return layer end
    end
    return nil
  end

  function Ghost.loadSettings(layer)
    local text = layer and layer.properties(PROPS).settings
    if not text then return nil end
    local ok, data = pcall(Util.decode, text)
    if not ok then return nil end
    -- v0.1 stored two flat colors; map them onto scheme slots.
    if data.color and not data.schemeColors then
      data.schemeColors = {
        ["Mono"] = { body = data.color },
        ["Near / Far"] = { body = data.color, near = data.color, far = data.color2 },
      }
    end
    data.color, data.color2 = nil, nil
    return Util.merge(Ghost.DEFAULTS, data)
  end

  -- Build -----------------------------------------------------------------------

  -- Root motion that locks planted feet. Each substep the root advances by the
  -- planted contact point's backward motion (heel, rolling to toe); in flight it
  -- coasts at the mean contact speed. Returns root(t) (body units, cumulative),
  -- cycle distance D, and plant events {t, side}.
  local function measureTravel(clip, rig, params)
    local S = 240
    local samples = {}
    for k = 0, S - 1 do
      local sk = Rig.solve(rig, Clip.sample(clip, k / S, params))
      local side
      if sk.lift <= 1e-6 then side = sk.near.lowest >= sk.far.lowest and "near" or "far" end
      samples[k] = { sk = sk, side = side }
    end

    local steps, plants = {}, {}
    local acc, grounded = 0, 0
    for k = 0, S - 1 do
      local a, b = samples[(k - 1) % S], samples[k] -- step from k-1 to k
      if b.side and a.side == b.side then
        local c = b.sk[b.side].contact
        local dx = a.sk[b.side][c].x - b.sk[b.side][c].x
        steps[k] = dx
        acc, grounded = acc + dx, grounded + 1
      end
      if b.side and a.side ~= b.side then table.insert(plants, { t = k / S, side = b.side }) end
    end
    local coast = grounded > 0 and acc / grounded or 0

    local R = { [0] = 0 }
    for k = 1, S do R[k] = R[k - 1] + (steps[k % S] or coast) end
    local function root(t)
      local x = (t % 1.0) * S
      local k = math.floor(x)
      return R[k] + (R[k + 1] - R[k]) * (x - k)
    end
    return root, R[S], plants
  end

  -- Returns build = { frames[1..N] = {sk, P, H, facing, t, ox, oy}, rig, N, footprints, trails }
  function Ghost.build(s, clip, baseRig)
    local rig = Rig.withProportions(baseRig, s.proportions)
    local N = s.frames
    local params = s.params[clip.name] or {}
    local H = s.height
    local f = s.facing == "Left" and -1 or 1

    local D, plants = 0, {}
    local rootX = function() return 0 end
    if s.travel then
      local root, dist
      root, dist, plants = measureTravel(clip, rig, params)
      local k = s.travelSpeed / 100
      D = dist * k
      rootX = function(t) return (root(t) - dist / 2) * k end
    end

    local frames = {}
    for i = 0, N - 1 do
      local t = i / N
      local pose = Clip.sample(clip, t, params)
      local sk = Rig.solve(rig, pose)
      -- Snap the whole figure to integer pixels: no per-joint jitter.
      local ox = math.floor(s.cx + f * rootX(t) * H + 0.5)
      local oy = math.floor(s.groundY - sk.ground * H + 0.5)
      local P = function(p) return ox + f * p.x * H, oy + p.y * H end
      frames[i + 1] = { sk = sk, P = P, H = H, facing = f, t = t, tw = pose.t, ox = ox, oy = oy, pose = pose }
    end

    -- Footprints: heel..toe span of each plant, in screen x.
    local footprints = {}
    if s.travel and s.footprints then
      for _, pl in ipairs(plants) do
        local sk = Rig.solve(rig, Clip.sample(clip, pl.t, params))
        local side = sk[pl.side]
        local base = s.cx + f * rootX(pl.t) * H
        table.insert(footprints, { base + f * side.heel.x * H, base + f * side.toe.x * H })
      end
    end

    local trails = {}
    if s.style == "Joints + arcs" then
      local byKey = {}
      for i, fr in ipairs(frames) do
        for key, p in pairs(Render.trailPoints(fr)) do
          byKey[key] = byKey[key] or {}
          byKey[key][i] = p
        end
      end
      trails = byKey
    end

    return { frames = frames, rig = rig, N = N, footprints = footprints, trails = trails, distance = D }
  end

  -- Rendering -------------------------------------------------------------------

  local function nearestIndex(palette, r, g, b)
    local best, bestD = 0, math.huge
    for i = 0, #palette - 1 do
      local c = palette:getColor(i)
      if c.alpha > 0 then
        local dr, dg, db = c.red - r, c.green - g, c.blue - b
        local d = dr * dr + dg * dg + db * db
        if d < bestD then best, bestD = i, d end
      end
    end
    return best
  end

  -- Returns function({r,g,b}) -> pixel value for the color mode, cached.
  function Ghost.pixelConverter(colorMode, palette)
    local cache = {}
    return function(c)
      local key = c[1] * 65536 + c[2] * 256 + c[3]
      local v = cache[key]
      if v then return v end
      if colorMode == ColorMode.RGB then
        v = app.pixelColor.rgba(c[1], c[2], c[3], 255)
      elseif colorMode == ColorMode.GRAY then
        v = app.pixelColor.graya(math.floor(0.299 * c[1] + 0.587 * c[2] + 0.114 * c[3]), 255)
      else
        v = nearestIndex(palette, c[1], c[2], c[3])
      end
      cache[key] = v
      return v
    end
  end

  -- Render cycle frame i (1-based) of build into img.
  function Ghost.renderFrame(img, build, i, s, toPixel)
    local picks = (s.schemeColors or {})[s.colorScheme]
    local resolve = Colors.resolver(s.colorScheme, Colors.resolve(s.colorScheme, picks))
    local W, Hh = img.width, img.height
    local put = function(x, y, c)
      if x >= 0 and y >= 0 and x < W and y < Hh then img:drawPixel(x, y, c) end
    end
    local trails = {}
    for _, pts in pairs(build.trails) do
      table.insert(trails, { points = pts, current = i })
    end
    Render.draw(put, build.frames[i], {
      style = s.style, thickness = s.thickness, pixelPerfect = s.pixelPerfect,
      color = function(part, side) return toPixel(resolve(part, side)) end,
      rig = build.rig, trails = trails, footprints = build.footprints,
      groundLine = s.groundLine, groundY = s.groundY, width = W, height = Hh,
      arcColor = toPixel(Colors.ARC), footColor = toPixel(Colors.FOOTPRINT), groundColor = toPixel(Colors.GROUND),
    })
  end

  -- Apply -----------------------------------------------------------------------

  local function tagMark(scope) return Ghost.MARK .. ":" .. scope end

  local function ensureLayer(sprite, scope)
    local layer = Ghost.findLayer(sprite, scope)
    if not layer then
      local prev = app.layer
      app.command.NewLayer { reference = true, top = true }
      layer = app.layer
      layer.data = Ghost.MARK
      layer.properties(PROPS).scope = scope
      layer.stackIndex = sprite.backgroundLayer and 2 or 1
      if prev then app.layer = prev end
    end
    return layer
  end

  local function clearTags(sprite, scope)
    local doomed = {}
    for _, tag in ipairs(sprite.tags) do
      if tag.data == tagMark(scope) then table.insert(doomed, tag) end
    end
    for _, tag in ipairs(doomed) do sprite:deleteTag(tag) end
  end

  local function addTag(sprite, from, to, name, rgb, scope)
    local tag = sprite:newTag(from, to)
    tag.name = name
    tag.data = tagMark(scope)
    tag.color = Color { r = rgb[1], g = rgb[2], b = rgb[3] }
  end

  -- Runs fn as one undo step on sprite, made active for it since NewLayer and app.transaction act
  -- on the active sprite, then puts the artist back on the sprite, layer and frame they had (#3):
  -- adding frames moves the active frame. `removed`, a layer fn deletes, is not restored.
  local function transactionOn(sprite, label, fn, removed)
    local prevSprite, prevLayer, prevFrame = app.sprite, app.layer, app.frame
    prevFrame = prevFrame and prevFrame.frameNumber
    if removed and prevLayer == removed then prevLayer = nil end
    if prevSprite ~= sprite then app.sprite = sprite end
    local ok, err = pcall(app.transaction, label, fn)
    if app.sprite ~= prevSprite then app.sprite = prevSprite end
    if prevSprite then
      if prevLayer then app.layer = prevLayer end
      if prevFrame then app.frame = prevFrame end
    end
    if not ok then error(err, 0) end
  end

  -- Writes the ghost into the sprite as one undo step, leaving the artist's active sprite, layer
  -- and frame as they were. Returns error string or nil.
  function Ghost.apply(sprite, s, clip, baseRig)
    local first, last = Ghost.scopeRange(sprite, s.scope)
    if not first then return "Tag '" .. s.scope .. "' not found" end
    local build = Ghost.build(s, clip, baseRig)
    local N = build.N

    transactionOn(sprite, "Ghost Reference", function()
      local layer = ensureLayer(sprite, s.scope)
      layer.name = "Ghost: " .. clip.name .. (s.scope ~= Ghost.ALL and (" [" .. s.scope .. "]") or "")
      layer.opacity = math.floor(s.opacity * 255 / 100 + 0.5)

      if s.scope == Ghost.ALL then
        while #sprite.frames < N do sprite:newEmptyFrame(#sprite.frames + 1) end
        last = #sprite.frames
      end
      if s.timing then
        for fr = first, math.min(last, first + N - 1) do sprite.frames[fr].duration = 1 / s.fps end
      end

      local toPixel = Ghost.pixelConverter(sprite.colorMode, sprite.palettes[1])
      local images = {}
      for i = 1, N do
        local img = Image(sprite.spec)
        img:clear()
        Ghost.renderFrame(img, build, i, s, toPixel)
        images[i] = img
      end

      for fr = first, last do
        local k = fr - first
        local cel = layer:cel(fr)
        if s.fillAll or k < N then
          local img = images[k % N + 1]
          if cel then
            cel.image = img
            cel.position = Point(0, 0)
          else
            sprite:newCel(layer, fr, img, Point(0, 0))
          end
        elseif cel then
          sprite:deleteCel(cel)
        end
      end

      clearTags(sprite, s.scope)
      if s.labels then
        if s.scope == Ghost.ALL then addTag(sprite, 1, N, clip.name, { 0, 170, 255 }, s.scope) end
        for i = 0, math.min(N, last - first + 1) - 1 do
          local m = Clip.markForFrame(clip, i, N)
          if m then addTag(sprite, first + i, first + i, m, { 120, 120, 120 }, s.scope) end
        end
      end

      local saved = Util.deepCopy(s)
      layer.properties(PROPS).settings = json.encode(saved)
    end)
    app.refresh()
    return nil
  end

  function Ghost.remove(sprite, scope)
    local layer = Ghost.findLayer(sprite, scope)
    transactionOn(sprite, "Remove Ghost Reference", function()
      if layer then sprite:deleteLayer(layer) end
      clearTags(sprite, scope)
    end, layer)
    app.refresh()
  end

  -- Fit to art ------------------------------------------------------------------

  local function artLayers(sprite)
    local out = {}
    local function walk(layers)
      for _, l in ipairs(layers) do
        if not l.isVisible then
          -- hidden layer or group: skip subtree
        elseif l.isGroup then walk(l.layers)
        elseif l.isImage and not Ghost.isGhost(l) and not l.isReference then
          table.insert(out, l)
        end
      end
    end
    walk(sprite.layers)
    return out
  end

  -- Bounding box of art: the selection, else the union of all visible art layers in the frame
  -- (ghost and reference layers excluded). The active layer does not narrow it (#42).
  function Ghost.fitToArt(sprite, frameNumber)
    local bounds
    if not sprite.selection.isEmpty then
      bounds = sprite.selection.bounds
    else
      for _, l in ipairs(artLayers(sprite)) do
        local cel = l:cel(frameNumber)
        if cel then
          local r = cel.image:shrinkBounds()
          if not r.isEmpty then
            r = Rectangle(r.x + cel.position.x, r.y + cel.position.y, r.width, r.height)
            bounds = bounds and bounds:union(r) or r
          end
        end
      end
    end
    if not bounds or bounds.isEmpty then return nil end
    return {
      height = bounds.height,
      groundY = bounds.y + bounds.height - 1,
      cx = bounds.x + bounds.width // 2,
    }
  end

  -- Preview background --------------------------------------------------------

  -- RGB composite of visible art (no ghosts, no reference layers) at a frame.
  function Ghost.composite(sprite, frameNumber)
    local img = Image(sprite.width, sprite.height, ColorMode.RGB)
    img:clear()
    if frameNumber < 1 or frameNumber > #sprite.frames then return img end
    local rgb = sprite.colorMode == ColorMode.RGB
    local pal = sprite.palettes[1]
    local transparent = sprite.transparentColor
    for _, l in ipairs(artLayers(sprite)) do
      local cel = l:cel(frameNumber)
      if cel then
        local opacity = (l.opacity or 255) * cel.opacity // 255
        if rgb then
          img:drawImage(cel.image, cel.position, opacity)
        else
          local src = cel.image
          local px, py = cel.position.x, cel.position.y
          for it in src:pixels() do
            local v = it()
            local c
            if sprite.colorMode == ColorMode.GRAY then
              local a = app.pixelColor.grayaA(v)
              if a > 0 then
                local g = app.pixelColor.grayaV(v)
                c = app.pixelColor.rgba(g, g, g, a)
              end
            elseif v ~= transparent or l.isBackground then
              local col = pal:getColor(v)
              if col.alpha > 0 then c = app.pixelColor.rgba(col.red, col.green, col.blue, col.alpha) end
            end
            if c then
              local x, y = px + it.x, py + it.y
              if x >= 0 and y >= 0 and x < img.width and y < img.height then img:drawPixel(x, y, c) end
            end
          end
        end
      end
    end
    return img
  end

  return Ghost
end
