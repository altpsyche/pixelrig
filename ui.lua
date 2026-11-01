-- UI: Ghost Reference dialog with animated preview, pose dragging and Apply.

return function(M)
  local Clip, Rig, Render, Util, Ghost = M.Clip, M.Rig, M.Render, M.Util, M.Ghost
  local UI = {}

  local MAXP = 8           -- reusable clip param sliders
  local CW, CH = 280, 220  -- preview canvas size
  local floor, max, min = math.floor, math.max, math.min

  local function rgbOf(c) return { c.red, c.green, c.blue } end
  local function colorOf(t) return Color { r = t[1], g = t[2], b = t[3] } end

  local function presetNames()
    local names = {}
    for _, p in ipairs(Rig.PRESETS) do table.insert(names, p.name) end
    table.insert(names, "Custom")
    return names
  end

  local function nearAngle(v, old)
    if not old then return v end
    while v - old > 180 do v = v - 360 end
    while v - old < -180 do v = v + 360 end
    return v
  end

  function UI.open()
    local sprite = app.sprite
    if not sprite then
      app.alert("Open or create a sprite first.")
      return
    end

    local lib = M.loadLibrary()
    if #lib.names == 0 then
      app.alert("No clips found.")
      return
    end

    -- State ------------------------------------------------------------------
    local dlg, S, work, build
    local dirty = false
    local ghostImgs, bgCache = {}, {}
    local cur, playing, drag = 1, false, nil
    local view = { x = 0, y = 0, z = 1 }
    local playTimer, changeTimer, applyTimer
    local storeColors, refreshColors, onSchemeChange, changed
    local sec -- Sections: tabs, or a section picker on Aseprite builds without Dialog:tab

    local function alive()
      return pcall(function() return sprite.width end)
    end

    -- Fit to art for this dialog's sprite (Ghost.fitToArt), or nil. It measures the active frame
    -- only when that frame is this sprite's; another open sprite may be active (#3).
    local function fitArt()
      local f = app.frame
      local own = app.sprite == sprite and f
      return Ghost.fitToArt(sprite, own and f.frameNumber or 1)
    end

    local function defaultsFor(scope)
      local s = Util.deepCopy(Ghost.DEFAULTS)
      s.scope = scope
      s.height = max(8, floor(sprite.height * 0.8))
      s.groundY = sprite.height - 1
      s.cx = sprite.width // 2
      local fit = fitArt()
      if fit then s.height, s.groundY, s.cx = fit.height, fit.groundY, fit.cx end
      if scope ~= Ghost.ALL then
        local a, b = Ghost.scopeRange(sprite, scope)
        if a then s.frames = max(2, b - a + 1) end
      end
      return s
    end

    local function loadScope(scope)
      local s = Ghost.loadSettings(Ghost.findLayer(sprite, scope))
      if not s then s = defaultsFor(scope) end
      s.scope = scope
      if not lib.clips[s.clip] then s.clip = lib.names[1] end
      S = s
      if S.clipData then
        work = Clip.fromData(Util.deepCopy(S.clipData), "layer")
        dirty = true
      else
        work = Clip.clone(lib.clips[S.clip])
        dirty = false
      end
      S.params[work.name] = S.params[work.name] or {}
    end

    local initialScope = Ghost.ALL
    if Ghost.isGhost(app.layer) then initialScope = Ghost.layerScope(app.layer) end
    loadScope(initialScope)

    -- Scheme colors ----------------------------------------------------------
    -- Color pickers c1..cN are relabelled per scheme; picks stored per scheme.
    local function slotsOf(scheme) return M.Colors.SLOTS[scheme] or M.Colors.SLOTS.Mono end

    function storeColors()
      local d = dlg.data
      S.schemeColors = S.schemeColors or {}
      local picks = {}
      for i, slot in ipairs(slotsOf(S.colorScheme)) do
        picks[slot.id] = rgbOf(d["c" .. i])
      end
      S.schemeColors[S.colorScheme] = picks
    end

    function refreshColors()
      local current = M.Colors.resolve(S.colorScheme, (S.schemeColors or {})[S.colorScheme])
      local slots = slotsOf(S.colorScheme)
      for i = 1, M.Colors.MAX_SLOTS do
        local slot = slots[i]
        if slot then
          dlg:modify { id = "c" .. i, label = slot.label, color = colorOf(current[slot.id]) }
          sec:setVisible("c" .. i, true)
        else
          sec:setVisible("c" .. i, false)
        end
      end
    end

    function onSchemeChange()
      storeColors()                      -- keep picks of the scheme being left
      S.colorScheme = dlg.data.colorScheme
      refreshColors()
      changed()
    end

    -- Build + preview --------------------------------------------------------
    local function pull()
      local d = dlg.data
      S.style, S.facing, S.thickness, S.pixelPerfect = d.style, d.facing, d.thickness, d.pixelPerfect
      S.height, S.groundY, S.cx = d.height, d.groundY, d.cx
      S.frames, S.fps, S.timing, S.fillAll, S.labels = d.frames, d.fps, d.timing, d.fillAll, d.labels
      S.opacity = d.opacity
      storeColors()
      S.travel, S.travelSpeed, S.footprints, S.groundLine = d.travel, d.travelSpeed, d.footprints, d.groundLine
      S.preset = d.preset
      S.proportions = { head = d.pHead, torso = d.pTorso, arms = d.pArms, legs = d.pLegs, bulk = d.pBulk }
      S.showArt = d.showArt
      S.params[work.name] = S.params[work.name] or {}
      for i, p in ipairs(work.params) do
        if i <= MAXP then S.params[work.name][p.id] = d["param" .. i] end
      end
    end

    local function bgFor(i)
      local first, last = Ghost.scopeRange(sprite, S.scope)
      if not first then return nil end
      local fr = first + i - 1
      if S.scope == Ghost.ALL then
        if fr > last then return nil end
      elseif fr > last then
        if not S.fillAll then return nil end
      end
      if not bgCache[fr] then bgCache[fr] = Ghost.composite(sprite, fr) end
      return bgCache[fr]
    end

    local function markLabel()
      local N = build.N
      local i, j = Clip.segmentAt(work, (cur - 1) / N)
      if not i then return "(no key poses)", nil end
      local a, b = work.marks[i], work.marks[j]
      local fa = floor(a.t * N + 0.5) + 1
      local fb = floor(b.t * N + 0.5) + 1
      return string.format("%s (f%d) -> %s (f%d)", a.name, fa, b.name, fb), i
    end

    local function updatePoseUI()
      if not build then return end
      local text, i = markLabel()
      dlg:modify { id = "segment", text = text }
      dlg:modify { id = "ease", option = (i and work.marks[i].ease) or "Linear", enabled = i ~= nil }
      dlg:modify { id = "dirtyInfo", text = dirty and ("Edited '" .. work.name .. "' (kept with ghost on Apply)") or "Clip unchanged" }
    end

    local function rebuild()
      if not alive() then return end
      build = Ghost.build(S, work, lib.rigs[work.rig])
      ghostImgs = {}
      bgCache = {}
      local toPixel = Ghost.pixelConverter(ColorMode.RGB)
      for i = 1, build.N do
        local img = Image(sprite.width, sprite.height, ColorMode.RGB)
        img:clear()
        Ghost.renderFrame(img, build, i, S, toPixel)
        ghostImgs[i] = img
      end
      if cur > build.N then cur = 1 end
      dlg:modify { id = "frame", min = 1, max = build.N, value = cur }
      updatePoseUI()
      dlg:repaint()
    end

    -- Ghost.apply writes this dialog's sprite and leaves the artist's active sprite, layer and
    -- frame as they were (#3). `clicked`: the artist pressed Apply, the one case that alerts when
    -- the sprite is closed.
    local function applyNow(clicked)
      if not alive() then
        if clicked then
          app.alert("The sprite this Ghost Reference was opened for is closed. Reopen the dialog on an open sprite.")
        end
        return
      end
      pull()
      S.clip = work.name
      S.clipData = dirty and Clip.export(work) or nil
      local err = Ghost.apply(sprite, S, work, lib.rigs[work.rig])
      if err then app.alert(err) end
      bgCache = {}
    end

    function changed()
      changeTimer:stop()
      changeTimer:start()
    end

    local function setFrame(i)
      cur = i
      dlg:modify { id = "frame", value = cur }
      updatePoseUI()
      dlg:repaint()
    end

    local function stopPlay()
      if playing then
        playing = false
        playTimer:stop()
        dlg:modify { id = "play", text = "Play" }
      end
    end

    -- Pose editing -----------------------------------------------------------
    local function editJoint(dr, x, y)
      local fr = build.frames[dr.frame]
      local sk, pose, rig = fr.sk, fr.pose, build.rig
      local id, side = dr.id, dr.side
      local s = side and sk[side]
      local ps = side and pose[side]
      local ch, val
      if id:find("knee$") then
        ch, val = "leg.thigh", Rig.angleFromDown(x - sk.hip.x, y - sk.hip.y)
      elseif id:find("ankle$") then
        ch, val = "leg.knee", ps["leg.thigh"] - Rig.angleFromDown(x - s.knee.x, y - s.knee.y)
      elseif id:find("toe$") then
        ch = "leg.foot"
        val = math.deg(math.atan(y - s.ankle.y, x - s.ankle.x)) - math.deg(math.atan(rig.bones.ankleH, rig.bones.foot))
      elseif id:find("elbow$") then
        ch, val = "arm.shoulder", Rig.angleFromDown(x - sk.shoulder.x, y - sk.shoulder.y)
      elseif id:find("hand$") then
        ch, val = "arm.elbow", Rig.angleFromDown(x - s.elbow.x, y - s.elbow.y) - ps["arm.shoulder"]
      elseif id == "neck" then
        ch, val = "torso.lean", Rig.angleFromUp(x - sk.hip.x, y - sk.hip.y)
      elseif id == "head" then
        ch, val = "head.tilt", Rig.angleFromUp(x - sk.neck.x, y - sk.neck.y) - (pose["torso.lean"] or 0)
      end
      if not ch then return end
      local old = side and ps[ch] or pose[ch]
      val = nearAngle(val, old)
      if Clip.setPoseKey(work, ch, fr.tw, side, val, build.N, S.params[work.name]) then
        dirty = true
        rebuild()
      end
    end

    local function onPaint(ev)
      local gc = ev.context
      gc.antialias = false
      local cw, ch = gc.width, gc.height
      gc.color = Color { r = 40, g = 40, b = 46 }
      gc:fillRect(Rectangle(0, 0, cw, ch))
      if not build or not alive() then return end

      local sw, sh = sprite.width, sprite.height
      local z = min(cw / sw, ch / sh)
      if z >= 1 then z = floor(z) end
      local w, h = floor(sw * z), floor(sh * z)
      local x, y = (cw - w) // 2, (ch - h) // 2
      view = { x = x, y = y, z = z }
      local dst = Rectangle(x, y, w, h)

      gc.color = Color { r = 230, g = 230, b = 230 }
      gc:fillRect(dst)
      if S.showArt ~= false then
        local bg = bgFor(cur)
        if bg then gc:drawImage(bg, bg.bounds, dst) end
      end
      local g = ghostImgs[cur]
      if g then
        gc.opacity = max(60, floor(S.opacity * 255 / 100))
        gc:drawImage(g, g.bounds, dst)
        gc.opacity = 255
      end

      -- Joint handles (when paused and zoomed enough to grab).
      if not playing and z >= 2 then
        local fr = build.frames[cur]
        for _, hnd in ipairs(Render.handles(fr.sk)) do
          local px, py = fr.P(hnd.p)
          local hx, hy = floor(x + (px + 0.5) * z), floor(y + (py + 0.5) * z)
          gc.color = Color { r = 255, g = 255, b = 255 }
          gc:fillRect(Rectangle(hx - 2, hy - 2, 5, 5))
          gc.color = hnd.side == "far" and Color { r = 200, g = 60, b = 60 } or Color { r = 20, g = 20, b = 20 }
          gc:fillRect(Rectangle(hx - 1, hy - 1, 3, 3))
        end
      end

      gc.color = Color { r = 255, g = 255, b = 255 }
      local mark = Clip.markForFrame(work, cur - 1, build.N)
      gc:fillText(string.format("%d/%d %s", cur, build.N, mark or ""), 4, 4)
    end

    local function canvasToRig(ex, ey, dr)
      local sx = (ex - view.x) / view.z - 0.5
      local sy = (ey - view.y) / view.z - 0.5
      local f = S.facing == "Left" and -1 or 1
      return (sx - dr.ox) / (f * S.height), (sy - dr.oy) / S.height
    end

    local function onMouseDown(ev)
      if ev.button ~= MouseButton.LEFT or not build then return end
      stopPlay()
      local fr = build.frames[cur]
      local best, bd = nil, max(8, view.z * 2)
      for _, hnd in ipairs(Render.handles(fr.sk)) do
        local px, py = fr.P(hnd.p)
        local hx, hy = view.x + (px + 0.5) * view.z, view.y + (py + 0.5) * view.z
        local d = math.sqrt((hx - ev.x) ^ 2 + (hy - ev.y) ^ 2)
        if d < bd then best, bd = hnd, d end
      end
      if best then drag = { id = best.id, side = best.side, ox = fr.ox, oy = fr.oy, frame = cur } end
    end

    local function onMouseMove(ev)
      if not drag then return end
      local x, y = canvasToRig(ev.x, ev.y, drag)
      editJoint(drag, x, y)
    end

    local function onMouseUp()
      if drag then
        drag = nil
        if dlg.data.autoApply then applyNow() end
      end
    end

    -- Widget sync ------------------------------------------------------------
    local function refreshParams()
      local values = S.params[work.name] or {}
      for i = 1, MAXP do
        local p = work.params[i]
        if p then
          local v = values[p.id]
          if v == nil then v = p.default end
          dlg:modify { id = "param" .. i, label = p.label, min = p.min, max = p.max, value = v }
          sec:setVisible("param" .. i, true)
        else
          sec:setVisible("param" .. i, false)
        end
      end
    end

    local function pushAll()
      local p = S.proportions
      local values = {
        style = S.style, facing = S.facing, thickness = S.thickness, pixelPerfect = S.pixelPerfect,
        height = S.height, groundY = S.groundY, cx = S.cx,
        frames = S.frames, fps = S.fps, timing = S.timing, fillAll = S.fillAll, labels = S.labels,
        colorScheme = S.colorScheme, opacity = S.opacity,
        travel = S.travel, travelSpeed = S.travelSpeed, footprints = S.footprints, groundLine = S.groundLine,
        pHead = p.head, pTorso = p.torso, pArms = p.arms, pLegs = p.legs, pBulk = p.bulk,
      }
      for id, v in pairs(values) do
        if type(v) == "boolean" then dlg:modify { id = id, selected = v }
        elseif type(v) == "string" then dlg:modify { id = id, option = v }
        else dlg:modify { id = id, value = v } end
      end
      dlg:modify { id = "preset", option = S.preset or "Custom" }
      refreshColors()
      dlg:modify { id = "clip", options = lib.names, option = work.name }
      dlg:modify { id = "clipName", text = work.name .. " custom" }
      refreshParams()
    end

    local function confirmDiscard()
      if not dirty then return true end
      local r = app.alert { title = "PixelRig", text = "Discard pose edits to '" .. work.name .. "'?",
                            buttons = { "Discard", "Cancel" } }
      return r == 1
    end

    local function onClipChange()
      local name = dlg.data.clip
      if name == work.name then return end
      if not confirmDiscard() then
        dlg:modify { id = "clip", option = work.name }
        return
      end
      pull()
      S.clip = name
      S.clipData = nil
      work = Clip.clone(lib.clips[name])
      dirty = false
      S.params[name] = S.params[name] or {}
      if S.scope == Ghost.ALL then
        S.frames, S.fps = work.frames, work.fps
        dlg:modify { id = "frames", value = S.frames }
        dlg:modify { id = "fps", value = S.fps }
      end
      dlg:modify { id = "clipName", text = name .. " custom" }
      refreshParams()
      rebuild()
    end

    local function onScopeChange()
      local scope = dlg.data.scope
      if scope == S.scope then return end
      if not confirmDiscard() then
        dlg:modify { id = "scope", option = S.scope }
        return
      end
      loadScope(scope)
      pushAll()
      rebuild()
    end

    local function onPresetChange()
      local p = Rig.preset(dlg.data.preset)
      if p then
        dlg:modify { id = "pHead", value = p.head }
        dlg:modify { id = "pTorso", value = p.torso }
        dlg:modify { id = "pArms", value = p.arms }
        dlg:modify { id = "pLegs", value = p.legs }
        dlg:modify { id = "pBulk", value = p.bulk }
      end
      changed()
    end

    local function onProportion()
      dlg:modify { id = "preset", option = "Custom" }
      changed()
    end

    local function onFit()
      if not alive() then return end
      local fit = fitArt()
      if not fit then
        app.alert("No art found: select an area or draw on a layer first.")
        return
      end
      dlg:modify { id = "height", value = fit.height }
      dlg:modify { id = "groundY", value = fit.groundY }
      dlg:modify { id = "cx", value = fit.cx }
      changed()
    end

    local function onSaveClip()
      local name = (dlg.data.clipName or ""):gsub("^%s+", ""):gsub("%s+$", "")
      if name == "" then return end
      local existing = lib.clips[name]
      if existing and existing.origin == "builtin" then
        app.alert("'" .. name .. "' is a built-in clip. Pick another name.")
        return
      end
      local data = Clip.export(work)
      data.name = name
      local dir = M.userClipsDir()
      app.fs.makeAllDirectories(dir)
      Util.writeJson(app.fs.joinPath(dir, name:gsub("[^%w%-_ ]", "_") .. ".json"), data)
      local oldName = work.name
      lib = M.loadLibrary()
      work = Clip.clone(lib.clips[name])
      S.params[name] = Util.deepCopy(S.params[oldName] or {})
      S.clip, S.clipData, dirty = name, nil, false
      dlg:modify { id = "clip", options = lib.names, option = name }
      updatePoseUI()
    end

    local function onRevert()
      work = Clip.clone(lib.clips[S.clip] or lib.clips[lib.names[1]])
      S.clipData, dirty = nil, false
      rebuild()
    end

    -- Dialog -----------------------------------------------------------------
    changeTimer = Timer { interval = 0.08, ontick = function()
      changeTimer:stop()
      if not alive() then return end
      pull()
      rebuild()
      if dlg.data.autoApply then
        applyTimer:stop()
        applyTimer:start()
      end
    end }
    applyTimer = Timer { interval = 0.4, ontick = function() applyTimer:stop(); applyNow() end }
    playTimer = Timer { interval = 1 / max(1, S.fps), ontick = function()
      if not build then return end
      setFrame(cur % build.N + 1)
    end }

    dlg = Dialog { title = "PixelRig: Ghost Reference", onclose = function()
      playTimer:stop(); changeTimer:stop(); applyTimer:stop()
    end }

    -- Without tabs (v1.3-rc6) every section is a separate page; a shorter preview keeps the
    -- dialog on screen at 200% UI scale.
    local previewH = M.Sections.hasTabs(dlg) and CH or 160
    dlg:canvas { id = "preview", width = CW, height = previewH,
                 onpaint = onPaint, onmousedown = onMouseDown, onmousemove = onMouseMove, onmouseup = onMouseUp }
    dlg:button { id = "prev", text = "<", onclick = function() stopPlay(); setFrame((cur - 2) % build.N + 1) end }
    dlg:button { id = "play", text = "Play", onclick = function()
      playing = not playing
      dlg:modify { id = "play", text = playing and "Pause" or "Play" }
      if playing then
        playTimer.interval = 1 / max(1, dlg.data.fps)
        playTimer:start()
      else
        playTimer:stop()
      end
      dlg:repaint()
    end }
    dlg:button { id = "next", text = ">", onclick = function() stopPlay(); setFrame(cur % build.N + 1) end }
    dlg:slider { id = "frame", label = "Frame", min = 1, max = max(2, S.frames), value = 1,
                 onchange = function() stopPlay(); setFrame(dlg.data.frame) end }

    sec = M.Sections.new(dlg, {
      { id = "tabMotion", text = "Motion", parts = {
        { id = "secMotion", text = "Motion" }, { id = "secClip", text = "Clip" },
        { id = "secTravel", text = "Travel" } } },
      { id = "tabBody", text = "Body", parts = { { id = "secBody", text = "Body" } } },
      { id = "tabPlace", text = "Place", parts = { { id = "secPlace", text = "Place" } } },
      { id = "tabLook", text = "Look", parts = {
        { id = "secLook", text = "Look" }, { id = "secColors", text = "Colors" } } },
      { id = "tabPose", text = "Pose", parts = { { id = "secPose", text = "Pose" } } },
    })
    local W = sec.widgets

    sec:begin("secMotion")
    W:combobox { id = "clip", label = "Clip", option = work.name, options = lib.names, onchange = onClipChange }
    W:combobox { id = "scope", label = "Range", option = S.scope, options = Ghost.scopes(sprite), onchange = onScopeChange }
    W:slider { id = "frames", label = "Frames", min = 2, max = 48, value = S.frames, onchange = changed }
    W:slider { id = "fps", label = "FPS", min = 1, max = 60, value = S.fps, onchange = changed }
    W:check { id = "fillAll", label = "Frames", text = "Loop over range", selected = S.fillAll, onclick = changed }
    W:check { id = "timing", text = "Set frame durations", selected = S.timing, onclick = changed }
    W:check { id = "labels", text = "Key pose tags", selected = S.labels, onclick = changed }
    sec:begin("secClip")
    for i = 1, MAXP do
      W:slider { id = "param" .. i, label = "Param", min = 0, max = 100, value = 0, visible = false, onchange = changed }
    end
    sec:begin("secTravel")
    W:check { id = "travel", label = "Root", text = "Travel (no foot slide)", selected = S.travel, onclick = changed }
    W:slider { id = "travelSpeed", label = "Speed %", min = 0, max = 200, value = S.travelSpeed, onchange = changed }
    W:check { id = "footprints", text = "Footprints", selected = S.footprints, onclick = changed }
    W:check { id = "groundLine", text = "Ground line", selected = S.groundLine, onclick = changed }

    sec:begin("secBody")
    W:combobox { id = "preset", label = "Preset", option = S.preset or "Default", options = presetNames(), onchange = onPresetChange }
    W:slider { id = "pHead", label = "Head %", min = 50, max = 250, value = S.proportions.head, onchange = onProportion }
    W:slider { id = "pTorso", label = "Torso %", min = 50, max = 200, value = S.proportions.torso, onchange = onProportion }
    W:slider { id = "pArms", label = "Arms %", min = 50, max = 200, value = S.proportions.arms, onchange = onProportion }
    W:slider { id = "pLegs", label = "Legs %", min = 50, max = 200, value = S.proportions.legs, onchange = onProportion }
    W:slider { id = "pBulk", label = "Bulk %", min = 50, max = 250, value = S.proportions.bulk, onchange = onProportion }
    W:combobox { id = "facing", label = "Facing", option = S.facing, options = { "Right", "Left" }, onchange = changed }

    sec:begin("secPlace")
    W:button { id = "fit", text = "Fit to art (selection, else all visible art)", onclick = onFit }
    W:slider { id = "height", label = "Height px", min = 8, max = max(16, sprite.height * 2), value = S.height, onchange = changed }
    W:slider { id = "groundY", label = "Ground Y", min = 0, max = sprite.height - 1, value = S.groundY, onchange = changed }
    W:slider { id = "cx", label = "Center X", min = 0, max = sprite.width, value = S.cx, onchange = changed }

    sec:begin("secLook")
    W:combobox { id = "style", label = "Style", option = S.style, options = Render.STYLES, onchange = changed }
    W:slider { id = "thickness", label = "Line px", min = 1, max = 8, value = S.thickness, onchange = changed }
    W:check { id = "pixelPerfect", text = "Pixel-perfect 1px lines", selected = S.pixelPerfect, onclick = changed }
    W:slider { id = "opacity", label = "Opacity %", min = 5, max = 100, value = S.opacity, onchange = changed }
    W:check { id = "showArt", text = "Show art in preview", selected = S.showArt ~= false, onclick = changed }
    sec:begin("secColors")
    W:combobox { id = "colorScheme", label = "Colors", option = S.colorScheme, options = M.Colors.SCHEMES, onchange = onSchemeChange }
    for i = 1, M.Colors.MAX_SLOTS do
      W:color { id = "c" .. i, label = "Color", color = Color { r = 0, g = 0, b = 0 }, visible = false, onchange = changed }
    end
    W:button { id = "resetColors", text = "Reset colors", onclick = function()
      S.schemeColors[S.colorScheme] = nil
      refreshColors()
      changed()
    end }

    sec:begin("secPose")
    W:label { id = "help", label = "Edit", text = "Pause, drag joints in preview." }
    W:label { id = "help2", text = "Far limbs share near curves (half cycle)." }
    W:label { id = "segment", label = "Segment", text = "" }
    W:combobox { id = "ease", label = "Spacing", option = "Linear", options = Clip.EASES, onchange = function()
      local _, i = markLabel()
      if not i then return end
      work.marks[i].ease = dlg.data.ease
      dirty = true
      rebuild()
      if dlg.data.autoApply then applyTimer:stop(); applyTimer:start() end
    end }
    W:label { id = "dirtyInfo", text = "" }
    W:entry { id = "clipName", label = "Save as", text = work.name .. " custom" }
    W:button { id = "saveClip", text = "Save clip", onclick = onSaveClip }
    W:button { id = "revert", text = "Revert clip", onclick = onRevert }
    sec:finish()

    dlg:separator()
    dlg:check { id = "autoApply", text = "Auto-apply to sprite", selected = false }
    dlg:button { id = "apply", text = "Apply", focus = true, onclick = function() applyNow(true) end }
    dlg:button { id = "remove", text = "Remove", onclick = function()
      if alive() then Ghost.remove(sprite, S.scope) end
    end }
    dlg:button { id = "close", text = "Close", onclick = function() dlg:close() end }

    refreshParams()
    refreshColors()
    pull()
    rebuild()
    dlg:show { wait = false }
  end

  return UI
end
