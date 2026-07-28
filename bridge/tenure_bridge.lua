-- TENURE production bridge entry point.
--
-- Read-only in Phases 0–2. It announces the live career to the desktop server;
-- snapshot/export readers are added only after the real FC schema spike is
-- recorded. It is never installed into autorun without explicit user consent.

require 'imports/other/helpers'
local transport = require 'tenure/lib/transport'

local in_career = false
pcall(function() in_career = IsInCM() end)

local save_uid = ''
local in_game_date = ''
if in_career then
  pcall(function() save_uid = GetSaveUID() or '' end)
  pcall(function()
    local date = GetCurrentDate()
    in_game_date = string.format('%04d-%02d-%02d', date.year, date.month, date.day)
  end)
end

local payload = {
  protocol = 1,
  kind = 'hello',
  le_version = LE_VERSION or 'unknown',
  game_build = 'detected_by_host',
  in_career = in_career,
  save_uid = save_uid,
  in_game_date = in_game_date,
  lua_version = _VERSION,
}

local response, problem = transport.post('/v1/hello', payload)
if response then
  print('[tenure] bridge connected: HTTP ' .. tostring(response.status_code))
else
  print('[tenure] bridge connection failed: ' .. tostring(problem))
end
