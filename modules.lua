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
  M.Clip.decode, M.Rig.readJson = M.Util.decode, M.Util.readJson

  function M.userClipsDir()
    return app.fs.joinPath(app.fs.userConfigPath, "pixelrig", "clips")
  end

  function M.rigsDir() return app.fs.joinPath(dir, "rigs") end

  -- Built-in clips + user clips. A user clip named like a built-in is left out; of two user files
  -- with one clip name, the first by file name loads and the other is skipped.
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
      -- Name order, so which of two files with one clip name loads never depends on the disk.
      local files = app.fs.listFiles(folder)
      table.sort(files)
      for _, file in ipairs(files) do
        if file:match("%.json$") then
          local function skip(reason)
            table.insert(lib.skipped, { file = file, origin = origin, reason = reason })
          end
          local path = app.fs.joinPath(folder, file)
          local ok, clip = pcall(M.Clip.load, path, origin)
          local rigReason = ok and needRig(clip.rig)
          local have = ok and lib.clips[clip.name]
          if not ok then
            skip(tostring(clip))
          elseif rigReason then
            skip(rigReason)
          elseif have and origin == "user" and have.origin == "user" then
            -- Never let a second file silently replace the first (#7).
            skip("same clip name as " .. app.fs.fileName(have.file))
          elseif not (have and have.origin == "builtin") then
            if not have then table.insert(lib.names, clip.name) end
            clip.file = path
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

  -- Where saving a clip named `name` writes, and what that replaces: nil when nothing, else a
  -- short phrase for the question. An existing user clip is saved over its own file, so the saved
  -- clip is the one the library shows afterwards; any other name gets Clip.fileName, where a file
  -- may already sit (on a disk that ignores case, an older file differing only in case).
  function M.clipSavePath(lib, name)
    local have = lib.clips[name]
    if have and have.origin == "user" then return have.file, "your clip '" .. name .. "'" end
    local path = app.fs.joinPath(M.userClipsDir(), M.Clip.fileName(name))
    if not app.fs.isFile(path) then return path, nil end
    local ok, data = pcall(M.Util.readJson, path)
    local held = ok and type(data) == "table" and type(data.name) == "string" and data.name
    if held then return path, "your clip '" .. held .. "' (" .. app.fs.fileName(path) .. ")" end
    return path, "the file " .. app.fs.fileName(path)
  end

  M.Sections = mod("sections")
  M.UI = mod("ui")(M)
  return M
end
