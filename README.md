# Appverse

Run `.applet` app packages safely in the browser (https://appverse.lol).

The apps sibling of [Gameverse](../gameverse.lol): a static website, no build step, no dependencies. An `.applet` is a zip with a
`manifest.json` and the app's files, run in `<iframe sandbox="allow-scripts">` with no network and permissions the user sees first.

## Run the site

    npx serve .          # or: python -m http.server 8000

## The model

An app is plain static HTML, CSS and JavaScript, zipped into an `.applet` with a `manifest.json`. There is no custom language. The sandbox
is the product:

- Runs in `<iframe sandbox="allow-scripts">` (no `allow-same-origin`, popups or top navigation), served from a separate origin in production.
- The entry HTML is rewritten on load to inject a strict CSP as the first element of `<head>` (`default-src 'none'`, `connect-src 'none'`,
  inline script and style only, `data:`/`blob:` media). Packages that ship their own CSP are rejected.
- The package's files are inlined into that one document (`js/sandbox.js`): scripts and styles as inline code, images, fonts and media as `data:` URLs; external or missing references are errors.
- The zip reader (`js/zip.js`) keeps Gameverse's checks (path traversal, CRC, size caps); only web, image, font, audio, video and text files are allowed (`js/manifest.js`).
- The only channel out is a small `postMessage` bridge (`appverse.storage`, fullscreen, clipboard), gated by manifest permissions that
  the user sees before the app runs.
- Later: an optional `network` permission with a declared host allowlist.

See `spec.html` and `make.html` for the manifest, permissions and limits.

## Known risks

CPU and memory hogging (Stop destroys the frame), phishing-style UI inside a trusted domain (the frame is labelled untrusted), and
browser differences in CSP and sandbox handling (tests must cover each escape route per engine: fetch, images, CSS `url()`, forms,
WebRTC, `sendBeacon`, popups, navigation).

## Status

Skeleton: pages, styles, branding, docs for the model, `llms.txt`, `robots.txt`, `sitemap.xml`. No runtime yet.

## Code

- `js/zip.js`, `js/zipwrite.js`: hostile-input zip reader and a zip writer (from Gameverse).
- `js/manifest.js`: manifest validation, allowed file kinds, the no-own-CSP rule.
- `js/sandbox.js`: document builder (CSP first, bridge shim, inlining), the permission-checked bridge, and `runApplet` for the iframe.
- `tests/sandbox.test.mjs`: `npm test`.

## Next steps

1. Wire the drop zone on `index.html` (card with permissions, Run, Stop) and port `js/library.js` and `js/packer.js`.
2. An escape-route test page and Playwright tests across Chromium, Firefox and WebKit (the unit tests do not run a browser).
3. The `applet` CLI (`new`, `check`, `pack`, `dev`, `inspect`), a few example apps, a library page.
4. Serve apps from a separate origin and set the page CSP (inline script/style, `data:` media) in the production server config.
