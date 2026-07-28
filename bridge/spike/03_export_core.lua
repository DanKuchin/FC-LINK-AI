--[[  TENURE spike 03 — CORE EXPORT + TIMING  (Ticket 7)
      ─────────────────────────────────────────────────────────────────────────
      The measurement that decides whether the session ritual is tolerable:
      how long does it take to pull the data a career import actually needs?

      Exports players / teams / teamplayerlinks / career_playercontract as
      NDJSON, and separately benchmarks name resolution (documented as slow).

      This script is READ ONLY.

      Output: %LOCALAPPDATA%\Tenure\spike\export_<date>\*.ndjson
              plus timing.json — the number that matters
--]]

require 'imports/other/helpers'

local OUT_ROOT = (os.getenv('LOCALAPPDATA') or 'C:') .. '\\Tenure\\spike'
local NAME_SAMPLE = 200        -- how many name lookups to time before extrapolating

assert(IsInCM(), 'Run this in career mode — load your save first.')

-- Columns we actually want. nil = every field in the table.
-- Missing columns are reported, not fatal: schemas move between title updates.
local WANTED = {
  players = {
    'playerid', 'birthdate', 'nationality', 'overallrating', 'potential',
    'preferredposition1', 'preferredposition2', 'preferredposition3',
    'height', 'weight', 'preferredfoot', 'contractvaliduntil',
    'internationalrep', 'isretiring', 'personality', 'skillmoves',
    'weakfootabilitytypecode', 'playerjointeamdate',
  },
  teams = nil,
  teamplayerlinks = nil,
  career_playercontract = nil,
}
local ORDER = { 'teams', 'teamplayerlinks', 'career_playercontract', 'players' }

local function esc(s)
  return (tostring(s):gsub('[%c"\\]', function(c)
    if c == '"' then return '\\"' end
    if c == '\\' then return '\\\\' end
    if c == '\n' then return '\\n' end
    if c == '\r' then return '\\r' end
    if c == '\t' then return '\\t' end
    return string.format('\\u%04x', string.byte(c))
  end))
end

