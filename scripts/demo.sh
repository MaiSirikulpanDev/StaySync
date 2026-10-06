#!/usr/bin/env bash
# Walks through StaySync against a running `docker compose up`.
# Needs only bash and curl. Override API / OTA / API_KEY if you changed the defaults.
set -euo pipefail

API=${API:-http://localhost:3000}
OTA=${OTA:-http://localhost:4000}
KEY=${API_KEY:-dev-api-key}

# GNU date first, BSD/macOS date as the fallback.
in_days() { date -u -d "+$1 days" +%F 2>/dev/null || date -u -v+"$1"d +%F; }
say() { printf '\n\033[1m== %s\033[0m\n' "$1"; }
field() { grep -o "\"$1\":\"[^\"]*\"" | head -1 | cut -d'"' -f4; }
call() { # call METHOD PATH [JSON] -> prints "<status> <body>"
  local method=$1 path=$2 body=${3:-}
  curl -s -w ' [HTTP %{http_code}]' -X "$method" "$API$path" \
    -H "x-api-key: $KEY" -H 'content-type: application/json' ${body:+-d "$body"}
  echo
}

IN=$(in_days 10); OUT=$(in_days 13)
OTA_IN=$(in_days 20); OTA_OUT=$(in_days 23)
CLASH_IN=$(in_days 11); CLASH_OUT=$(in_days 12)
LISTING="demo-$(date +%s)"

say "1. Health (database + RabbitMQ)"
curl -s "$API/health"; echo

say "2. Create a property"
PROP=$(curl -s -X POST "$API/properties" -H "x-api-key: $KEY" -H 'content-type: application/json' \
  -d '{"name":"Demo Villa","timezone":"Australia/Brisbane","currency":"AUD","baseRateCents":15000,"minStay":2,"maxGuests":4}')
echo "$PROP"
ID=$(echo "$PROP" | field id)
TOKEN=$(echo "$PROP" | field icalToken)

say "3. Connect it to the mock OTA (listing $LISTING) and add a +20% weekend rule"
call POST "/properties/$ID/channels" "{\"type\":\"MOCK_OTA\",\"listingId\":\"$LISTING\"}"
call POST "/properties/$ID/pricing-rules" '{"type":"WEEKEND","adjustPercent":20}'

say "4. Quote $IN to $OUT (per-night breakdown, weekend uplift applied)"
call GET "/properties/$ID/quote?checkIn=$IN&checkOut=$OUT&guests=2"

say "5. Book it"
call POST "/properties/$ID/stays" \
  "{\"kind\":\"BOOKING\",\"checkIn\":\"$IN\",\"checkOut\":\"$OUT\",\"guestName\":\"Ada Lovelace\",\"guests\":2}"

say "6. Try to double-book overlapping dates -> 409 from the database constraint"
call POST "/properties/$ID/stays" \
  "{\"kind\":\"BOOKING\",\"checkIn\":\"$CLASH_IN\",\"checkOut\":\"$(in_days 15)\",\"guestName\":\"Bob\",\"guests\":1}"

say "7. The booking reaches the mock OTA through the outbox and RabbitMQ"
for _ in $(seq 1 20); do
  CALLS=$(curl -s "$OTA/_calls")
  echo "$CALLS" | grep -q "\"listingId\":\"$LISTING\"" && break
  sleep 1
done
echo "$CALLS" | grep -q "\"listingId\":\"$LISTING\"" \
  && echo "mock OTA received an availability push for $LISTING" \
  || { echo "no push seen after 20s"; exit 1; }

say "8. The OTA sends us a booking (signed webhook) for $OTA_IN to $OTA_OUT"
curl -s -X POST "$OTA/_simulate/booking" -H 'content-type: application/json' \
  -d "{\"type\":\"booking.created\",\"listingId\":\"$LISTING\",\"bookingId\":\"ota-$LISTING\",\"checkIn\":\"$OTA_IN\",\"checkOut\":\"$OTA_OUT\",\"guestName\":\"Grace Hopper\",\"guests\":2,\"totalCents\":60000}"
echo

say "9. An OTA booking that overlaps ours is an overbooking -> recorded for a human, OTA still gets 200"
curl -s -X POST "$OTA/_simulate/booking" -H 'content-type: application/json' \
  -d "{\"type\":\"booking.created\",\"listingId\":\"$LISTING\",\"bookingId\":\"ota-clash-$LISTING\",\"checkIn\":\"$CLASH_IN\",\"checkOut\":\"$CLASH_OUT\",\"guestName\":\"Clash\",\"guests\":1}"
echo
call GET "/sync-issues?resolved=false" | cut -c1-300

say "10. Availability for the next 25 days"
AV=$(curl -s "$API/properties/$ID/availability?from=$(in_days 0)&to=$(in_days 25)" -H "x-api-key: $KEY")
echo "$(echo "$AV" | grep -o '"available":false' | wc -l | tr -d ' ') unavailable nights (3 direct + 3 from the OTA)"

say "11. iCal feed for Airbnb / Booking.com (no guest details)"
curl -s "$API/properties/$ID/calendar.ics?token=$TOKEN"

printf '\nDone. Swagger UI: %s/docs   RabbitMQ UI: http://localhost:15672 (guest/guest)\n' "$API"
