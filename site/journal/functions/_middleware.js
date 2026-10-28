// Passcode gate for the whole Journal site (Cloudflare Pages Function).
// Replaces Basic Auth, which iOS home-screen apps handle badly (they forget
// it or re-prompt on every launch).
//
// One passcode, stored as the Pages secret JOURNAL_PASSCODE. A correct
// passcode sets a signed, HttpOnly cookie good for a year. The passcode is
// part of the signing key, so changing it signs out every device. If the
// secrets or the KV binding are missing, every request is refused (503).
//
// Guessing: wrong tries are counted in KV (AUTH_KV). 5 misses from one IP in
// 15 minutes locks that IP out; 30 misses from anywhere in an hour locks
// login for everyone until the hour passes. Devices already signed in keep
// working.
//
// Same scheme as the-garden/src/worker.js, adapted for Pages.

const COOKIE = "journal_session";
const SESSION_DAYS = 365;
const IP_LIMIT = 5, IP_WINDOW_S = 15 * 60;
const GLOBAL_LIMIT = 30, GLOBAL_WINDOW_S = 60 * 60;
const MIN_PASSCODE = 12;

// Install metadata holds no personal data; iOS fetches it without cookies.
const PUBLIC_PATHS = new Set([
  "/manifest.webmanifest", "/apple-touch-icon.png", "/icon-192.png", "/icon-512.png", "/icon-maskable-512.png",
]);

export async function onRequest({ request, next, env }) {
  const url = new URL(request.url);
  if (PUBLIC_PATHS.has(url.pathname)) return next();
  if (!configured(env)) return htmlPage("Journal is locked: the passcode isn't set up yet.", 503, false);

  if (url.pathname === "/__login" && request.method === "POST") return login(request, env);
  if (url.pathname === "/__logout") return logout();
  if (await validSession(request, env)) return next();
  return htmlPage("", 401, true);
}

function configured(env) {
  return typeof env.JOURNAL_PASSCODE === "string" && env.JOURNAL_PASSCODE.length >= MIN_PASSCODE &&
    typeof env.SESSION_SECRET === "string" && env.SESSION_SECRET.length >= 32 &&
    env.AUTH_KV && typeof env.AUTH_KV.get === "function";
}

async function login(request, env) {
  const ip = request.headers.get("CF-Connecting-IP") || "local";
  const ipKey = `fail:ip:${ip}`, allKey = "fail:all";
  const [ipN, allN] = (await Promise.all([env.AUTH_KV.get(ipKey), env.AUTH_KV.get(allKey)])).map((v) => Number(v) || 0);
  if (ipN >= IP_LIMIT || allN >= GLOBAL_LIMIT) {
    return htmlPage("Too many wrong tries. Wait 15 minutes, then try again.", 429, true);
  }

  const form = await request.formData().catch(() => null);
  const given = form ? String(form.get("passcode") || "") : "";
  if (!(await sameSecret(given, env.JOURNAL_PASSCODE))) {
    // KV counters, each expiring with its window. Not atomic, which is fine:
    // a lost increment under a burst only delays the lock by a try or two.
    await Promise.all([
      env.AUTH_KV.put(ipKey, String(ipN + 1), { expirationTtl: IP_WINDOW_S }),
      env.AUTH_KV.put(allKey, String(allN + 1), { expirationTtl: GLOBAL_WINDOW_S }),
    ]);
    const left = IP_LIMIT - ipN - 1;
    return htmlPage(left > 0 ? "Wrong passcode." : "Wrong passcode. Locked for 15 minutes.", 401, true);
  }

  const exp = Math.floor(Date.now() / 1000) + SESSION_DAYS * 86400;
  const token = exp + "." + (await sign(String(exp), env));
  return new Response(null, {
    status: 303,
    headers: {
      Location: "/",
      "Set-Cookie": `${COOKIE}=${token}; Max-Age=${SESSION_DAYS * 86400}; Path=/; HttpOnly; Secure; SameSite=Lax`,
      "Cache-Control": "no-store",
    },
  });
}

function logout() {
  return new Response(null, {
    status: 303,
    headers: { Location: "/", "Set-Cookie": `${COOKIE}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax` },
  });
}

async function validSession(request, env) {
  const raw = (request.headers.get("Cookie") || "").split(/;\s*/).find((c) => c.startsWith(COOKIE + "="));
  if (!raw) return false;
  const [exp, sig] = raw.slice(COOKIE.length + 1).split(".");
  if (!/^\d+$/.test(exp || "") || !sig) return false;
  if (Number(exp) < Date.now() / 1000) return false;
  return sameSecret(sig, await sign(exp, env));
}

// HMAC key = session secret + passcode, so a new passcode voids old cookies.
async function sign(message, env) {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(env.SESSION_SECRET + "\u0000" + env.JOURNAL_PASSCODE),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return btoa(String.fromCharCode(...new Uint8Array(mac))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Compares hashes of both strings so timing reveals nothing about the secret.
async function sameSecret(a, b) {
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(a)),
    crypto.subtle.digest("SHA-256", enc.encode(b)),
  ]);
  const x = new Uint8Array(ha), y = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

function htmlPage(message, status, showForm) {
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  return new Response(`<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Journal</title>
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Journal">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<style>
  :root { --paper:#F6F2EA; --ink:#22201C; --muted:#6E675C; --rule:#DED6C7; --rust:#9E432A; color-scheme: light; }
  @media (prefers-color-scheme: dark) { :root { --paper:#16130F; --ink:#EDE6DA; --muted:#A39A8B; --rule:#3A332A; --rust:#D9785A; color-scheme: dark; } }
  body { margin:0; min-height:100vh; display:grid; place-items:center; background:var(--paper); color:var(--ink);
    font:18px/1.5 Georgia, "Newsreader", serif; padding:16px; box-sizing:border-box; }
  form, .msg { width:100%; max-width:340px; }
  h1 { font-size:32px; margin:0 0 4px; }
  p { color:var(--muted); margin:0 0 18px; font:15px system-ui, sans-serif; }
  p.err { color:var(--rust); }
  input { width:100%; box-sizing:border-box; padding:14px; font:17px system-ui, sans-serif; border:1px solid var(--rule);
    border-radius:10px; background:transparent; color:var(--ink); margin-bottom:12px; }
  button { width:100%; min-height:50px; border:0; border-radius:10px; background:var(--ink); color:var(--paper);
    font:600 17px system-ui, sans-serif; }
</style></head><body>
${showForm ? `<form method="post" action="/__login">
  <h1>Journal</h1>
  <p${message ? ' class="err"' : ""}>${message ? esc(message) : "Enter your passcode."}</p>
  <input type="password" name="passcode" autocomplete="current-password" aria-label="Passcode" autofocus required>
  <button type="submit">Open</button>
</form>
<script>
  // Keep a deep link (#e-<entry>, from the Habits app) through the login:
  // the 303 back to "/" inherits the fragment of the URL that was posted to.
  if (location.hash) document.forms[0].action = "/__login" + location.hash;
</script>` :`<div class="msg"><h1>Journal</h1><p>${esc(message)}</p></div>`}
</body></html>`, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}
