# Appverse

[![tests](https://github.com/Egalitarias/appverse.lol/actions/workflows/test.yml/badge.svg)](https://github.com/Egalitarias/appverse.lol/actions/workflows/test.yml)

Run `.applet` app packages safely in the browser (https://appverse.lol).

The apps sibling of [Gameverse](https://gameverse.lol): a static website, no build step, no dependencies. An `.applet` is a zip with a
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

## The tools

    npx appverse new my-app      # or: npm install -g appverse, then `applet new my-app`
    cd my-app
    npx appverse dev             # run it in the sandbox, reloading when you save
    npx appverse check           # look for mistakes
    npx appverse pack            # build my-app.applet

The same tools are a zip on `make.html` (no npm needed). To publish a new version of the npm package: raise `PACKAGE_VERSION` in
`tools/build-npm.mjs`, run `node tools/build-npm.mjs`, then `cd dist/npm && npm publish --access public --otp=<code>`.

## Known risks

CPU and memory hogging (Stop destroys the frame), phishing-style UI inside a trusted domain (the frame is labelled untrusted), and
browser differences in CSP and sandbox handling (tests must cover each escape route per engine: fetch, images, CSS `url()`, forms,
WebRTC, `sendBeacon`, popups, navigation).

## Status

Working and live at https://appverse.lol: the sandboxed runner, the library, the in-browser packer, the `applet` command (published on npm as
`appverse`), the downloads on `make.html`, and one example app. The sandbox is covered by unit tests and by escape-route tests in Chromium, Firefox and WebKit
(`docs/browser-tests.md`); two gaps are known (WebRTC in Chromium, and storage keyed by an app's own id), and apps still run on the main
origin (see Next steps).

## Code

- `js/zip.js`, `js/zipwrite.js`: hostile-input zip reader and a zip writer (from Gameverse).
- `js/manifest.js`: manifest validation, allowed file kinds, the no-own-CSP rule.
- `js/sandbox.js`: document builder (CSP first, bridge shim, inlining), the permission-checked bridge, and `runApplet` for the iframe.
- `js/main.js`: the home page: drop or choose an `.applet`, see its permissions, Run, Stop.
- `js/library.js`, `library.html`: the library: add `.applet` files (kept in IndexedDB), run, download, remove, search, plus the featured examples from `examples/catalog.json`.
- `js/pack.js`, `pack.html`: the in-browser packer (drop a folder, .zip or .applet; edit the manifest; checks; test run; download).
- `js/packer.js`: tidy a set of files, guess and validate a manifest, `lintApplet` (network use, browser storage, missing permissions, modules...), `buildApplet`. No DOM, so it also runs in Node.
- `tools/applet.mjs`: the `applet` command (Node 20+, no install; `npm link` installs it): `new`, `dev`, `check [--strict]`, `pack`, `inspect`, `unpack`. `tools/applet-dev.mjs` is the dev server (127.0.0.1 only, runs the app in the real sandbox, reloads on save); `tools/pack-folder.mjs` reads a folder; `tools/pack.mjs` is the old `pack` entry point. `templates/starter` is what `applet new` copies.
- `js/downloads.js`, `js/make.js`: the two downloads on `make.html` (the starter app, and the tools: the `applet` CLI with the few `js/` files it imports), zipped in the browser from files the site serves. `tools/deploy.sh` serves `tools/applet*.mjs` and `tools/pack-folder.mjs` for that; `tests/downloads.test.mjs` unpacks the tools zip in a clean folder and runs it.
- `tools/build-examples.mjs` repacks every `examples/<name>/` and rewrites `examples/catalog.json` (run it after changing an example, and commit the output).
- `examples/notes`: a notepad using `storage` and `clipboard`, with its packed `notes.applet`.
- `tests/sandbox.test.mjs`: `npm test`.
- `tests/browser/`: the escape-route tests, which run a hostile app in real browsers (Playwright, its own `package.json`): `npm run test:browser`. See `docs/browser-tests.md`.

## Next steps

1. Close the two known gaps in `docs/browser-tests.md` (WebRTC in Chromium; storage keyed by a self-declared id).
2. More example apps.
3. Serve apps from a separate origin.
