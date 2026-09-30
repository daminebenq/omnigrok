#!/bin/sh
# Runnable checks: Access auth guard, streaming pipeline, tool-calling loop.
set -e
cd "$(dirname "$0")/.."
BUNDLE="npx esbuild --bundle --format=esm --platform=neutral --log-level=error"
$BUNDLE src/worker/auth.ts      --outfile=test/.tmp-auth.mjs
$BUNDLE src/worker/inference.ts --outfile=test/.tmp-inference.mjs
$BUNDLE src/web/lib/api.ts      --outfile=test/.tmp-api.mjs
$BUNDLE src/worker/browse.ts    --outfile=test/.tmp-browse.mjs
$BUNDLE src/worker/session.ts   --outfile=test/.tmp-session.mjs
$BUNDLE src/worker/router.ts    --outfile=test/.tmp-router.mjs
$BUNDLE src/worker/mcp.ts       --outfile=test/.tmp-mcp.mjs
echo "--- auth ---";   node test/auth.test.mjs
echo "--- stream ---"; node test/stream.test.mjs
echo "--- agent ---";  node test/agent.test.mjs
echo "--- browse ---"; node test/browse.test.mjs
echo "--- session ---"; node test/session.test.mjs
echo "--- router ---"; node test/router.test.mjs
echo "--- mcp ---";    node test/mcp.test.mjs
rm -f test/.tmp-*.mjs
