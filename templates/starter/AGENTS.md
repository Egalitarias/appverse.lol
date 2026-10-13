# Notes for AI agents

You are writing an Appverse app: a folder of plain HTML, CSS and JavaScript that is zipped into an `.applet` and run in a sandbox.

- Entry is `index.html`. Keep everything in this folder: **no network**. No CDN links, web fonts, `fetch`, XMLHttpRequest, WebSocket or remote images; they are blocked and `applet check` reports them.
- Use plain scripts (`<script src="app.js">`). ES module `import` of other files does not work: bundle first.
- Do not add a Content-Security-Policy tag: Appverse adds one and rejects packages that have their own.
- `localStorage`, `sessionStorage`, IndexedDB and cookies do not work. Use `await appverse.storage.get(key)` / `.set(key, value)` / `.remove(key)` (strings only, 256 KB total) and add `"storage"` to `permissions` in `manifest.json`.
- Other bridge calls, each needing its permission: `appverse.copyText(text)` (`clipboard`), `appverse.requestFullscreen()` (`fullscreen`). Ask only for what the app uses.
- Only these file kinds are allowed: html, css, js, json, txt, md, images (png, jpg, gif, webp, avif, svg, ico), fonts (woff, woff2, ttf, otf), audio (mp3, ogg, wav, m4a) and video (mp4, webm).
- Run `applet check` and fix every error before handing the folder back. This file (`AGENTS.md`) is left out of the package.
- Spec: https://appverse.lol/spec.html
