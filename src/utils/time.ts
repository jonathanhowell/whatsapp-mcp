export const APPLE_EPOCH_OFFSET_SECONDS = 978307200;

export function appleEpochToISO(coreDataTs: number | null): string | null {
  if (coreDataTs === null || coreDataTs === 0) return null;
  return new Date((coreDataTs + APPLE_EPOCH_OFFSET_SECONDS) * 1000).toISOString();
}

export function isoToAppleEpoch(iso: string): number {
  return Math.floor(new Date(iso).getTime() / 1000) - APPLE_EPOCH_OFFSET_SECONDS;
}

export const MESSAGE_TYPE_MAP: Record<number, string> = {
  0:  "text",
  1:  "image",
  2:  "location",
  6:  "voice",
  7:  "sticker",
  8:  "video",
  10: "document",
  14: "system",
  19: "template", // WhatsApp Business template message (header/body/footer in ZMETADATA)
  59: "poll",
  66: "reaction",
};

export function resolveMessageType(typeInt: number): string {
  return MESSAGE_TYPE_MAP[typeInt] ?? `unknown(${typeInt})`;
}
