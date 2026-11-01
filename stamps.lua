-- Stamps: hand-shaped pixel circles for small heads and joint dots.
-- Large sizes fall back to a computed circle.

local Stamps = {}

local RINGS = {
  [3] = { ".#.", "#.#", ".#." },
  [4] = { ".##.", "#..#", "#..#", ".##." },
  [5] = { ".###.", "#...#", "#...#", "#...#", ".###." },
  [6] = { ".####.", "#....#", "#....#", "#....#", "#....#", ".####." },
  [7] = { "..###..", ".#...#.", "#.....#", "#.....#", "#.....#", ".#...#.", "..###.." },
  [8] = { "..####..", ".#....#.", "#......#", "#......#", "#......#", "#......#", ".#....#.", "..####.." },
  [9] = { "...###...", ".##...##.", ".#.....#.", "#.......#", "#.......#", "#.......#", ".#.....#.", ".##...##.", "...###..." },
  [10] = { "...####...", ".##....##.", ".#......#.", "#........#", "#........#", "#........#", "#........#", ".#......#.", ".##....##.", "...####..." },
}

local cache = {}

local function fromRows(rows, filled)
  local pts = {}
  for y, row in ipairs(rows) do
    local first, last = row:find("#"), nil
    for x = #row, 1, -1 do
      if row:sub(x, x) == "#" then last = x; break end
    end
    for x = 1, #row do
      local on = row:sub(x, x) == "#"
      if filled and first and x >= first and x <= last then on = true end
      if on then table.insert(pts, { x - 1, y - 1 }) end
    end
  end
  return pts
end

local function computed(d, filled)
  local pts = {}
  local r = d / 2
  for y = 0, d - 1 do
    for x = 0, d - 1 do
      local dx, dy = x + 0.5 - r, y + 0.5 - r
      local dist = math.sqrt(dx * dx + dy * dy)
      if dist <= r and (filled or dist > r - 1.0) then table.insert(pts, { x, y }) end
    end
  end
  return pts
end

-- Offsets {dx, dy} from top-left of a d x d box.
function Stamps.circle(d, filled)
  d = math.max(1, math.floor(d + 0.5))
  local key = d .. (filled and "f" or "r")
  if cache[key] then return cache[key] end
  local pts
  if d == 1 then pts = { { 0, 0 } }
  elseif d == 2 then pts = { { 0, 0 }, { 1, 0 }, { 0, 1 }, { 1, 1 } }
  elseif RINGS[d] then pts = fromRows(RINGS[d], filled)
  else pts = computed(d, filled) end
  cache[key] = pts
  return pts
end

-- Draw circle of diameter d centered at (cx, cy).
function Stamps.draw(put, cx, cy, d, filled, c)
  d = math.max(1, math.floor(d + 0.5))
  local x0 = math.floor(cx - d / 2 + 0.5)
  local y0 = math.floor(cy - d / 2 + 0.5)
  for _, p in ipairs(Stamps.circle(d, filled)) do
    put(x0 + p[1], y0 + p[2], c)
  end
end

return Stamps
