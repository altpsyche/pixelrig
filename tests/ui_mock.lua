-- UI smoke test with a mock Dialog/Timer (Dialog is unavailable in batch mode).
-- aseprite -b --script-param root=<repo> --script-param out=<dir> --script tests/ui_mock.lua
local root = app.params.root
local out = app.params.out

local failures = 0
local function check(cond, msg)
  if cond then print("ok   " .. msg) else print("FAIL " .. msg); failures = failures + 1 end
end

-- Mock widgets -----------------------------------------------------------------
local widgets, order = {}, {}
local mock = {}
local function add(kind, t)
  assert(t.id, kind .. " without id")
  assert(not widgets[t.id], "duplicate id " .. t.id)
  local w = { kind = kind, t = t }
  w.visible = t.visible ~= false
  if kind == "slider" then
    w.value = t.value; w.min = t.min; w.max = t.max
    assert(t.value >= t.min and t.value <= t.max, t.id .. " value out of range")
  elseif kind == "check" then w.value = t.selected or false
  elseif kind == "combobox" then
    w.value = t.option; w.options = t.options
    local found = false
    for _, o in ipairs(t.options) do if o == t.option then found = true end end
    assert(found, t.id .. " option '" .. tostring(t.option) .. "' not in options")
  elseif kind == "color" then w.value = t.color
  elseif kind == "entry" or kind == "label" then w.value = t.text
  end
  widgets[t.id] = w
  table.insert(order, t.id)
  return mock
end
for _, k in ipairs({ "canvas", "button", "slider", "combobox", "check", "color", "label", "entry", "tab" }) do
  mock[k] = function(self, t) return add(k, t) end
end
-- Like Aseprite: a separator with an id can be modified; one without is not tracked.
function mock:separator(t)
  if type(t) == "table" and t.id then return add("separator", t) end
  return self
end
function mock:endtabs(t) return add("endtabs", t) end
function mock:show() return self end
function mock:close() if self._onclose then self._onclose() end end
local repaints = 0
function mock:repaint() repaints = repaints + 1 end
function mock:modify(t)
  local w = widgets[t.id]
  assert(w, "modify unknown id " .. tostring(t.id))
  if t.options then w.options = t.options end
  if t.min then w.min = t.min end
  if t.max then w.max = t.max end
  if t.value ~= nil then w.value = t.value end
  if t.selected ~= nil then w.value = t.selected end
  if t.option ~= nil then
    w.value = t.option
    local found = false
    for _, o in ipairs(w.options or {}) do if o == t.option then found = true end end
    assert(found, t.id .. " option '" .. tostring(t.option) .. "' not in options")
  end
  if t.text ~= nil then w.value = t.text end
  if t.visible ~= nil then w.visible = t.visible end
  if t.label ~= nil then w.label = t.label end
  if t.color ~= nil then w.value = t.color end
  if w.kind == "slider" and (w.value < w.min or w.value > w.max) then
    error(t.id .. " value " .. w.value .. " outside " .. w.min .. ".." .. w.max)
  end
end
-- notabs=1: a Dialog like Aseprite v1.3-rc6 (Lua API 25), where reading tab/endtabs raises.
local NOTABS = app.params.notabs == "1"
if NOTABS then mock.tab, mock.endtabs = nil, nil end

setmetatable(mock, { __index = function(_, k)
  if NOTABS and (k == "tab" or k == "endtabs") then error("Field " .. k .. " does not exist") end
  if k == "data" then
    local d = {}
    for id, w in pairs(widgets) do d[id] = w.value end
    return d
  end
end })

Dialog = function(t) mock._onclose = t.onclose; return mock end
Timer = function(t)
  return { interval = t.interval, running = false, ontick = t.ontick,
           start = function(self) self.running = true; self.ontick() end, stop = function(self) self.running = false end }
end

local function setRaw(id, v)
  local w = widgets[id]
  w.value = v
  local cb = w.t.onchange or w.t.onclick
  if cb then cb() end
end

-- No tabs: a control is only usable if some section shows it. Switch to that section first,
-- and fail when no section does.
local function reach(id)
  if not NOTABS or id == "section" or widgets[id].visible ~= false then return end
  for _, name in ipairs(widgets.section.options) do
    setRaw("section", name)
    if widgets[id].visible then return end
  end
  check(false, "no tabs: " .. id .. " is reachable through the section picker")
end

local function set(id, v) reach(id); setRaw(id, v) end
local function click(id) reach(id); widgets[id].t.onclick() end

