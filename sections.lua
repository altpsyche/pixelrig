-- Sections: a dialog split into named sections.
-- Uses Dialog:tab / Dialog:endtabs where the Aseprite build has them. Older builds (v1.3-rc6,
-- Lua API 25) have neither, and reading the field raises "Field tab does not exist"; there a
-- "Section" picker shows one section's widgets at a time.
--
--   local sec = Sections.new(dlg, { { id = "tabMotion", text = "Motion" }, ... })
--   local W = sec.widgets          -- use W:slider{...} etc. for widgets inside sections
--   sec:begin("tabMotion") ... sec:finish()
--   sec:setVisible(id, bool)       -- a widget's own visibility (per-clip sliders, color slots)

local Sections = {}
Sections.__index = Sections

function Sections.hasTabs(dlg)
  local ok, tab = pcall(function() return dlg.tab end)
  return ok and tab ~= nil
end

function Sections.new(dlg, list)
  local self = setmetatable({
    dlg = dlg,
    list = list,
    tabs = Sections.hasTabs(dlg),
    current = nil,   -- id of the section being built
    shown = list[1].id,
    sectionOf = {},  -- widget id -> section id
    own = {},        -- widget id -> its own visibility
    order = {},      -- widget ids in creation order
    auto = 0,
  }, Sections)

  if not self.tabs then
    local names = {}
    for _, s in ipairs(list) do table.insert(names, s.text) end
    dlg:combobox { id = "section", label = "Section", option = list[1].text, options = names,
                   onchange = function() self:show(self:idOf(dlg.data.section)) end }
  end

  -- Proxy that creates a widget on the dialog and records it under the current section.
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
      if not self.tabs then t.visible = self.own[t.id] and self.current == self.shown end
      return dlg[kind](dlg, t)
    end
  end })
  return self
end

function Sections:idOf(text)
  for _, s in ipairs(self.list) do
    if s.text == text then return s.id end
  end
  return self.list[1].id
end

function Sections:textOf(id)
  for _, s in ipairs(self.list) do
    if s.id == id then return s.text end
  end
  return self.list[1].text
end

function Sections:begin(id)
  self.current = id
  if self.tabs then self.dlg:tab { id = id, text = self:textOf(id) } end
end

function Sections:finish()
  self.current = nil
  if self.tabs then
    self.dlg:endtabs { id = "tabs", selected = self.list[1].id }
  else
    -- Not every widget reads `visible` when created (v1.3-rc6 separators do not); modify does.
    self:show(self.shown)
  end
end

-- A widget's own visibility; in picker mode it also needs its section to be shown.
function Sections:setVisible(id, visible)
  self.own[id] = visible
  local section = self.sectionOf[id]
  local onScreen = visible and (self.tabs or section == nil or section == self.shown)
  self.dlg:modify { id = id, visible = onScreen }
end

-- Picker mode: show one section's widgets, honouring each widget's own visibility.
function Sections:show(id)
  if self.tabs then return end
  self.shown = id
  for _, wid in ipairs(self.order) do
    self.dlg:modify { id = wid, visible = self.own[wid] and self.sectionOf[wid] == id }
  end
end

return Sections
