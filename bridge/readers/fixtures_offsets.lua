--[[  TENURE build-sensitive fixtures / standings reader  (Ticket 8)
      ─────────────────────────────────────────────────────────────────────────
      The single highest-value fact you can learn today.

      Fixtures, results and league tables have NO stable API. They are reached by
      walking raw pointers at hard-coded offsets, which are bound to a specific
      game build. This probe finds out whether that path is alive on YOUR build,
      and fails loudly and specifically if it is not.

      Offsets follow the official example script (lua/export_fixtures.lua in
      xAranaktu/FC-26-Live-Editor). If they have moved, this is exactly the file
      that will need re-deriving — which is why it is isolated here and nowhere
      else in the project.

      This script is READ ONLY.

      Output: %LOCALAPPDATA%\Tenure\spike\fixtures_<date>.ndjson
              + a PASS / FAIL verdict in the console
--]]

MEMORY = require 'imports/core/memory'
require 'imports/other/helpers'
require 'imports/services/enums'

local OUT_DIR = (os.getenv('LOCALAPPDATA') or 'C:') .. '\\Tenure\\spike'
local ENVIRONMENT = (os.getenv('LOCALAPPDATA') or 'C:') .. '\\Tenure\\bridge\\environment.json'
local EXPECTED_BUILD = '1.0.138.57785'
local EXPECTED_LE = 'v26.3.5'

-- Sanity bounds, from templates/LIVE_EDITOR_LIMITS.json in the Live Editor repo.
local MAX_FIXTURES  = 5000
local MAX_STANDINGS = 6000

assert(IsInCM(), 'Run this in career mode — load your save first.')

local environment_file = io.open(ENVIRONMENT, 'r')
assert(environment_file,
  'No host environment record. Run `node spike/detect.mjs` before this probe.')
local environment_text = environment_file:read('*a')
environment_file:close()
local detected_build = environment_text:match('"game_build"%s*:%s*"([^"]+)"')
assert(detected_build == EXPECTED_BUILD,
  'Refusing memory offsets for FC build ' .. tostring(detected_build) ..
  '; this reader is guarded for ' .. EXPECTED_BUILD .. ' only.')
assert(tostring(LE_VERSION) == EXPECTED_LE,
  'Refusing memory offsets with Live Editor ' .. tostring(LE_VERSION) ..
  '; this reader is guarded for ' .. EXPECTED_LE .. ' only.')

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

