import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ProtoMessage } from "./protobuf.js";
import { pb } from "../test/fixtures.js";

describe("ProtoMessage", () => {
  it("reads nested strings, ints and repeated messages", () => {
    const buf = pb([
      [87, [[1, [[1, 1], [2, 0], [3, 678], [5, [[1, "100000000000004@lid"]]]]]]],
      [7, [[1, [[3, "👍"]]], [1, [[3, "❤️"]]]]],
      [4, 1790000000000],
    ]);
    const m = ProtoMessage.decode(buf);
    assert.equal(m.path(87, 1).int(3), 678);
    assert.equal(m.path(87, 1, 5).str(1), "100000000000004@lid");
    assert.deepEqual(m.msg(7).msgs(1).map((r) => r.str(3)), ["👍", "❤️"]);
    assert.equal(m.int(4), 1790000000000, "varints beyond 2^31 survive");
  });

  it("reads packed repeated varints", () => {
    const m = ProtoMessage.decode(pb([[1, Buffer.from([0, 2, 1])]]));
    assert.deepEqual(m.ints(1), [0, 2, 1]);
  });

  it("returns an empty message for garbage or null", () => {
    assert.equal(ProtoMessage.decode(Buffer.from([0xff, 0xff])).has(1), false);
    assert.equal(ProtoMessage.decode(null).str(1), null);
  });
});
