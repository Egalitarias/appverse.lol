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

npm test
[ -z "$(git status --porcelain)" ] || { echo "Uncommitted changes; commit first." >&2; exit 1; }
SHA=$(git rev-parse --short HEAD)

# Everything tracked except tests/, the deploy files and dotfiles (tools/applet*.mjs and tools/pack-folder.mjs ARE served: the tools download on make.html zips them); the server has no git checkout. A build that already exists is identical and is reused.
if ssh "$HOST" "[ -d $BASE/builds/$SHA ]"; then
  echo "Build $SHA is already on the server."
else
  ssh "$HOST" "rm -rf $BASE/builds/$SHA.partial && mkdir -p $BASE/builds/$SHA.partial"
  git ls-files | grep -vE '^(tests/|tools/(deploy\.sh|Caddyfile|build-examples\.mjs|pack\.mjs)$|docs/deploy\.md$|\.|package\.json$)' | tar cf - -T - \
    | ssh "$HOST" "tar xf - -C $BASE/builds/$SHA.partial --no-same-owner && chmod -R a+rX $BASE/builds/$SHA.partial && mv $BASE/builds/$SHA.partial $BASE/builds/$SHA"
fi

# Point `current` at the build (atomic: make a new link, then rename it over the old one).
ssh "$HOST" "cd $BASE && ln -sfn builds/$SHA current.tmp && mv -T current.tmp current"
echo "current -> $SHA on $HOST:$BASE"

# Keep the 5 newest builds and the one `current` points at.
ssh "$HOST" "cd $BASE/builds && keep=\$(basename \$(readlink -f ../current)) && ls -1t | tail -n +6 | while read -r b; do [ \"\$b\" = \"\$keep\" ] || rm -rf \"\$b\"; done"

curl -fsSI https://appverse.lol/ | head -1
