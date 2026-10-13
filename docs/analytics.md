# Analytics

`https://appverse.lol/analytics.html` shows how the site is used: visitors, page views, downloads, where visitors come from, screens, languages
and pages that were not found. It is modelled on the Gameverse page, with one difference: Gameverse has a server with accounts and a
database, and Appverse is static files, so the numbers come from the web server's access log instead of from code in the pages.

```
Caddy access log --(hourly)--> tools/analytics-report.mjs --> /var/www/appverse-site/stats/data.json --> /analytics/data.json --> analytics.html
```

- No tracking script, cookie or third party runs in the pages, and nothing is sent from them.
- `tools/analytics-report.mjs` reads the JSON log and writes daily totals only. A visitor is a hash of address, browser and day with a
  random salt per run; it is never written. Bots and tools (curl, crawlers, the deploy check) are counted separately and left out.
- The raw log is kept for 14 days (`roll_keep_for 336h` in `tools/Caddyfile`); `data.json` keeps up to 400 days of totals, so the history
  outlives the log.
- Downloads on make.html are zipped in the browser from files the site serves, so a download is counted from the requests for those
  files (`tools/applet.mjs` for the tools zip; the starter files minus the tools downloads for the starter zip). It is close, not exact.
- There are no countries: that needs an IP-to-country file (Gameverse uses DB-IP). It can be added to the report script later.
- The page and `/analytics/*` ask for a password (Caddy basic auth). `analytics.html` is `noindex`, not in `sitemap.xml`, and disallowed in
  `robots.txt`. Sign-in with GitHub or Google is not set up; see below.

## One-time setup on the server

`tools/deploy.sh` does not touch the Caddyfile, so this is done by hand. It needs Node 20 or newer on the server (the report script is
plain Node, no packages).

1. Make the password hash on the server and put it in `/etc/caddy/Caddyfile`, in place of the placeholder in the `basic_auth @private`
   block (keep the real hash out of the repository):

   ```
   caddy hash-password
   ```

2. Copy the new `tools/Caddyfile` blocks (`log`, `@private`/`basic_auth`, `handle_path`, `handle`) into `/etc/caddy/Caddyfile`, then check and
   reload:

   ```
   mkdir -p /var/log/caddy /var/www/appverse-site/stats && chown caddy /var/log/caddy
   caddy validate --config /etc/caddy/Caddyfile
   systemctl reload caddy
   ```

3. Deploy once (`tools/deploy.sh`): it also copies `tools/analytics-report.mjs` to `/var/www/appverse-site/bin/`.
4. Run the report hourly, as a user that can read the log. In `/etc/cron.d/appverse-analytics`:

   ```
   7 * * * * root node /var/www/appverse-site/bin/analytics-report.mjs --out /var/www/appverse-site/stats/data.json /var/log/caddy/appverse-access*.log*
   ```

   (The rotated files may be gzipped; the script reads both.) Run the same command by hand once to see the page fill in.
5. Open `https://appverse.lol/analytics.html`, sign in, and check the numbers move after a few page loads and the next run.

## Not done yet

- Countries (needs a geolocation file).
- Sign-in with GitHub or Google. The password gate can later be replaced by `oauth2-proxy` or a Caddy auth plugin in front of
  `/analytics*` with an allow-list of your username; the page does not change.
