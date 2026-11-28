#!/usr/bin/env bash
# The AI part of the demo: a guest writes, the agent drafts a reply and files a proposal, a person
# approves it, and the change reaches the mock OTA. Run by demo.sh when the agent is up, or alone:
#   PROPERTY=<id> STAY=<id> LISTING=<ota listing id> ./scripts/demo-agent.sh
# Needs the agent running (this calls the paid Claude API, a fraction of a cent per message):
#   ANTHROPIC_API_KEY=sk-ant-... docker compose --profile ai up -d agent
# Needs only bash and curl.
set -euo pipefail

API=${API:-http://localhost:3000}
OTA=${OTA:-http://localhost:4000}
KEY=${API_KEY:-dev-api-key}
JAEGER=${JAEGER:-http://localhost:16686}
WAIT_RUN=${WAIT_RUN:-120} # seconds to wait for the agent
: "${PROPERTY:?set PROPERTY to a property id}" "${STAY:?set STAY to the stay id of the guest}" "${LISTING:?set LISTING to the mock OTA listing id}"

say() { printf '\n\033[1m== %s\033[0m\n' "$1"; }
api() { # api METHOD PATH [JSON] -> body
  local method=$1 path=$2 body=${3:-}
  curl -s -X "$method" "$API$path" -H "x-api-key: $KEY" -H 'content-type: application/json' ${body:+-d "$body"}
}
field() { grep -o "\"$1\":\"[^\"]*\"" | head -1 | cut -d'"' -f4; }
# grep exits 1 on no match, which pipefail would turn into a failure; these only read, so ignore it
ota_pushes() { curl -s "$OTA/_calls" | grep -o "\"listingId\":\"$LISTING\"" | wc -l | tr -d ' ' || true; }

say "12. A guest asks to extend their stay by one night"
MESSAGE=$(api POST "/properties/$PROPERTY/guest-messages" \
  "{\"fromName\":\"Ada Lovelace\",\"body\":\"Hi! Could we extend our stay by one night, please?\",\"stayId\":\"$STAY\"}")
echo "$MESSAGE"
MESSAGE_ID=$(echo "$MESSAGE" | field id)
[ -n "$MESSAGE_ID" ] || { echo "the message was not accepted"; exit 1; }

say "13. The agent reads it through MCP, drafts a reply and files a proposal (up to ${WAIT_RUN}s)"
VIEW=""
for _ in $(seq 1 "$WAIT_RUN"); do
  VIEW=$(api GET "/guest-messages/$MESSAGE_ID")
  # a run that is no longer RUNNING, and a draft saved
  echo "$VIEW" | grep -q '"status":"RUNNING"' && { sleep 1; continue; }
  echo "$VIEW" | grep -q '"status":"\(SUCCEEDED\|FAILED\|TIMED_OUT\|SKIPPED_BUDGET\)"' && break
  sleep 1
done
echo "$VIEW" | grep -q '"runs":\[{' || {
  echo "no agent run after ${WAIT_RUN}s: is the agent running? ANTHROPIC_API_KEY=... docker compose --profile ai up -d agent"
  exit 1
}
RUN_STATUS=$(echo "$VIEW" | grep -o '"status":"\(SUCCEEDED\|FAILED\|TIMED_OUT\|SKIPPED_BUDGET\)"' | head -1 | cut -d'"' -f4 || true)
echo "run status: $RUN_STATUS"
echo "reply draft (nothing is sent to the guest):"
echo "$VIEW" | grep -o '"replyDraft":"[^"]*"' | head -1 | cut -d'"' -f4 || true

# Prisma lists a proposal's id first, so the first id after "proposals" is the proposal's own.
PROPOSAL_ID=$(echo "$VIEW" | grep -o '"proposals":\[{"id":"[^"]*"' | head -1 | cut -d'"' -f6 || true)
if [ "$RUN_STATUS" != "SUCCEEDED" ] || [ -z "$PROPOSAL_ID" ]; then
  echo "the agent filed no proposal (run $RUN_STATUS); the draft above is all it produced"
  exit 0
fi
echo "proposal $PROPOSAL_ID, nothing has changed yet:"
echo "$VIEW" | grep -o '"proposals":\[{[^]]*\]' | head -1

say "14. The owner approves it: only now does anything change, through the same path as a normal booking"
BEFORE=$(ota_pushes)
api POST "/agent-proposals/$PROPOSAL_ID/approve"
echo

say "15. The changed stay reaches the mock OTA through the outbox and Kafka"
NOW=$BEFORE
for _ in $(seq 1 30); do
  NOW=$(ota_pushes)
  [ "$NOW" -gt "$BEFORE" ] && break
  sleep 1
done
[ "$NOW" -gt "$BEFORE" ] \
  && echo "mock OTA received another availability push for $LISTING" \
  || { echo "no push seen after 30s (the proposal may have been refused: see its status above)"; exit 1; }

printf '\nTrace: %s (service staysync-api, the POST /properties/%s/guest-messages trace: outbox, Kafka,\nthe agent run with one span per model turn and tool call, and the MCP spans under it).\n' "$JAEGER" "$PROPERTY"
