# Security policy

Appverse runs apps from people you may not know, in a sandbox. A way out of that sandbox is the most serious kind of bug here, so please report it
privately before you tell anyone else.

## How to report

- Use **Report a vulnerability** on the [Security tab](https://github.com/Egalitarias/appverse.lol/security/advisories/new). Only you and the maintainer
  can see the report.
- Or write to GaryDaviesHome@Gmail.com.

Please include the steps to reproduce, the browser and version, and what an attacker gains. A small `.applet` that shows the problem helps most.
Please do not open a public issue or pull request for a vulnerability until it is fixed.

## What counts

In scope: a way for an app (the code inside an `.applet`) to

- run or load code, or send or receive anything, over the network (`fetch`, images, CSS `url()`, forms, WebRTC, beacons, fonts, workers);
- read or change the page that runs it, other apps' data, cookies, or the host origin's storage;
- open popups, navigate the page, or go fullscreen or copy to the clipboard without the permission or a user gesture;
- get round the injected Content-Security-Policy or the iframe sandbox;
- or a crafted zip, manifest or file that the reader or packer does not reject (path traversal, zip bombs, wrong sizes, bad checksums, an entry that
  becomes something else when it is inlined).

Also in scope: the `applet` command and the npm package `appverse` (for example, a path outside the folder written by `unpack`, or the dev server
reachable from another computer or another website).

Out of scope, because they are known limits (see [spec.html](spec.html)): an app that uses a lot of CPU or memory (Stop ends it), an app that shows
misleading content such as a fake sign-in form, and browser bugs that are not specific to Appverse (report those to the browser vendor).

## What to expect

You will get a reply within a few days. We will tell you whether we can reproduce it, work on a fix, and credit you when it is released if you wish.
We ask for time to fix it before you publish, and will tell you if it is going to take long.

## Supported versions

Only the latest version of the site (https://appverse.lol) and the latest `appverse` package on npm are supported.
