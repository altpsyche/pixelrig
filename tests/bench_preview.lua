-- Preview timing harness (#8): how long the Ghost Reference preview takes on a large sprite.
-- aseprite -b --script-param root=<repo> [--script-param moves=N] --script tests/bench_preview.lua
--
-- For a 1024x1024 RGB and an indexed sprite with a full-canvas backdrop and a character layer, it
-- prints the time of one art composite (Ghost.composite), then opens the dialog through a mock
-- Dialog (Dialog is nil in batch mode), presses a joint handle and drags it over N mouse moves,
-- painting the preview after each move as Aseprite does. Each line names the color mode, the
-- seconds, and how many ghost frames were rendered and art composites made. A checksum of the
-- composite's pixels lets two runs, before and after a change, show the preview art is identical.
-- Timings are os.clock() CPU seconds; not a test, nothing fails. tools/test.sh does not run it.
local root = app.params.root
local MOVES = tonumber(app.params.moves or "") or 10
local SIZE = 1024

-- Mock dialog: just enough of Dialog and Timer for UI.open. Timers tick when started.
local widgets = {}
local mock = {}
local function add(kind, t)
  widgets[t.id] = { kind = kind, t = t, value = t.value or t.selected or t.option or t.color or t.text }
  if kind == "check" then widgets[t.id].value = t.selected or false end
  return mock
end
for _, k in ipairs({ "canvas", "button", "slider", "combobox", "check", "color", "label", "entry" }) do
  mock[k] = function(self, t) return add(k, t) end
end
function mock:separator(t) if type(t) == "table" and t.id then add("separator", t) end return self end
function mock:show() return self end
function mock:close() if self._onclose then self._onclose() end end
function mock:repaint() end
function mock:modify(t)
  local w = widgets[t.id]
  for _, k in ipairs({ "value", "option", "selected" }) do
    if t[k] ~= nil then w.value = t[k] end
  end
  if t.text ~= nil and w.kind ~= "check" then w.value = t.text end
  if t.color ~= nil then w.value = t.color end
end
setmetatable(mock, { __index = function(_, k)
  if k == "data" then
    local d = {}
    for id, w in pairs(widgets) do d[id] = w.value end
    return d
  end
end })
Dialog = function(t) mock._onclose = t.onclose; return mock end
Timer = function(t)
  return { interval = t.interval, ontick = t.ontick,
           start = function(self) self.ontick() end, stop = function() end }
end

local function set(id, v)
  widgets[id].value = v
  local cb = widgets[id].t.onchange or widgets[id].t.onclick
  if cb then cb() end
end

local function fakeGC(w, h)
  local gc = { width = w, height = h }
  function gc:fillRect() end
  function gc:drawImage() end
  function gc:fillText() end
  return gc
end

local M = dofile(root .. "/modules.lua")(root)
local Ghost = M.Ghost

-- Count ghost frame renders and art composites by wrapping them; UI calls them through Ghost.
local counts = { render = 0, composite = 0 }
local renderFrame, composite = Ghost.renderFrame, Ghost.composite
Ghost.renderFrame = function(...) counts.render = counts.render + 1; return renderFrame(...) end
Ghost.composite = function(...) counts.composite = counts.composite + 1; return composite(...) end

local function checksum(img)
  local h = 0
  for it in img:pixels() do h = (h * 31 + it()) & 0xffffffff end
  return string.format("%08x", h)
end

-- A 1024x1024 sprite: a full-canvas backdrop and a 64x128 character, in colorMode.
local function makeSprite(colorMode)
  local spr = Sprite(SIZE, SIZE, colorMode)
  local function px(r, g, b)
    if colorMode == ColorMode.INDEXED then return (r + g + b) % 200 + 1 end
    return app.pixelColor.rgba(r, g, b, 255)
  end
  if colorMode == ColorMode.INDEXED then
    local pal = Palette(256)
    for i = 0, 255 do pal:setColor(i, Color { r = i, g = (i * 7) % 256, b = (i * 13) % 256, a = i == 0 and 0 or 255 }) end
    spr:setPalette(pal)
  end
  local back = Image(SIZE, SIZE, colorMode)
  for y = 0, SIZE - 1 do
    for x = 0, SIZE - 1 do back:drawPixel(x, y, px(x % 97, y % 89, (x * y) % 83)) end
  end
  spr.cels[1].image = back
  local char = spr:newLayer()
  local img = Image(64, 128, colorMode)
  for y = 0, 127 do for x = 0, 63 do img:drawPixel(x, y, px(200, 80 + y % 40, 40 + x)) end end
  spr:newCel(char, 1, img, Point(480, 860))
  app.sprite = spr
  return spr
end

local function bench(name, colorMode)
  local spr = makeSprite(colorMode)
  local t0 = os.clock()
  local comp = composite(spr, 1)
  local tComp = os.clock() - t0
  print(string.format("%s composite: %.3f s (checksum %s)", name, tComp, checksum(comp)))

  for k in pairs(widgets) do widgets[k] = nil end
  M.UI.open()
  -- A 128px character standing at the bottom middle, as the character layer sits.
  set("height", 128); set("groundY", 987); set("cx", 512)
  local canvas = widgets.preview.t
  local gc = fakeGC(canvas.width, canvas.height)
  canvas.onpaint({ context = gc })

  -- Press each spot of the canvas until one grabs a handle: the first move that renders a frame.
  local grabbed
  for gy = 0, canvas.height - 1, 2 do
    for gx = 0, canvas.width - 1, 2 do
      canvas.onmousedown({ x = gx, y = gy, button = MouseButton.LEFT })
      local before = counts.render + counts.composite
      canvas.onmousemove({ x = gx, y = gy })
      canvas.onpaint({ context = gc })
      if counts.render + counts.composite > before then grabbed = { x = gx, y = gy } break end
      canvas.onmouseup({ x = gx, y = gy })
    end
    if grabbed then break end
  end
  if not grabbed then print(name .. " drag: no joint handle found"); return end

  counts.render, counts.composite = 0, 0
  t0 = os.clock()
  for i = 1, MOVES do
    canvas.onmousemove({ x = grabbed.x + (i % 3), y = grabbed.y + (i % 2) })
    canvas.onpaint({ context = gc })
  end
  local tDrag = os.clock() - t0
  canvas.onmouseup({ x = grabbed.x, y = grabbed.y })
  print(string.format("%s drag: %d moves %.3f s, %.3f s per move, %d frames rendered, %d composites",
    name, MOVES, tDrag, tDrag / MOVES, counts.render, counts.composite))
  mock:close()
  spr:close()
end

bench("RGB 1024x1024", ColorMode.RGB)
bench("Indexed 1024x1024", ColorMode.INDEXED)
