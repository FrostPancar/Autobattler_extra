# Autobattler_extra on Render

Static hosting for the no-Firebase build (`index_extra.html`).

## Repo layout

- `index_extra.html` — full game; presets/HOF in browser localStorage
- `render-build.sh` — copies `index_extra.html` → `render-static/index.html`
- `render.yaml` — Render Blueprint (static site)

## Render setup

1. [Render Dashboard](https://dashboard.render.com) → **New** → **Blueprint**
2. Connect **`FrostPancar/Autobattler_extra`**, branch **`main`**
3. Apply blueprint → wait for **Live**
4. URL: `https://autobattler-extra.onrender.com` (or name shown in dashboard)

## Ship updates

```bash
git add index_extra.html
git commit -m "Update game"
git push
```

## Local test

```bash
bash render-build.sh
open render-static/index.html
```

Firebase is **not** used in this repo.
