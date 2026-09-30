#!/bin/sh
# Runnable checks for the worker auth guard and the chat streaming pipeline.
set -e
cd "$(dirname "$0")/.."
npx esbuild src/worker/auth.ts      --format=esm --outfile=test/.tmp-auth.mjs      --log-level=error
npx esbuild src/worker/inference.ts --format=esm --outfile=test/.tmp-inference.mjs --log-level=error
npx esbuild src/web/lib/api.ts      --format=esm --outfile=test/.tmp-api.mjs       --log-level=error
echo "--- auth ---";   node test/auth.test.mjs
echo "--- stream ---"; node test/stream.test.mjs
rm -f test/.tmp-*.mjs
