#!/usr/bin/env bash
# Walks through the whole system. Needs: docker compose up -d, curl, jq.
set -euo pipefail
API=${API:-http://localhost:3000}
JSON='content-type: application/json'
DEVICE=brewer-001

step() { printf '\n\033[1m== %s\033[0m\n' "$1"; }
set_failure_rate() { docker compose exec -T mosquitto mosquitto_pub -t sim/config -m "{\"otaFailureRate\":$1}"; }

# Polls a rollout until it leaves RUNNING, printing progress whenever it changes.
wait_for_rollout() {
  local last="" now
  while true; do
    now=$(curl -s "$API/ota/rollouts/$1" | jq -c '{status, stage: .currentStage, progress}')
    [ "$now" != "$last" ] && echo "$now" && last=$now
    [ "$(echo "$now" | jq -r .status)" != RUNNING ] && break
    sleep 1
  done
}

step "1. Fleet"
curl -s "$API/devices" | jq -c '.[] | {id, firmwareVersion, online, state, waterTempC}'

step "2. Set desired state on $DEVICE and watch the delta clear"
curl -s -XPUT "$API/devices/$DEVICE/desired" -H "$JSON" \
  -d '{"targetTempC": 93, "brewRecipe": "espresso"}' | jq -c .shadow
for _ in $(seq 1 10); do
  delta=$(curl -s "$API/devices/$DEVICE" | jq -c .shadow.delta)
  echo "delta: $delta"
  [ "$delta" = "{}" ] && break
  sleep 1
done
curl -s "$API/devices/$DEVICE" | jq .shadow

step "3. Healthy rollout to 1.1.0 (stages 10% -> 50% -> 100%, abort above 20% failures)"
set_failure_rate 0
id=$(curl -s -XPOST "$API/ota/rollouts" -H "$JSON" \
  -d '{"targetVersion":"1.1.0","stages":[10,50,100],"failureThresholdPct":20}' | jq -r .id)
wait_for_rollout "$id"
sleep 6 # let the next telemetry report the new firmware version
curl -s "$API/devices" | jq -c '[.[].firmwareVersion] | group_by(.) | map({(.[0]): length}) | add'

step "4. Simulator failure rate -> 100%, rollout to 1.2.0 should abort after stage 1"
set_failure_rate 1
id=$(curl -s -XPOST "$API/ota/rollouts" -H "$JSON" \
  -d '{"targetVersion":"1.2.0","stages":[10,50,100],"failureThresholdPct":20}' | jq -r .id)
wait_for_rollout "$id"
curl -s "$API/ota/rollouts/$id" | jq -c '{status, jobs}'

set_failure_rate 0
echo; echo "done (failure rate reset to 0)"
