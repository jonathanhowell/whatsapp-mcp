import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { makeFakeChatStorage, makeTmpDir, pb } from "../test/fixtures.js";
import { toolHarness } from "../test/tool-harness.js";
import { registerGetMessagesTool } from "../tools/get-messages.js";
import { registerGetMessagesSinceTool } from "../tools/get-messages-since.js";
import { registerSearchMessagesTool } from "../tools/search-messages.js";

const CAPTION = "Hi All,\n\nBob's dinghy is for sale — numerous spares.";

describe("captions and filenames", () => {
  let work: string;
  let h: ReturnType<typeof toolHarness>;
  const byId = (msgs: any[]) => Object.fromEntries(msgs.map((m) => [m.message_id, m]));

  before(() => {
    work = makeTmpDir();
    const db = makeFakeChatStorage(work, (d) => {
      d.exec(`
        INSERT INTO ZWACHATSESSION (Z_PK, ZPARTNERNAME, ZCONTACTJID, ZSESSIONTYPE) VALUES (26, 'Sailing', '1@g.us', 1);
        INSERT INTO ZWAMEDIAITEM (Z_PK, ZMEDIALOCALPATH, ZFILESIZE, ZTITLE) VALUES
          (1, 'Media/x/a.jpg', 137588, '${CAPTION.replace(/'/g, "''")}'),
          (2, 'Media/x/b.pdf', 665028, 'Hi Sam. Good to chat last week.'),
          (3, 'Media/x/c.pdf', 151996, NULL),
          (4, NULL, 0, NULL);
        INSERT INTO ZWAMESSAGE (Z_PK, ZCHATSESSION, ZMEDIAITEM, ZMESSAGETYPE, ZISFROMME, ZMESSAGEDATE, ZTEXT) VALUES
          (32931, 26, 1, 1, 0, 810738420, NULL),
          (34747, 26, 2, 8, 1, 810738421, 'Example Corp Org Chart'),
          (27444, 26, 3, 8, 0, 810738422, 'Quarterly_Report_Final'),
          (100,   26, 4, 0, 0, 810738423, 'plain text');
      `);
    });
    h = toolHarness(db);
    registerGetMessagesTool(h.server, h.getState);
    registerGetMessagesSinceTool(h.server, h.getState);
    registerSearchMessagesTool(h.server, h.getState);
  });
  after(() => {
    h.close();
    fs.rmSync(work, { recursive: true, force: true });
  });

  const check = (m: Record<number, any>) => {
    assert.equal(m[32931].text, CAPTION, "image caption goes in text");
    assert.equal(m[32931].media.filename, null, "caption must not be the filename");
    assert.equal(m[34747].text, "Hi Sam. Good to chat last week.", "document caption in text");
    assert.equal(m[34747].media.filename, "Example Corp Org Chart", "document title in filename");
    assert.equal(m[27444].text, null);
    assert.equal(m[27444].media.filename, "Quarterly_Report_Final");
    assert.equal(m[100].text, "plain text");
    assert.equal(m[100].media, null, "metadata-only media rows are not media");
  };

  it("get_messages", async () => {
    check(byId((await h.call("get_messages", { chat_id: 26 })).messages));
  });

  it("get_messages_since", async () => {
    check(byId((await h.call("get_messages_since", { since: "2001-01-01T00:00:00Z" })).chats[0].messages));
  });

  it("search_messages matches captions and returns them in text", async () => {
    const res = await h.call("search_messages", { query: "numerous spares" });
    assert.equal(res.total_messages, 1);
    assert.equal(res.chats[0].messages[0].message_id, 32931);
    assert.equal(res.chats[0].messages[0].text, CAPTION);
    const doc = await h.call("search_messages", { query: "good to chat" });
    assert.equal(doc.chats[0].messages[0].message_id, 34747);
  });
});

