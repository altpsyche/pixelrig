-- Headless test: aseprite -b --script-param root=<repo> --script-param out=<dir> --script tests/headless.lua
local root = app.params.root
local out = app.params.out
local M = dofile(root .. "/modules.lua")(root)
local Clip, Rig, Ghost, Util, Render, Colors = M.Clip, M.Rig, M.Ghost, M.Util, M.Render, M.Colors

local failures = 0
local function check(cond, msg)
  if cond then print("ok   " .. msg) else print("FAIL " .. msg); failures = failures + 1 end
end

local lib = M.loadLibrary()
check(lib.clips.Run ~= nil, "library loads Run")
local rig = lib.rigs.humanoid
do
  local builtinSkipped = 0
  for _, s in ipairs(lib.skipped or {}) do
    if s.origin == "builtin" then builtinSkipped = builtinSkipped + 1 end
  end
  check(lib.skipped and builtinSkipped == 0, "library: every built-in clip loads")
end

-- Library: bad user clips are skipped with a reason; the rest still load (#4).
do
  local dir = app.fs.joinPath(out, "badclips")
  app.fs.makeAllDirectories(dir)
  for _, f in ipairs(app.fs.listFiles(dir)) do os.remove(app.fs.joinPath(dir, f)) end
  local function write(file, edit)
    local data = Util.readJson(app.fs.joinPath(root, "clips", "run.json"))
    data.name = file
    edit(data)
    Util.writeJson(app.fs.joinPath(dir, file .. ".json"), data)
  end
  write("good", function() end)
  write("norig", function(d) d.rig = nil end)
  write("missingrig", function(d) d.rig = "nope" end)
  write("brokenrig", function(d) d.rig = "brokenrig" end)
  write("nokeys", function(d) d.channels["leg.knee"].keys = nil end)
  write("badkey", function(d) d.channels["leg.knee"].keys[1] = { "x" } end)
  write("noparamchannels", function(d) d.params[1].channels = nil end)
  write("nodefault", function(d) d.params[1].default = nil end)
  write("badrepeat", function(d) d.channels["leg.knee"]["repeat"] = "x" end)
  write("boolrepeat", function(d) d.channels["leg.knee"]["repeat"] = true end)
  local function writeText(path, text)
    local f = io.open(path, "w")
    f:write(text)
    f:close()
  end
  writeText(app.fs.joinPath(dir, "notjson.json"), "{ not json")
  -- A .json entry that cannot be read as a file: a folder.
  app.fs.makeAllDirectories(app.fs.joinPath(dir, "unreadable.json"))
  -- Rigs from a test folder: the real humanoid, and a rig file that exists but cannot be read.
  local rigDir = app.fs.joinPath(out, "badrigs")
  app.fs.makeAllDirectories(rigDir)
  Util.writeJson(app.fs.joinPath(rigDir, "humanoid.json"), Util.readJson(app.fs.joinPath(root, "rigs", "humanoid.json")))
  writeText(app.fs.joinPath(rigDir, "brokenrig.json"), "[1, 2]")

  local userDir, rigsDir = M.userClipsDir, M.rigsDir
  M.userClipsDir = function() return dir end
  M.rigsDir = function() return rigDir end
  local ok, badLib = pcall(M.loadLibrary)
  M.userClipsDir, M.rigsDir = userDir, rigsDir
  check(ok, "library: loading never throws on bad user clips " .. (ok and "" or tostring(badLib)))
  if ok then
    check(badLib.clips.Run ~= nil and badLib.clips.good ~= nil, "library: good clips still load beside bad ones")
    local reasons = {}
    for _, s in ipairs(badLib.skipped or {}) do reasons[s.file] = s.reason end
    local function skipped(file, want)
      local r = reasons[file .. ".json"]
      check(badLib.clips[file] == nil and r and r:find(want, 1, true) ~= nil,
            "library: " .. file .. " skipped with reason (" .. tostring(r) .. ")")
    end
    skipped("norig", "no rig")
    skipped("missingrig", "rig 'nope' not found")
    skipped("nokeys", "channel 'leg.knee'")
    skipped("badkey", "channel 'leg.knee'")
    skipped("noparamchannels", "param 'stride'")
    skipped("nodefault", "param 'stride'")
    skipped("badrepeat", "channel 'leg.knee' has a bad repeat")
    skipped("boolrepeat", "channel 'leg.knee' has a bad repeat")
    skipped("brokenrig", "rig 'brokenrig' is unreadable")
    skipped("notjson", "not valid JSON")
    skipped("unreadable", "cannot be read")
    check(#(badLib.skipped or {}) == 11, "library: exactly the bad clips skipped (" .. #(badLib.skipped or {}) .. ")")
    local oneLine = true
    for _, s in ipairs(badLib.skipped or {}) do
      if s.reason:find("\n", 1, true) or #s.reason > 60 then oneLine = false end
    end
    check(oneLine, "library: each reason is one short line")
  end
end

local function settings(over)
  local s = Util.merge(Ghost.DEFAULTS, over or {})
  return s
end

local WHITE = app.pixelColor.rgba(255, 255, 255, 255)

-- Render a cycle build into a sheet (white bg) for visual review.
local function sheet(name, s, clip, w, h)
  w, h = w or 64, h or 64
  local build = Ghost.build(s, clip or lib.clips.Run, rig)
  local toPixel = Ghost.pixelConverter(ColorMode.RGB)
  local img = Image(w * build.N, h, ColorMode.RGB)
  img:clear(WHITE)
  for i = 1, build.N do
    local f = Image(w, h, ColorMode.RGB)
    f:clear()
    Ghost.renderFrame(f, build, i, s, toPixel)
    img:drawImage(f, Point((i - 1) * w, 0))
  end
  img:saveAs(out .. "/" .. name .. ".png")
  return build
end

-- Styles x schemes
for _, style in ipairs(Render.STYLES) do
  sheet("style_" .. style:gsub("[^%w]", "_"), settings { style = style, height = 52, groundY = 62, cx = 32 })
end
for _, scheme in ipairs(M.Colors.SCHEMES) do
  sheet("scheme_" .. scheme:gsub("[^%w]", "_"), settings { colorScheme = scheme, style = "Capsule", height = 56, groundY = 62, cx = 32 })
end

-- No jitter: hip pixel x constant in-place; pelvis y integer.
do
  local b = Ghost.build(settings { height = 48, groundY = 62, cx = 32 }, lib.clips.Run, rig)
  local same = true
  for _, fr in ipairs(b.frames) do
    local x, y = fr.P(fr.sk.hip)
    if x ~= 32 or y ~= math.floor(y) then same = false end
  end
  check(same, "hip snapped to integer pixel, fixed x in place")
end

-- Pixel-perfect removes L corners
do
  local pts = Render.pixelPerfect({ { 0, 0 }, { 1, 0 }, { 1, 1 }, { 2, 1 } })
  check(#pts == 3, "pixel-perfect drops L corner (" .. #pts .. " pts)")
end

-- Travel: positive distance, two footprints, foot plant stays put while grounded.
do
  local s = settings { travel = true, height = 40, groundY = 62, cx = 64, footprints = true, groundLine = true }
  local b = sheet("travel", s, nil, 128, 64)
  check(b.distance > 0.3 and b.distance < 2.5, string.format("travel distance per cycle %.2f body units", b.distance))
  check(#b.footprints == 2, "two footprints per cycle (" .. #b.footprints .. ")")
  -- Contact frames 1..3 share the planted near foot: screen x drift <= 1px.
  local xs = {}
  for i = 1, 3 do
    local fr = b.frames[i]
    local x = fr.P(fr.sk.near.heel)
    table.insert(xs, x)
  end
  local drift = math.max(table.unpack(xs)) - math.min(table.unpack(xs))
  check(drift <= 2.5, string.format("planted foot drift %.2f px over contact frames", drift))
end

-- Proportion presets
for _, p in ipairs(Rig.PRESETS) do
  sheet("preset_" .. p.name, settings { preset = p.name, proportions = p, style = "Capsule", height = 56, groundY = 62, cx = 32 })
end
do
  local chibi = Rig.withProportions(rig, Rig.preset("Chibi"))
  check(chibi.bones.headR > rig.bones.headR * 1.5, "chibi head bigger")
  local b = chibi.bones
  local stand = b.thigh + b.shin + b.ankleH + b.torso + b.neck + 2 * b.headR
  check(math.abs(stand - 1) < 1e-9, "proportions renormalized to height 1")
end

-- Easing: Hold after first mark freezes pose until next mark.
do
  local c = Clip.clone(lib.clips.Run)
  c.marks[1].ease = "Hold"
  local p0 = Clip.sample(c, 0.0)
  local p1 = Clip.sample(c, 0.06)
  check(math.abs(p0.near["leg.thigh"] - p1.near["leg.thigh"]) < 1e-9, "Hold keeps pose inside segment")
  c.marks[1].ease = "Ease in"
  local w = Clip.warp(c, 0.04)
  check(w < 0.04, string.format("Ease in warps time earlier (%.4f)", w))
end

-- Pose key editing: set near thigh at frame 3 -> sampled value matches.
do
  local c = Clip.clone(lib.clips.Run)
  local params = { stride = 150 }
  local tw = Clip.sample(c, 2 / 12, params).t
  Clip.setPoseKey(c, "leg.thigh", tw, "near", 20, 12, params)
  local v = Clip.sample(c, 2 / 12, params).near["leg.thigh"]
  check(math.abs(v - 20) < 1e-6, string.format("pose key edit through stride mod (%.3f)", v))
  local before = #c.channels["leg.thigh"].keys
  Clip.setPoseKey(c, "leg.thigh", (Clip.sample(c, 7 / 12).t), "far", -10, 12, params)
  check(#c.channels["leg.thigh"].keys >= before, "far edit lands in shared curve")
end

-- Sprite-level: apply to "All frames", tag scope, persistence, fit, composite, indexed.
do
  local spr = Sprite(64, 64, ColorMode.RGB)
  local art = spr.layers[1]
  art.name = "Art"
  -- draw a 10x30 block as "character"
  local img = Image(64, 64, ColorMode.RGB)
  for y = 30, 59 do for x = 27, 36 do img:drawPixel(x, y, app.pixelColor.rgba(200, 80, 40, 255)) end end
  spr.cels[1].image = img

  local fit = Ghost.fitToArt(spr, 1)
  check(fit and fit.height == 30 and fit.groundY == 59 and fit.cx == 32, "fit to art bounds")

  local s = settings { height = fit.height, groundY = fit.groundY, cx = fit.cx, frames = 12 }
  check(Ghost.apply(spr, s, lib.clips.Run, rig) == nil, "apply all frames")
  local layer = Ghost.findLayer(spr, Ghost.ALL)
  check(layer and layer.isReference, "ghost layer is reference")
  check(#spr.frames == 12, "frames added to 12")
  local loaded = Ghost.loadSettings(layer)
  check(loaded and loaded.height == 30 and loaded.cx == 32, "settings persisted on layer")

  -- Corrupt settings: anything that does not decode to an object is ignored (#4).
  local good = layer.properties("pixelrig").settings
  for _, text in ipairs({ "42", '"text"', "true", "null", "[1, 2]", "{ not json" }) do
    layer.properties("pixelrig").settings = text
    local ok, got = pcall(Ghost.loadSettings, layer)
    check(ok and got == nil, "settings " .. text .. " ignored (" .. tostring(ok and got or got) .. ")")
  end
  layer.properties("pixelrig").settings = good

  -- re-apply does not duplicate layers/tags
  Ghost.apply(spr, s, lib.clips.Run, rig)
  local ghosts, tags = 0, #spr.tags
  for _, l in ipairs(spr.layers) do if Ghost.isGhost(l) then ghosts = ghosts + 1 end end
  check(ghosts == 1 and tags == 11, "re-apply idempotent (" .. ghosts .. " ghost, " .. tags .. " tags)")

  -- tag scope
  local tag = spr:newTag(5, 10)
  tag.name = "attack"
  local s2 = settings { scope = "attack", frames = 6, style = "Capsule", height = 30, groundY = 59, cx = 32 }
  check(Ghost.apply(spr, s2, lib.clips.Run, rig) == nil, "apply tag scope")
  local tl = Ghost.findLayer(spr, "attack")
  check(tl ~= nil and tl ~= layer, "separate ghost layer for tag")
  check(tl:cel(4) == nil and tl:cel(5) ~= nil and tl:cel(10) ~= nil and tl:cel(11) == nil, "tag ghost only in tag frames")
  local scopes = Ghost.scopes(spr)
  check(#scopes == 2 and scopes[2] == "attack", "scopes exclude ghost label tags (" .. #scopes .. ")")

  local comp = Ghost.composite(spr, 1)
  check(app.pixelColor.rgbaA(comp:getPixel(30, 40)) == 255 and app.pixelColor.rgbaA(comp:getPixel(5, 5)) == 0,
        "composite has art, excludes ghost")

  Ghost.remove(spr, "attack")
  check(Ghost.findLayer(spr, "attack") == nil and Ghost.findLayer(spr, Ghost.ALL) ~= nil, "remove only that scope")
  spr:close()
end

-- Fit measures all visible art, not the active layer (#42): a body layer and a small boots
-- layer, boots active, fit to the whole body; a non-empty selection still wins.
do
  local spr = Sprite(64, 64, ColorMode.RGB)
  local body = spr.layers[1]
  body.name = "Body"
  local bodyImg = Image(64, 64, ColorMode.RGB)
  for y = 10, 49 do for x = 24, 39 do bodyImg:drawPixel(x, y, app.pixelColor.rgba(200, 80, 40, 255)) end end
  spr.cels[1].image = bodyImg
  local boots = spr:newLayer()
  boots.name = "Boots"
  local bootsImg = Image(64, 64, ColorMode.RGB)
  for y = 50, 57 do for x = 26, 33 do bootsImg:drawPixel(x, y, app.pixelColor.rgba(60, 40, 20, 255)) end end
  spr:newCel(boots, 1, bootsImg, Point(0, 0))
  app.layer = boots

  local fit = Ghost.fitToArt(spr, 1)
  check(app.layer == boots and fit and fit.height == 48 and fit.groundY == 57 and fit.cx == 32,
        "fit ignores the active layer: boots active, fits the whole body (" ..
        (fit and (fit.height .. "px, ground " .. fit.groundY .. ", cx " .. fit.cx) or "nil") .. ")")

  spr.selection = Selection(Rectangle(4, 20, 10, 12))
  fit = Ghost.fitToArt(spr, 1)
  check(fit and fit.height == 12 and fit.groundY == 31 and fit.cx == 9, "a non-empty selection still wins the fit")
  spr:close()
end

-- Apply and Remove leave the artist where they were (#3): a 3-frame sprite, frame 1 and an art
-- layer active, a 5-frame ghost that adds frames; then the same with another sprite active.
-- Apply still adds frames by default; ADR-0005 puts that behind an option (#27), which will
-- turn it on here.
do
  local other = Sprite(32, 32, ColorMode.RGB)
  other:newEmptyFrame(2); other:newEmptyFrame(3)
  local otherLayer = other.layers[1]
  local spr = Sprite(64, 64, ColorMode.RGB)
  spr:newEmptyFrame(2); spr:newEmptyFrame(3)
  local art = spr.layers[1]
  local top = spr:newLayer()
  top.name = "Top"
  app.sprite = spr; app.layer = art; app.frame = 1

  local function where()
    return string.format("sprite %s, layer %s, frame %s",
      app.sprite == spr and "spr" or (app.sprite == other and "other" or "?"),
      app.layer and app.layer.name or "nil", app.frame and app.frame.frameNumber or "nil")
  end

  local s = settings { frames = 5, height = 40, groundY = 60, cx = 32 }
  check(Ghost.apply(spr, s, lib.clips.Run, rig) == nil and #spr.frames == 5, "apply adds frames to 5")
  check(app.sprite == spr and app.layer == art and app.frame.frameNumber == 1,
        "apply keeps the active sprite, layer and frame (" .. where() .. ")")

  app.sprite = other; app.layer = otherLayer; app.frame = 3
  local s2 = settings { frames = 8, height = 40, groundY = 60, cx = 32, scope = Ghost.ALL }
  check(Ghost.apply(spr, s2, lib.clips.Run, rig) == nil and #spr.frames == 8 and #other.frames == 3,
        "apply with another sprite active writes only the given sprite")
  check(app.sprite == other and app.layer == otherLayer and app.frame.frameNumber == 3,
        "apply with another sprite active keeps it active (" .. where() .. ")")
  -- The sprite Apply wrote keeps its own layer and frame too, seen on switching back to it.
  app.sprite = spr
  check(app.layer == art and app.frame.frameNumber == 1,
        "apply with another sprite active keeps the written sprite's own layer and frame (" .. where() .. ")")
  app.sprite = other; app.layer = otherLayer; app.frame = 3
  local tag = spr:newTag(2, 3)
  tag.name = "walk"
  check(Ghost.apply(spr, settings { scope = "walk", frames = 2 }, lib.clips.Run, rig) == nil
        and Ghost.findLayer(spr, "walk") ~= nil and #other.layers == 1,
        "a new ghost layer goes on the given sprite, not the active one")
  check(app.sprite == other and app.layer == otherLayer and app.frame.frameNumber == 3,
        "a new ghost layer keeps the other sprite active (" .. where() .. ")")

  Ghost.remove(spr, "walk")
  check(Ghost.findLayer(spr, "walk") == nil and app.sprite == other and app.layer == otherLayer
        and app.frame.frameNumber == 3, "remove keeps the other sprite active (" .. where() .. ")")

  app.sprite = spr; app.layer = Ghost.findLayer(spr, Ghost.ALL); app.frame = 2
  local removed = pcall(Ghost.remove, spr, Ghost.ALL)
  check(removed and Ghost.findLayer(spr, Ghost.ALL) == nil and app.sprite == spr and app.frame.frameNumber == 2,
        "remove with its own ghost layer active keeps the sprite and frame (" .. where() .. ")")
  spr:close()
  other:close()
end

-- Apply with another sprite active is one undo step on the written sprite (#3).
do
  local other = Sprite(32, 32, ColorMode.RGB)
  local spr = Sprite(64, 64, ColorMode.RGB)
  spr:newEmptyFrame(2); spr:newEmptyFrame(3)
  app.sprite = other
  check(Ghost.apply(spr, settings { frames = 5 }, lib.clips.Run, rig) == nil
        and #spr.frames == 5 and #spr.layers == 2, "apply with another sprite active adds a layer and frames")
  app.sprite = spr
  app.command.Undo()
  check(#spr.frames == 3 and #spr.layers == 1 and #other.layers == 1,
        "one undo after apply with another sprite active restores the written sprite (" ..
        #spr.frames .. " frames, " .. #spr.layers .. " layers)")
  spr:close()
  other:close()
end

-- The ghost is visible on indexed and grayscale sprites (#5): every pixel the RGB render draws is
-- drawn, never in the transparent index, and the artist's palette is left as it was.
do
  local function count(img, visible)
    local n = 0
    if img then
      for it in img:pixels() do
        if visible(it()) then n = n + 1 end
      end
    end
    return n
  end

  local function ghostImage(spr)
    local layer = Ghost.findLayer(spr, Ghost.ALL)
    local cel = layer and layer:cel(1)
    return cel and cel.image
  end

  -- Pixels the ghost draws in RGB for settings s, and how many of them are color rgb.
  local function reference(s, rgb)
    local img = Image(48, 48, ColorMode.RGB)
    img:clear()
    Ghost.renderFrame(img, Ghost.build(s, lib.clips.Run, rig), 1, s, Ghost.pixelConverter(ColorMode.RGB))
    local exact = rgb and app.pixelColor.rgba(rgb[1], rgb[2], rgb[3], 255)
    return count(img, function(v) return app.pixelColor.rgbaA(v) > 0 end), count(img, function(v) return v == exact end)
  end

  local function setRgb(pal, i, c) pal:setColor(i, Color { r = c[1], g = c[2], b = c[3], a = 255 }) end

  local function schemeColor(scheme, part, side)
    return Colors.resolver(scheme, Colors.resolve(scheme))(part, side)
  end

  -- The palette entry at the transparent index is exactly one color the ghost draws, so before the
  -- fix that color's pixels came out transparent. Each path that turns a color into a pixel is
  -- covered: a scheme's near color, Mono's auto-darkened far color, a custom scheme pick, and the
  -- motion arc, footprint and ground line colors (Joints + arcs, travel, ground line on).
  local CUSTOM = { 200, 40, 120 }
  local extras = { style = "Joints + arcs", travel = true, footprints = true, groundLine = true }
  for _, case in ipairs({
    { name = "Near / Far near color", transparent = 0, over = { colorScheme = "Near / Far" },
      rgb = schemeColor("Near / Far", "torso", "near") },
    { name = "Mono darkened far color", transparent = 2, over = { colorScheme = "Mono" },
      rgb = schemeColor("Mono", "torso", "far") },
    { name = "custom scheme color", transparent = 0,
      over = { colorScheme = "Limbs", schemeColors = { ["Limbs"] = { legNear = CUSTOM } } }, rgb = CUSTOM },
    { name = "arc color", transparent = 0, over = extras, rgb = Colors.ARC },
    { name = "footprint color", transparent = 0, over = extras, rgb = Colors.FOOTPRINT },
    { name = "ground line color", transparent = 3, over = extras, rgb = Colors.GROUND },
  }) do
    local over = { height = 40, groundY = 46, cx = 24, frames = 4 }
    for k, v in pairs(case.over) do over[k] = v end
    local s = settings(over)
    local want, ofColor = reference(s, case.rgb)
    local label = "indexed, " .. case.name .. " at transparent index " .. case.transparent
    check(ofColor > 0, label .. ": the ghost draws that color (" .. ofColor .. " pixels)")
    local spr = Sprite(48, 48, ColorMode.INDEXED)
    spr.transparentColor = case.transparent
    local pal = spr.palettes[1]
    setRgb(pal, case.transparent, case.rgb)
    local size, before = #pal, {}
    for i = 0, size - 1 do before[i] = pal:getColor(i).rgbaPixel end
    check(Ghost.apply(spr, s, lib.clips.Run, rig) == nil, label .. ": apply")
    local drawn = count(ghostImage(spr), function(v) return v ~= case.transparent end)
    check(want > 0 and drawn == want,
          label .. ": every ghost pixel is visible, none in the transparent index (" .. drawn .. " of " .. want .. ")")
    local same = #spr.palettes[1] == size
    for i = 0, size - 1 do
      if spr.palettes[1]:getColor(i).rgbaPixel ~= before[i] then same = false end
    end
    check(same, label .. ": apply leaves the sprite palette unchanged")
    spr:close()
  end

  local s = settings { height = 40, groundY = 46, cx = 24, frames = 4 }
  local want = reference(s)

  -- A palette holding only the transparent entry has nothing visible to draw with: no error.
  local spr = Sprite(48, 48, ColorMode.INDEXED)
  spr.palettes[1]:resize(1)
  check(Ghost.apply(spr, s, lib.clips.Run, rig) == nil and #spr.palettes[1] == 1,
        "indexed: a palette with only the transparent entry applies without error, palette unchanged")
  spr:close()

  spr = Sprite(48, 48, ColorMode.GRAY)
  check(Ghost.apply(spr, s, lib.clips.Run, rig) == nil, "apply on grayscale sprite")
  local drawn = count(ghostImage(spr), function(v) return app.pixelColor.grayaA(v) > 0 end)
  check(want > 0 and drawn == want, "grayscale: every ghost pixel is visible (" .. drawn .. " of " .. want .. ")")
  spr:close()
end

print(failures == 0 and "ALL PASSED" or (failures .. " FAILED"))
if failures > 0 then error(failures .. " test(s) failed") end
