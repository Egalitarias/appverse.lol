<!--
DRAFT. Not legal advice: have a lawyer review the "Licensing your contribution" section before the repo accepts outside pull requests. To resolve:
  - Decide how agreement is recorded: a CLA bot on pull requests, or the sign-off line described below.
  - If the licence changes, update "What this repository is" and "Licensing your contribution".
-->

# Contributing to Appverse

Thanks for wanting to help. This repository is the open part of Appverse: the sandbox, the packer, the `applet` command, the starter and the docs.
Read the whole page before you open a pull request; it is short.

## What this repository is

- The sandbox that runs `.applet` apps (`js/sandbox.js`), the zip and manifest code, the packer and checker, the `applet` command, the starter template and
  the examples.
- It is **not** the hosted service. Accounts, billing, the store and similar are separate and are not accepting contributions.

The code runs in browsers and in Node 20+, with **no dependencies and no build step**. Please keep it that way.

## Reporting a security problem

The sandbox is the point of the project, so please **do not open a public issue** for a way out of it (reading the page, running network code, reaching
storage, escaping the iframe, getting round the CSP, a zip or manifest that is not rejected). Write to GaryDaviesHome@Gmail.com with the steps to reproduce. We will
reply, fix it and credit you if you wish. Other bugs are fine as normal issues.

## Before you start

- For anything bigger than a small fix, open an issue first and say what you plan to change. It avoids work that cannot be merged.
- Good first changes: clearer error messages, checks in `lintApplet` (js/packer.js), docs, examples, tests for cases we missed.
- Changes we are unlikely to accept: adding dependencies, a build step, a new app language, anything that widens what an app can do (a new permission,
  a looser CSP, a new file kind) without a strong reason and tests.

## Running it

```
npm test                                  # all tests (Node 20+, no install)
node tools/applet.mjs new my-app          # try the command
node tools/applet.mjs dev my-app          # run an app in the sandbox
node tools/build-npm.mjs                  # builds the npm package into dist/npm (do not publish it yourself)
```

## Changing the code

- Match the surrounding code: plain ES modules, semicolons, single quotes, short comments that say why.
- **Every change comes with tests** in `tests/` (`node:test`). A change to the sandbox, the CSP, the zip reader or the manifest rules must include a test
  that fails without it, ideally for the attack it prevents.
- Keep the page policy and the sandbox policy in step: `js/sandbox.js` and `tools/Caddyfile` describe the same rules (`tests/csp.test.mjs` checks part of it).
- If you add a file the tools zip needs, add it to the list in `js/downloads.js`. The npm package and the zip are built from that one list.
- Update the docs (`make.html`, `spec.html`, `README.md`, `llms.txt`) when behaviour changes.

## Pull requests

1. Fork, branch, and keep the pull request to one topic.
2. Make sure `npm test` passes.
3. Say what changed and why, and how you tested it. For a user-visible change, say what a person will notice.
4. Be ready for questions. Small, well-tested changes are merged fastest.

Commit messages: a short summary line in the imperative ("Reject duplicate zip entries"), then a blank line and the reason if it is not obvious.

## Licensing your contribution

You keep the copyright in what you write. By sending a pull request you agree that:

1. You wrote it, or have the right to submit it, and it does not include anyone else's code or content unless you say so and it is under a compatible
   licence.
2. You grant Gary Davies a perpetual, worldwide, non-exclusive, royalty-free, irrevocable licence to use, copy, modify, publish, distribute and **sublicense**
   your contribution, **under this project's licence or any other terms, including commercial ones**, as part of Appverse and any later version of it.
3. Your contribution is provided "as is", without warranty.

Add this line to the description of your first pull request: `I agree to the contributor licence in CONTRIBUTING.md`. [A CLA bot may ask you to
confirm instead.]

This is what allows the project to change its licence or offer it commercially in the future without having to ask every contributor again. If you
cannot agree to that, please do not contribute code; issues and ideas are always welcome.

## Conduct

Be kind and be specific. Disagree with the code, not the person. Harassment of any kind gets you removed from the project.

## Names and logos

The Appverse name and logo are not covered by the code licence: see [TRADEMARK.md](TRADEMARK.md).
