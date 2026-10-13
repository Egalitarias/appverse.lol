# Browser tests: the sandbox escape routes

`npm test` checks the sandbox's code. These tests check the sandbox itself, in the real browsers: they run a hostile app and watch
whether anything gets out. They need a dependency (Playwright), so they live apart in `tests/browser/` and the site and `npm test` stay
free of dependencies.

```
cd tests/browser
npm ci
npx playwright install chromium firefox webkit      # once
npx playwright test                                  # or, from the top folder: npm run test:browser
BROWSERS=chromium npx playwright test --project=chromium     # one engine
```

CI runs them in `.github/workflows/browser.yml`, apart from the main tests.

## How it works

- `servers.mjs`: the **site** (this repository, served with the headers that `tools/Caddyfile` gives the real site: the policy is read
  out of that file, so it cannot drift) and a **canary** on another origin that answers anything and records every way it was reached:
  HTTP, a WebSocket upgrade, a bare TCP connection, a UDP packet. Anything the canary hears from an app is an escape.
- `probes.mjs`: about 85 attacks on one page: fetch, XHR, beacons, WebSocket, EventSource, images, CSS (`url()`, `@import`, fonts, masks),
  stylesheets, scripts, dynamic `import()`, workers, frames (`src`, `srcdoc`, blob, data), objects, media, forms, popups, downloads,
  dialogs, cookies, WebRTC, navigating the frame or the top page, rewriting the document, removing the policy tag, reaching the site's own
  origin, and the `postMessage` bridge (calls without a permission, forged messages, names like `constructor`).
- `run.mjs` and `global-setup.mjs`: run each browser through the attacks **twice**, once as an app in the real sandbox, and once on a
  **control** page with no sandbox and no policy. Everything that happened is written to `.results/<engine>.json` (not committed).
- `escape.spec.mjs`: one test per attack. In the sandbox it must not get out; on the control page each attack a browser can observe must
  get out. That second half is what makes the first one mean something: an attack that does not work on an open page proves nothing
  when it fails in the sandbox. `storage.spec.mjs` asks who can see an app's saved data: it belongs to the package (its SHA-256), never to the `id` the author wrote, so
  no app can read another's by claiming its id.

Attacks that wreck or navigate their own page (rewriting the document, `location = ...`, navigating the top page) run last, each on a fresh
page, because a blocked navigation replaces the frame with an error page and ends the app's script.

## Known gaps

A gap is listed in `KNOWN_GAPS` in `escape.spec.mjs`: the test passes while the gap is open
and fails the day it closes, so the entry gets deleted then. Nothing else is allowed through.

- **WebRTC in Chromium.** A content-security-policy does not cover WebRTC. An app can make the browser send UDP (STUN) packets to any
  address, which is a way to send data out. Not blocked today. In Firefox and WebKit the same attack does not reach the canary even with
  no sandbox, so it says nothing about them either way.

## Are the tests any good?

They were checked by breaking the sandbox on purpose. With the network allowed in both the app's policy and the page's policy, the
network attacks failed the tests; with the `sandbox` attribute loosened, the popup and storage checks failed; with the app's own policy
tag removed, every attack that reaches back to the site's own origin failed in all three engines. (The page's own policy and the app's
policy overlap, so one of them alone is not enough to show a gap: that is why the same-origin attacks exist.) Do the same when you change
`js/sandbox.js` or `tools/Caddyfile`.

## Adding an attack

Add a `net`, `cap` or `works` entry to `PROBES` in `probes.mjs`. Run it: if it does not reach the canary on the control page in some
engine, remove that engine from its `control` list (the test says it cannot be observed there); if it gets out of the sandbox, that is a
finding, not a test to loosen.
