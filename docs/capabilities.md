# Capabilities: how apps get more than the sandbox gives

A design note, not a plan with dates. It records how Appverse should grow what apps can do, so that the next feature is decided against it
and not argued from scratch. Written 2026-10-14, while the sandbox itself was still being hardened (see `docs/browser-tests.md`).

## The rule

**There is one sandbox. Capabilities are given by the host through the bridge, never by loosening the sandbox.**

The sandbox (`js/sandbox.js`) is the isolation boundary: an opaque-origin frame with no network, no frames, no popups, no cookies and no
way to reach the host page. Everything an app may do beyond running its own code goes through a small `postMessage` bridge, checked
against the permissions in its manifest, which the user sees before the app runs. A new capability is therefore a new, narrow, reviewable
function in the host. It is not a second sandbox, and it is not a hole in the first.

Why not several sandboxes (for example "Basic", "Creative", "Storage", "Connected", "Realtime", "Compute"): each one is its own attack
surface to harden, test in three engines and keep passing, and the real cost of this project so far was closing routes out of one. And
those names are not rungs of one ladder: "Creative" is a kind of app that already runs in the basic sandbox, "Storage" and "Compute" are
resources, "Realtime" needs the network that "Connected" would give. They are permission sets, not isolation levels.

## What exists today

| | |
|---|---|
| Runs | HTML, CSS and JavaScript from the package, in `<iframe sandbox="allow-scripts">`, with a policy that allows no network, no frames and no `document.write`. WebRTC and `link` elements are removed. |
| Permission `storage` | `appverse.storage.get/set/remove`: strings only, 256 KB per app, kept in the visitor's browser under the hash of the package (not the app's `id`). |
| Permission `clipboard` | Write text, on a user gesture. |
| Permission `fullscreen` | Ask for fullscreen, on a user gesture. |
| Needs no permission | Canvas, Web Audio, blob workers, images, fonts and media inlined as `data:` URLs. |

## Capability classes, by the risk they add

Classify a capability by what it lets leave or reach, not by what kind of app uses it. Each class has a different review.

| Class | Examples | Risk added | Review |
|---|---|---|---|
| **No new risk** | Canvas, audio, fullscreen, pointer lock, gamepad | None beyond running code | Check it works in all three engines (a "still works" probe), then leave it |
| **Local data** | Storage (bigger, or binary), open a file the user picks, save a file | Data at rest in the browser; one app reading another's; filling the disk | Isolation by package, quotas, user gesture for file access, a probe that another app cannot see it |
| **Data leaves the device** | Calls to an API, realtime messages | The whole reason for a sandbox: an app can send out what it knows | Full review, see below |
| **Resource abuse** | CPU, memory, runaway timers | A bad app freezes the visitor's tab | Applies to every app, see below |
| **Trust** | Who wrote the app | Decides how much anyone should grant | Separate setting, see below |

A capability is its own permission in the manifest and its own line in what the user is shown. It is never "a tier" that bundles
several things: an app that needs storage and one API host should be asked for exactly those two.

## Order of work

1. **Now: nothing new.** Basic and "creative" apps already run. What is missing is proof: "still works" probes in `tests/browser` for
   canvas, WebGL, Web Audio and a worker, so the promise is tested and guarded when the sandbox changes.
2. **When an app needs it: local data.** Raise the storage limits or allow binary data, behind the existing permission. Add file open and
   save on a user gesture, which is probably worth more to real apps than anything else on this list.
3. **The big next feature: data that leaves.** Design below. Do it only with its own security review and escape tests.
4. **Only if users ask: realtime.** Same shape as above, relayed by the host.
5. **For every app, whenever convenient: resource limits.**

## Data that leaves the device, if it is built

The app never gets a network. The host makes the request for it.

- **The manifest declares the hosts** (`"network": ["api.example.com"]`), and the user sees them before running: "This app wants to
  talk to api.example.com". Not a wildcard, not "the internet".
- **The bridge does the call.** `appverse.fetch(url, options)` goes to the host page, which checks the host against the declared list,
  makes the request itself from the main origin's context with no cookies or credentials of Appverse's, and returns the result. The
  frame still has no network, so none of the routes closed for the sandbox are reopened.
- **Limits.** `https` only, no redirects to other hosts, a cap on request and response size and on how many calls per minute, and a
  timeout. No headers the app sets that identify the visitor.
- **What it cannot hide.** An allowed host can still be sent anything the app knows. The permission is honest about that: the user is
  trusting that app with that host. This is the part to be clear about in the interface and in `privacy.html`.
- **Needs before it ships:** escape tests that an app cannot reach a host that is not on its list (including by redirect, by DNS
  tricks such as a name that resolves to an internal address, and by the lookups the hostname tests already watch), and a way to see
  and revoke what an app has been allowed.

**Realtime** (multiplayer, chat) is the same pattern with the host holding a WebSocket and relaying messages for the app. WebRTC is never
opened to an app: it is the route the sandbox spent the most work closing.

## Resource limits (every app)

A browser cannot cap a frame's CPU or memory. What can be done, cheapest first: the existing Stop button; a visible indicator when an
app is using a lot; pausing apps in background tabs; a watchdog in the host that stops an app that has not yielded for too long. WebAssembly
is not allowed today (the package file types exclude it) and widens the surface, so it should stay out unless a real app needs it.
"Compute" is therefore not a tier: it is a limit that applies to the basic tier too.

## Trust

The same sandbox can safely give more to an app you wrote or reviewed than to an anonymous one. Keep that separate from permissions:
permissions say what an app asks for, trust says what it may be granted. That needs some way to know who wrote an app (a signature, or
a list of vetted apps in the catalog), which does not exist yet. Until it does, treat every app as a stranger's, and keep the grant
that matters most (the network) behind explicit, per-host user approval.

## Every new capability needs

- a manifest permission and a line the user sees, worded plainly;
- a function in the host bridge that checks the permission and bounds its inputs (`createBridge` in `js/sandbox.js`);
- tests in `tests/sandbox.test.mjs` for the bridge, and probes in `tests/browser` that the sandbox still holds with the capability
  present, plus a mutation check that those probes fail when the new code is broken;
- a mention in `make.html`, `spec.html` and `llms.txt`, and in `applet check` so authors learn before they publish.

## Not decided

- **Versioning and compatibility.** How long an app made today keeps working while the sandbox tightens is deliberately left open until
  the hardening settles (see the note in the project memory). Do not add runtime versions or a compatibility contract before then.
- **Separate apps origin.** Planned (`*.appverse-apps.lol`) and not done. It limits what an escape can reach and should happen before
  the network capability does, because that is the first capability whose failure would matter.
- **Whether to host apps from strangers at all.** If yes, review, reporting and removal belong in this note too, and the "trust" section
  becomes the main one.
