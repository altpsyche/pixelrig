-- Ghost: writes generated poses into a reference layer of an Aseprite sprite.

return function(Clip, Rig, Render)
  local Ghost = {}
  local MARK = "anim-ghost"

  function Ghost.findLayer(sprite)
    for _, layer in ipairs(sprite.layers) do
      if layer.data == MARK then return layer end
    end
    return nil
  end

  local function nearestIndex(palette, color)
    local best, bestD = 0, math.huge
    for i = 0, #palette - 1 do
      local c = palette:getColor(i)
      if c.alpha > 0 then
        local dr, dg, db = c.red - color.red, c.green - color.green, c.blue - color.blue
        local d = dr * dr + dg * dg + db * db
        if d < bestD then best, bestD = i, d end
      end
    end
    return best
  end

  local function pixelFor(sprite, color)
    local cm = sprite.colorMode
    if cm == ColorMode.RGB then
      return app.pixelColor.rgba(color.red, color.green, color.blue, 255)
    elseif cm == ColorMode.GRAY then
      return app.pixelColor.graya(color.gray, 255)
    else
      return nearestIndex(sprite.palettes[1], color)
    end
  end

  local function scaled(color, k)
    return Color { r = math.floor(color.red * k), g = math.floor(color.green * k), b = math.floor(color.blue * k) }
  end

  local function ensureLayer(sprite, name)
    local layer = Ghost.findLayer(sprite)
    if not layer then
      local prev = app.layer
      app.command.NewLayer { reference = true, top = true }
      layer = app.layer
      layer.data = MARK
      layer.stackIndex = sprite.backgroundLayer and 2 or 1
      if prev then app.layer = prev end
    end
    layer.name = name
    return layer
  end

  local function clearTags(sprite)
    local doomed = {}
    for _, tag in ipairs(sprite.tags) do
      if tag.data == MARK then table.insert(doomed, tag) end
    end
    for _, tag in ipairs(doomed) do sprite:deleteTag(tag) end
  end

  local function addTag(sprite, from, to, name, color)
    local tag = sprite:newTag(from, to)
    tag.name = name
    tag.data = MARK
    tag.color = color
  end

  -- s = { clip, rig, params, height, groundY, cx, facing, style, thickness,
  --       frames, fps, timing, fillAll, labels, color, opacity }
  function Ghost.generate(sprite, s)
    local N = s.frames
    local view = { cx = s.cx, groundY = s.groundY, height = s.height, facing = s.facing }

    -- Solve all poses for one cycle.
    local skels = {}
    for i = 0, N - 1 do
      local pose = Clip.sample(s.clip, i / N, s.params)
      skels[i] = Rig.solve(s.rig, pose)
    end

    -- Motion trails (Joints + arcs style).
    local trailSets = {}
    if s.style == "Joints + arcs" then
      local byKey = {}
      for i = 0, N - 1 do
        for key, p in pairs(Render.trailPoints(skels[i], view)) do
          byKey[key] = byKey[key] or {}
          byKey[key][i + 1] = p
        end
      end
      trailSets = byKey
    end

    app.transaction("Ghost Reference", function()
      local layer = ensureLayer(sprite, "Ghost: " .. s.clip.name)
      layer.opacity = math.floor(s.opacity * 255 / 100 + 0.5)

      while #sprite.frames < N do sprite:newEmptyFrame(#sprite.frames + 1) end
      if s.timing then
        for i = 1, N do sprite.frames[i].duration = 1 / s.fps end
      end

      local colors = {
        near = pixelFor(sprite, s.color),
        far = pixelFor(sprite, scaled(s.color, 0.55)),
        arc = pixelFor(sprite, Color { r = 255, g = 150, b = 40 }),
      }

      -- Render one image per cycle frame.
      local images = {}
      for i = 0, N - 1 do
        local img = Image(sprite.spec)
        img:clear()
        local W, Hh = img.width, img.height
        local put = function(x, y, c)
          if x >= 0 and y >= 0 and x < W and y < Hh then img:drawPixel(x, y, c) end
        end
        local trails = {}
        for _, pts in pairs(trailSets) do
          table.insert(trails, { points = pts, current = i + 1 })
        end
        Render.draw(put, skels[i], view, {
          style = s.style, thickness = s.thickness, colors = colors,
          rig = s.rig, trails = trails,
        })
        images[i] = img
      end

      local last = s.fillAll and #sprite.frames or N
      for fr = 1, last do
        local img = images[(fr - 1) % N]
        local cel = layer:cel(fr)
        if cel then
          cel.image = img
          cel.position = Point(0, 0)
        else
          sprite:newCel(layer, fr, img, Point(0, 0))
        end
      end
      -- Frames past the cycle when not looping: clear stale ghost cels.
      if not s.fillAll then
        for fr = N + 1, #sprite.frames do
          local cel = layer:cel(fr)
          if cel then sprite:deleteCel(cel) end
        end
      end

      clearTags(sprite)
      if s.labels then
        addTag(sprite, 1, N, s.clip.name, Color { r = 0, g = 170, b = 255 })
        for i = 0, N - 1 do
          local m = Clip.markForFrame(s.clip, i, N)
          if m then addTag(sprite, i + 1, i + 1, m, Color { r = 120, g = 120, b = 120 }) end
        end
      end
    end)
    app.refresh()
  end

  function Ghost.remove(sprite)
    app.transaction("Remove Ghost Reference", function()
      local layer = Ghost.findLayer(sprite)
      if layer then sprite:deleteLayer(layer) end
      clearTags(sprite)
    end)
    app.refresh()
  end

  return Ghost
end