local problems = {}
local function fail(stage, detail)
  problems[#problems + 1] = { stage = stage, detail = tostring(detail) }
  say('  FAIL @ ' .. stage .. ': ' .. tostring(detail))
end

-- ── pointer walk ────────────────────────────────────────────────────────────
local function get_data_manager()
  local iface = GetPlugin(ENUM_djb2IFCEInterface_CLSS)
  assert(iface and iface ~= 0, 'GetPlugin(IFCEInterface) returned 0')
  local mgr = MEMORY:ReadMultilevelPointer(iface, { 0x18, 0x10, 0x08, 0x00 })
  assert(mgr and mgr ~= 0, 'multilevel pointer resolved to 0')
  return mgr
end

local function read_list(mgr, list_offset, item_size, max_expected, label)
  local list = MEMORY:ReadPointer(mgr + list_offset)
  assert(list and list ~= 0, label .. ' list pointer is 0')
  local begin_ptr = MEMORY:ReadPointer(list + 0x28)
  assert(begin_ptr and begin_ptr ~= 0, label .. ' begin pointer is 0')
  local count = MEMORY:ReadInt(list + 0x1C)
  assert(count and count > 0, label .. ' count is ' .. tostring(count))
  assert(count <= max_expected * 2,
      string.format('%s count %d is implausible (limit ~%d) — offsets have probably moved',
        label, count, max_expected))
  return begin_ptr, count, item_size
end

local function read_standings(mgr)
  local base, count, size = read_list(mgr, 0x88, 0x18, MAX_STANDINGS, 'standings')
  local by_index, list = {}, {}
  for i = 0, count - 1 do
    local cur = base + (size * i)
    local used = MEMORY:ReadBool(cur + 0x16)
    local team_id = MEMORY:ReadInt(cur + 0x04)
    local row = {
      index = i,
      id = MEMORY:ReadShort(cur + 0x00),
      comp_obj_id = MEMORY:ReadShort(cur + 0x02),
      team_id = team_id,
      home_w = MEMORY:ReadChar(cur + 0x09), home_d = MEMORY:ReadChar(cur + 0x0A),
      home_l = MEMORY:ReadChar(cur + 0x0B), home_gf = MEMORY:ReadChar(cur + 0x0C),
      home_ga = MEMORY:ReadChar(cur + 0x0D),
      away_w = MEMORY:ReadChar(cur + 0x0E), away_d = MEMORY:ReadChar(cur + 0x0F),
      away_l = MEMORY:ReadChar(cur + 0x10), away_gf = MEMORY:ReadChar(cur + 0x11),
      away_ga = MEMORY:ReadChar(cur + 0x12),
      points = MEMORY:ReadShort(cur + 0x14),
    }
    by_index[i] = row
    if used and team_id and team_id > 0 then list[#list + 1] = row end
  end
  return list, by_index, count
end

local function read_fixtures(mgr)
  local base, count, size = read_list(mgr, 0x60, 0x18, MAX_FIXTURES, 'fixtures')
  local list = {}
  for i = 0, count - 1 do
    local cur = base + (size * i)
    if MEMORY:ReadBool(cur + 0x14) then
      list[#list + 1] = {
        date = MEMORY:ReadInt(cur + 0x00),
        time = MEMORY:ReadShort(cur + 0x04),
        id = MEMORY:ReadShort(cur + 0x06),
        comp_obj_id = MEMORY:ReadShort(cur + 0x08),
        home_standing_index = MEMORY:ReadShort(cur + 0x0A),
        away_standing_index = MEMORY:ReadShort(cur + 0x0C),
        match_group_id = MEMORY:ReadChar(cur + 0x0E),
        home_score = MEMORY:ReadChar(cur + 0x0F),
        home_pens = MEMORY:ReadChar(cur + 0x10),
        away_score = MEMORY:ReadChar(cur + 0x11),
        away_pens = MEMORY:ReadChar(cur + 0x12),
        played = MEMORY:ReadBool(cur + 0x13),
      }
    end
  end
  return list, count
end

-- ── run ─────────────────────────────────────────────────────────────────────
say('─────────────────────────────────────────────')
say('TENURE spike 04 — fixtures / standings probe')
say('  LE version: ' .. tostring(LE_VERSION))

local t0 = os.clock()
local mgr, standings, standings_by_index, fixtures
local ok

ok, mgr = pcall(get_data_manager)
if not ok then fail('data_manager', mgr) end

if ok then
  local res = { pcall(read_standings, mgr) }
  if res[1] then
    standings, standings_by_index = res[2], res[3]
    say(string.format('  standings : %d valid rows', #standings))
  else
    fail('standings', res[2])
  end

  local fres = { pcall(read_fixtures, mgr) }
  if fres[1] then
    fixtures = fres[2]
    say(string.format('  fixtures  : %d valid rows', #fixtures))
  else
    fail('fixtures', fres[2])
  end
end

-- ── plausibility checks: reading numbers is not the same as reading the RIGHT numbers ──
local checks = {}
if fixtures and standings_by_index then
  local played, scored_sane, resolved_teams, comps = 0, 0, 0, {}
  local today = GetCurrentDate():ToInt()
  local date_sane = 0
  for _, f in ipairs(fixtures) do
    if f.played then played = played + 1 end
    if f.home_score >= 0 and f.home_score <= 20 and f.away_score >= 0 and f.away_score <= 20 then
      scored_sane = scored_sane + 1
    end
    local hs = standings_by_index[f.home_standing_index]
    local as = standings_by_index[f.away_standing_index]
    if hs and as and hs.team_id > 0 and as.team_id > 0 then resolved_teams = resolved_teams + 1 end
    comps[f.comp_obj_id] = true
    -- fixture dates should sit in a window either side of "today" in career terms
    if f.date and math.abs(f.date - today) < 2000 then date_sane = date_sane + 1 end
  end
  local ncomps = 0
  for _ in pairs(comps) do ncomps = ncomps + 1 end

  checks = {
    fixtures_found = #fixtures,
    played_fixtures = played,
    scores_in_range_pct = #fixtures > 0 and math.floor(scored_sane / #fixtures * 100) or 0,
    team_ids_resolved_pct = #fixtures > 0 and math.floor(resolved_teams / #fixtures * 100) or 0,
    dates_plausible_pct = #fixtures > 0 and math.floor(date_sane / #fixtures * 100) or 0,
    distinct_competitions = ncomps,
  }
  say(string.format('  played    : %d', played))
  say(string.format('  scores in range   : %d%%', checks.scores_in_range_pct))
  say(string.format('  team ids resolved : %d%%', checks.team_ids_resolved_pct))
  say(string.format('  dates plausible   : %d%%', checks.dates_plausible_pct))
  say(string.format('  competitions      : %d', ncomps))
end

local verdict = 'FAIL'
if #problems == 0 and checks.fixtures_found and checks.fixtures_found > 50
   and checks.team_ids_resolved_pct >= 95 and checks.scores_in_range_pct >= 95 then
  verdict = (checks.dates_plausible_pct or 0) >= 80 and 'PASS' or 'PASS_WITH_DOUBT'
end

-- ── write output ────────────────────────────────────────────────────────────
local d = GetCurrentDate()
local path = string.format('%s\\fixtures_%04d%02d%02d.ndjson', OUT_DIR, d.year, d.month, d.day)
local out = io.open(path, 'w+')
if out then
  out:write(encode({
    record = 'meta', verdict = verdict, le_version = LE_VERSION or 'unknown',
    in_game_date = string.format('%04d-%02d-%02d', d.year, d.month, d.day),
    in_game_date_int = d:ToInt(),
    checks = checks, problems = problems,
    elapsed_ms = math.floor((os.clock() - t0) * 1000),
  }) .. '\n')
  if standings then
    for _, s in ipairs(standings) do out:write(encode({ record = 'standing', data = s }) .. '\n') end
  end
  if fixtures then
    for _, f in ipairs(fixtures) do out:write(encode({ record = 'fixture', data = f }) .. '\n') end
  end
  out:close()
  say('  written   : ' .. path)
else
  say('  WARNING: could not write ' .. path)
end

say('─────────────────────────────────────────────')
say('  VERDICT: ' .. verdict)
if verdict == 'FAIL' then
  say('  The offset path is broken on this build.')
  say('  This does not kill the project — it means results must be entered')
  say('  manually until the offsets are re-derived. Record this in docs/.')
elseif verdict == 'PASS_WITH_DOUBT' then
  say('  Structure reads fine but the date field looks off. Check the date')
  say('  encoding before trusting fixture scheduling.')
else
  say('  The fragile path is alive on this build. Record the build number.')
end
say('─────────────────────────────────────────────')