-- Fake graphics context
local function fakeGC(w, h)
  local gc = { width = w, height = h, antialias = true, opacity = 255, draws = 0 }
  function gc:fillRect() end
  function gc:drawImage() self.draws = self.draws + 1 end
  function gc:fillText() end
  return gc
end

-- Run --------------------------------------------------------------------------
local M = dofile(root .. "/modules.lua")(root)
M.userClipsDir = function() return app.fs.joinPath(out, "userclips") end
-- A user clip naming a rig that does not exist: skipped, and the dialog says why (#4).
local brokenClip = app.fs.joinPath(M.userClipsDir(), "broken.json")
do
  app.fs.makeAllDirectories(M.userClipsDir())
  -- Start from an empty folder: clips saved by an earlier run would make a save ask (#7).
  for _, f in ipairs(app.fs.listFiles(M.userClipsDir())) do os.remove(app.fs.joinPath(M.userClipsDir(), f)) end
  local data = M.Util.readJson(app.fs.joinPath(root, "clips", "run.json"))
  data.name, data.rig = "Broken", "nope"
  M.Util.writeJson(brokenClip, data)
end

-- Timers are mocked: flush change debounce by calling ontick directly.
local spr = Sprite(64, 64, ColorMode.RGB)
local img = Image(64, 64, ColorMode.RGB)
for y = 20, 59 do for x = 28, 35 do img:drawPixel(x, y, app.pixelColor.rgba(200, 80, 40, 255)) end end
spr.cels[1].image = img
-- A small "Boots" layer inside the body, left active: Fit must still measure the whole body (#42).
local boots = spr:newLayer()
boots.name = "Boots"
local bootsImg = Image(64, 64, ColorMode.RGB)
for y = 55, 59 do for x = 29, 34 do bootsImg:drawPixel(x, y, app.pixelColor.rgba(60, 40, 20, 255)) end end
spr:newCel(boots, 1, bootsImg, Point(0, 0))
app.layer = boots
local tag = spr:newTag(1, 1)
tag.name = "idle"

local ok, err = pcall(M.UI.open)
check(ok, "dialog opens " .. tostring(err or ""))
if not ok then error(err) end
-- Visibility right after opening, before any interaction switches section.
local openedMotionOnly = widgets.clip.visible and not (widgets.param1.visible or widgets.travel.visible
  or widgets.preset.visible or widgets.fit.visible or widgets.style.visible or widgets.c1.visible
  or widgets.ease.visible)

check(widgets.height.value == 40 and widgets.groundY.value == 59, "auto-fit on first open")
check(widgets.skipped and widgets.skipped.visible
      and widgets.skipped.value == "broken.json: rig 'nope' not found",
      "skipped clip reason shown on one line: " .. tostring(widgets.skipped and widgets.skipped.value))
check(widgets.fit.t.text == "Fit to art (selection, else all visible art)",
      "fit button says what it measures: " .. tostring(widgets.fit.t.text))
-- (in picker mode the sliders sit in the Clip section, checked below)
check((NOTABS or (widgets.param1.visible == true and widgets.param6.visible == false))
      and widgets.param1.label == "Stride %" and widgets.param1.value == 100,
      "param sliders relabelled for Run")

-- paint
local gc = fakeGC(280, 220)
widgets.preview.t.onpaint({ context = gc })
check(gc.draws >= 1, "preview paints ghost (" .. gc.draws .. " draws)")

-- slider change (debounce timer ticks synchronously in mock)
local r0 = repaints
set("height", 48)
check(repaints > r0, "slider change rebuilds preview")

-- drag: scan the canvas until a press lands on a joint handle and the move edits the pose
local before = repaints
local edited = false
for gy = 0, 219, 3 do
  for gx = 0, 279, 3 do
    widgets.preview.t.onmousedown({ x = gx, y = gy, button = MouseButton.LEFT })
    widgets.preview.t.onmousemove({ x = gx + 6, y = gy + 3 })
    widgets.preview.t.onmouseup({ x = gx + 6, y = gy + 3 })
    if repaints > before then edited = true break end
  end
  if edited then break end
end
check(edited, "dragging a joint edits pose and repaints")
check(widgets.dirtyInfo.value:find("Edited") ~= nil, "dirty state shown: " .. tostring(widgets.dirtyInfo.value))

-- easing
set("ease", "Ease out")
check(true, "ease change ok")

-- presets / proportions
set("preset", "Chibi")
check(widgets.pHead.value == 200, "preset applies proportions")
set("pLegs", 90)
check(widgets.preset.value == "Custom", "manual proportion -> Custom")

-- sections: tabs when the Dialog has them, else a section picker (#40)
if NOTABS then
  check(widgets.section ~= nil and widgets.tabMotion == nil, "no tabs: section picker instead of tabs")
  local opts = table.concat(widgets.section.options, ",")
  check(opts == "Motion,Clip,Travel,Body,Place,Look,Colors,Pose", "no tabs: one short section per part (" .. opts .. ")")
  check(openedMotionOnly, "no tabs: the dialog opens on the Motion section only")
  -- Every section shows exactly its own controls.
  local SECTIONS = {
    Motion = { "clip", "skipped", "scope", "frames", "fps", "fillAll", "timing", "labels" },
    Clip = { "param1", "param2", "param3", "param4", "param5" },
    Travel = { "travel", "travelSpeed", "footprints", "groundLine" },
    Body = { "preset", "pHead", "pTorso", "pArms", "pLegs", "pBulk", "facing" },
    Place = { "fit", "height", "groundY", "cx" },
    Look = { "style", "thickness", "pixelPerfect", "opacity", "showArt" },
    Colors = { "colorScheme", "c1", "resetColors" },
    Pose = { "help", "help2", "segment", "ease", "dirtyInfo", "clipName", "saveClip", "revert" },
  }
  for _, name in ipairs(widgets.section.options) do
    setRaw("section", name)
    local okSection = true
    for other, ids in pairs(SECTIONS) do
      for _, id in ipairs(ids) do
        if (widgets[id].visible == true) ~= (other == name) then okSection = false end
      end
    end
    check(okSection, "no tabs: section " .. name .. " shows its own controls and hides the rest")
  end
  -- Controls outside the sections stay visible whatever section is shown.
  check(widgets.frame.visible and widgets.apply.visible and widgets.preview.visible,
        "no tabs: preview, transport and Apply stay visible")
  set("section", "Clip")
  check(widgets.param1.visible and widgets.param5.visible and not widgets.param6.visible and not widgets.clip.visible,
        "no tabs: Clip shows this clip's param sliders only")
  set("section", "Colors")
  check(widgets.c1.visible and not widgets.c2.visible and not widgets.style.visible and not widgets.param1.visible,
        "no tabs: Colors shown, others hidden, color slots keep their own visibility")
else
  check(widgets.tabMotion ~= nil and widgets.section == nil, "tabs: dialog uses tabs")
end

-- color schemes: pickers relabel per scheme, picks persist per scheme
check(widgets.c1.visible and widgets.c1.label == "Body" and widgets.c2.visible == false, "Mono shows one picker")
set("colorScheme", "Limbs")
check(widgets.c5.visible and not widgets.c6.visible, "Limbs shows five pickers")
set("c2", Color { r = 1, g = 2, b = 3 })      -- near arm
set("colorScheme", "Segments")
check(widgets.c8.visible, "Segments shows eight pickers")
set("colorScheme", "Limbs")
check(widgets.c2.value.red == 1 and widgets.c2.value.blue == 3, "Limbs pick survives scheme switch")
click("resetColors")
check(widgets.c2.value.red == 255, "reset colors restores scheme defaults")
set("colorScheme", "Segments")
if NOTABS then
  set("section", "Clip")
  check(not widgets.c8.visible and widgets.param1.visible and not widgets.param6.visible,
        "no tabs: back to Clip hides colors, param sliders keep their own visibility")
end

set("style", "Joints + arcs"); set("travel", true)

-- frame transport
click("next"); click("prev"); click("play"); click("play")
check(true, "transport buttons ok")

-- fit, with the Boots layer still active
check(app.layer == boots and widgets.height.value ~= 40, "fit button starts from a changed height")
click("fit")
check(widgets.height.value == 40, "fit button")

-- apply
click("apply")
local layer = M.Ghost.findLayer(spr, M.Ghost.ALL)
check(layer ~= nil, "apply creates ghost layer")
local saved = M.Ghost.loadSettings(layer)
check(saved and saved.clipData ~= nil and saved.style == "Joints + arcs", "edited clip + settings saved on layer")

-- Another sprite active, its own layer and frame 3 (#3): Fit measures only the dialog's sprite,
-- and Apply writes the dialog's sprite without leaving the artist on it.
local other = Sprite(32, 32, ColorMode.RGB)
other:newEmptyFrame(2); other:newEmptyFrame(3)
local otherLayer = other.layers[1]
local otherImg = Image(32, 32, ColorMode.RGB)
for y = 2, 31 do for x = 0, 31 do otherImg:drawPixel(x, y, app.pixelColor.rgba(20, 200, 20, 255)) end end
other:newCel(otherLayer, 3, otherImg, Point(0, 0))
app.sprite = other; app.layer = otherLayer; app.frame = 3
local function otherActive()
  return app.sprite == other and app.layer == otherLayer and app.frame and app.frame.frameNumber == 3
end
set("height", 48)
click("fit")
check(widgets.height.value == 40 and widgets.groundY.value == 59 and widgets.cx.value == 32 and otherActive(),
      "fit with another sprite's layer and frame active measures the dialog's sprite (" ..
      widgets.height.value .. "px, ground " .. widgets.groundY.value .. ", cx " .. widgets.cx.value .. ")")
local framesBefore = #spr.frames
click("apply")
local applied = M.Ghost.loadSettings(M.Ghost.findLayer(spr, M.Ghost.ALL))
check(applied and applied.height == 40 and #other.layers == 1 and #other.frames == 3 and #spr.frames == framesBefore,
      "apply with another sprite active writes the dialog's sprite only")
check(otherActive(), "apply with another sprite active leaves that sprite, layer and frame active")
app.sprite = spr
other:close()

-- save clip
set("clipName", "Run test")
click("saveClip")
local savedFile = app.fs.joinPath(M.userClipsDir(), "^run test.json")
check(app.fs.isFile(savedFile), "clip saved to user dir")
check(widgets.clip.value == "Run test", "clip combobox switched to saved clip")

-- Saving never silently overwrites another clip (#7). app.alert is stubbed: it records the text
-- and answers with `answer` (1 = Replace, 2 = Cancel), as a real alert returns the button index.
do
  local alerts, answer = {}, 2
  rawset(app, "alert", function(t) table.insert(alerts, type(t) == "table" and t.text or t); return answer end)
  local function readText(path)
    local f = io.open(path, "r")
    local text = f and f:read("a")
    if f then f:close() end
    return text
  end
  local function hasName(name)
    for _, n in ipairs(widgets.clip.options) do if n == name then return true end end
    return false
  end
  local function saveAs(name) set("clipName", name); click("saveClip") end

  local before = readText(savedFile)
  set("ease", "Hold")
  check(widgets.dirtyInfo.value:find("Edited", 1, true) ~= nil, "spacing edit before saving again")
  saveAs("Run test")
  check(#alerts == 1 and alerts[1] == "Replace your clip 'Run test'?",
        "saving over a user clip asks first: " .. tostring(alerts[1]))
  check(readText(savedFile) == before, "cancel leaves the saved clip unchanged")
  answer = 1
  saveAs("Run test")
  check(#alerts == 2 and readText(savedFile) ~= before, "replace overwrites the saved clip")
  local shown = M.loadLibrary().clips["Run test"]
  local held = false
  for _, m in ipairs(shown and shown.marks or {}) do if m.ease == "Hold" then held = true end end
  check(shown and held and shown.file == savedFile and widgets.clip.value == "Run test"
        and widgets.dirtyInfo.value == "Clip unchanged",
        "the saved clip is the one the library shows afterwards")

  -- Names that used to share a file: each gets its own, and saving one asks nothing.
  local n0 = #alerts
  for _, name in ipairs({ "Run/test", "日本", "中文" }) do saveAs(name) end
  check(#alerts == n0, "new names save without asking (" .. (#alerts - n0) .. " alerts)")
  check(hasName("Run test") and hasName("Run/test") and hasName("日本") and hasName("中文"),
        "colliding and non-ASCII names are separate clips")

  -- A failed write shows a message instead of raising.
  local userDir = M.userClipsDir
  local notDir = app.fs.joinPath(out, "notadir")
  local f = io.open(notDir, "w"); f:write("x"); f:close()
  M.userClipsDir = function() return notDir end
  n0 = #alerts
  local okClick, err = pcall(saveAs, "Elsewhere")
  M.userClipsDir = userDir
  os.remove(notDir)
  check(okClick, "failed write does not raise " .. tostring(err or ""))
  check(#alerts == n0 + 1 and tostring(alerts[#alerts]):find("Could not save clip 'Elsewhere': ^elsewhere.json: ", 1, true) ~= nil,
        "failed write shows a message: " .. tostring(alerts[#alerts]))
  check(widgets.clip.value == "中文", "failed write keeps the current clip")
  rawset(app, "alert", nil)
end

-- scope switch to tag
set("scope", "idle")
check(widgets.scope.value == "idle", "scope switched to tag")
click("apply")
check(M.Ghost.findLayer(spr, "idle") ~= nil, "tag ghost applied")

-- reopen restores settings for All frames
os.remove(brokenClip)
for k in pairs(widgets) do widgets[k] = nil end
app.layer = layer
M.UI.open()
check(widgets.style.value == "Joints + arcs" and widgets.colorScheme.value == "Segments", "reopen restores settings")
check(not widgets.skipped.visible, "no skipped line when every clip loads")

-- Corrupt settings on the ghost layer: the dialog still opens, with defaults (#4).
local function reopenWith(text)
  layer.properties("pixelrig").settings = text
  click("close")
  for k in pairs(widgets) do widgets[k] = nil end
  app.layer = layer
  local opened, why = pcall(M.UI.open)
  return opened, why
end
for _, text in ipairs({ "[1, 2]", "42", "null" }) do
  local opened, why = reopenWith(text)
  check(opened and widgets.style.value == M.Ghost.DEFAULTS.style and widgets.clip.value == "Run",
        "corrupt settings " .. text .. " -> opens with defaults " .. tostring(why or ""))
end
local opened, why = reopenWith(json.encode({ style = "Capsule", clip = "Run", clipData = { name = "Run" } }))
check(opened and widgets.style.value == "Capsule" and widgets.dirtyInfo.value == "Clip unchanged",
      "corrupt edited clip in settings -> library clip " .. tostring(why or ""))

-- Drag every joint on a clip without leg.thigh or arm.shoulder: nothing raises (#4).
do
  local data = M.Util.readJson(app.fs.joinPath(root, "clips", "run.json"))
  data.name = "No upper limbs"
  data.channels["leg.thigh"], data.channels["arm.shoulder"] = nil, nil
  local file = app.fs.joinPath(M.userClipsDir(), "no-upper-limbs.json")
  M.Util.writeJson(file, data)
  reopenWith(json.encode({ clip = "No upper limbs" }))
  os.remove(file)
  check(widgets.clip.value == "No upper limbs", "clip without thigh and shoulder channels loads")

  local handles = M.Render.handles
  local errors, dragged = {}, 0
  local ids = {}
  for _, h in ipairs(handles({ near = {}, far = {} })) do table.insert(ids, h.id) end
  for _, id in ipairs(ids) do
    click("revert") -- a fresh clip each time: dragging a knee or elbow would add the missing channel
    -- Offer only this handle, find where the preview draws it, then press, drag and release there.
    M.Render.handles = function(sk)
      for _, h in ipairs(handles(sk)) do
        if h.id == id then return { h } end
      end
      return {}
    end
    local spot
    local g = fakeGC(widgets.preview.t.width, widgets.preview.t.height)
    function g:fillRect(r) if r.width == 5 and not spot then spot = { x = r.x + 2, y = r.y + 2 } end end
    widgets.preview.t.onpaint({ context = g })
    if spot then
      local r0 = repaints
      local okDrag, e = pcall(function()
        widgets.preview.t.onmousedown({ x = spot.x, y = spot.y, button = MouseButton.LEFT })
        widgets.preview.t.onmousemove({ x = spot.x + 5, y = spot.y + 4 })
        widgets.preview.t.onmouseup({ x = spot.x + 5, y = spot.y + 4 })
      end)
      if not okDrag then table.insert(errors, id .. ": " .. tostring(e)) end
      if repaints > r0 then dragged = dragged + 1 end
    else
      table.insert(errors, id .. ": handle not drawn")
    end
  end
  M.Render.handles = handles
  check(#errors == 0, "dragging any joint on a clip missing channels does not raise " .. table.concat(errors, "; "))
  check(dragged == #ids, string.format("every joint drags (%d of %d)", dragged, #ids))
end

click("remove")
check(M.Ghost.findLayer(spr, M.Ghost.ALL) == nil, "remove ghost")
click("close")

-- The dialog's sprite closed (#3): Apply says so, auto-apply stays silent.
do
  for k in pairs(widgets) do widgets[k] = nil end
  local gone = Sprite(32, 32, ColorMode.RGB)
  app.sprite = gone
  M.UI.open()
  gone:close()
  app.sprite = spr
  local alerts = {}
  rawset(app, "alert", function(t) table.insert(alerts, type(t) == "table" and t.text or t) end)
  set("autoApply", true)
  set("ease", "Ease in")
  local autoAlerts = #alerts
  click("apply")
  rawset(app, "alert", nil)
  check(autoAlerts == 0, "auto-apply on a closed sprite stays silent (" .. autoAlerts .. " alerts)")
  check(#alerts == 1 and tostring(alerts[1]):find("is closed", 1, true) ~= nil,
        "apply on a closed sprite says so: " .. tostring(alerts[1]))
  click("close")
end

print((NOTABS and "[no tabs] " or "[tabs] ") .. (failures == 0 and "ALL PASSED" or (failures .. " FAILED")))
if failures > 0 then error(failures .. " test(s) failed") end
