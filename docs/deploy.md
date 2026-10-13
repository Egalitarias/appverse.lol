# Deploying appverse.lol

The site is plain static files; there is no build step. This mirrors Gameverse's setup (`../gameverse.lol/docs/deploy.md`) without releases.

## Server

- Host: `appverse.lol`, SSH as `root` with key auth.
- Web server: Caddy with the config in `tools/Caddyfile` (gzip, `nosniff`, a Content-Security-Policy, automatic TLS).
- The site lives under `/var/www/appverse-site`:

  ```
  builds/<commit>/   one folder per deployed commit, never edited
  current            symlink to a build: what https://appverse.lol/ serves
  ```

## First-time setup (once, on a new server)

1. Point DNS for `appverse.lol` (and `www`) at the server.
2. Install Caddy, then put the config in place:

   ```
   scp tools/Caddyfile root@appverse.lol:/tmp/Caddyfile.new
   ssh root@appverse.lol 'mkdir -p /var/www/appverse-site/builds && caddy validate --config /tmp/Caddyfile.new --adapter caddyfile && cp /etc/caddy/Caddyfile /etc/caddy/Caddyfile.bak 2>/dev/null; cp /tmp/Caddyfile.new /etc/caddy/Caddyfile && systemctl reload caddy'
   ```

## Deploy

```
tools/deploy.sh
```

Runs `npm test`, refuses to run with uncommitted changes, streams the tracked files (minus `tests/`, `tools/`, dotfiles) over `tar | ssh` into
`builds/<commit>`, and repoints `current` in one atomic step. The 5 newest builds and the live one are kept. Override the server with
`DEPLOY_HOST` / `DEPLOY_BASE`. Caddy serves from disk, so content changes need no reload; reload only after editing the Caddyfile.

Roll back: `ssh root@appverse.lol 'cd /var/www/appverse-site && ls -1t builds && ln -sfn builds/<older> current.tmp && mv -T current.tmp current'`.

## Content-Security-Policy

Only `/` and `index.html` (the page that runs apps) allow inline script and style, because an app's iframe inherits its page's policy and the
app's code is inlined into it (see the note at the top of `js/sandbox.js`). Every other page forbids them, so do not add inline `<script>` or
`style=` to those pages.

## Not done yet

Apps still run on the main origin (opaque-origin sandbox only). The planned separate apps origin (for example `*.appverse-apps.lol`) is not set up.

## Verify

`curl -sI https://appverse.lol/ | head -5`, then drop `examples/notes.applet` on the page.