describe("message types (audited mapping)", () => {
  let work: string;
  let h: ReturnType<typeof toolHarness>;
  let m: Record<number, any>;

  before(async () => {
    work = makeTmpDir();
    const db = makeFakeChatStorage(work, (d) => {
      const media = d.prepare(
        "INSERT INTO ZWAMEDIAITEM (Z_PK, ZMEDIALOCALPATH, ZFILESIZE, ZTITLE, ZMEDIAURL, ZVCARDNAME, ZVCARDSTRING, ZLATITUDE, ZLONGITUDE, ZMETADATA) VALUES (?,?,?,?,?,?,?,?,?,?)"
      );
      const info = d.prepare("INSERT INTO ZWAMESSAGEINFO (Z_PK, ZRECEIPTINFO) VALUES (?, ?)");
      const msg = d.prepare(
        "INSERT INTO ZWAMESSAGE (Z_PK, ZCHATSESSION, ZMEDIAITEM, ZMESSAGEINFO, ZMESSAGETYPE, ZGROUPEVENTTYPE, ZISFROMME, ZMESSAGEDATE, ZTEXT) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?)"
      );
      d.prepare("INSERT INTO ZWACHATSESSION (Z_PK, ZPARTNERNAME, ZSESSIONTYPE) VALUES (1, 'Chat', 0)").run();
      let t = 811786284;
      const add = (id: number, type: number, o: { me?: number; text?: string | null; media?: any[]; info?: Buffer; ge?: number } = {}) => {
        let mid = null;
        if (o.media) {
          media.run(id, ...o.media);
          mid = id;
        }
        let iid = null;
        if (o.info) {
          info.run(id, o.info);
          iid = id;
        }
        msg.run(id, mid, iid, type, o.ge ?? 2, o.me ?? 0, t++, o.text ?? null);
      };
      // documents were typed "video" (8 is document)
      add(27444, 8, { text: "Quarterly_Report_Final", media: ["Media/a.pdf", 151996, null, "https://mmg", null, null, 0, 0, null] });
      // phantom: E2E banner inserted when the chat started
      add(34746, 10, { media: [null, 0, null, null, null, null, 0, 0, pb([[49, 47]])] });
      // link preview was typed "sticker"
      add(34751, 7, { text: "Coach support for the regatta", media: [null, 0, "Event - Summer Regatta", "https://example.org/e", null, null, 0, 0, null] });
      // calls were typed "poll"
      add(19637, 59, { media: [null, 0, null, null, null, null, 0, 0, pb([[87, [[1, [[1, 0], [2, 0], [3, 678], [5, [[1, "1@lid"]]]]]]]])] });
      add(22475, 59, { me: 1, media: [null, 0, null, null, null, null, 0, 0, pb([[87, [[1, [[1, 0], [2, 1], [3, 0]]]]]])] });
      add(36686, 59, { media: [null, 0, null, null, null, null, 0, 0, pb([[87, [[1, [[1, 1], [2, 1], [3, 0]]]]]])] });
      // a genuine poll
      add(37017, 46, {
        info: pb([[8, [[2, "Attending the picnic"], [3, [[1, "Yes"]]], [3, [[1, "No"]]], [3, [[1, "Maybe"]]], [4, 1],
          [5, [[1, 1], [4, "a@lid"]]], [5, [[1, 0], [4, "b@lid"]]], [5, [[1, 1], [4, "c@lid"]]], [5, [[4, "d@lid"]]]]]]),
      });
      // a text message carrying two reactions (WhatsApp stores reactions on the target)
      add(37172, 0, { text: "See you there", info: pb([[7, [[1, [[1, "AC98"], [2, "100000000000002@lid"], [3, "👍"], [4, 1790000000000]]], [1, [[2, "x@lid"], [3, ""]]]]]]) });
      // business template (unknown(19))
      add(35063, 19, { media: [null, 0, null, null, null, null, 0, 0, pb([[24, [[1, [[2, "We have an update for you"], [6, "Hi there, Monday is cancelled"], [7, "Example Fitness Ltd"]]]]]])] });
      add(36841, 66, { media: [null, 0, null, null, null, null, 0, 0, null] });
      add(36789, 4, { media: [null, 0, null, null, "Example Taxis", "BEGIN:VCARD\nFN:Example Taxis\nEND:VCARD", 0, 0, null] });
      add(33918, 5, { media: [null, 0, null, null, null, null, 12.3456, -65.4321, null] });
      add(37090, 14, { media: [null, 0, "3A5CFA58F721D82426F2", null, null, null, 0, 0, null] });
    });
    h = toolHarness(db);
    registerGetMessagesTool(h.server, h.getState);
    m = Object.fromEntries(
      (await h.call("get_messages", { chat_id: 1, limit: 100 })).messages.map((x: any) => [x.message_id, x])
    );
  });
  after(() => {
    h.close();
    fs.rmSync(work, { recursive: true, force: true });
  });

  it("8 is document, not video", () => {
    assert.equal(m[27444].type, "document");
    assert.equal(m[27444].media.filename, "Quarterly_Report_Final");
  });

  it("10 is a system notice with no text or media (the 'phantom' row)", () => {
    assert.equal(m[34746].type, "system");
    assert.equal(m[34746].text, null);
    assert.equal(m[34746].media, null);
  });

  it("7 is link: text kept, preview in `link`, no fake media filename", () => {
    assert.equal(m[34751].type, "link");
    assert.equal(m[34751].text, "Coach support for the regatta");
    assert.deepEqual(m[34751].link, { url: "https://example.org/e", title: "Event - Summer Regatta" });
    assert.equal(m[34751].media, null);
  });

  it("59 is call with direction, duration, outcome and missed status", () => {
    assert.equal(m[19637].type, "call");
    assert.deepEqual(m[19637].call, { direction: "incoming", video: false, duration_seconds: 678, outcome: "answered", missed: false });
    assert.equal(m[19637].text, "Incoming voice call (11m 18s)");
    assert.deepEqual(m[22475].call, { direction: "outgoing", video: false, duration_seconds: 0, outcome: "not_answered", missed: false });
    assert.equal(m[36686].call.missed, true);
    assert.equal(m[36686].text, "Missed video call");
  });

  it("46 is poll, decoded with vote counts", () => {
    assert.equal(m[37017].type, "poll");
    assert.deepEqual(m[37017].poll, {
      question: "Attending the picnic",
      options: [{ name: "Yes", votes: 1 }, { name: "No", votes: 2 }, { name: "Maybe", votes: 0 }],
      max_selections: 1,
    });
    assert.match(m[37017].text, /^Poll: Attending the picnic\n- Yes \(1 vote\)/);
  });

  it("reactions are attached to the message they react to (removed reactions skipped)", () => {
    assert.deepEqual(m[37172].reactions, [
      { emoji: "👍", from_me: false, sender_jid: "100000000000002@lid", timestamp: new Date(1790000000000).toISOString() },
    ]);
    assert.equal(m[27444].reactions, undefined);
  });

  it("19 is template with its body text", () => {
    assert.equal(m[35063].type, "template");
    assert.equal(m[35063].text, "We have an update for you\n\nHi there, Monday is cancelled\n\nExample Fitness Ltd");
  });

  it("album, contact, location and deleted", () => {
    assert.equal(m[36841].type, "album");
    assert.equal(m[36789].type, "contact");
    assert.equal(m[36789].text, "Example Taxis");
    assert.match(m[36789].contact.vcard, /BEGIN:VCARD/);
    assert.deepEqual(m[33918].location, { latitude: 12.3456, longitude: -65.4321 });
    assert.equal(m[37090].type, "deleted");
    assert.equal(m[37090].media, null);
  });
});
