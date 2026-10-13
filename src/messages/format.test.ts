import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { makeFakeChatStorage, makeTmpDir } from "../test/fixtures.js";
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
