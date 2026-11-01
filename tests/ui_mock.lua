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

local function set(id, v)
  local w = widgets[id]
  w.value = v
  local cb = w.t.onchange or w.t.onclick
  if cb then cb() end
end
local function click(id) widgets[id].t.onclick() end

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

-- Timers are mocked: flush change debounce by calling ontick directly.
local spr = Sprite(64, 64, ColorMode.RGB)
local img = Image(64, 64, ColorMode.RGB)
for y = 20, 59 do for x = 28, 35 do img:drawPixel(x, y, app.pixelColor.rgba(200, 80, 40, 255)) end end
spr.cels[1].image = img
local tag = spr:newTag(1, 1)
tag.name = "idle"

local ok, err = pcall(M.UI.open)
check(ok, "dialog opens " .. tostring(err or ""))
if not ok then error(err) end

check(widgets.height.value == 40 and widgets.groundY.value == 59, "auto-fit on first open")
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
  check(widgets.clip.visible and not widgets.param1.visible and not widgets.travel.visible
        and not widgets.c1.visible and not widgets.style.visible,
        "no tabs: only the Motion section is shown")
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

-- fit
click("fit")
check(widgets.height.value == 40, "fit button")

-- apply
click("apply")
local layer = M.Ghost.findLayer(spr, M.Ghost.ALL)
check(layer ~= nil, "apply creates ghost layer")
local saved = M.Ghost.loadSettings(layer)
check(saved and saved.clipData ~= nil and saved.style == "Joints + arcs", "edited clip + settings saved on layer")

-- save clip
set("clipName", "Run test")
click("saveClip")
check(app.fs.isFile(app.fs.joinPath(out, "userclips", "Run test.json")), "clip saved to user dir")
check(widgets.clip.value == "Run test", "clip combobox switched to saved clip")

-- scope switch to tag
set("scope", "idle")
check(widgets.scope.value == "idle", "scope switched to tag")
click("apply")
check(M.Ghost.findLayer(spr, "idle") ~= nil, "tag ghost applied")

-- reopen restores settings for All frames
for k in pairs(widgets) do widgets[k] = nil end
app.layer = layer
M.UI.open()
check(widgets.style.value == "Joints + arcs" and widgets.colorScheme.value == "Segments", "reopen restores settings")

click("remove")
check(M.Ghost.findLayer(spr, M.Ghost.ALL) == nil, "remove ghost")
click("close")

print((NOTABS and "[no tabs] " or "[tabs] ") .. (failures == 0 and "ALL PASSED" or (failures .. " FAILED")))
if failures > 0 then error(failures .. " test(s) failed") end
