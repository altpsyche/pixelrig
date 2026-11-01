-- Modules: loads all PixelRig modules from an extension directory.

return function(dir)
  local function mod(name) return dofile(app.fs.joinPath(dir, name .. ".lua")) end
  local M = { dir = dir }
  M.Util = mod("util")
  M.Clip = mod("clip")
  M.Rig = mod("rig")
  M.Stamps = mod("stamps")
  M.Colors = mod("colors")
  M.Render = mod("render")(M.Stamps)
  M.Ghost = mod("ghost")(M.Clip, M.Rig, M.Render, M.Colors, M.Util)
  M.Clip.readJson, M.Rig.readJson = M.Util.readJson, M.Util.readJson

  function M.userClipsDir()
    return app.fs.joinPath(app.fs.userConfigPath, "pixelrig", "clips")
  end

  -- Built-in clips + user clips (user dir wins on name clash only if not built-in).
  function M.loadLibrary()
    local lib = { clips = {}, names = {}, rigs = {} }
    local function scan(folder, origin)
      if not app.fs.isDirectory(folder) then return end
      for _, file in ipairs(app.fs.listFiles(folder)) do
        if file:match("%.json$") then
          local ok, clip = pcall(M.Clip.load, app.fs.joinPath(folder, file), origin)
          if ok and clip.name and not (lib.clips[clip.name] and lib.clips[clip.name].origin == "builtin") then
            if not lib.rigs[clip.rig] then
              lib.rigs[clip.rig] = M.Rig.load(app.fs.joinPath(dir, "rigs", clip.rig .. ".json"))
            end
            if not lib.clips[clip.name] then table.insert(lib.names, clip.name) end
            lib.clips[clip.name] = clip
          end
        end
      end
    end
    scan(app.fs.joinPath(dir, "clips"), "builtin")
    scan(M.userClipsDir(), "user")
    table.sort(lib.names)
    return lib
  end

  M.Sections = mod("sections")
  M.UI = mod("ui")(M)
  return M
end
