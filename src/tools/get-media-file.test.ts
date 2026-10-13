import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { exportMedia, mediaFilename, resolveMedia } from "./get-media-file.js";
import { makeTmpDir } from "../test/fixtures.js";

const row = (o: Partial<Parameters<typeof resolveMedia>[0]>) => ({
  message_id: 1,
  message_type: 1,
  media_item_id: 10,
  media_path: null,
  media_url: "https://mmg.whatsapp.net/x",
  media_file_size: 100,
  media_title: null,
  text: null,
  ...o,
});
const noLive = () => null;

describe("resolveMedia", () => {
  let base: string;
  before(() => {
    base = makeTmpDir();
    fs.mkdirSync(path.join(base, "Media/chat/a"), { recursive: true });
    fs.writeFileSync(path.join(base, "Media/chat/a/photo.jpg"), "jpegbytes");
  });
  after(() => fs.rmSync(base, { recursive: true, force: true }));

  it("ok for a downloaded file", () => {
    const r = resolveMedia(row({ media_path: "Media/chat/a/photo.jpg" }), base, noLive);
    assert.equal(r.status, "ok");
    assert.equal(r.size, 9);
  });

  it("not_downloaded (not EISDIR) when the path is null — the reported bug", () => {
    const r = resolveMedia(row({ media_path: null }), base, noLive);
    assert.equal(r.status, "not_downloaded");
  });

  it("not_downloaded when the path resolves to a directory", () => {
    assert.equal(resolveMedia(row({ media_path: "Media/chat" }), base, noLive).status, "not_downloaded");
  });

  it("uses a path recorded in the live DB after the snapshot was taken", () => {
    const r = resolveMedia(row({ media_path: null }), base, () => "Media/chat/a/photo.jpg");
    assert.equal(r.status, "ok");
  });

  it("missing when a recorded file was deleted", () => {
    assert.equal(resolveMedia(row({ media_path: "Media/chat/a/gone.jpg" }), base, noLive).status, "missing");
  });

  it("no_media for text, calls, templates and link previews (metadata-only media rows)", () => {
    for (const t of [0, 7, 10, 19, 46, 59, 66]) {
      assert.equal(resolveMedia(row({ message_type: t }), base, noLive).status, "no_media", `type ${t}`);
    }
    assert.equal(resolveMedia(row({ media_item_id: null }), base, noLive).status, "no_media");
  });
});

describe("mediaFilename", () => {
  it("uses the document title (ZTEXT) for documents, adding the extension", () => {
    assert.equal(mediaFilename({ message_type: 8, text: "Example Corp Org Chart" }, "/x/uuid.pdf"), "Example Corp Org Chart.pdf");
    assert.equal(mediaFilename({ message_type: 8, text: "Report.PDF" }, "/x/uuid.pdf"), "Report.PDF");
  });
  it("uses the local file name for images (never the caption)", () => {
    assert.equal(mediaFilename({ message_type: 1, text: null }, "/x/abc.jpg"), "abc.jpg");
  });
});

describe("exportMedia", () => {
  let dir: string;
  before(() => (dir = makeTmpDir()));
  after(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("copies the file to a readable temp path and prunes day-old exports", () => {
    const src = path.join(dir, "src.jpg");
    fs.writeFileSync(src, "bytes");
    const out = path.join(dir, "out");
    fs.mkdirSync(out);
    const old = path.join(out, "1-old.jpg");
    fs.writeFileSync(old, "x");
    const twoDaysAgo = new Date(Date.now() - 2 * 86400_000);
    fs.utimesSync(old, twoDaysAgo, twoDaysAgo);

    const p = exportMedia(42, src, "../evil/name.jpg", out);
    assert.equal(path.dirname(p), out);
    assert.equal(path.basename(p), "42-_evil_name.jpg");
    assert.equal(fs.readFileSync(p, "utf8"), "bytes");
    assert.ok(!fs.existsSync(old));
  });
});
