export const APPLE_EPOCH_OFFSET_SECONDS = 978307200;

export function appleEpochToISO(coreDataTs: number | null): string | null {
  if (coreDataTs === null || coreDataTs === 0) return null;
  return new Date((coreDataTs + APPLE_EPOCH_OFFSET_SECONDS) * 1000).toISOString();
}
