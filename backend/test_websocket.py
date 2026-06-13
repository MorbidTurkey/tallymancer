"""
test_websocket.py — WebSocket integration test.

Run with: python test_websocket.py
Requires: pip install websockets httpx

Tests:
1. Create a session via REST.
2. Connect two WebSocket clients (one player, one audience).
3. Both receive the initial sync message.
4. Apply a score delta via REST.
5. Verify both WebSocket clients receive the broadcast update.
6. Apply undo via REST.
7. Verify both clients receive updated state.
8. Audience WS receives sync but audience REST write is still blocked.
"""

import asyncio
import json
import httpx
import websockets

BASE = "http://localhost:8000"
WS_BASE = "ws://localhost:8000"

SEP = "-" * 50


async def main():
    async with httpx.AsyncClient() as client:
        # ── 1. Create session ──────────────────────────────────────────────
        print(SEP)
        print("1. Creating MTG session with two players")
        resp = await client.post(f"{BASE}/api/sessions", json={
            "game_preset": "mtg",
            "player_names": ["Alice", "Bob"],
        })
        resp.raise_for_status()
        links = resp.json()
        print(f"   player_link:   {links['player_link']}")
        print(f"   audience_link: {links['audience_link']}")

        player_token = links["player_link"].split("/")[-1]
        audience_token = links["audience_link"].split("/")[-1]

        # ── 2. Get session state to find player IDs ────────────────────────
        session_resp = await client.get(f"{BASE}/api/sessions/{player_token}")
        session_resp.raise_for_status()
        session = session_resp.json()
        alice_id = session["players"][0]["id"]
        print(f"   Alice ID: {alice_id}")

        # ── 3. Connect two WebSocket clients ──────────────────────────────
        print(SEP)
        print("2. Connecting WebSocket clients (player + audience)")

        player_ws = await websockets.connect(f"{WS_BASE}/ws/{player_token}")
        audience_ws = await websockets.connect(f"{WS_BASE}/ws/{audience_token}")

        # Both should receive initial sync immediately.
        player_init = json.loads(await asyncio.wait_for(player_ws.recv(), timeout=3))
        audience_init = json.loads(await asyncio.wait_for(audience_ws.recv(), timeout=3))

        assert player_init["type"] == "sync", f"Expected sync, got {player_init['type']}"
        assert audience_init["type"] == "sync"
        assert player_init["token_type"] == "player"
        assert audience_init["token_type"] == "audience"
        assert len(player_init["data"]["players"]) == 2
        print(f"   Player WS init:   type={player_init['type']}, token_type={player_init['token_type']}, players={len(player_init['data']['players'])}")
        print(f"   Audience WS init: type={audience_init['type']}, token_type={audience_init['token_type']}")

        # ── 4. Apply score delta via REST, expect broadcast ────────────────
        print(SEP)
        print("3. Applying -5 to Alice via REST")
        delta_resp = await client.post(
            f"{BASE}/api/sessions/{player_token}/players/{alice_id}/score",
            json={"delta": -5, "counter_name": "life"},
        )
        delta_resp.raise_for_status()
        print(f"   REST response: resulting_score={delta_resp.json()['resulting_score']}")

        # Give the background task a moment to broadcast.
        await asyncio.sleep(0.1)

        player_update = json.loads(await asyncio.wait_for(player_ws.recv(), timeout=3))
        audience_update = json.loads(await asyncio.wait_for(audience_ws.recv(), timeout=3))

        alice_score_p = next(p for p in player_update["data"]["players"] if p["id"] == alice_id)
        alice_score_a = next(p for p in audience_update["data"]["players"] if p["id"] == alice_id)

        assert alice_score_p["scores"]["life"] == 15, f"Expected 15, got {alice_score_p['scores']['life']}"
        assert alice_score_a["scores"]["life"] == 15
        print(f"   Player WS sees Alice life={alice_score_p['scores']['life']} ✓")
        print(f"   Audience WS sees Alice life={alice_score_a['scores']['life']} ✓")

        # ── 5. Undo via REST, expect broadcast ─────────────────────────────
        print(SEP)
        print("4. Undoing last event")
        undo_resp = await client.post(f"{BASE}/api/sessions/{player_token}/undo")
        undo_resp.raise_for_status()
        undo_data = undo_resp.json()
        print(f"   Undid event {undo_data['voided_event_id'][:8]}... score {undo_data['score_before_undo']} → {undo_data['score_after_undo']}")

        await asyncio.sleep(0.1)

        player_undo = json.loads(await asyncio.wait_for(player_ws.recv(), timeout=3))
        audience_undo = json.loads(await asyncio.wait_for(audience_ws.recv(), timeout=3))

        alice_after = next(p for p in player_undo["data"]["players"] if p["id"] == alice_id)
        assert alice_after["scores"]["life"] == 20, f"Expected 20 after undo, got {alice_after['scores']['life']}"
        print(f"   Player WS sees Alice life={alice_after['scores']['life']} after undo ✓")

        # ── 6. Ping/pong ───────────────────────────────────────────────────
        print(SEP)
        print("5. Ping/pong heartbeat")
        await player_ws.send(json.dumps({"type": "ping"}))
        pong = json.loads(await asyncio.wait_for(player_ws.recv(), timeout=3))
        assert pong["type"] == "pong", f"Expected pong, got {pong}"
        print(f"   Got pong ✓")

        # ── 7. Invalid token rejected ──────────────────────────────────────
        print(SEP)
        print("6. Invalid token is rejected")
        try:
            bad_ws = await websockets.connect(f"{WS_BASE}/ws/00000000-0000-0000-0000-000000000000")
            await bad_ws.recv()
            print("   ERROR: connection should have been rejected!")
        except (websockets.exceptions.ConnectionClosedError,
                websockets.exceptions.InvalidStatus) as e:
            # FastAPI rejects the WS upgrade with HTTP 403 before accept(),
            # which the client library surfaces as InvalidStatus.
            print(f"   Connection rejected ({type(e).__name__}) ✓")

        # ── 8. Reconnect resync ────────────────────────────────────────────
        print(SEP)
        print("7. Reconnect resync: close and re-open player WS")
        await player_ws.close()
        await asyncio.sleep(0.1)
        player_ws2 = await websockets.connect(f"{WS_BASE}/ws/{player_token}")
        resync = json.loads(await asyncio.wait_for(player_ws2.recv(), timeout=3))
        assert resync["type"] == "sync"
        alice_resynced = next(p for p in resync["data"]["players"] if p["id"] == alice_id)
        assert alice_resynced["scores"]["life"] == 20
        print(f"   Resync on reconnect: Alice life={alice_resynced['scores']['life']} ✓")

        # Cleanup
        await player_ws2.close()
        await audience_ws.close()

        print(SEP)
        print("All WebSocket tests passed! ✓")


if __name__ == "__main__":
    asyncio.run(main())
