// 웹 푸시 (RFC 8291 aes128gcm + VAPID) — 외부 라이브러리 없이 WebCrypto로 구현

const te = new TextEncoder();
export const b64u = {
  enc(buf) {
    const u = new Uint8Array(buf);
    let s = "";
    for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  },
  dec(s) {
    s = s.replace(/-/g, "+").replace(/_/g, "/");
    while (s.length % 4) s += "=";
    const b = atob(s);
    return Uint8Array.from(b, (c) => c.charCodeAt(0));
  },
};
const concat = (...arrs) => {
  const out = new Uint8Array(arrs.reduce((a, b) => a + b.length, 0));
  let o = 0;
  for (const a of arrs) { out.set(a, o); o += a.length; }
  return out;
};
async function hmac(key, data) {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, data));
}
async function hkdf(salt, ikm, info, len) {
  const prk = await hmac(salt, ikm);
  return (await hmac(prk, concat(info, new Uint8Array([1])))).slice(0, len);
}

// VAPID 키는 처음 필요할 때 만들어서 settings 테이블에 저장
export async function getVapid(env, st, setSettings) {
  if (st.vapid_pub && st.vapid_priv) return { pub: st.vapid_pub, privJwk: JSON.parse(st.vapid_priv) };
  const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const pub = b64u.enc(await crypto.subtle.exportKey("raw", kp.publicKey));
  const privJwk = await crypto.subtle.exportKey("jwk", kp.privateKey);
  await setSettings(env, { vapid_pub: pub, vapid_priv: JSON.stringify(privJwk) });
  st.vapid_pub = pub; st.vapid_priv = JSON.stringify(privJwk);
  return { pub, privJwk };
}

export async function encryptPayload(sub, payload) {
  const uaPub = b64u.dec(sub.p256dh), auth = b64u.dec(sub.auth);
  const as = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const asPub = new Uint8Array(await crypto.subtle.exportKey("raw", as.publicKey));
  const uaKey = await crypto.subtle.importKey("raw", uaPub, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, as.privateKey, 256));
  const ikm = await hkdf(auth, shared, concat(te.encode("WebPush: info\0"), uaPub, asPub), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, te.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, te.encode("Content-Encoding: nonce\0"), 12);
  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, concat(te.encode(payload), new Uint8Array([2]))));
  const header = new Uint8Array(21);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = 65;
  return concat(header, asPub, ct);
}

async function vapidAuth(endpoint, vapid) {
  const aud = new URL(endpoint).origin;
  const h = b64u.enc(te.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const p = b64u.enc(te.encode(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: "mailto:couple@wooju.pages.dev" })));
  const key = await crypto.subtle.importKey("jwk", vapid.privJwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, te.encode(h + "." + p));
  return `vapid t=${h}.${p}.${b64u.enc(sig)}, k=${vapid.pub}`;
}

// who 에게 알림 보내기 (실패해도 조용히 넘어감, 만료된 구독은 삭제)
export async function sendPush(env, st, setSettings, who, msg) {
  const { results } = await env.DB.prepare("SELECT endpoint, p256dh, auth FROM push_subs WHERE who = ?1").bind(who).all();
  if (!results || !results.length) return 0;
  const vapid = await getVapid(env, st, setSettings);
  const payload = JSON.stringify(msg);
  let sent = 0;
  await Promise.all(results.map(async (s) => {
    try {
      const body = await encryptPayload(s, payload);
      const r = await fetch(s.endpoint, {
        method: "POST",
        headers: {
          "Content-Encoding": "aes128gcm",
          "Content-Type": "application/octet-stream",
          TTL: "86400",
          Urgency: "high",
          Authorization: await vapidAuth(s.endpoint, vapid),
        },
        body,
      });
      if (r.status === 404 || r.status === 410) await env.DB.prepare("DELETE FROM push_subs WHERE endpoint = ?1").bind(s.endpoint).run();
      else if (r.ok) sent++;
    } catch {}
  }));
  return sent;
}
