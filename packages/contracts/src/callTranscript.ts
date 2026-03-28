function normalizeText(value: unknown) {
  return String(value || "").trim();
}

function normalizeSpeaker(value: unknown) {
  const text = normalizeText(value) || "Speaker";
  return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
}

function isStructuredSystemLine(line: string, eventType = "") {
  const normalizedLine = normalizeText(line);
  const normalizedEventType = normalizeText(eventType).toLowerCase();
  if (!normalizedLine) return false;
  if (normalizedEventType === "tool") return true;

  const rawPayload = normalizedLine.replace(/^System:\s*/i, "");
  if (!rawPayload.startsWith("{")) return false;

  try {
    const parsed = JSON.parse(rawPayload);
    return Boolean(parsed && typeof parsed === "object" && !Array.isArray(parsed));
  } catch {
    return false;
  }
}

export type TranscriptEventRow = {
  role?: string | null;
  text?: string | null;
  event_type?: string | null;
};

export function buildTranscriptFromEvents(rows: TranscriptEventRow[]) {
  const lines: string[] = [];
  for (const row of rows || []) {
    const text = normalizeText(row?.text);
    if (!text) continue;
    const line = /^(Assistant|Caller|Agent|System):\s*/i.test(text)
      ? text
      : `${normalizeSpeaker(row?.role)}: ${text}`;
    if (isStructuredSystemLine(line, String(row?.event_type || ""))) continue;
    lines.push(line);
  }
  return lines.join("\n");
}

export function sanitizeTranscriptText(text: string) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => normalizeText(line))
    .filter(Boolean)
    .filter((line) => !isStructuredSystemLine(line))
    .join("\n");
}

export function addTranscriptSpacing(text: string) {
  const cleaned = sanitizeTranscriptText(text);
  if (!cleaned) return "";
  return cleaned
    .split("\n")
    .map((line) => normalizeText(line))
    .filter(Boolean)
    .join("\n\n");
}
