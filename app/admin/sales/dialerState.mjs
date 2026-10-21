export const HANDOFF =
  "I can show you in about two minutes. I'll put our AI receptionist on — she already knows everything from the main pages of your website. Ask her anything a customer would ask your receptionist.";
export const OUTCOMES = [
  ["no_answer", "No answer"],
  ["voicemail", "Voicemail"],
  ["callback_requested", "Call back ▾"],
  ["not_interested", "Not interested"],
  ["do_not_call", "Do not call ▾"],
  ["demo_completed", "Demo done"],
  ["signup_link_sent", "Link sent"],
];
export function dialerPhase(call) {
  return !call?.id
    ? "READY"
    : call.terminal
      ? "WRAPUP"
      : call.aiLive
        ? "DEMO"
        : call.prospectConnected
          ? "TALK"
          : "DIALING";
}
export function elapsed(start, end = Date.now()) {
  if (start === null || start === undefined || start === "") return "0:00";
  const seconds = Math.max(
    0,
    Math.floor((new Date(end).getTime() - new Date(start).getTime()) / 1000) ||
      0,
  );
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
export function orderNumbers(numbers = []) {
  return [...numbers].sort(
    (a, b) =>
      (Date.parse(b.lastConnectedAt) || 0) -
        (Date.parse(a.lastConnectedAt) || 0) ||
      ({ cell: 0, shop: 1, other: 2 }[a.type] ?? 2) -
        ({ cell: 0, shop: 1, other: 2 }[b.type] ?? 2),
  );
}
export function renderScript(text, vars = {}) {
  return String(text || "").replace(/\{([a-z_]+)\}/g, (_, key) =>
    String(vars[key] || ""),
  );
}
export function suggestedAsks(prospect) {
  if (prospect?.suggestedAsks?.length) return prospect.suggestedAsks;
  const facts = prospect?.coreFacts || [];
  const asks = [];
  for (const [category, text] of [
    ["hours", "Ask her what your hours are."],
    ["service_area", "Ask her if you cover my area."],
    ["services", "Ask her what services you offer."],
  ])
    if (
      facts.some(
        (f) => String(f.category).toLowerCase().replace(/ /g, "_") === category,
      )
    )
      asks.push({ category, text, pitch: false });
  if ((prospect?.pitchFlags || []).some((f) => /no after.hours/i.test(f)))
    asks.push({
      category: "after_hours",
      text: "Ask her to get someone out tonight.",
      pitch: true,
    });
  return asks;
}
export function callbackTime(kind, now = new Date()) {
  const date = new Date(now);
  if (kind === "today") date.setHours(date.getHours() + 2);
  else {
    date.setDate(date.getDate() + 1);
    date.setHours(kind === "tomorrow_am" ? 10 : 14, 0, 0, 0);
  }
  return date.toISOString();
}
export function mayQuickAdvance({ call, outcome, note }) {
  return Boolean(
    call?.terminal &&
      ["no_answer", "voicemail"].includes(outcome) &&
      !String(note || "").trim(),
  );
}
export function safeExternalUrl(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

export function formatPhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  return /^1?\d{10}$/.test(digits)
    ? `(${digits.slice(-10, -7)}) ${digits.slice(-7, -4)}-${digits.slice(-4)}`
    : String(value || "");
}
