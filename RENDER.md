# Autobattler_extra on Render

Static game + WebSocket co-op server (no Firebase).

## Services

| Service | URL | Role |
|---------|-----|------|
| `autobattler-extra` | `https://autobattler-extra.onrender.com` | Game (`index_extra.html`) |
| `coop-ws` | `wss://coop-ws.onrender.com` | Online co-op sync |

## Deploy

1. Push to `main` on [FrostPancar/Autobattler_extra](https://github.com/FrostPancar/Autobattler_extra).
2. Render Blueprint applies `render.yaml` (both services).
3. Wait for **both** deploys to be **Live**.

## Play co-op

1. Open the static site URL.
2. Start **Campaign**.
3. Click **Online Co-op: Off** → waits for WebSocket → **On**.
4. Friends open the same URL and join (global lobby).

Presets / Hall of Fame stay in **browser localStorage** (not shared).

## Local dev

```bash
# Terminal 1 — co-op server
cd coop-server && npm install && node server.js

# Terminal 2 — static files
bash render-build.sh
npx --yes serve render-static -p 8080
# Open http://localhost:8080?coopWs=ws://localhost:10000
```

## Limits (MVP)

- Co-op state lives in server memory (resets on redeploy / sleep).
- No Firebase; no cross-device preset sync.
- Online PvP still hidden on this build.
