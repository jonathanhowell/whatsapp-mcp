export const APPLE_EPOCH_OFFSET_SECONDS = 978307200;

export function appleEpochToISO(coreDataTs: number | null): string | null {
  if (coreDataTs === null || coreDataTs === 0) return null;
  return new Date((coreDataTs + APPLE_EPOCH_OFFSET_SECONDS) * 1000).toISOString();
}

export function isoToAppleEpoch(iso: string): number {
  return Math.floor(new Date(iso).getTime() / 1000) - APPLE_EPOCH_OFFSET_SECONDS;
}

// ZWAMESSAGE.ZMESSAGETYPE, audited against a real macOS ChatStorage.sqlite
// (Oct 2026) by inspecting each type's ZTEXT / ZWAMEDIAITEM columns and
// protobuf metadata. Types not listed (12, 13, 28, 60, 75) are rare and
// carry no user content we could identify; they surface as unknown(N).
export const MESSAGE_TYPE_MAP: Record<number, string> = {
  0:  "text",
  1:  "image",
  2:  "video",
  3:  "audio",          // voice notes and audio files
  4:  "contact",        // shared vCard (ZVCARDNAME / ZVCARDSTRING)
  5:  "location",       // ZLATITUDE / ZLONGITUDE
  6:  "group_event",    // join/leave/subject change etc.
  7:  "link",           // text with a link preview (ZMEDIAURL / ZTITLE)
  8:  "document",       // ZTEXT = document title, ZTITLE = caption
  10: "system",         // per-chat notices, e.g. the E2E-encryption banner
  11: "gif",
  14: "deleted",        // "This message was deleted"
  15: "sticker",
  19: "template",       // WhatsApp Business template (text in ZMETADATA)
  23: "template",       // WhatsApp PSA with video (text in ZMETADATA)
  27: "group_invite",
  30: "interactive",    // business list/buttons message (text in ZMETADATA)
  31: "list_response",
  32: "interactive",
  34: "button_response",
  42: "template",
  43: "template",
  46: "poll",           // question/options/votes in ZWAMESSAGEINFO.ZRECEIPTINFO
  54: "video_note",
  59: "call",           // voice/video call event (details in ZMETADATA)
  66: "album",          // header row for a group of images that follow it
};

export function resolveMessageType(typeInt: number): string {
  return MESSAGE_TYPE_MAP[typeInt] ?? `unknown(${typeInt})`;
}
