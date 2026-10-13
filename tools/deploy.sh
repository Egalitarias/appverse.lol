#!/usr/bin/env bash
# Deploy the static site to appverse.lol. See docs/deploy.md.
#
#   tools/deploy.sh
#
# The tracked files of the current commit go into an immutable build folder named after the commit, and `current` is
# a symlink to it, so the site switches in one atomic step and nothing is ever half uploaded. Rolling back is
# repointing `current` at an older build (see docs/deploy.md).
set -euo pipefail
cd "$(dirname "$0")/.."
HOST=${DEPLOY_HOST:-root@appverse.lol}
BASE=${DEPLOY_BASE:-/var/www/appverse-site}
SITE=${DEPLOY_URL:-https://appverse.lol}

npm test
[ -z "$(git status --porcelain)" ] || { echo "Uncommitted changes; commit first." >&2; exit 1; }
SHA=$(git rev-parse --short HEAD)
FILES=$(node tools/site-files.mjs) # a bad list stops the deploy here, before anything is sent

# Only the tracked files listed in tools/site-files.txt (a new file stays private until it is added there); the server has no git checkout. A build that already exists is identical and is reused.
if ssh "$HOST" "[ -d $BASE/builds/$SHA ]"; then
  echo "Build $SHA is already on the server."
else
  ssh "$HOST" "rm -rf $BASE/builds/$SHA.partial && mkdir -p $BASE/builds/$SHA.partial"
  printf '%s\n' "$FILES" | tar cf - -T - \
    | ssh "$HOST" "tar xf - -C $BASE/builds/$SHA.partial --no-same-owner && chmod -R a+rX $BASE/builds/$SHA.partial && mv $BASE/builds/$SHA.partial $BASE/builds/$SHA"
fi

# Point `current` at the build (atomic: make a new link, then rename it over the old one). The build it replaces is remembered for the rollback below.
PREV=$(ssh "$HOST" "basename \$(readlink $BASE/current) 2>/dev/null || true")
point() { ssh "$HOST" "cd $BASE && ln -sfn builds/$1 current.tmp && mv -T current.tmp current"; }
point "$SHA"
echo "current -> $SHA on $HOST:$BASE"

# The live site must answer for the pages and the files the make.html downloads are built from; if not, put the previous build back.
healthy() {
  for p in / /make.html /js/downloads.js /templates/starter/manifest.json; do
    curl -fsS --max-time 15 -o /dev/null "$SITE$p" || { echo "Check failed: $SITE$p" >&2; return 1; }
  done
}
if ! healthy; then
  if [ -n "$PREV" ] && [ "$PREV" != "$SHA" ]; then
    point "$PREV"
    echo "Rolled back: current -> $PREV" >&2
  else
    echo "No other build to roll back to; current stays at $SHA." >&2
  fi
  exit 1
fi
echo "Site check passed ($SITE)"

# Keep the 5 newest builds and the one `current` points at.
ssh "$HOST" "cd $BASE/builds && keep=\$(basename \$(readlink -f ../current)) && ls -1t | tail -n +6 | while read -r b; do [ \"\$b\" = \"\$keep\" ] || rm -rf \"\$b\"; done"
