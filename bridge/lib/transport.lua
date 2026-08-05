-- TENURE bridge transport — authenticated loopback HTTP only.

require 'imports/other/helpers'

local M = {}
local HANDSHAKE = (os.getenv('LOCALAPPDATA') or 'C:') .. '\\Tenure\\bridge\\handshake.json'

local function escape(value)
  return (tostring(value):gsub('[%c"\\]', function(character)
    if character == '"' then return '\\"' end
    if character == '\\' then return '\\\\' end
    if character == '\n' then return '\\n' end
    if character == '\r' then return '\\r' end
    if character == '\t' then return '\\t' end
    return string.format('\\u%04x', string.byte(character))
  end))
end

local function sorted_keys(value)
  local keys = {}
  for key in pairs(value) do keys[#keys + 1] = tostring(key) end
  table.sort(keys)
  return keys
end

function M.encode(value)
  local kind = type(value)
  if kind == 'nil' then return 'null' end
  if kind == 'boolean' then return tostring(value) end
  if kind == 'number' then return string.format('%.14g', value) end
  if kind == 'string' then return '"' .. escape(value) .. '"' end
  if kind ~= 'table' then return 'null' end

  local parts = {}
  if #value > 0 then
    for index = 1, #value do parts[#parts + 1] = M.encode(value[index]) end
    return '[' .. table.concat(parts, ',') .. ']'
  end
  for _, key in ipairs(sorted_keys(value)) do
    parts[#parts + 1] = '"' .. escape(key) .. '":' .. M.encode(value[key])
  end
  return '{' .. table.concat(parts, ',') .. '}'
end

function M.read_handshake()
  local file = io.open(HANDSHAKE, 'r')
  if not file then return nil, 'handshake not found at ' .. HANDSHAKE end
  local text = file:read('*a')
  file:close()
  local port = text:match('"port"%s*:%s*(%d+)')
  local token = text:match('"token"%s*:%s*"([^"]+)"')
  local protocol = text:match('"protocol"%s*:%s*(%d+)')
  if not port or not token or not protocol then
    return nil, 'handshake file is malformed'
  end
  if tonumber(protocol) ~= 1 then
    return nil, 'unsupported bridge protocol ' .. tostring(protocol)
  end
  return { port = tonumber(port), token = token, protocol = tonumber(protocol) }
end

function M.post(route, payload, timeout)
  local handshake, problem = M.read_handshake()
  if not handshake then return nil, problem end
  local ok, response = pcall(function()
    local request = REQUEST:new({
      method = HTTP_POST_REQUEST,
      url = string.format('http://127.0.0.1:%d%s', handshake.port, route),
      timeout = timeout or 10000,
    })
    request:SetHeaders({
      ['Content-Type'] = 'application/json',
      ['Authorization'] = 'Bearer ' .. handshake.token,
    })
    request:SetBody(M.encode(payload))
    return HTTP:send(request)
  end)
  if not ok then return nil, tostring(response) end
  if not response then return nil, 'HTTP returned no response' end
  if response.status_code < 200 or response.status_code >= 300 then
    return nil, 'HTTP ' .. tostring(response.status_code) .. ': ' .. tostring(response.text)
  end
  return response
end

return M