local function encode(v)
  local t = type(v)
  if t == 'nil' then return 'null' end
  if t == 'boolean' then return tostring(v) end
  if t == 'number' then return string.format('%.14g', v) end
  if t == 'string' then return '"' .. esc(v) .. '"' end
  if t == 'table' then
    local parts = {}
    if #v > 0 then
      for i = 1, #v do parts[#parts + 1] = encode(v[i]) end
      return '[' .. table.concat(parts, ',') .. ']'
    end
    local keys = {}
    for k in pairs(v) do keys[#keys + 1] = tostring(k) end
    table.sort(keys)
    for _, k in ipairs(keys) do parts[#parts + 1] = '"' .. esc(k) .. '":' .. encode(v[k]) end
    return '{' .. table.concat(parts, ',') .. '}'
  end
  return '"' .. esc(tostring(v)) .. '"'
end

local function say(m)
  print(m)
  if LOGGER then LOGGER:LogInfo('[tenure] ' .. m) end
end

local d = GetCurrentDate()
local dir = string.format('%s\\export_%04d%02d%02d', OUT_ROOT, d.year, d.month, d.day)
-- Lua has no portable mkdir; the spike server pre-creates OUT_ROOT, so fall back to it.
local function open_out(basename)
  local f = io.open(dir .. '\\' .. basename, 'w+')
  if f then return f, dir .. '\\' .. basename end
  f = io.open(OUT_ROOT .. '\\' .. basename, 'w+')
  return f, OUT_ROOT .. '\\' .. basename
end

-- ── generic table export ────────────────────────────────────────────────────
local function export_table(name, wanted)
  local result = { table = name }
  local t0 = os.clock()

  local ok_fields, fields = pcall(GetDBTableFields, name)
  if not ok_fields or type(fields) ~= 'table' then
    result.error = 'GetDBTableFields failed: ' .. tostring(fields)
    return result
  end

  local available = {}
  local all = {}
  for i = 1, #fields do
    local fname = type(fields[i]) == 'table' and fields[i].name or tostring(fields[i])
    if type(fname) == 'table' then fname = tostring(fname.value or '') end
    available[fname] = true
    all[#all + 1] = fname
  end

  local columns, missing = {}, {}
  if wanted == nil then
    columns = all
  else
    for _, c in ipairs(wanted) do
      if available[c] then columns[#columns + 1] = c else missing[#missing + 1] = c end
    end
  end
  result.columns = columns
  result.missing_columns = missing
  if #missing > 0 then
    say(string.format('  ! %s: %d requested column(s) not present: %s',
        name, #missing, table.concat(missing, ', ')))
  end

  local f, fpath = open_out(name .. '.ndjson')
  if not f then
    result.error = 'cannot open output file for ' .. name
    return result
  end

  local ok, err = pcall(function()
    local tbl = LE.db:GetTable(name)
    assert(tbl, 'GetTable returned nil')
    local rec = tbl:GetFirstRecord()
    local n = 0
    while rec and rec > 0 do
      local row = {}
      for ci = 1, #columns do
        row[columns[ci]] = tbl:GetRecordFieldValue(rec, columns[ci])
      end
      f:write(encode(row) .. '\n')
      n = n + 1
      if n % 2000 == 0 then
        f:flush()
        say(string.format('    %s … %d rows', name, n))
      end
      rec = tbl:GetNextValidRecord()
    end
    result.rows = n
  end)

  f:close()
  if not ok then result.error = tostring(err) end

  result.elapsed_ms = math.floor((os.clock() - t0) * 1000)
  result.file = fpath
  if result.rows and result.rows > 0 and result.elapsed_ms > 0 then
    result.rows_per_sec = math.floor(result.rows / (result.elapsed_ms / 1000))
  end
  say(string.format('  %s: %s rows in %d ms%s',
      name,
      tostring(result.rows or '?'),
      result.elapsed_ms,
      result.rows_per_sec and (' (' .. result.rows_per_sec .. '/s)') or ''))
  return result
end

-- ── name lookup benchmark ───────────────────────────────────────────────────
local function benchmark_names()
  local ids = {}
  pcall(function()
    local tbl = LE.db:GetTable('players')
    local rec = tbl:GetFirstRecord()
    while rec and rec > 0 and #ids < NAME_SAMPLE do
      ids[#ids + 1] = tbl:GetRecordFieldValue(rec, 'playerid')
      rec = tbl:GetNextValidRecord()
    end
  end)
  if #ids == 0 then return { error = 'could not sample player ids' } end

  local t0 = os.clock()
  local nonempty = 0
  for i = 1, #ids do
    local ok, nm = pcall(GetPlayerName, ids[i])
    if ok and nm and nm ~= '' then nonempty = nonempty + 1 end
  end
  local ms = (os.clock() - t0) * 1000
  return {
    sampled = #ids,
    resolved = nonempty,
    total_ms = math.floor(ms),
    ms_per_lookup = ms / #ids,
  }
end

-- ── run ─────────────────────────────────────────────────────────────────────
say('─────────────────────────────────────────────')
say('TENURE spike 03 — core export')
say('Output folder: ' .. dir)
say('(if that folder does not exist, files land in ' .. OUT_ROOT .. ')')

local run_started = os.clock()
local results = {}
for _, name in ipairs(ORDER) do
  say('Exporting ' .. name .. ' …')
  results[#results + 1] = export_table(name, WANTED[name])
end

say('Benchmarking name lookups …')
local names_bench = benchmark_names()
if names_bench.ms_per_lookup then
  say(string.format('  %.2f ms per GetPlayerName (%d sampled)',
      names_bench.ms_per_lookup, names_bench.sampled))
end

local total_ms = math.floor((os.clock() - run_started) * 1000)

-- projected full import cost: exports + one name lookup per player
local player_rows = 0
for _, r in ipairs(results) do
  if r.table == 'players' and r.rows then player_rows = r.rows end
end
local projected_names_ms = names_bench.ms_per_lookup and
    math.floor(names_bench.ms_per_lookup * player_rows) or nil

local timing = {
  record = 'timing',
  le_version = LE_VERSION or 'unknown',
  in_game_date = string.format('%04d-%02d-%02d', d.year, d.month, d.day),
  tables = results,
  name_lookup = names_bench,
  export_total_ms = total_ms,
  projected_all_names_ms = projected_names_ms,
  projected_full_import_ms = projected_names_ms and (total_ms + projected_names_ms) or nil,
}

local tf, tpath = open_out('timing.json')
if tf then tf:write(encode(timing)) tf:close() end

say('─────────────────────────────────────────────')
say(string.format('Export total: %d ms (%.1f s)', total_ms, total_ms / 1000))
if projected_names_ms then
  say(string.format('Projected name resolution for all %d players: %.1f s',
      player_rows, projected_names_ms / 1000))
  say(string.format('Projected full first import: %.1f s  [target < 90 s]',
      (total_ms + projected_names_ms) / 1000))
end
say('Timing written to: ' .. tostring(tpath))
say('─────────────────────────────────────────────')
