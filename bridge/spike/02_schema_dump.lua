--[[  TENURE spike 02 — SCHEMA DUMP  (Ticket 6)
      ─────────────────────────────────────────────────────────────────────────
      Answers "what is actually in there?" instead of guessing table names.

      Walks GetDBTablesNames() → GetDBTableFields() → row count, and writes
      NDJSON (one line per table) so a failure part-way through still leaves
      usable output.

      This script is READ ONLY.

      Output: %LOCALAPPDATA%\Tenure\spike\schema_<date>.ndjson
      Run in career mode — some tables only exist once a career is loaded.
--]]

require 'imports/other/helpers'

local OUT_DIR = (os.getenv('LOCALAPPDATA') or 'C:') .. '\\Tenure\\spike'
local COUNT_BUDGET_SEC = 4.0   -- per table; a few tables are enormous
local HARD_ROW_CAP = 200000

assert(IsInCM(), 'Run this in career mode — load your save first.')

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

-- ── open output ─────────────────────────────────────────────────────────────
local d = GetCurrentDate()
local path = string.format('%s\\schema_%04d%02d%02d.ndjson', OUT_DIR, d.year, d.month, d.day)
local out = io.open(path, 'w+')
assert(out, 'cannot write to ' .. path .. ' — does the folder exist? Run the spike server once.')

local save_uid = ''
pcall(function() save_uid = GetSaveUID() end)

out:write(encode({
  record = 'meta',
  le_version = LE_VERSION or 'unknown',
  save_uid = save_uid,
  in_game_date = string.format('%04d-%02d-%02d', d.year, d.month, d.day),
  lua_version = _VERSION,
}) .. '\n')

-- ── enumerate ───────────────────────────────────────────────────────────────
local names = GetDBTablesNames()
say(string.format('Found %d accessible tables. This takes a few minutes.', #names))

local total_started = os.clock()
local total_rows, counted, skipped = 0, 0, 0

for i = 1, #names do
  local name = names[i]
  local entry = { record = 'table', name = name }

  -- fields
  local ok_fields, fields = pcall(GetDBTableFields, name)
  if ok_fields and type(fields) == 'table' then
    local list = {}
    for fi = 1, #fields do
      local desc = fields[fi]
      local flat = {}
      if type(desc) == 'table' then
        for k, v in pairs(desc) do
          if type(v) ~= 'table' and type(v) ~= 'function' then flat[tostring(k)] = v end
        end
      else
        flat.name = tostring(desc)
      end
      list[#list + 1] = flat
    end
    entry.fields = list
    entry.field_count = #list
  else
    entry.fields_error = tostring(fields)
  end

  -- row count, budgeted
  local t0 = os.clock()
  local ok_count, count, capped = pcall(function()
    local tbl = LE.db:GetTable(name)
    if not tbl then return -1, false end
    local rec = tbl:GetFirstRecord()
    local n = 0
    while rec and rec > 0 do
      n = n + 1
      if n >= HARD_ROW_CAP then return n, true end
      if (n % 512 == 0) and (os.clock() - t0) > COUNT_BUDGET_SEC then return n, true end
      rec = tbl:GetNextValidRecord()
    end
    return n, false
  end)

  if ok_count then
    entry.row_count = count
    entry.row_count_capped = capped or false
    entry.count_ms = math.floor((os.clock() - t0) * 1000)
    if count and count > 0 then total_rows = total_rows + count end
    counted = counted + 1
  else
    entry.count_error = tostring(count)
    skipped = skipped + 1
  end

  out:write(encode(entry) .. '\n')
  out:flush()

  if i % 25 == 0 then
    say(string.format('  … %d/%d tables (%d rows so far)', i, #names, total_rows))
  end
end

local elapsed = os.clock() - total_started
out:write(encode({
  record = 'summary',
  tables = #names,
  counted = counted,
  skipped = skipped,
  total_rows_seen = total_rows,
  elapsed_ms = math.floor(elapsed * 1000),
}) .. '\n')
out:close()

say('─────────────────────────────────────────────')
say(string.format('Schema dump complete: %d tables, %d rows seen, %.1f s', #names, total_rows, elapsed))
say('Written to: ' .. path)
say('Copy it into the repo as tests/fixtures/schema-<build>.ndjson')
say('─────────────────────────────────────────────')
