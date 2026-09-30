// The browse proxy is a server-side fetch driven by user input, so the guard
// matters. This app is deliberately allowed to reach the user's own infra, so
// the rule is not "block all private ranges" -- it blocks loopback,
// link-local and cloud metadata, which are never legitimate browsing targets.
import { assertBrowsableUrl, browse } from "./.tmp-browse.mjs";

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) console.log(`      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`);
};
const blocked = (u) => { try { assertBrowsableUrl(u); return false; } catch { return true; } };

// Must be refused
check("blocks localhost",            blocked("http://localhost/admin"), true);
check("blocks 127.0.0.1",            blocked("http://127.0.0.1:8080/"), true);
check("blocks 127.x loopback range", blocked("http://127.1.2.3/"), true);
check("blocks 0.0.0.0",              blocked("http://0.0.0.0/"), true);
check("blocks IPv6 loopback",        blocked("http://[::1]/"), true);
check("blocks AWS/GCP metadata",     blocked("http://169.254.169.254/latest/meta-data/"), true);
check("blocks link-local range",     blocked("http://169.254.1.1/"), true);
check("blocks GCP metadata host",    blocked("http://metadata.google.internal/"), true);
check("blocks *.localhost",          blocked("http://api.localhost/"), true);
check("blocks file://",              blocked("file:///etc/passwd"), true);
check("blocks gopher://",            blocked("gopher://x/"), true);
check("blocks garbage",              blocked("not a url"), true);

// Must be allowed (the user's own infrastructure is a legitimate target)
check("allows https",                blocked("https://example.com/x"), false);
check("allows user's own host",      blocked("https://jarvis.damineweb.work/"), false);

// Body handling
globalThis.fetch = async () =>
  new Response("<html><head><title>  Hello   World </title></head><body><script>bad()</script><p>Body text</p></body></html>",
    { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
const r = await browse("https://example.com");
check("extracts and normalizes title", r.title, "Hello World");
check("keeps html for sandboxed render", r.html.includes("<p>Body text</p>"), true);
check("text view strips script contents", r.text.includes("bad()"), false);
check("text view keeps body copy", r.text.includes("Body text"), true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
