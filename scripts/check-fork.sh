#!/usr/bin/env bash
set -u
NEW=/c/Users/Asus/Claude_Code/Mashhoor
fails=0
[ -d "$NEW/.git" ] || { echo "FAIL: no git repo at $NEW"; fails=1; }
[ -d "$NEW/prisma/migrations" ] && { echo "FAIL: Talaqi migrations copied over"; fails=1; }
[ -f "$NEW/src/lib/api.ts" ] || { echo "FAIL: source did not copy"; fails=1; }
git -C "$NEW" ls-files 2>/dev/null | grep -q ".next-dev" && { echo "FAIL: dev logs tracked"; fails=1; }
[ "$(git -C "$NEW" rev-list --count HEAD 2>/dev/null || echo 0)" = "1" ] || { echo "FAIL: history is not a single fresh commit"; fails=1; }
[ "$fails" = 0 ] && echo "PASS: fork is clean"
exit "$fails"
