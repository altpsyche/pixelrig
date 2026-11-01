-- PixelRig: animation toolkit for Aseprite. Module: Ghost Reference.

local function loadModules(dir)
  local function mod(name) return dofile(app.fs.joinPath(dir, name .. ".lua")) end
  local Util = mod("util")
  local Clip = mod("clip")
  local Rig = mod("rig")
  Clip.readJson, Rig.readJson = Util.readJson, Util.readJson
  local Render = mod("render")
  local Ghost = mod("ghost")(Clip, Rig, Render)
  return Clip, Rig, Render, Ghost
end

local function loadLibrary(dir, Clip, Rig)
  local clips, names, rigs = {}, {}, {}
  local clipsDir = app.fs.joinPath(dir, "clips")
  for _, file in ipairs(app.fs.listFiles(clipsDir)) do
    if file:match("%.json$") then
      local clip = Clip.load(app.fs.joinPath(clipsDir, file))
      if not rigs[clip.rig] then
        rigs[clip.rig] = Rig.load(app.fs.joinPath(dir, "rigs", clip.rig .. ".json"))
      end
      clips[clip.name] = clip
      table.insert(names, clip.name)
    end
  end
  table.sort(names)
  return clips, names, rigs
end

local function openDialog(dir)
  local sprite = app.sprite
  if not sprite then
    app.alert("Open or create a sprite first.")
    return
  end

  local Clip, Rig, Render, Ghost = loadModules(dir)
  local clips, names, rigs = loadLibrary(dir, Clip, Rig)
  if #names == 0 then
    app.alert("No clips found in " .. app.fs.joinPath(dir, "clips"))
    return
  end

  local dlg, timer
  local current = clips[names[1]]

  local function paramId(clip, p) return "p_" .. clip.name .. "_" .. p.id end

  local function alive()
    return pcall(function() return sprite.width end)
  end

  local function regenerate()
    if not alive() then return end
    if app.sprite ~= sprite then return end
    local d = dlg.data
    local clip = clips[d.clip]
    local params = {}
    for _, p in ipairs(clip.params) do params[p.id] = d[paramId(clip, p)] end
    Ghost.generate(sprite, {
      clip = clip, rig = rigs[clip.rig], params = params,
      height = d.height, groundY = d.groundY, cx = d.cx,
      facing = d.facing == "Left" and -1 or 1,
      style = d.style, thickness = d.thickness,
      frames = d.frames, fps = d.fps,
      timing = d.timing, fillAll = d.fillAll, labels = d.labels,
      color = d.color, opacity = d.opacity,
    })
  end

  local function schedule()
    if dlg and dlg.data.live then
      timer:stop()
      timer:start()
    end
  end

  timer = Timer { interval = 0.15, ontick = function() timer:stop(); regenerate() end }

  local function onClipChange()
    current = clips[dlg.data.clip]
    for _, name in ipairs(names) do
      for _, p in ipairs(clips[name].params) do
        dlg:modify { id = paramId(clips[name], p), visible = (clips[name] == current) }
      end
    end
    dlg:modify { id = "frames", value = current.frames }
    dlg:modify { id = "fps", value = current.fps }
    schedule()
  end

  local H = sprite.height
  local defHeight = math.max(8, math.floor(H * 0.8))

  dlg = Dialog { title = "Ghost Reference", onclose = function() timer:stop() end }
  dlg:combobox { id = "clip", label = "Motion", option = names[1], options = names, onchange = onClipChange }
  dlg:combobox { id = "style", label = "Style", option = Render.STYLES[1], options = Render.STYLES, onchange = schedule }
  dlg:combobox { id = "facing", label = "Facing", option = "Right", options = { "Right", "Left" }, onchange = schedule }

  dlg:separator { text = "Placement" }
  dlg:slider { id = "height", label = "Height px", min = 8, max = math.max(16, H * 2), value = defHeight, onchange = schedule }
  dlg:slider { id = "groundY", label = "Ground Y", min = 0, max = H, value = H - 1, onchange = schedule }
  dlg:slider { id = "cx", label = "Center X", min = 0, max = sprite.width, value = sprite.width // 2, onchange = schedule }
  dlg:slider { id = "thickness", label = "Line px", min = 1, max = 8, value = math.max(1, defHeight // 48), onchange = schedule }

  dlg:separator { text = "Timing" }
  dlg:slider { id = "frames", label = "Frames", min = 2, max = 48, value = current.frames, onchange = schedule }
  dlg:slider { id = "fps", label = "FPS", min = 1, max = 60, value = current.fps, onchange = schedule }
  dlg:check { id = "timing", text = "Set frame durations", selected = #sprite.frames == 1, onclick = schedule }
  dlg:check { id = "fillAll", text = "Loop over all frames", selected = true, onclick = schedule }

  dlg:separator { text = "Motion" }
  for _, name in ipairs(names) do
    local clip = clips[name]
    for _, p in ipairs(clip.params) do
      dlg:slider { id = paramId(clip, p), label = p.label, min = p.min, max = p.max, value = p.default,
                   visible = (clip == current), onchange = schedule }
    end
  end

  dlg:separator { text = "Look" }
  dlg:color { id = "color", label = "Color", color = Color { r = 0, g = 170, b = 255 }, onchange = schedule }
  dlg:slider { id = "opacity", label = "Opacity %", min = 5, max = 100, value = 40, onchange = schedule }
  dlg:check { id = "labels", text = "Label key poses (tags)", selected = true, onclick = schedule }
  dlg:check { id = "live", text = "Live preview", selected = true }

  dlg:button { id = "gen", text = "Generate", onclick = regenerate }
  dlg:button { id = "remove", text = "Remove ghost", onclick = function()
    if alive() then Ghost.remove(sprite) end
  end }
  dlg:button { id = "close", text = "Close", onclick = function() dlg:close() end }

  dlg:show { wait = false }
  regenerate()
end

function init(plugin)
  plugin:newCommand {
    id = "AnimGhostReference",
    title = "Ghost Reference...",
    group = "view_animation_helpers",
    onenabled = function() return app.sprite ~= nil end,
    onclick = function() openDialog(plugin.path) end,
  }
end

function exit(plugin) end
