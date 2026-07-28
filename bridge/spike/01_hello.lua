--[[  TENURE spike 01 — HELLO  (Ticket 5)
      ─────────────────────────────────────────────────────────────────────────
      Proves the whole transport chain in one shot:
        game process → Live Editor Lua → HTTP → local server on 127.0.0.1

      This script is READ ONLY. It changes nothing in your career.

      Run:  Live Editor overlay → Features → Lua Engine → execute → pick this file
      With: `node spike/server.mjs` already running in a terminal

      If HTTP fails (antivirus, firewall), it falls back to writing a file and
      says so — which is itself a result worth recording.
--]]

require 'imports/other/helpers'

local HANDSHAKE = (os.getenv('LOCALAPPDATA') or 'C:') .. '\\Tenure\\bridge\\handshake.json'
local FALLBACK_DIR = (os.getenv('LOCALAPPDATA') or 'C:') .. '\\Tenure\\spike'

-- ── tiny JSON encoder (fallback if the bundled lib is unavailable) ───────────
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
    for k, val in pairs(v) do
      parts[#parts + 1] = '"' .. esc(k) .. '":' .. encode(val)
    end
    return '{' .. table.concat(parts, ',') .. '}'
  end
  return 'null'
end

local function say(msg)
  print(msg)
  if LOGGER then LOGGER:LogInfo('[tenure] ' .. msg) end
end

-- ── read the handshake ──────────────────────────────────────────────────────
local function read_handshake()
  local f = io.open(HANDSHAKE, 'r')
  if not f then return nil, 'handshake not found at ' .. HANDSHAKE end
  local text = f:read('*a')
  f:close()
  -- deliberately not a full JSON parser: three fields, matched directly
  local port = text:match('"port"%s*:%s*(%d+)')
  local token = text:match('"token"%s*:%s*"([^"]+)"')
  if not port or not token then return nil, 'handshake file is malformed' end
  return { port = tonumber(port), token = token }
end

-- ── gather facts ────────────────────────────────────────────────────────────
local in_career = false
pcall(function() in_career = IsInCM() end)

local save_uid = nil
if in_career then pcall(function() save_uid = GetSaveUID() end) end

local le_version = 'unknown'
pcall(function() if LE_VERSION then le_version = LE_VERSION end end)

local in_game_date = nil
if in_career then
  pcall(function()
    local d = GetCurrentDate()
    in_game_date = string.format('%04d-%02d-%02d', d.year, d.month, d.day)
  end)
end

local payload = {
  protocol = 1,
  kind = 'hello',
  le_version = le_version,
  game_build = 'detected_by_host',   -- the desktop side reads this from the exe manifest
  in_career = in_career,
  save_uid = save_uid or '',
  in_game_date = in_game_date or '',
  lua_version = _VERSION,
  sent_at_clock = os.clock(),
}

say('─────────────────────────────────────────────')
say('TENURE spike 01 — hello')
say('  LE version   : ' .. le_version)
say('  in career    : ' .. tostring(in_career))
say('  save uid     : ' .. (save_uid or '(none)'))
say('  in-game date : ' .. (in_game_date or '(none)'))

-- ── try HTTP ────────────────────────────────────────────────────────────────
local hs, hs_err = read_handshake()
local delivered = false

if not hs then
  say('  transport    : NO HANDSHAKE — ' .. tostring(hs_err))
  say('                 is `node spike/server.mjs` running?')
else
  local ok, result = pcall(function()
    local req = REQUEST:new({
      method = HTTP_POST_REQUEST,
      url = string.format('http://127.0.0.1:%d/v1/hello', hs.port),
      timeout = 10000,
    })
    req:SetHeaders({
      ['Content-Type'] = 'application/json',
      ['Authorization'] = 'Bearer ' .. hs.token,
    })
    req:SetBody(encode(payload))
    return HTTP:send(req)
  end)

  if ok and result and result.status_code == 200 then
    delivered = true
    say('  transport    : HTTP OK (200) on port ' .. hs.port)
    say('                 server said: ' .. tostring(result.text))
  elseif ok and result then
    say('  transport    : HTTP reached the server but returned ' .. tostring(result.status_code))
    say('                 body: ' .. tostring(result.text))
  else
    say('  transport    : HTTP FAILED — ' .. tostring(result))
    say('                 likely antivirus or firewall. File fallback follows.')
  end
end

-- ── file fallback, always written so there is a record either way ───────────
local fpath = FALLBACK_DIR .. '\\hello_fallback.json'
local f = io.open(fpath, 'w+')
if f then
  f:write(encode(payload))
  f:close()
  say('  file record  : ' .. fpath)
else
  say('  file record  : FAILED to write ' .. fpath)
  say('                 does the folder exist? run `node spike/server.mjs` once.')
end

say('  result       : ' .. (delivered and 'PASS — transport works end to end'
                                      or  'PARTIAL — see transport line above'))
say('─────────────────────────────────────────────')
