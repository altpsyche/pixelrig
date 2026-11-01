-- Util: JSON file IO and table helpers.
-- Aseprite's json.decode returns lazy userdata; convert so sort/pairs/# behave normally.

local Util = {}

local function plain(v)
  if type(v) ~= "userdata" then return v end
  local t = {}
  if tostring(v):sub(1, 1) == "[" then
    for i = 1, #v do t[i] = plain(v[i]) end
  else
    for k, x in pairs(v) do t[k] = plain(x) end
  end
  return t
end

Util.plain = plain

function Util.decode(text)
  return plain(json.decode(text))
end

function Util.readJson(path)
  local f = assert(io.open(path, "r"))
  local text = f:read("a")
  f:close()
  return Util.decode(text)
end

-- Writes data as JSON. Returns true, or nil and why (one line: file name and reason); never
-- raises. Writes a temporary file first and moves it into place, so a failed write leaves the
-- file that was there as it was. Creates missing folders.
function Util.writeJson(path, data)
  local tmp = path .. ".tmp"
  local ok, err = pcall(function()
    local text = json.encode(data)
    app.fs.makeAllDirectories(app.fs.filePath(path))
    local f, openErr = io.open(tmp, "w")
    if not f then error(openErr, 0) end
    local wrote, writeErr = f:write(text)
    local closed, closeErr = f:close()
    if not (wrote and closed) then error(writeErr or closeErr, 0) end
    local moved, moveErr = os.rename(tmp, path)
    -- Windows will not rename onto an existing file: move the old one aside to a backup, move
    -- the new one in, then drop the backup. If the new one cannot move in, the backup goes back,
    -- so one version always survives.
    if not moved and app.fs.isFile(path) then
      local bak = path .. ".bak"
      if os.rename(path, bak) then
        moved, moveErr = os.rename(tmp, path)
        if moved then os.remove(bak) else os.rename(bak, path) end
      end
    end
    if not moved then error(moveErr, 0) end
  end)
  if ok then return true end
  if app.fs.isFile(tmp) then os.remove(tmp) end
  -- io's reasons start with the full path; the file name is enough on one line.
  local why = tostring(err)
  for _, prefix in ipairs({ tmp .. ": ", path .. ": " }) do
    if why:sub(1, #prefix) == prefix then why = why:sub(#prefix + 1) end
  end
  return nil, app.fs.fileName(path) .. ": " .. why
end

function Util.deepCopy(v)
  if type(v) ~= "table" then return v end
  local t = {}
  for k, x in pairs(v) do t[k] = Util.deepCopy(x) end
  return t
end

-- Copy of defaults overlaid with t (recursive for nested maps).
function Util.merge(defaults, t)
  local out = Util.deepCopy(defaults)
  for k, v in pairs(t or {}) do
    if type(v) == "table" and type(out[k]) == "table" and #out[k] == 0 and #v == 0 then
      out[k] = Util.merge(out[k], v)
    else
      out[k] = Util.deepCopy(v)
    end
  end
  return out
end

return Util
