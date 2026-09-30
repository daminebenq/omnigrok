import { validateCfAccessToken } from "./.tmp-auth.mjs";

const AUD = "test-aud-123";
const TEAM = "fake.cloudflareaccess.com";

// Generate a real RSA keypair and publish it as the "Access" JWKS.
const { publicKey, privateKey } = await crypto.subtle.generateKey(
  { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1,0,1]), hash: "SHA-256" },
  true, ["sign", "verify"]
);
const pubJwk = await crypto.subtle.exportKey("jwk", publicKey);
const KID = "test-kid-1";

globalThis.fetch = async (url) => {
  if (!String(url).includes("/cdn-cgi/access/certs")) throw new Error("unexpected fetch " + url);
  return new Response(JSON.stringify({
    keys: [{ kid: KID, kty: "RSA", alg: "RS256", use: "sig", e: pubJwk.e, n: pubJwk.n }]
  }), { headers: { "content-type": "application/json" } });
};

const b64url = (buf) => Buffer.from(buf).toString("base64")
  .replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
const enc = new TextEncoder();

async function mint({ aud = [AUD], exp = Math.floor(Date.now()/1000)+3600, sub = "user-1", kid = KID, alg = "RS256" } = {}) {
  const h = b64url(enc.encode(JSON.stringify({ alg, kid, typ: "JWT" })));
  const p = b64url(enc.encode(JSON.stringify({ sub, email: "a@b.c", aud, exp, iat: Math.floor(Date.now()/1000) })));
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", privateKey, enc.encode(`${h}.${p}`));
  return `${h}.${p}.${b64url(sig)}`;
}

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const ok = got === want;
  ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  (got ${got}, want ${want})`);
};

// 1. valid token accepted
check("valid token accepted", !!(await validateCfAccessToken(await mint(), AUD, TEAM)), true);

// 2. aud as bare string (Access sometimes does this)
check("string aud accepted", !!(await validateCfAccessToken(await mint({aud: AUD}), AUD, TEAM)), true);

// 3. expired rejected
check("expired rejected", await validateCfAccessToken(await mint({exp: Math.floor(Date.now()/1000)-10}), AUD, TEAM), null);

// 4. wrong audience rejected
check("wrong aud rejected", await validateCfAccessToken(await mint({aud:["other"]}), AUD, TEAM), null);

// 5. unknown kid rejected
check("unknown kid rejected", await validateCfAccessToken(await mint({kid:"nope"}), AUD, TEAM), null);

// 6. alg=none rejected (classic bypass)
const noneTok = `${b64url(enc.encode(JSON.stringify({alg:"none",kid:KID})))}.${b64url(enc.encode(JSON.stringify({sub:"x",email:"x",aud:[AUD],exp:9999999999})))}.`;
check("alg=none rejected", await validateCfAccessToken(noneTok, AUD, TEAM), null);

// 7. THE forgery the old code accepted: unsigned, hand-crafted payload
const forged = `${b64url(enc.encode(JSON.stringify({alg:"RS256",kid:KID})))}.${b64url(enc.encode(JSON.stringify({sub:"attacker",email:"evil@x.com",aud:[AUD],exp:9999999999})))}.AAAA`;
check("forged payload rejected", await validateCfAccessToken(forged, AUD, TEAM), null);

// 8. tampered payload (valid sig, swapped body)
const good = await mint();
const [gh, , gs] = good.split(".");
const tampered = `${gh}.${b64url(enc.encode(JSON.stringify({sub:"admin",email:"e@x",aud:[AUD],exp:9999999999})))}.${gs}`;
check("tampered payload rejected", await validateCfAccessToken(tampered, AUD, TEAM), null);

// 9. junk inputs
check("null rejected", await validateCfAccessToken(null, AUD, TEAM), null);
check("garbage rejected", await validateCfAccessToken("not.a.jwt", AUD, TEAM), null);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
