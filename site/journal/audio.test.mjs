// node site/journal/audio.test.mjs — checks functions/audio/[key].js against
// a fake R2 bucket: full reads, Range reads (iOS needs them), bad names.
import assert from "node:assert";
import { onRequestGet, parseRange } from "./functions/audio/[key].js";

assert.deepStrictEqual(parseRange("bytes=0-1"), { offset: 0, length: 2 });
assert.deepStrictEqual(parseRange("bytes=100-"), { offset: 100 });
assert.deepStrictEqual(parseRange("bytes=-500"), { suffix: 500 });
assert.strictEqual(parseRange("bytes=5-1"), null);
assert.strictEqual(parseRange(null), null);
assert.strictEqual(parseRange("bytes=-"), null);

const data = new Uint8Array(1000).map((_, i) => i % 256);
const bucket = {
  async get(key, opts) {
    if (key !== "memo.m4a") return null;
    let bytes = data;
    const r = opts?.range;
    if (r) {
      const start = r.offset ?? data.length - r.suffix;
      bytes = data.slice(start, r.length !== undefined ? start + r.length : undefined);
    }
    return { size: data.length, body: bytes, httpMetadata: { contentType: "audio/x-m4a" } };
  },
};
const call = (key, range) => onRequestGet({
  params: { key },
  request: new Request("https://j.test/audio/" + key, { headers: range ? { Range: range } : {} }),
  env: { MEMOS_AUDIO: bucket },
});

let r = await call("memo.m4a");
assert.strictEqual(r.status, 200);
assert.strictEqual(r.headers.get("Accept-Ranges"), "bytes");
assert.strictEqual((await r.arrayBuffer()).byteLength, 1000);

r = await call("memo.m4a", "bytes=0-1");
assert.strictEqual(r.status, 206);
assert.strictEqual(r.headers.get("Content-Range"), "bytes 0-1/1000");
assert.strictEqual(r.headers.get("Content-Length"), "2");

r = await call("memo.m4a", "bytes=-100");
assert.strictEqual(r.headers.get("Content-Range"), "bytes 900-999/1000");

r = await call("memo.m4a", "bytes=990-");
assert.strictEqual(r.headers.get("Content-Range"), "bytes 990-999/1000");

assert.strictEqual((await call("nope.m4a")).status, 404);
assert.strictEqual((await call("../secret")).status, 400);
assert.strictEqual((await call("a/b.m4a")).status, 400);
assert.strictEqual((await onRequestGet({ params: { key: "memo.m4a" }, request: new Request("https://j.test/"), env: {} })).status, 503);

console.log("audio.test.mjs: all assertions passed");
