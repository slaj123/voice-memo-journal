// Serves memo audio from R2 (binding MEMOS_AUDIO in wrangler.toml). It sits
// behind functions/_middleware.js, so only a signed-in Journal can play it;
// the voice Worker no longer serves audio publicly.
//
// Supports Range requests: iOS Safari won't play or seek audio without them.

const KEY_RE = /^[A-Za-z0-9._-]{1,200}$/;

export async function onRequestGet({ params, request, env }) {
  const key = String(params.key || "");
  if (!KEY_RE.test(key) || key.includes("..")) return new Response("Bad name", { status: 400 });
  if (!env.MEMOS_AUDIO) return new Response("Audio storage not bound", { status: 503 });

  const range = parseRange(request.headers.get("Range"));
  const object = await env.MEMOS_AUDIO.get(key, range ? { range } : undefined);
  if (!object) return new Response("Not found", { status: 404 });

  const headers = new Headers({
    "Content-Type": object.httpMetadata?.contentType || "audio/mp4",
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=3600",
  });
  if (!range) {
    headers.set("Content-Length", String(object.size));
    return new Response(object.body, { status: 200, headers });
  }
  const start = range.offset ?? object.size - range.suffix;
  const end = range.length !== undefined ? start + range.length - 1 : object.size - 1;
  headers.set("Content-Range", `bytes ${start}-${end}/${object.size}`);
  headers.set("Content-Length", String(end - start + 1));
  return new Response(object.body, { status: 206, headers });
}

// "bytes=0-1", "bytes=100-", "bytes=-500" -> an R2 range option, else null.
export function parseRange(header) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header || "");
  if (!m || (m[1] === "" && m[2] === "")) return null;
  if (m[1] === "") return { suffix: Number(m[2]) };
  const offset = Number(m[1]);
  if (m[2] === "") return { offset };
  const end = Number(m[2]);
  return end >= offset ? { offset, length: end - offset + 1 } : null;
}
