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

None at the moment.

### WebRTC, and why the sandbox also refuses frames

A content-security-policy does not cover WebRTC, so an app could make the browser send UDP (STUN) packets to any address and put data
in them. Chromium and Firefox both did, until the sandbox page was changed (`GUARD` in `js/sandbox.js`):

1. The page loses `RTCPeerConnection` (and the prefixed names), and the property is locked.
2. That is not enough on its own. A frame the app makes (`iframe.srcdoc` is allowed by `frame-src 'none'`) is a new page with its own,
   untouched copy of the API, and the sandbox cannot reach into it. So a Trusted Types policy (the app's policy requires it for
   `'script'`, with one policy named `default`) refuses every way for a string to become a frame: the `srcdoc` property and
   attribute, HTML that mentions a frame, `document.write` (a tag can be written in two pieces), and script from a string (a
   `javascript:` URL). A frame written into the package's own page is made by the HTML parser, which no policy sees, so packing refuses it.
3. The 22 attacks in `probes.mjs` named `webrtc*` each have a UDP port of their own on the canary, so a packet says which route it
   took: the constructor, its prefixed name, a worker, nested frames made nine different ways, parse-time writes, and trying to get the
   original constructor back.

What the engines can show: the canary's STUN address is this machine's network address (some browsers will not send STUN to a loopback
address). Chromium and Firefox send packets on the control page, so there a "nothing reached the canary" result means something.
**The WebKit that Playwright runs has no WebRTC at all** (`RTCPeerConnection` is undefined), so nothing can be observed there; real
Safari has it, and the same guard applies to it.

### Host names are data too

Even with every request blocked, an app can make the browser look a name up. `<a href>`, `<link rel=dns-prefetch>` and
`<link rel=preconnect>` ask DNS about a host before any content-security-policy is consulted, and in Firefox `connect-src` does not apply
to preconnect at all. A name like `<data>.example.com` is a way to send data to whoever runs that domain's DNS. The hostname probes
(`dns-*`) put the probe's name and the run (`s` the sandbox, `c` the control page) in each hostname, and read the lookups from the
browser's own log: Chromium's network log, and Firefox's host resolver log. In Firefox the sandbox leaked all of them. The fixes:

1. `<meta http-equiv="x-dns-prefetch-control" content="off">` in the app's page (stops the anchor and `dns-prefetch` lookups).
2. No link element can be made: `createElement`, `createElementNS` and custom elements that extend `link` refuse it, and the HTML policy
   refuses text that contains one. An app has no use for one (its stylesheets are put inline when it is packed).

What can and cannot be seen: Chromium's log shows no lookup for these hints even with nothing in the way (only for an image request), so
the sandbox result there is a weak "nothing seen"; WebKit has no log to read, so it is not observed at all. Only Firefox shows every
lookup on the control page.

## Are the tests any good?

They were checked by breaking the sandbox on purpose. With the network allowed in both the app's policy and the page's policy, the
network attacks failed the tests; with the `sandbox` attribute loosened, the popup and storage checks failed; with the app's own policy
tag removed, every attack that reaches back to the site's own origin failed in all three engines. For WebRTC: with the
constructors left in, the direct, prefixed and restore routes failed; with the Trusted Types directives removed from the policy, or with
a policy that lets every string through, all the nested-frame routes failed (13 failures) in Chromium and in Firefox. (The page's own policy and the app's
policy overlap, so one of them alone is not enough to show a gap: that is why the same-origin attacks exist.) Do the same when you change
`js/sandbox.js` or `tools/Caddyfile`.

## Adding an attack

Add a `net`, `cap` or `works` entry to `PROBES` in `probes.mjs`. Run it: if it does not reach the canary on the control page in some
engine, remove that engine from its `control` list (the test says it cannot be observed there); if it gets out of the sandbox, that is a
finding, not a test to loosen.
