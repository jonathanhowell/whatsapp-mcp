import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { makeFakeChatStorage, makeTmpDir } from "../test/fixtures.js";
import { toolHarness } from "../test/tool-harness.js";
import { registerGetMessagesTool } from "../tools/get-messages.js";

describe("sender names", () => {
  let work: string;
  let h: ReturnType<typeof toolHarness>;
  let m: Record<number, any>;

  before(async () => {
    work = makeTmpDir();
    const dbPath = makeFakeChatStorage(work, (d) => {
      d.exec(`
        INSERT INTO ZWACHATSESSION (Z_PK, ZPARTNERNAME, ZCONTACTJID, ZSESSIONTYPE) VALUES
          (724, 'Mum', '100000000000005@lid', 0),
          (26, 'Sailing', '447700900000-1600000000@g.us', 1);
        INSERT INTO ZWAGROUPMEMBER (Z_PK, ZCHATSESSION, ZMEMBERJID, ZCONTACTNAME) VALUES
          (1, 26, '111@lid', NULL),       -- in address book by LID
          (2, 26, '222@lid', NULL),       -- push name only via phone-number mapping
          (3, 26, '333@lid', NULL),       -- LID display name only
          (4, 26, '444@lid', 'Group Nick'),
          (5, 26, '555@lid', NULL);       -- unknown everywhere
        INSERT INTO ZWAPROFILEPUSHNAME (ZJID, ZPUSHNAME) VALUES ('447700900222@s.whatsapp.net', 'Bob (push)');
        INSERT INTO ZWAMESSAGE (Z_PK, ZCHATSESSION, ZGROUPMEMBER, ZMESSAGETYPE, ZISFROMME, ZMESSAGEDATE, ZTEXT, ZFROMJID, ZPUSHNAME) VALUES
          (1, 26, 1, 0, 0, 1, 'a', '447700900000-1600000000@g.us', 'COiOqdUGIAA='),
          (2, 26, 2, 0, 0, 2, 'b', '447700900000-1600000000@g.us', 'IAA='),
          (3, 26, 3, 0, 0, 3, 'c', '447700900000-1600000000@g.us', NULL),
          (4, 26, 4, 0, 0, 4, 'd', '447700900000-1600000000@g.us', NULL),
          (5, 26, 5, 0, 0, 5, 'e', '447700900000-1600000000@g.us', 'IAA='),
          (6, 724, NULL, 0, 0, 6, 'f', '100000000000005@lid', 'IAA='),
          (7, 724, NULL, 0, 1, 7, 'g', NULL, 'CKbal80GGhs0NDc4MDE5MDkxNjZAcy53aGF0c2FwcC5uZXQgAA==');
      `);
    });
    const ab = new Database(path.join(work, "ContactsV2.sqlite"));
    ab.exec(`CREATE TABLE ZWAADDRESSBOOKCONTACT (Z_PK INTEGER PRIMARY KEY, ZFULLNAME TEXT, ZBUSINESSNAME TEXT,
               ZLID TEXT, ZWHATSAPPID TEXT, ZGIVENNAME TEXT, ZLASTNAME TEXT, ZPHONENUMBER TEXT, ZLOCALIZEDPHONENUMBER TEXT);
             INSERT INTO ZWAADDRESSBOOKCONTACT (ZFULLNAME, ZLID, ZWHATSAPPID) VALUES ('Alice Address-Book', '111@lid', '447700900111@s.whatsapp.net');`);
    ab.close();
    const lid = new Database(path.join(work, "LID.sqlite"));
    lid.exec(`CREATE TABLE ZWAZACCOUNT (Z_PK INTEGER PRIMARY KEY, ZIDENTIFIER TEXT, ZPHONENUMBER TEXT, ZDISPLAYNAME TEXT);
              INSERT INTO ZWAZACCOUNT (ZIDENTIFIER, ZPHONENUMBER, ZDISPLAYNAME) VALUES
                ('222@lid', '447700900222', NULL), ('333@lid', NULL, 'Carol (LID)');`);
    lid.close();

    h = toolHarness(dbPath);
    registerGetMessagesTool(h.server, h.getState);
    const all = [
      ...(await h.call("get_messages", { chat_id: 26 })).messages,
      ...(await h.call("get_messages", { chat_id: 724 })).messages,
    ];
    m = Object.fromEntries(all.map((x: any) => [x.message_id, x]));
  });
  after(() => {
    h.close();
    fs.rmSync(work, { recursive: true, force: true });
  });

  it("resolves group senders from the address book by LID", () => {
    assert.equal(m[1].sender_name, "Alice Address-Book");
    assert.equal(m[1].sender_jid, "111@lid");
  });
  it("maps @lid to the phone-number JID for push names", () => {
    assert.equal(m[2].sender_name, "Bob (push)");
  });
  it("falls back to the LID display name, and prefers the group contact name", () => {
    assert.equal(m[3].sender_name, "Carol (LID)");
    assert.equal(m[4].sender_name, "Group Nick");
  });
  it("returns null (never a base64 token or raw JID) when unresolved, with sender_jid set", () => {
    assert.equal(m[5].sender_name, null);
    assert.equal(m[5].sender_jid, "555@lid");
  });
  it("1:1 inbound messages fall back to the chat partner's name", () => {
    assert.equal(m[6].sender_name, "Mum");
    assert.equal(m[6].sender_jid, "100000000000005@lid");
  });
  it("own messages have null sender_name/sender_jid rather than the ZPUSHNAME blob", () => {
    assert.equal(m[7].is_from_me, true);
    assert.equal(m[7].sender_name, null);
    assert.equal(m[7].sender_jid, null);
  });
});
