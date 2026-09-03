#!/usr/bin/env bash
# Fails while the working tree has uncommitted changes.
set -e
dirty="$(git -C "$(dirname "$0")/.." status --porcelain)"
if [ -n "$dirty" ]; then echo "FAIL: dirty tree"; echo "$dirty"; exit 1; fi
echo "PASS: clean tree"
