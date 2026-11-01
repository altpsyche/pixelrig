-- Pure-Lua tests: plain Lua 5.4, no Aseprite (#12). CI runs them through tools/check.sh.
--   lua5.4 tests/pure.lua [-v]     (from any folder, by path; -v prints passing checks too)
-- Covers the modules that need no `app`: clip sampling, easing and key edits, rig solving and
-- grounding, stamps, colors, and render output through a put callback. Aseprite's `json` global
-- is absent here, so a minimal decoder below reads the clip and rig files; it lives in this test
-- only, never in shipped code.

local root = ((arg and arg[0] or ""):match("^(.*)[/\\][^/\\]*$") or ".") .. "/.."
local verbose = arg and arg[1] == "-v"

local failures, passes = 0, 0
local function check(cond, msg)
  if cond then
    passes = passes + 1
    if verbose then print("ok   " .. msg) end
  else
    failures = failures + 1
    print("FAIL " .. msg)
  end
end
local function near(a, b, eps) return type(a) == "number" and math.abs(a - b) < (eps or 1e-9) end

-- Minimal JSON decoder (test only) -------------------------------------------

local function decode(text)
  local pos = 1
  local function ws() pos = text:find("[^ \t\r\n]", pos) or #text + 1 end
  local function fail(what) error(("json: %s at %d"):format(what, pos), 0) end
  local value
  local ESC = { b = "\b", f = "\f", n = "\n", r = "\r", t = "\t" }
  local function str()
    local out = {}
    pos = pos + 1
    while true do
      local c = text:sub(pos, pos)
      if c == "" then fail("unterminated string") end
      if c == '"' then pos = pos + 1; return table.concat(out) end
      if c == "\\" then
        local e = text:sub(pos + 1, pos + 1)
        if e == "u" then
          out[#out + 1] = utf8.char(tonumber(text:sub(pos + 2, pos + 5), 16))
          pos = pos + 6
        else
          out[#out + 1] = ESC[e] or e
          pos = pos + 2
        end
      else
        out[#out + 1] = c
        pos = pos + 1
      end
    end
  end
  function value()
    ws()
    local c = text:sub(pos, pos)
    if c == "{" then
      local t = {}
      pos = pos + 1; ws()
      if text:sub(pos, pos) == "}" then pos = pos + 1; return t end
      while true do
        ws()
        if text:sub(pos, pos) ~= '"' then fail("expected key") end
        local k = str()
        ws()
        if text:sub(pos, pos) ~= ":" then fail("expected ':'") end
        pos = pos + 1
        t[k] = value()
        ws()
        local d = text:sub(pos, pos)
        pos = pos + 1
        if d == "}" then return t end
        if d ~= "," then fail("expected ',' or '}'") end
      end
    elseif c == "[" then
      local t, n = {}, 0
      pos = pos + 1; ws()
      if text:sub(pos, pos) == "]" then pos = pos + 1; return t end
      while true do
        n = n + 1
        t[n] = value()
        ws()
        local d = text:sub(pos, pos)
        pos = pos + 1
        if d == "]" then return t end
        if d ~= "," then fail("expected ',' or ']'") end
      end
    elseif c == '"' then return str()
    elseif text:find("^true", pos) then pos = pos + 4; return true
    elseif text:find("^false", pos) then pos = pos + 5; return false
    elseif text:find("^null", pos) then pos = pos + 4; return nil
    end
    local num = text:match("^-?%d+%.?%d*[eE]?[-+]?%d*", pos)
    if not num or num == "" then fail("unexpected '" .. c .. "'") end
    pos = pos + #num
    return tonumber(num) or fail("bad number")
  end
  local v = value()
  ws()
  if pos <= #text then fail("trailing text") end
  return v
end

local function readJson(path)
  local f = assert(io.open(path, "r"))
  local text = f:read("a")
  f:close()
  return decode(text)
end

do
  local v = decode('{"a": [1, -2.5, 3e2], "b": {"c": "x\\"y\\u0041"}, "d": true, "e": [], "f": null}')
  check(decode("[1, null, 3]")[3] == 3, "test JSON decoder keeps positions after a null")
  check(v.a[1] == 1 and v.a[2] == -2.5 and v.a[3] == 300 and v.b.c == 'x"yA' and v.d == true
        and #v.e == 0 and v.f == nil, "test JSON decoder reads objects, arrays, numbers, strings")
  check(not pcall(decode, "{ not json"), "test JSON decoder rejects bad JSON")
end

-- Modules ---------------------------------------------------------------------

local function mod(name) return dofile(root .. "/" .. name .. ".lua") end
local Clip = mod("clip")
local Rig = mod("rig")
local Stamps = mod("stamps")
local Colors = mod("colors")
local Render = mod("render")(Stamps)
Clip.decode, Rig.readJson = decode, readJson

check(_VERSION == "Lua 5.4", "runs on Lua 5.4, as Aseprite embeds (" .. _VERSION .. ")")
check(app == nil and json == nil, "no Aseprite globals: app and json are absent")

local run = Clip.load(root .. "/clips/run.json", "builtin")
local humanoid = Rig.load(root .. "/rigs/humanoid.json")
check(run.name == "Run" and run.origin == "builtin", "Clip.load reads clips/run.json")

-- A small clip built in code, so the expected values are worked out by hand.
local function clip(over)
  local data = {
    name = "T", rig = "humanoid", interp = "linear",
    channels = { ["a.x"] = { keys = { { 0.5, 10 }, { 0, 0 } } } },
  }
  for k, v in pairs(over or {}) do data[k] = v end
  return Clip.fromData(data, "test")
end

-- Clip: loading and checks ----------------------------------------------------

do
  local c = clip()
  check(c.channels["a.x"].keys[1][1] == 0, "fromData sorts keys by time")
  check(c.sideOffset == 0.5 and #c.sided == 0 and #c.params == 0 and #c.marks == 0,
        "fromData fills defaults: sideOffset 0.5, no sided, params or marks")
  local function reason(data)
    local ok, err = pcall(Clip.fromData, data)
    return not ok and err or nil
  end
  check(reason({ rig = "humanoid" }) == "no name", "check: no name")
  check(reason({ name = "x" }) == "no rig named", "check: no rig")
  check(reason({ name = "x", rig = "r", channels = { c = { keys = { { "a", 1 } } } } }) == "channel 'c' has a bad key",
        "check: bad key")
  check(reason({ name = "x", rig = "r", channels = { c = { keys = {}, ["repeat"] = true } } })
        == "channel 'c' has a bad repeat", "check: bad repeat")
  check(reason({ name = "x", rig = "r", params = { { id = "p", channels = {}, min = 0, max = 1 } } })
        == "param 'p' has no default", "check: param without default")
  check(reason({ name = "x", rig = "r", marks = { { name = "m" } } }) == "mark 1 has no time", "check: mark without time")
  local ok, err = pcall(Clip.load, root .. "/tests/no-such-clip.json")
  check(not ok and err == "cannot be read", "load: a missing file cannot be read")
  local e = Clip.export(Clip.clone(run))
  check(e.origin == nil and e.name == "Run", "export drops the runtime origin")
end

-- Clip: sampling --------------------------------------------------------------

do
  local c = clip()
  local function at(t) return Clip.sample(c, t)["a.x"] end
  check(near(at(0), 0) and near(at(0.5), 10), "linear: exact on keys")
  check(near(at(0.25), 5), "linear: halfway between keys")
  check(near(at(0.75), 5), "linear: wraps from the last key back to the first")
  check(near(Clip.sample(clip { channels = { ["a.x"] = { keys = { { 0.3, 7 } } } } }, 0.9)["a.x"], 7),
        "one key holds its value all cycle")

  local r = clip { channels = { ["a.x"] = { ["repeat"] = 2, keys = { { 0, 0 }, { 0.5, 10 } } } } }
  check(near(Clip.sample(r, 0.25)["a.x"], 10) and near(Clip.sample(r, 0.5)["a.x"], 0),
        "repeat 2 plays the channel twice per cycle")

  local s = clip { interp = "smooth", channels = { ["a.x"] = { keys = { { 0, 0 }, { 0.25, 4 }, { 0.5, 10 }, { 0.75, 3 } } } } }
  local smoothOnKeys = true
  for _, k in ipairs(s.channels["a.x"].keys) do
    if not near(Clip.sample(s, k[1])["a.x"], k[2], 1e-9) then smoothOnKeys = false end
  end
  check(smoothOnKeys, "smooth (Catmull-Rom) passes through every key")
  local v = Clip.sample(s, 0.375)["a.x"]
  check(v > 4 and v < 10 and not near(v, 7, 1e-6), string.format("smooth curves between keys (%.4f)", v))
  local lin = Clip.clone(s)
  lin.interp = "linear"
  check(near(Clip.sample(lin, 0.375)["a.x"], 7) and not near(v, 7, 1e-6), "linear interp: straight between the same keys")

  local sided = clip {
    sided = { "leg" }, sideOffset = 0.25,
    channels = { ["leg.x"] = { keys = { { 0, 0 }, { 0.5, 10 } } }, ["body.y"] = { keys = { { 0, 2 } } } },
  }
  local p = Clip.sample(sided, 0.1)
  check(Clip.isSided(sided, "leg.x") and not Clip.isSided(sided, "body.y"), "isSided by channel prefix")
  check(near(p.near["leg.x"], 2) and near(p.far["leg.x"], 7) and p["leg.x"] == nil,
        "sided channel: far side samples at t + sideOffset")
  check(near(p["body.y"], 2) and p.near["body.y"] == nil, "unsided channel sits on the pose itself")

  local params = clip {
    params = {
      { id = "s", op = "scale", min = 0, max = 200, default = 50, channels = { "a.x" } },
      { id = "a", op = "add", min = -5, max = 5, default = 0, channels = { "a.x" } },
    },
  }
  check(near(Clip.sample(params, 0.5)["a.x"], 5), "scale param applies its default")
  check(near(Clip.sample(params, 0.5, { s = 200, a = 3 })["a.x"], 23), "scale then add, from given values")

  local lift = clip { channels = { ["root.lift"] = { keys = { { 0, -1 } } } } }
  check(Clip.sample(lift, 0)["root.lift"] == 0, "negative root.lift clamps to 0")

  local pr = Clip.sample(run, 0)
  check(type(pr.near["leg.thigh"]) == "number" and type(pr.far["leg.thigh"]) == "number"
        and type(pr["torso.lean"]) == "number" and pr["root.lift"] >= 0, "Run samples every channel")
  check(near(pr.near["leg.thigh"], 30) and near(Clip.sample(run, 0.5).far["leg.thigh"], 30, 1e-6),
        "Run: near thigh on its first key; far side half a cycle later")
end

-- Clip: easing ----------------------------------------------------------------

do
  local function eased(kind)
    return clip { marks = { { t = 0, name = "a", ease = kind }, { t = 0.5, name = "b" } } }
  end
  local i, j, t0, t1 = Clip.segmentAt(eased(), 0.6)
  check(i == 2 and j == 1 and near(t0, 0.5) and near(t1, 1), "segmentAt: last mark wraps to the first")
  check(Clip.segmentAt(clip(), 0.3) == nil, "segmentAt: nil without marks")
  check(near(Clip.warp(clip(), 0.3), 0.3), "warp: unchanged without marks")
  check(near(Clip.warp(eased("Linear"), 0.1), 0.1), "warp: Linear unchanged")
  check(near(Clip.warp(eased("Ease in"), 0.25), 0.125), "warp: Ease in at mid-segment is u^2")
  check(near(Clip.warp(eased("Ease out"), 0.25), 0.375), "warp: Ease out at mid-segment is 1-(1-u)^2")
  check(near(Clip.warp(eased("Ease in-out"), 0.125), 0.0625) and near(Clip.warp(eased("Ease in-out"), 0.375), 0.4375),
        "warp: Ease in-out eases both halves")
  check(near(Clip.warp(eased("Hold"), 0.4), 0) and near(Clip.warp(eased("Hold"), 0.5), 0.5),
        "warp: Hold freezes until the next mark")
  local h = eased("Hold")
  check(near(Clip.sample(h, 0.3)["a.x"], 0) and near(Clip.sample(h, 0.3).t, 0), "Hold keeps the pose inside its segment")
  check(near(Clip.warp(eased("Ease in"), 0.75), 0.75), "warp: a mark with no ease is linear")
end

-- Clip: key edits -------------------------------------------------------------

do
  local c = clip()
  check(Clip.setPoseKey(c, "a.x", 0.25, nil, 8, 4), "setPoseKey inserts a key")
  local keys = c.channels["a.x"].keys
  check(#keys == 3 and near(keys[2][1], 0.25) and keys[2][2] == 8 and near(Clip.sample(c, 0.25)["a.x"], 8),
        "inserted key is sorted in and sampled back")
  Clip.setPoseKey(c, "a.x", 0.3, nil, 9, 4)
  check(#keys == 3 and near(keys[2][1], 0.3) and keys[2][2] == 9, "a key within half a frame is replaced and snapped")
  Clip.setPoseKey(c, "a.x", 0.98, nil, 1, 4)
  check(#keys == 3 and near(keys[3][1], 0.98) and keys[3][2] == 1 and near(keys[1][1], 0.3),
        "a key within half a frame across the cycle end is replaced")

  local p = clip { params = { { id = "s", op = "scale", min = 0, max = 200, default = 100, channels = { "a.x" } } } }
  Clip.setPoseKey(p, "a.x", 0.25, nil, 20, 4, { s = 200 })
  check(near(Clip.sample(p, 0.25, { s = 200 })["a.x"], 20) and near(Clip.sample(p, 0.25)["a.x"], 10),
        "edit through a scale param stores the raw value")
  check(Clip.setPoseKey(p, "a.x", 0.25, nil, 20, 4, { s = 0 }) == false, "scale 0 cannot be inverted: edit refused")

  local s = clip { sided = { "leg" }, sideOffset = 0.5, channels = { ["leg.x"] = { keys = { { 0, 0 } } } } }
  Clip.setPoseKey(s, "leg.x", 0.25, "far", 6, 8)
  check(near(Clip.sample(s, 0.25).far["leg.x"], 6) and near(s.channels["leg.x"].keys[2][1], 0.75),
        "far edit lands at t + sideOffset in the shared curve")

  local n = clip()
  Clip.setPoseKey(n, "b.y", 0, nil, 3, 4)
  check(n.channels["b.y"] and near(Clip.sample(n, 0.6)["b.y"], 3), "editing a missing channel creates it")

  local m = clip { marks = { { t = 0, name = "contact" }, { t = 0.5, name = "pass" } } }
  check(Clip.markForFrame(m, 0, 8) == "contact" and Clip.markForFrame(m, 4, 8) == "pass"
        and Clip.markForFrame(m, 1, 8) == nil, "markForFrame names frames on a mark")
end

-- Rig: solving and grounding ---------------------------------------------------

local function standing(b) return b.thigh + b.shin + b.ankleH + b.torso + b.neck + 2 * b.headR end

do
  check(near(standing(humanoid.bones), 1), "rig normalized to standing height 1")
  local rest = { near = {}, far = {} }
  local sk = Rig.solve(humanoid, rest)
  local b = humanoid.bones
  check(sk.hip.x == 0 and sk.hip.y == 0, "hip at the origin")
  check(near(sk.near.knee.x, 0) and near(sk.near.knee.y, b.thigh), "rest: knee straight below the hip")
  check(near(sk.near.ankle.y, b.thigh + b.shin), "rest: ankle below the knee")
  check(near(sk.near.toe.x, b.foot) and near(sk.near.heel.x, -b.heel), "rest: toe forward, heel back")
  check(near(sk.neck.y, -b.torso) and near(sk.head.y, -(b.torso + b.neck + b.headR)), "rest: spine and head straight up")
  check(near(sk.ground, b.thigh + b.shin + b.ankleH), "rest: ground under the flat foot")
  check(near(sk.ground - (sk.head.y - b.headR), 1), "rest: ground to head top is the body height")

  local lifted = Rig.solve(humanoid, { ["root.lift"] = 0.1, near = {}, far = {} })
  check(near(lifted.ground, sk.ground + 0.1) and lifted.lift == 0.1, "root.lift drops the ground below the feet")

  local toes = Rig.solve(humanoid, { near = { ["leg.foot"] = 30 }, far = {} })
  check(toes.near.contact == "toe" and near(toes.near.lowest, toes.near.toe.y), "toes down: toe touches")
  local heel = Rig.solve(humanoid, { near = { ["leg.foot"] = -30 }, far = {} })
  check(heel.near.contact == "heel" and near(heel.near.lowest, heel.near.heel.y), "toes up: heel touches")

  local step = Rig.solve(humanoid, { near = { ["leg.thigh"] = 40 }, far = { ["leg.thigh"] = -10 } })
  check(near(step.ground, math.max(step.near.lowest, step.far.lowest)), "ground is the lower foot")
  check(step.near.knee.x > 0 and step.far.knee.x < 0, "+ thigh swings forward, - back")
  local bend = Rig.solve(humanoid, { near = { ["leg.knee"] = 90 }, far = {} })
  check(near(bend.near.ankle.x, -b.shin) and near(bend.near.ankle.y, b.thigh), "knee bend 90 swings the shin back level")
  local lean = Rig.solve(humanoid, { ["torso.lean"] = 90, near = {}, far = {} })
  check(near(lean.neck.x, b.torso) and near(lean.neck.y, 0, 1e-12), "torso.lean 90 lays the spine forward")
  check(near(Rig.angleFromDown(1, 0), 90) and near(Rig.angleFromUp(0, -1), 0), "angle helpers")

  local chibi = Rig.withProportions(humanoid, Rig.preset("Chibi"))
  check(chibi.bones.headR > b.headR * 1.5 and near(standing(chibi.bones), 1), "Chibi: bigger head, height still 1")
  check(Rig.withProportions(humanoid, nil).bones.headR == b.headR, "no proportions: a copy")
  check(Rig.preset("Nope") == nil and Rig.preset("Default").head == 100, "preset lookup by name")
end

-- Stamps ------------------------------------------------------------------------

local function set(pts)
  local s = {}
  for _, p in ipairs(pts) do s[p[1] .. "," .. p[2]] = true end
  return s
end
local function count(t) local n = 0; for _ in pairs(t) do n = n + 1 end; return n end

do
  check(#Stamps.circle(1, false) == 1 and #Stamps.circle(2, true) == 4, "1px and 2px stamps")
  local r3 = set(Stamps.circle(3, false))
  check(count(r3) == 4 and r3["1,0"] and r3["0,1"] and r3["2,1"] and r3["1,2"] and not r3["1,1"],
        "3px ring is the hand-drawn plus")
  local f5 = set(Stamps.circle(5, true))
  check(count(f5) == 21 and f5["2,2"] and not f5["0,0"], "5px filled stamp fills its ring")
  check(Stamps.circle(4.4, false) == Stamps.circle(4, false), "diameters round and stamps are cached")
  local r12 = Stamps.circle(12, false)
  local sym = true
  local s12 = set(r12)
  for _, p in ipairs(r12) do
    if not s12[(11 - p[1]) .. "," .. p[2]] or not s12[p[1] .. "," .. (11 - p[2])] then sym = false end
  end
  check(#r12 > 0 and sym and not s12["6,6"], "computed 12px ring is symmetric and hollow")
  local got = {}
  Stamps.draw(function(x, y, c) got[#got + 1] = { x, y, c } end, 10, 20, 3, false, "c")
  local g = set(got)
  check(#got == 4 and got[1][3] == "c" and g["10,19"] and g["9,20"] and g["11,20"] and g["10,21"],
        "draw centres the stamp on (cx, cy)")
end

-- Colors ------------------------------------------------------------------------

do
  local mono = Colors.resolver("Mono", Colors.resolve("Mono"))
  check(mono("thigh", "near")[3] == 255 and mono("thigh", "far")[3] == math.floor(255 * 0.55), "Mono: far side darker")
  local picks = { far = { 1, 2, 3 } }
  local nf = Colors.resolver("Near / Far", Colors.resolve("Near / Far", picks))
  check(nf("thigh", "far") == picks.far and nf("torso", "center")[1] == 0, "Near / Far: picks override defaults")
  local limbs = Colors.resolver("Limbs", Colors.resolve("Limbs"))
  check(limbs("shin", "far")[3] == 230 and limbs("forearm", "near")[1] == 255 and limbs("head", "center")[3] == 255,
        "Limbs: color per limb and side")
  local seg = Colors.resolver("Segments", Colors.resolve("Segments"))
  check(seg("foot", "near")[1] == 170 and seg("foot", "far")[1] == math.floor(170 * 0.55), "Segments: part color, far darker")
  local slots = true
  for _, scheme in ipairs(Colors.SCHEMES) do
    if #Colors.SLOTS[scheme] > Colors.MAX_SLOTS then slots = false end
  end
  check(slots, "every scheme fits in MAX_SLOTS")
end

-- Render through a put callback -----------------------------------------------------

do
  local W, H, GY, CX = 64, 64, 60, 32
  local function frameFor(t, height)
    local sk = Rig.solve(humanoid, Clip.sample(run, t))
    local h = height or 48
    local function P(p) return math.floor(CX + p.x * h + 0.5), math.floor(GY - (sk.ground - p.y) * h + 0.5) end
    return { sk = sk, P = P, H = h, facing = 1 }
  end
  local function draw(style, over)
    local pixels, calls, parts = {}, 0, {}
    local opts = {
      style = style, thickness = 1, pixelPerfect = true, rig = humanoid,
      color = function(part, side) parts[part .. "/" .. side] = true; return part end,
      groundLine = false, groundY = GY, width = W, height = H,
      arcColor = "arc", footColor = "foot", groundColor = "ground",
    }
    for k, v in pairs(over or {}) do opts[k] = v end
    Render.draw(function(x, y, c)
      calls = calls + 1
      pixels[x .. "," .. y] = c
    end, (over and over.frame) or frameFor(0), opts)
    return pixels, calls, parts
  end

  local stick, stickCalls, parts = draw("Stick")
  local inBounds = true
  for k in pairs(stick) do
    local x, y = k:match("^(-?%d+),(-?%d+)$") -- a float key such as "10.0" does not match
    x, y = tonumber(x), tonumber(y)
    if not x or x < 0 or x >= W or y < 0 or y >= H then inBounds = false end
  end
  check(stickCalls > 0 and inBounds, "Stick: whole pixels, inside the canvas (" .. count(stick) .. " px)")
  check(parts["head/center"] and parts["thigh/near"] and parts["thigh/far"] and parts["forearm/near"],
        "color callback asked per part and side")
  local again = draw("Stick")
  local same = count(again) == count(stick)
  for k, v in pairs(stick) do if again[k] ~= v then same = false end end
  check(same, "same frame, same pixels")

  local rough = draw("Stick", { pixelPerfect = false })
  check(count(rough) > count(stick), "pixelPerfect drops corner pixels from the drawn chains ("
        .. count(rough) .. " -> " .. count(stick) .. " px)")

  local capsule = draw("Capsule")
  check(count(capsule) > count(stick), "Capsule fills more pixels than Stick")
  local thick = draw("Stick", { thickness = 3 })
  check(count(thick) > count(stick), "thickness 3 draws wider limbs than 1")
  local joints = draw("Joints + arcs", { trails = { { points = { { 2, 3 }, { 4, 5 } }, current = 2 } } })
  check(joints["2,3"] == "arc" and joints["4,5"] ~= "arc", "Joints + arcs: trail points but not the current one")

  local ground = draw("Stick", { groundLine = true, footprints = { { 10, 12 } } })
  check(ground["0," .. (GY + 1)] == "ground" and ground["2," .. (GY + 1)] == "ground"
        and ground["10," .. (GY + 1)] == "foot" and ground["12," .. (GY + 1)] == "foot",
        "ground line every other pixel under groundY, footprints over it")
  local edge = draw("Stick", { groundLine = true, groundY = H - 1 })
  check(edge["0," .. (H - 1)] ~= nil, "ground line stays on the canvas at its bottom row")

  local lowest = -1
  for k in pairs(stick) do lowest = math.max(lowest, tonumber(k:match(",(-?%d+)$"))) end
  check(lowest == GY, "grounded foot lands on groundY (" .. lowest .. ")")

  local line = {}
  Render.line1(function(x, y) line[#line + 1] = { x, y } end, 0, 0, 3, 1, "c")
  check(#line == 4 and line[1][1] == 0 and line[4][1] == 3 and line[4][2] == 1, "line1: Bresenham end to end")
  check(#Render.pixelPerfect({ { 0, 0 }, { 1, 0 }, { 1, 1 }, { 2, 1 } }) == 3, "pixel-perfect drops the L corner")
  check(#Render.pixelPerfect({ { 0, 0 }, { 1, 1 }, { 2, 2 } }) == 3, "pixel-perfect keeps a diagonal")

  local sk = frameFor(0).sk
  local handles = Render.handles(sk)
  check(#handles == 12 and handles[1].p == sk.near.knee and handles[12].p == sk.head, "handles cover joints and head")
  local tp = Render.trailPoints(frameFor(0))
  check(tp["near.hand"] and tp["near.toe"] and tp.head, "trail points: near hand, near toe, head top")
end

print(("pure: %d passed, %d failed"):format(passes, failures))
if failures > 0 then os.exit(1) end
