-- Sections: a dialog split into tabs, each made of one or more parts.
-- Uses Dialog:tab / Dialog:endtabs where the Aseprite build has them: each tab holds its parts,
-- parts after the first shown under a separator. Older builds (v1.3-rc6, Lua API 25) have
-- neither, and reading the field raises "Field tab does not exist"; there a "Section" picker
-- shows one part at a time, which keeps the dialog short enough for the screen. Each widget gets
-- its visibility when created (v1.3-rc6 reads `visible` for every widget it adds through
-- Dialog_add_widget); the helper never creates separators in picker mode, which would not.
--
--   local sec = Sections.new(dlg, {
--     { id = "tabMotion", text = "Motion", parts = { { id = "secMotion", text = "Motion" },
--                                                    { id = "secClip", text = "Clip" } } },
--     ...
--   })
--   local W = sec.widgets          -- use W:slider{...} etc. for widgets inside parts
--   sec:begin("secMotion") ... sec:begin("secClip") ... sec:finish()
--   sec:setVisible(id, bool)       -- a widget's own visibility (per-clip sliders, color slots)

local Sections = {}
Sections.__index = Sections

function Sections.hasTabs(dlg)
  local ok, tab = pcall(function() return dlg.tab end)
  return ok and tab ~= nil
end

function Sections.new(dlg, tabs)
  local self = setmetatable({
    dlg = dlg,
    tabs = tabs,
    hasTabs = Sections.hasTabs(dlg),
    parts = {},      -- flat list of parts in order, each { id, text, tab }
    current = nil,   -- id of the part being built
    sectionOf = {},  -- widget id -> part id
    own = {},        -- widget id -> its own visibility
    order = {},      -- widget ids in creation order
    auto = 0,
  }, Sections)
  for _, t in ipairs(tabs) do
    for i, p in ipairs(t.parts) do
      table.insert(self.parts, { id = p.id, text = p.text, tab = t, first = (i == 1) })
    end
  end
  self.shown = self.parts[1].id

  if not self.hasTabs then
    local names = {}
    for _, p in ipairs(self.parts) do table.insert(names, p.text) end
    dlg:combobox { id = "section", label = "Section", option = names[1], options = names,
                   onchange = function() self:show(self:idOf(dlg.data.section)) end }
  end

  -- Proxy that creates a widget on the dialog and records it under the current part.
  self.widgets = setmetatable({}, { __index = function(_, kind)
    return function(_, t)
      t = t or {}
      if not t.id then
        self.auto = self.auto + 1
        t.id = "_section_widget_" .. self.auto
      end
      self.sectionOf[t.id] = self.current
      self.own[t.id] = t.visible ~= false
      table.insert(self.order, t.id)
      if not self.hasTabs then t.visible = self.own[t.id] and self.current == self.shown end
      return dlg[kind](dlg, t)
    end
  end })
  return self
end

function Sections:part(id)
  for _, p in ipairs(self.parts) do
    if p.id == id then return p end
  end
  error("unknown section part " .. tostring(id))
end

function Sections:idOf(text)
  for _, p in ipairs(self.parts) do
    if p.text == text then return p.id end
  end
  return self.parts[1].id
end

function Sections:begin(id)
  local p = self:part(id)
  self.current = id
  if not self.hasTabs then return end
  if p.first then
    self.dlg:tab { id = p.tab.id, text = p.tab.text }
  else
    self.dlg:separator { text = p.text }
  end
end

function Sections:finish()
  self.current = nil
  if self.hasTabs then self.dlg:endtabs { id = "tabs", selected = self.tabs[1].id } end
end

-- A widget's own visibility; in picker mode it also needs its part to be shown.
function Sections:setVisible(id, visible)
  self.own[id] = visible
  local section = self.sectionOf[id]
  local onScreen = visible and (self.hasTabs or section == nil or section == self.shown)
  self.dlg:modify { id = id, visible = onScreen }
end

-- Picker mode: show one part's widgets, honouring each widget's own visibility.
function Sections:show(id)
  if self.hasTabs then return end
  self.shown = id
  for _, wid in ipairs(self.order) do
    self.dlg:modify { id = wid, visible = self.own[wid] and self.sectionOf[wid] == id }
  end
end

return Sections
