#!/usr/bin/env bash
# Three demo-safety invariants for the frozen v1.0-demo tag.
set -u
cd "$(dirname "$0")/.."
fails=0
grep -q "DEMO_ACCOUNTS\|talaqi123" src/components/screens/public/login.tsx && { echo "FAIL: credentials in login bundle"; fails=1; }
grep -q "SEED_ALLOW_WIPE" prisma/seed.ts || { echo "FAIL: seed has no wipe guard"; fails=1; }
grep -q "length < 32" src/lib/jwt.ts || { echo "FAIL: AUTH_SECRET has no length floor"; fails=1; }
grep -q "migrate deploy && npm run seed" README.md && { echo "FAIL: README still tells you to seed production"; fails=1; }
[ "$fails" = 0 ] && echo "PASS: hardened"
exit "$fails"
