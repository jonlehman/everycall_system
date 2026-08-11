function normalizeText(value: unknown) {
  return String(value || "").trim();
}

function normalizeSpeaker(value: unknown) {
  const text = normalizeText(value) || "Speaker";
  return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
}

function normalizeTranscriptComparisonText(value: unknown) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function splitTranscriptLine(line: string) {
  const match = normalizeText(line).match(/^(Assistant|Caller|Agent|System):\s*(.*)$/i);
  if (!match) return null;
  return {
    speaker: String(match[1]).toLowerCase(),
    text: normalizeText(match[2])
  };
}

function commonPrefixWordCount(left: string[], right: string[]) {
  const limit = Math.min(left.length, right.length);
  let count = 0;
  while (count < limit && left[count] === right[count]) count += 1;
  return count;
}

function commonPrefixCharacterCount(left: string, right: string) {
  const limit = Math.min(left.length, right.length);
  let count = 0;
  while (count < limit && left[count] === right[count]) count += 1;
  return count;
}

export function areIncrementalTranscriptSnapshots(previous: unknown, next: unknown) {
  const previousText = normalizeTranscriptComparisonText(previous);
  const nextText = normalizeTranscriptComparisonText(next);
  if (!previousText || !nextText) return false;
  if (previousText === nextText) return true;
  if (previousText.startsWith(`${nextText} `) || nextText.startsWith(`${previousText} `)) return true;

  const previousWords = previousText.split(" ");
  const nextWords = nextText.split(" ");
  const sharedWords = commonPrefixWordCount(previousWords, nextWords);
  const shorterWordCount = Math.min(previousWords.length, nextWords.length);
  if (sharedWords < 2 || sharedWords !== shorterWordCount - 1) return false;

  const previousBoundaryWord = previousWords[sharedWords] || "";
  const nextBoundaryWord = nextWords[sharedWords] || "";
  const boundaryLength = Math.min(previousBoundaryWord.length, nextBoundaryWord.length);
  return boundaryLength >= 3
    && commonPrefixCharacterCount(previousBoundaryWord, nextBoundaryWord) / boundaryLength >= 0.6;
}

export function selectPreferredTranscriptSnapshot(previous: unknown, next: unknown) {
  const previousText = normalizeText(previous);
  const nextText = normalizeText(next);
  if (!previousText) return nextText;
  if (!nextText) return previousText;
  return nextText;
}

export function collapseIncrementalTranscriptLines(lines: string[]) {
  const collapsed: string[] = [];
  for (const rawLine of lines || []) {
    const line = normalizeText(rawLine);
    if (!line) continue;
    const current = splitTranscriptLine(line);
    const previousLine = collapsed[collapsed.length - 1] || "";
    const previous = previousLine ? splitTranscriptLine(previousLine) : null;
    if (
      current
      && previous
      && current.speaker === "caller"
      && current.speaker === previous.speaker
      && areIncrementalTranscriptSnapshots(previous.text, current.text)
    ) {
      collapsed[collapsed.length - 1] = selectPreferredTranscriptSnapshot(previous.text, current.text) === previous.text
        ? previousLine
        : line;
      continue;
    }
    collapsed.push(line);
  }
  return collapsed;
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
  return collapseIncrementalTranscriptLines(lines).join("\n");
}

export function sanitizeTranscriptText(text: string) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line) => normalizeText(line))
    .filter(Boolean)
    .filter((line) => !isStructuredSystemLine(line));
  return collapseIncrementalTranscriptLines(lines).join("\n");
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
