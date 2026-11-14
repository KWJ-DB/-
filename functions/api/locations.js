// GET /api/locations  (헤더 X-Room: 방 코드)
import { json, roomKey, validCode, listLocs } from "../_shared.js";

export async function onRequestGet({ request, env }) {
  let code = "";
  try {
    code = decodeURIComponent(request.headers.get("x-room") || "");
  } catch {}
  if (!validCode(code)) return json({ error: "방 코드가 올바르지 않아요" }, 400);
  const room = await roomKey(code);
  const list = await listLocs(env, room);
  return json({ now: Date.now(), members: list });
}
