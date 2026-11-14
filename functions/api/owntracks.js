// POST /api/owntracks — OwnTracks 앱(HTTP 모드)이 백그라운드에서 위치를 보내는 곳
// 앱 설정: Username = 내 이름, Password = 방 코드
import { json, roomKey, cleanName, validCode, saveLoc, listLocs } from "../_shared.js";

function parseBasic(header) {
  if (!header || !header.startsWith("Basic ")) return null;
  try {
    const bin = atob(header.slice(6));
    const text = new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
    const i = text.indexOf(":");
    if (i < 0) return null;
    return { user: text.slice(0, i), pass: text.slice(i + 1) };
  } catch {
    return null;
  }
}

function unauthorized() {
  return new Response("unauthorized", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="friendmap"' },
  });
}

export async function onRequestPost({ request, env }) {
  const cred = parseBasic(request.headers.get("authorization"));
  if (!cred || !validCode(cred.pass)) return unauthorized();

  const name = cleanName(cred.user || request.headers.get("x-limit-u"));
  if (!name) return unauthorized();
  const room = await roomKey(cred.pass);

  let body = null;
  try {
    body = await request.json();
  } catch {}

  if (body && body._type === "location") {
    try {
      await saveLoc(env, room, name, {
        lat: body.lat,
        lon: body.lon,
        acc: body.acc,
        batt: body.batt,
        t: body.tst ? body.tst * 1000 : Date.now(),
        src: "app",
      });
    } catch {}
  }

  // 응답으로 친구 위치를 돌려주면 OwnTracks 앱 지도에도 친구가 보임
  const list = await listLocs(env, room);
  const msgs = list
    .filter((r) => r.name !== name)
    .map((r) => {
      const m = {
        _type: "location",
        lat: r.lat,
        lon: r.lon,
        tst: Math.floor(r.t / 1000),
        tid: [...r.name].slice(0, 2).join(""),
        topic: `owntracks/${encodeURIComponent(r.name)}/phone`,
      };
      if (r.acc != null) m.acc = r.acc;
      if (r.batt != null) m.batt = r.batt;
      return m;
    });
  return json(msgs);
}
