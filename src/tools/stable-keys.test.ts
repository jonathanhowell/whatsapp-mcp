import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { makeFakeChatStorage, makeTmpDir, pb } from "../test/fixtures.js";
import { toolHarness } from "../test/tool-harness.js";
import { registerGetMessagesTool } from "./get-messages.js";
import { registerGetMessagesSinceTool } from "./get-messages-since.js";
import { registerSearchMessagesTool } from "./search-messages.js";
import { registerGetChatTool } from "./get-chat.js";
import { registerListChatsTool } from "./list-chats.js";
import { registerGetMediaFileTool } from "./get-media-file.js";

const GROUP = "120363000000000001@g.us";
const DM = "447700900123@s.whatsapp.net";
const MEMBER = "100000000000001@lid";

describe("stable keys (stanza_id, chat_jid)", () => {
  let work: string;
  let h: ReturnType<typeof toolHarness>;
  const SINCE = { since: "2001-01-01T00:00:00Z" };

  before(() => {
    work = makeTmpDir();
    const db = makeFakeChatStorage(work, (d) => {
      d.exec(`
        INSERT INTO ZWACHATSESSION (Z_PK, ZPARTNERNAME, ZCONTACTJID, ZSESSIONTYPE) VALUES
          (10, 'Test Group', '${GROUP}', 1), (20, 'Test Person', '${DM}', 0);
        INSERT INTO ZWAMEDIAITEM (Z_PK, ZMEDIALOCALPATH, ZFILESIZE) VALUES (70, 'Media/x/photo.jpg', 4);
      `);
      const media = d.prepare("INSERT INTO ZWAMEDIAITEM (Z_PK, ZMETADATA) VALUES (?, ?)");
      const msg = d.prepare(
        "INSERT INTO ZWAMESSAGE (Z_PK, ZCHATSESSION, ZMEDIAITEM, ZMESSAGETYPE, ZISFROMME, ZMESSAGEDATE, ZTEXT, ZSTANZAID) VALUES (?,?,?,?,?,?,?,?)"
      );
      msg.run(1, 10, null, 0, 0, 100, "group post", "GROUPPOST");
      msg.run(2, 10, 70, 1, 0, 101, null, "PHOTO");
      // call events reuse the call ID as stanza ID in more than one chat
      msg.run(3, 10, null, 0, 0, 102, "same id, group", "SHARED");
      msg.run(4, 20, null, 0, 1, 103, "same id, dm", "SHARED");
      // reply whose original was deleted
      media.run(80, pb([[5, "GONE"], [6, MEMBER], [19, [[1, "deleted original"]]]]));
      msg.run(5, 10, 80, 0, 0, 104, "reply to deleted", "R1");
      // "reply privately": a 1:1 reply quoting a group message (ZMETADATA field 7)
      media.run(81, pb([[5, "GROUPPOST"], [6, MEMBER], [7, GROUP], [19, [[1, "group post"]]]]));
      msg.run(6, 20, 81, 0, 1, 105, "private reply", "R2");
    });
    fs.mkdirSync(path.join(work, "Message", "Media", "x"), { recursive: true });
    fs.writeFileSync(path.join(work, "Message", "Media", "x", "photo.jpg"), "JPEG");
    h = toolHarness(db);
    for (const reg of [
      registerGetMessagesTool,
      registerGetMessagesSinceTool,
      registerSearchMessagesTool,
      registerGetChatTool,
      registerListChatsTool,
      registerGetMediaFileTool,
    ]) {
      reg(h.server, h.getState);
    }
  });
  after(() => {
    h.close();
    fs.rmSync(work, { recursive: true, force: true });
  });

  it("every message carries stanza_id and every chat group carries chat_jid", async () => {
    const page = await h.call("get_messages", { chat_id: 10 });
    assert.equal(page.chat_jid, GROUP);
    assert.deepEqual(page.messages.map((m: any) => m.stanza_id).sort(), ["GROUPPOST", "PHOTO", "R1", "SHARED"]);

    for (const res of [await h.call("get_messages_since", SINCE), await h.call("search_messages", { query: "same id" })]) {
      assert.ok(res.chats.length > 0);
      for (const chat of res.chats) {
        assert.equal(chat.chat_jid, chat.chat_id === 10 ? GROUP : DM);
        for (const m of chat.messages) assert.equal(typeof m.stanza_id, "string");
      }
    }
  });

  it("chat_jid input returns the same messages as chat_id", async () => {
    for (const [id, jid] of [[10, GROUP], [20, DM]] as const) {
      const byId = await h.call("get_messages", { chat_id: id });
      const byJid = await h.call("get_messages", { chat_jid: jid });
      assert.deepEqual(byJid, byId);
    }
    assert.deepEqual(await h.call("get_chat", { chat_jid: DM }), await h.call("get_chat", { chat_id: 20 }));
  });

  it("rejects both or neither chat key, and unknown JIDs", async () => {
    const error = async (name: string, args: object) => {
      const res = await h.raw(name, args);
      assert.equal(res.isError, true);
      return res.content[0].text;
    };
    for (const args of [{}, { chat_id: 10, chat_jid: GROUP }]) {
      assert.match(await error("get_messages", args), /exactly one of chat_id or chat_jid/);
      assert.match(await error("get_chat", args), /exactly one of chat_id or chat_jid/);
    }
    assert.match(await error("get_messages", { chat_jid: "447700900999@s.whatsapp.net" }), /No chat with JID/);
    for (const args of [{}, { stanza_id: "PHOTO" }, { message_id: 2, stanza_id: "PHOTO", chat_jid: GROUP }]) {
      assert.match(await error("get_media_file", args), /either message_id, or both stanza_id and chat_jid/);
    }
  });

  it("list_chats and get_chat expose chat_jid alongside jid", async () => {
    const { chats } = await h.call("list_chats");
    for (const c of chats) assert.equal(c.chat_jid, c.jid);
    assert.equal((await h.call("get_chat", { chat_id: 10 })).chat_jid, GROUP);
  });

  it("quoted carries stanza_id and chat_jid, even when the original was deleted", async () => {
    const group = await h.call("get_messages", { chat_jid: GROUP });
    const r1 = group.messages.find((m: any) => m.stanza_id === "R1");
    assert.equal(r1.quoted.message_id, null);
    assert.equal(r1.quoted.stanza_id, "GONE");
    assert.equal(r1.quoted.chat_jid, GROUP);
  });

  it("resolves a private reply's quote in the group it came from", async () => {
    const dm = await h.call("get_messages", { chat_jid: DM });
    const r2 = dm.messages.find((m: any) => m.stanza_id === "R2");
    assert.equal(r2.quoted.message_id, 1);
    assert.equal(r2.quoted.stanza_id, "GROUPPOST");
    assert.equal(r2.quoted.chat_jid, GROUP);
  });

  it("get_media_file accepts stanza_id + chat_jid", async () => {
    const res = await h.call("get_media_file", { stanza_id: "PHOTO", chat_jid: GROUP, inline: true });
    assert.equal(res.status, "ok");
    assert.equal(res.message_id, 2);
    assert.equal(Buffer.from(res.data, "base64").toString(), "JPEG");

    const none = await h.call("get_media_file", { stanza_id: "SHARED", chat_jid: DM });
    assert.equal(none.message_id, 4, "stanza ID is matched within the given chat");
    assert.equal(none.status, "no_media");

    const missing = await h.call("get_media_file", { stanza_id: "PHOTO", chat_jid: DM });
    assert.equal(missing.status, "not_found");

  });
});
