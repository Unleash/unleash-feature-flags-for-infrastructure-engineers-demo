-- Weighted 3:2:1 across FREE, REGULAR, and PREMIUM: at -R60 that yields
-- 30, 20, and 10 requests per second respectively.
-- base64("FREE"), base64("REGULAR"), base64("PREMIUM")
local FREE = "Bearer RlJFRQ=="
local REGULAR = "Bearer UkVHVUxBUg=="
local PREMIUM = "Bearer UFJFTUlVTQ=="
math.randomseed(os.time())

-- wrk.path is not reliably populated inside request() in this wrk2 build,
-- so the endpoint comes in via the environment (exported by the Makefile).
local endpoint = os.getenv("ENDPOINT") or "/get-transaction"
local method = "GET"
if endpoint == "/schedule-calculation" then
  method = "PUT"
elseif endpoint == "/write-transaction" then
  method = "POST"
end

request = function()
  local roll = math.random(6)
  local auth = PREMIUM
  if roll <= 3 then
    auth = FREE
  elseif roll <= 5 then
    auth = REGULAR
  end
  local path = endpoint .. "?ts=" .. os.time()
  return wrk.format(method, path, { ["Authorization"] = auth })
end
