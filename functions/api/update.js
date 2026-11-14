// POST /api/update  { name, code, lat, lon, acc, batt }  — 웹페이지에서 보낼 때
import { json, roomKey, cleanName, validCode, saveLoc } from "../_shared.js";

export async function onRequestPost({ request, env }) {
  let b;
  try {
    b = await request.json();
  } catch {
    return json({ error: "잘못된 요청" }, 400);
  }
  const name = cleanName(b.name);
  if (!name) return json({ error: "이름을 입력하세요" }, 400);
  if (!validCode(b.code)) return json({ error: "방 코드는 6자 이상" }, 400);
  try {
    const room = await roomKey(b.code);
    await saveLoc(env, room, name, { ...b, src: "web", t: Date.now() });
    return json({ ok: true });
  } catch (e) {
    return json({ error: e.message }, 400);
  }
}
