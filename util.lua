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

function Util.writeJson(path, data)
  local f = assert(io.open(path, "w"))
  f:write(json.encode(data))
  f:close()
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
