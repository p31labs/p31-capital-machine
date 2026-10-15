#!/bin/bash
set -euo pipefail
# push.sh — push both remediation repos to their remotes.
#   PARENT_ROOT  (default /home/p31/production)          → git push origin main
#   CM_REMOTE    (capital-machine remote URL, unset today) → git push "$CM_REMOTE" main
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PARENT="${PARENT_ROOT:-/home/p31/production}"

echo ">>> Pushing parent repo ($PARENT)..."
git -C "$PARENT" push origin main

if [ -n "${CM_REMOTE:-}" ]; then
  echo ">>> Pushing capital-machine ($ROOT) → $CM_REMOTE"
  git -C "$ROOT" push "$CM_REMOTE" main
else
  echo "⚠ capital-machine has no remote configured yet."
  echo "   Configure one, e.g.:"
  echo "     git -C '$ROOT' remote add origin https://github.com/p31labs/p31-capital-machine.git"
  echo "   or run: CM_REMOTE=<url> bash scripts/push.sh"
fi