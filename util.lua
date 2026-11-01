-- Util: JSON file loading into plain Lua tables.
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

function Util.readJson(path)
  local f = assert(io.open(path, "r"))
  local text = f:read("a")
  f:close()
  return plain(json.decode(text))
end

return Util
