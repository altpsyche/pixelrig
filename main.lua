-- PixelRig: animation toolkit for Aseprite. Module: Ghost Reference.

function init(plugin)
  local M = dofile(app.fs.joinPath(plugin.path, "modules.lua"))(plugin.path)
  plugin:newCommand {
    id = "PixelRigGhostReference",
    title = "Ghost Reference...",
    group = "view_animation_helpers",
    onenabled = function() return app.sprite ~= nil end,
    onclick = function() M.UI.open() end,
  }
end

function exit(plugin) end
