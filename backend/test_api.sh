#!/usr/bin/env bash
# test_api.sh — Manual smoke-test script using curl.
#
# Run the server first:
#   uvicorn app.main:app --reload --port 8000
#
# Then in another terminal:
#   bash test_api.sh
#
# Each command prints what it's testing, the request, and the response.
# Requires: curl, jq (for pretty-printing JSON)

set -e
BASE="http://localhost:8000"
SEP="─────────────────────────────────────────"

echo "$SEP"
echo "1. Health check"
curl -s "$BASE/health" | jq .

echo "$SEP"
echo "2. List presets"
curl -s "$BASE/api/presets" | jq '[.[] | {slug, name}]'

echo "$SEP"
echo "3. Create a session (MTG, 2 players)"
RESPONSE=$(curl -s -X POST "$BASE/api/sessions" \
  -H "Content-Type: application/json" \
  -d '{"game_preset": "mtg", "player_names": ["Alice", "Bob"]}')
echo "$RESPONSE" | jq .

# Extract tokens from the links
PLAYER_LINK=$(echo "$RESPONSE" | jq -r '.player_link')
AUDIENCE_LINK=$(echo "$RESPONSE" | jq -r '.audience_link')
PLAYER_TOKEN="${PLAYER_LINK##*/}"
AUDIENCE_TOKEN="${AUDIENCE_LINK##*/}"

echo "Player token:   $PLAYER_TOKEN"
echo "Audience token: $AUDIENCE_TOKEN"

echo "$SEP"
echo "4. Get session state (player token)"
SESSION=$(curl -s "$BASE/api/sessions/$PLAYER_TOKEN")
echo "$SESSION" | jq .

# Extract first player id
PLAYER_ID=$(echo "$SESSION" | jq -r '.players[0].id')
echo "First player ID: $PLAYER_ID"

echo "$SEP"
echo "5. Apply -3 delta to Alice (lose 3 life)"
curl -s -X POST "$BASE/api/sessions/$PLAYER_TOKEN/players/$PLAYER_ID/score" \
  -H "Content-Type: application/json" \
  -d '{"delta": -3, "counter_name": "life"}' | jq .

echo "$SEP"
echo "6. Session state after delta — Alice should be at 17"
curl -s "$BASE/api/sessions/$PLAYER_TOKEN" | jq '.players[] | {name, scores}'

echo "$SEP"
echo "7. Rename Alice to 'Alice (Storm)'  "
curl -s -X PATCH "$BASE/api/sessions/$PLAYER_TOKEN/players/$PLAYER_ID" \
  -H "Content-Type: application/json" \
  -d '{"name": "Alice (Storm)"}' | jq '{id, name}'

echo "$SEP"
echo "8. Add a third player mid-session"
NEW_PLAYER=$(curl -s -X POST "$BASE/api/sessions/$PLAYER_TOKEN/players" \
  -H "Content-Type: application/json" \
  -d '{"name": "Charlie", "color": "#e63946"}')
echo "$NEW_PLAYER" | jq .
NEW_PLAYER_ID=$(echo "$NEW_PLAYER" | jq -r '.id')

echo "$SEP"
echo "9. Undo last score change"
curl -s -X POST "$BASE/api/sessions/$PLAYER_TOKEN/undo" | jq .

echo "$SEP"
echo "10. Session state after undo — Alice should be back at 20"
curl -s "$BASE/api/sessions/$PLAYER_TOKEN" | jq '.players[] | {name, scores}'

echo "$SEP"
echo "11. Get full history log"
curl -s "$BASE/api/sessions/$PLAYER_TOKEN/history" | jq .

echo "$SEP"
echo "12. Audience token can READ session"
curl -s "$BASE/api/sessions/$AUDIENCE_TOKEN" | jq '{game_preset, token_type}'

echo "$SEP"
echo "13. Audience token cannot APPLY a delta (expect 403)"
curl -s -X POST "$BASE/api/sessions/$AUDIENCE_TOKEN/players/$PLAYER_ID/score" \
  -H "Content-Type: application/json" \
  -d '{"delta": -1}' | jq .

echo "$SEP"
echo "14. Remove Charlie"
curl -s -X DELETE "$BASE/api/sessions/$PLAYER_TOKEN/players/$NEW_PLAYER_ID" -o /dev/null -w "HTTP %{http_code}\n"

echo "$SEP"
echo "All smoke tests passed!"
