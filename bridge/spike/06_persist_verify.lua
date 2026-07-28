--[[  TENURE spike 06 — PERSISTENCE PROOF, PART B: VERIFY + RESTORE  (Ticket 9)
      ─────────────────────────────────────────────────────────────────────────
      Run this AFTER: save → quit FC entirely → relaunch → load the same career.

      For each table tested in step 05 it reports one of:
        PERSISTED  — the value survived a full restart. The table is writable.
        REVERTED   — the value went back. The table is READ ONLY in practice.
        MISSING    — the row could not be found again (mapping problem).

      It then RESTORES every original value, whatever the outcome.

      The result is the answer to the single biggest unknown in the plan.
      Record it in docs/persistence-<build>.md.
--]]

require 'imports/other/helpers'

local OUT_DIR = (os.getenv('LOCALAPPDATA') or 'C:') .. '\\Tenure\\spike'
local MARKER = OUT_DIR .. '\\persist_test.json'

assert(IsInCM(), 'Run this in career mode — load the SAME career you tested.')

local function say(m)
  print(m)
  if LOGGER then LOGGER:LogInfo('[tenure] ' .. m) end
end

-- ── read the marker (small, known shape — matched rather than fully parsed) ──
local mf = io.open(MARKER, 'r')
assert(mf, 'no marker file at ' .. MARKER .. ' — run 05_persist_write.lua first')
local raw = mf:read('*a')
mf:close()

local marker_uid = raw:match('"save_uid"%s*:%s*"([^"]*)"') or ''
local current_uid = ''
pcall(function() current_uid = GetSaveUID() end)

say('─────────────────────────────────────────────')
say('TENURE spike 06 — persistence proof (verify)')
say('  marker save uid : ' .. marker_uid)
say('  current save uid: ' .. current_uid)

if marker_uid ~= '' and current_uid ~= '' and marker_uid ~= current_uid then
  say('')
  say('  ✖ DIFFERENT CAREER LOADED. Load the same save and run this again.')
  say('    (This is also proof that GetSaveUID distinguishes careers — useful.)')
  say('─────────────────────────────────────────────')
  return
end
if marker_uid ~= '' and marker_uid == current_uid then
  say('  ✓ save uid survived a full restart — it is a usable career anchor')
end

-- Each test object was written in a stable order by step 05, so a linear scan
-- over the marker text is enough to recover them without a JSON parser.
local tests = {}
for chunk in raw:gmatch('%b{}') do
  local tbl = chunk:match('"table"%s*:%s*"([^"]+)"')
  local field = chunk:match('"field"%s*:%s*"([^"]+)"')
  local original = tonumber(chunk:match('"original"%s*:%s*(-?[%d%.eE+]+)'))
  local written = tonumber(chunk:match('"written"%s*:%s*(-?[%d%.eE+]+)'))
  local key_field = chunk:match('"field"%s*:%s*"([^"]+)"%s*,%s*"value"')
      or chunk:match('"key"%s*:%s*{[^}]-"field"%s*:%s*"([^"]+)"')
  local key_value = tonumber(chunk:match('"value"%s*:%s*(-?[%d%.]+)'))
  if tbl and field and original and written and key_field and key_value then
    tests[#tests + 1] = {
      table = tbl, field = field, original = original, written = written,
      key_field = key_field, key_value = key_value,
    }
  end
end

assert(#tests > 0, 'could not read any tests from the marker file — was step 05 interrupted?')
say(string.format('  recovered %d test(s) from the marker', #tests))
say('')

-- ── verify + restore ────────────────────────────────────────────────────────
local summary = {}

for _, t in ipairs(tests) do
  local status, observed = 'MISSING', nil

  local ok, err = pcall(function()
    local tbl = LE.db:GetTable(t.table)
    assert(tbl, 'GetTable returned nil')

    local rec = tbl:GetFirstRecord()
    local found = nil
    while rec and rec > 0 do
      if tbl:GetRecordFieldValue(rec, t.key_field) == t.key_value then found = rec break end
      rec = tbl:GetNextValidRecord()
    end
    assert(found, 'row not found again')

    observed = tbl:GetRecordFieldValue(found, t.field)
    if observed == t.written then
      status = 'PERSISTED'
    elseif observed == t.original then
      status = 'REVERTED'
    else
      status = 'CHANGED_BY_GAME'
    end

    -- restore whatever we found back to the original
    tbl:SetRecordFieldValue(found, t.field, t.original)
    local after = tbl:GetRecordFieldValue(found, t.field)
    assert(after == t.original, 'restore failed: value is now ' .. tostring(after))
  end)

  local line = string.format('  %-24s %-18s %-16s expected %s, found %s',
      t.table, t.field, status, tostring(t.written), tostring(observed))
  if not ok then line = line .. '   [' .. tostring(err) .. ']' end
  say(line)

  summary[#summary + 1] = { table = t.table, status = status, error = (not ok) and tostring(err) or nil }
end

-- ── verdict ─────────────────────────────────────────────────────────────────
local persisted, reverted, broken = 0, 0, 0
for _, s in ipairs(summary) do
  if s.status == 'PERSISTED' then persisted = persisted + 1
  elseif s.status == 'REVERTED' then reverted = reverted + 1
  else broken = broken + 1 end
end

say('')
say('─────────────────────────────────────────────')
say(string.format('  PERSISTED %d   REVERTED %d   OTHER %d', persisted, reverted, broken))
if persisted > 0 then
  say('  At least one table accepts durable writes. Those tables — and only')
  say('  those — may ever appear in a write instruction.')
else
  say('  Nothing persisted. Under this plan that is survivable: the MVP writes')
  say('  nothing to FC by design. But it means the product is read-only until')
  say('  a writable table is found. Record it and re-scope deliberately.')
end
say('  Originals have been restored. Save the career to make that stick.')
say('  Now write up docs/persistence-<build>.md.')
say('─────────────────────────────────────────────')
