--[[  TENURE spike 05 — PERSISTENCE PROOF, PART A: WRITE  (Ticket 9)
      ─────────────────────────────────────────────────────────────────────────
      Answers the biggest unknown in the whole plan.

      The Live Editor wiki states that only SOME database tables are stored
      inside the career file — edits to the others silently revert on restart.
      Which tables are which is not documented anywhere. So we measure it.

      Procedure:
        1. Run this script.            (writes a marker value into each table)
        2. SAVE YOUR CAREER in-game.
        3. Quit FC completely. Relaunch. Load the same career.
        4. Run 06_persist_verify.lua.  (reads back, reports, RESTORES originals)

      ⚠  THIS SCRIPT WRITES TO YOUR CAREER. Use a throwaway save.
         It records every original value and step 06 restores them, but a
         crash between the two leaves the marker values in place.

      Set BACKED_UP = true below to arm it.
--]]

local BACKED_UP = false   -- ← set to true once you are on a disposable save

--[[ Tables to test. Add more once 02_schema_dump.lua has shown you the real
     schema — pick fields that are cosmetic or trivially reversible.
     `delta` is added to the current value; step 06 subtracts it again. ]]
local TESTS = {
  { table = 'players',               field = 'socklengthcode',  delta = 1, bound = 2 },
  { table = 'career_playercontract', field = 'duration_months', delta = 1, bound = 240 },
  -- { table = 'teams',              field = '<cosmetic int>',  delta = 1, bound = 100 },
}

-- ─────────────────────────────────────────────────────────────────────────────
require 'imports/other/helpers'

local OUT_DIR = (os.getenv('LOCALAPPDATA') or 'C:') .. '\\Tenure\\spike'
local MARKER = OUT_DIR .. '\\persist_test.json'

assert(IsInCM(), 'Run this in career mode — load your save first.')
assert(BACKED_UP, 'Refusing to run. Back up your career, then set BACKED_UP = true at the top of this file.')

local function esc(s)
  return (tostring(s):gsub('[%c"\\]', function(c)
    if c == '"' then return '\\"' end
    if c == '\\' then return '\\\\' end
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
  return 'null'
end

local function say(m)
  print(m)
  if LOGGER then LOGGER:LogInfo('[tenure] ' .. m) end
end

local save_uid = ''
pcall(function() save_uid = GetSaveUID() end)

say('─────────────────────────────────────────────')
say('TENURE spike 05 — persistence proof (write)')
say('  save uid: ' .. save_uid)

local results = {}

for _, test in ipairs(TESTS) do
  local r = { table = test.table, field = test.field }

  local ok, err = pcall(function()
    local tbl = LE.db:GetTable(test.table)
    assert(tbl, 'GetTable returned nil')

    -- first record with a readable numeric value in the target field
    local rec = tbl:GetFirstRecord()
    local chosen, original, key = nil, nil, nil
    while rec and rec > 0 do
      local v = tbl:GetRecordFieldValue(rec, test.field)
      if type(v) == 'number' then
        chosen, original = rec, v
        -- capture an identifying key so step 06 can find the same row again
        for _, kf in ipairs({ 'playerid', 'teamid', 'id' }) do
          local kv = tbl:GetRecordFieldValue(rec, kf)
          if type(kv) == 'number' then key = { field = kf, value = kv } break end
        end
        break
      end
      rec = tbl:GetNextValidRecord()
    end
    assert(chosen, 'no record with a numeric ' .. test.field)
    assert(key, 'no identifying key field found in ' .. test.table)

    local target = original + test.delta
    if target > test.bound then target = original - test.delta end
    assert(target ~= original, 'could not pick a distinct test value')

    tbl:SetRecordFieldValue(chosen, test.field, target)

    -- did the write even land in memory? (separate question from persistence)
    local readback = tbl:GetRecordFieldValue(chosen, test.field)

    r.key = key
    r.original = original
    r.written = target
    r.readback = readback
    r.in_session_write = (readback == target)
  end)

  if not ok then
    r.error = tostring(err)
    say(string.format('  %-24s %-18s ERROR: %s', test.table, test.field, tostring(err)))
  else
    say(string.format('  %-24s %-18s %s → %s  (in-session write: %s)',
        test.table, test.field, tostring(r.original), tostring(r.written),
        r.in_session_write and 'OK' or 'FAILED'))
  end

  results[#results + 1] = r
end

local d = GetCurrentDate()
local cycle_id = string.format('%d-%d', os.time(), math.floor(os.clock() * 1000))
local f = io.open(MARKER, 'w+')
assert(f, 'cannot write marker file ' .. MARKER)
f:write(encode({
  cycle_id = cycle_id,
  written_at_game_date = string.format('%04d-%02d-%02d', d.year, d.month, d.day),
  save_uid = save_uid,
  le_version = LE_VERSION or 'unknown',
  test_count = #results,
  tests = results,
}))
f:close()

say('  marker written: ' .. MARKER)
say('  cycle id     : ' .. cycle_id)
say('─────────────────────────────────────────────')
say('  NEXT, in order — none of these steps is optional:')
say('   1. Save your career in-game.')
say('   2. Quit FC 26 completely (not just to the main menu).')
say('   3. Relaunch through the Live Editor launcher, load the same career.')
say('   4. Run 06_persist_verify.lua.')
say('─────────────────────────────────────────────')
