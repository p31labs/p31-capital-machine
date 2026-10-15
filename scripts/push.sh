#!/bin/bash
set -euo pipefail
# push.sh — push both remediation repos to their remotes using the gh CLI
# credential helper (GitHub auth lives in ~/.config/gh/hosts.yml).
#   PARENT_ROOT  (default /home/p31/production)          → git push origin main
#   CM_REMOTE    (capital-machine remote URL, unset today) → git push "$CM_REMOTE" main
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PARENT="${PARENT_ROOT:-/home/p31/production}"
export GH_TOKEN="$(gh auth token 2>/dev/null || true)"
GH_HELPER="!gh auth git-credential"

echo ">>> Pushing parent repo ($PARENT)..."
git -C "$PARENT" -c credential.helper="$GH_HELPER" push origin main

if [ -n "${CM_REMOTE:-}" ]; then
  echo ">>> Pushing capital-machine ($ROOT) → $CM_REMOTE"
  git -C "$ROOT" -c credential.helper="$GH_HELPER" push "$CM_REMOTE" main
else
  echo "⚠ capital-machine has no remote configured and no upstream repo exists."
  echo "   Create it first (owner decision: name + visibility), e.g.:"
  echo "     gh repo create p31labs/p31-capital-machine --private"
  echo "     git -C '$ROOT' remote add origin https://github.com/p31labs/p31-capital-machine.git"
  echo "   then run: CM_REMOTE=origin bash scripts/push.sh"
fi