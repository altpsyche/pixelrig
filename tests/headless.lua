local dir = app.params.root
local out = app.params.out
local function mod(n) return dofile(dir.."/"..n..".lua") end
local Util, Clip, Rig, Render = mod("util"), mod("clip"), mod("rig"), mod("render")
Clip.readJson, Rig.readJson = Util.readJson, Util.readJson
local Ghost = mod("ghost")(Clip, Rig, Render)
local clip = Clip.load(dir.."/clips/run.json")
local rig = Rig.load(dir.."/rigs/"..clip.rig..".json")
for _, style in ipairs(Render.STYLES) do
  local spr = Sprite(64, 64, ColorMode.RGB)
  app.command.BackgroundFromLayer()
  local bg = spr.layers[1]
  bg.cels[1].image:clear(app.pixelColor.rgba(255,255,255,255))
  local h = style == "Capsule" and 56 or 48
  Ghost.generate(spr, { clip=clip, rig=rig, params={}, height=h, groundY=62, cx=32, facing=1,
    style=style, thickness=1, frames=12, fps=12, timing=true, fillAll=true, labels=true,
    color=Color{r=0,g=120,b=255}, opacity=100 })
  -- reference layers are not exported; flip to normal for test output
  print(style, #spr.frames, #spr.layers, spr.layers[2].name, spr.layers[2].isReference, #spr.tags)
  local names = {} for _,t in ipairs(spr.tags) do table.insert(names, t.name.."@"..t.fromFrame.frameNumber) end
  print(table.concat(names, " "))
  local flat = Image(spr.spec)
  local sheet = Image(64*12, 64, ColorMode.RGB)
  for i=1,12 do
    local img = Image(spr.spec); img:clear(app.pixelColor.rgba(255,255,255,255))
    img:drawImage(spr.layers[2]:cel(i).image, Point(0,0))
    sheet:drawImage(img, Point((i-1)*64, 0))
  end
  sheet:saveAs(out.."/"..style:gsub("[^%w]","_")..".png")
  spr:close()
end
