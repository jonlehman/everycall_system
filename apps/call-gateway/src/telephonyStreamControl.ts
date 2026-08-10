export const TELNYX_INPUT_STREAM_TRACK = "inbound_track";

export function shouldForwardTelnyxInputTrack(value: unknown) {
  const track = String(value || "").trim().toLowerCase();
  return !track || track.includes("inbound");
}

export function buildTelnyxClearEvent() {
  return { event: "clear" };
}
