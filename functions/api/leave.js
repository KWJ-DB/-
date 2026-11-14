// POST /api/leave  { name, code }  — 내 위치 기록 삭제
import { json, roomKey, cleanName, validCode, deleteLoc } from "../_shared.js";

export async function onRequestPost({ request, env }) {
  let b;
  try {
    b = await request.json();
  } catch {
    return json({ error: "잘못된 요청" }, 400);
  }
  const name = cleanName(b.name);
  if (!name || !validCode(b.code)) return json({ error: "잘못된 요청" }, 400);
  await deleteLoc(env, await roomKey(b.code), name);
  return json({ ok: true });
}
