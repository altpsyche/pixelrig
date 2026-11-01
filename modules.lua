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

  function M.rigsDir() return app.fs.joinPath(dir, "rigs") end

  -- Built-in clips + user clips (user dir wins on name clash only if not built-in).
  -- A file that cannot be used is left out and listed in lib.skipped as { file, origin, reason },
  -- the reason one short line for the artist; loading itself never raises.
  function M.loadLibrary()
    local lib = { clips = {}, names = {}, rigs = {}, skipped = {} }
    local rigProblem = {} -- rig name -> why it cannot be used
    -- Loads a rig once; returns nil, or why the clip naming it cannot be used.
    local function needRig(name)
      if lib.rigs[name] or rigProblem[name] then return rigProblem[name] end
      local path = app.fs.joinPath(M.rigsDir(), name .. ".json")
      if not app.fs.isFile(path) then
        rigProblem[name] = "rig '" .. name .. "' not found"
      else
        local ok, rig = pcall(M.Rig.load, path)
        if ok then lib.rigs[name] = rig else rigProblem[name] = "rig '" .. name .. "' is unreadable" end
      end
      return rigProblem[name]
    end
    local function scan(folder, origin)
      if not app.fs.isDirectory(folder) then return end
      for _, file in ipairs(app.fs.listFiles(folder)) do
        if file:match("%.json$") then
          local function skip(reason)
            table.insert(lib.skipped, { file = file, origin = origin, reason = reason })
          end
          local ok, clip = pcall(M.Clip.load, app.fs.joinPath(folder, file), origin)
          local rigReason = ok and needRig(clip.rig)
          if not ok then
            skip(tostring(clip))
          elseif rigReason then
            skip(rigReason)
          elseif not (lib.clips[clip.name] and lib.clips[clip.name].origin == "builtin") then
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
