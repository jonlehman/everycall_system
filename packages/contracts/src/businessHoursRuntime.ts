import { createDeterministicId, deterministicAnswerPacketSchema, type DeterministicAnswerPacket } from "./knowledgePlannerRuntime.js";

export type BusinessHoursPeriod = {
  openDay?: string | null;
  open_day?: string | null;
  openTime?: string | null;
  open_time?: string | null;
  closeDay?: string | null;
  close_day?: string | null;
  closeTime?: string | null;
  close_time?: string | null;
};

export type BusinessHoursConfig = {
  timezone?: string | null;
  openStatus?: string | null;
  open_status?: string | null;
  displayText?: string | null;
  display_text?: string | null;
  regularHours?: BusinessHoursPeriod[] | null;
  regular_hours?: BusinessHoursPeriod[] | null;
};

const BUSINESS_HOURS_DAYS = [
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
  "SUNDAY"
] as const;

const DAY_LABELS: Record<string, string> = {
  MONDAY: "Monday",
  TUESDAY: "Tuesday",
  WEDNESDAY: "Wednesday",
  THURSDAY: "Thursday",
  FRIDAY: "Friday",
  SATURDAY: "Saturday",
  SUNDAY: "Sunday"
};

const DAY_ALIAS_MAP: Record<string, string> = {
  mon: "MONDAY",
  monday: "MONDAY",
  tue: "TUESDAY",
  tues: "TUESDAY",
  tuesday: "TUESDAY",
  wed: "WEDNESDAY",
  wednesday: "WEDNESDAY",
  thu: "THURSDAY",
  thur: "THURSDAY",
  thurs: "THURSDAY",
  thursday: "THURSDAY",
  fri: "FRIDAY",
  friday: "FRIDAY",
  sat: "SATURDAY",
  saturday: "SATURDAY",
  sun: "SUNDAY",
  sunday: "SUNDAY"
};

const HOURS_QUERY_RE = /\b(hours?|business hours|open now|open right now|are you open|currently open|currently closed|what time do you open|when do you open|what time do you close|when do you close|today'?s hours|hours today|open today|closed today|weekend hours)\b/i;
const OPEN_NOW_RE = /\b(open now|open right now|are you open|currently open|currently closed)\b/i;
const CLOSE_TIME_RE = /\b(what time do you close|when do you close|closing time|close today)\b/i;
const OPEN_TIME_RE = /\b(what time do you open|when do you open|opening time|open today)\b/i;
const TODAY_HOURS_RE = /\b(today'?s hours|hours today|open today|closed today)\b/i;

function normalizeText(value: unknown) {
  return String(value || "").trim();
}

function uniqueValues(values: Iterable<unknown>) {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const text = normalizeText(value);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(text);
  }
  return output;
}

function estimateTokenCount(value: unknown) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return Math.ceil(Buffer.byteLength(String(text || ""), "utf8") / 4);
}

function parseDayToken(token: unknown) {
  return DAY_ALIAS_MAP[normalizeText(token).toLowerCase()] || null;
}

function parseTimeToMinutes(value: unknown) {
  const text = normalizeText(value);
  if (!text) return null;
  if (text === "24:00") return 24 * 60;
  const match24 = text.match(/^(\d{1,2}):(\d{2})$/);
  if (match24) {
    const hours = Number(match24[1]);
    const minutes = Number(match24[2]);
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
    return (hours * 60) + minutes;
  }
  const match12 = text.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/i);
  if (!match12) return null;
  let hours = Number(match12[1]);
  const minutes = Number(match12[2] || 0);
  const meridiem = String(match12[3] || "").toUpperCase();
  if (hours < 1 || hours > 12 || minutes < 0 || minutes > 59) return null;
  if (hours === 12) hours = 0;
  if (meridiem === "PM") hours += 12;
  return (hours * 60) + minutes;
}

function formatTimeLabel(value: unknown) {
  const minutes = parseTimeToMinutes(value);
  if (minutes === null) return normalizeText(value) || "-";
  if (minutes >= 24 * 60) return "12:00 AM";
  const hours24 = Math.floor(minutes / 60);
  const mins = minutes % 60;
  const meridiem = hours24 >= 12 ? "PM" : "AM";
  const hours12 = (hours24 % 12) || 12;
  return `${hours12}:${String(mins).padStart(2, "0")} ${meridiem}`;
}

function getLocalDateParts(value: Date, timezone: string) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone || "America/Los_Angeles",
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(value).filter((part) => part.type !== "literal").map((part) => [part.type, part.value])
  );
  const day = parseDayToken(parts.weekday);
  if (!day) return null;
  return {
    day,
    minutes: ((Number(parts.hour) || 0) * 60) + (Number(parts.minute) || 0)
  };
}

function getRegularHours(config: BusinessHoursConfig) {
  return Array.isArray(config?.regularHours || config?.regular_hours)
    ? (config?.regularHours || config?.regular_hours || [])
    : [];
}

function normalizeOpenStatus(config: BusinessHoursConfig) {
  return normalizeText(config?.openStatus || config?.open_status || "OPEN").toUpperCase();
}

function getTodayPeriods(config: BusinessHoursConfig, day: string) {
  return getRegularHours(config)
    .map((period) => ({
      openDay: normalizeText(period?.openDay || period?.open_day).toUpperCase(),
      openTime: normalizeText(period?.openTime || period?.open_time),
      closeDay: normalizeText(period?.closeDay || period?.close_day || period?.openDay || period?.open_day).toUpperCase(),
      closeTime: normalizeText(period?.closeTime || period?.close_time)
    }))
    .filter((period) => period.openDay === day && period.closeDay === day)
    .filter((period) => parseTimeToMinutes(period.openTime) !== null && parseTimeToMinutes(period.closeTime) !== null)
    .sort((left, right) => (parseTimeToMinutes(left.openTime) || 0) - (parseTimeToMinutes(right.openTime) || 0));
}

function isBusinessOpenNow(config: BusinessHoursConfig, now: Date, localDay: string, localMinutes: number) {
  const openStatus = normalizeOpenStatus(config);
  if (openStatus === "CLOSED_PERMANENTLY" || openStatus === "CLOSED_TEMPORARILY") return false;
  const dayIndex = BUSINESS_HOURS_DAYS.indexOf(localDay as typeof BUSINESS_HOURS_DAYS[number]);
  if (dayIndex < 0) return false;
  const currentWeekMinute = (dayIndex * 1440) + localMinutes;
  const regularHours = getRegularHours(config);
  const WEEK_MINUTES = 7 * 24 * 60;

  for (const rawPeriod of regularHours) {
    const openDay = normalizeText(rawPeriod?.openDay || rawPeriod?.open_day).toUpperCase();
    const closeDay = normalizeText(rawPeriod?.closeDay || rawPeriod?.close_day || rawPeriod?.openDay || rawPeriod?.open_day).toUpperCase();
    const openIndex = BUSINESS_HOURS_DAYS.indexOf(openDay as typeof BUSINESS_HOURS_DAYS[number]);
    const closeIndex = BUSINESS_HOURS_DAYS.indexOf(closeDay as typeof BUSINESS_HOURS_DAYS[number]);
    const openMinutes = parseTimeToMinutes(rawPeriod?.openTime || rawPeriod?.open_time);
    const closeMinutes = parseTimeToMinutes(rawPeriod?.closeTime || rawPeriod?.close_time);
    if (openIndex < 0 || closeIndex < 0 || openMinutes === null || closeMinutes === null) continue;

    let start = (openIndex * 1440) + openMinutes;
    let end = (closeIndex * 1440) + closeMinutes;
    if (end <= start) end += WEEK_MINUTES;
    if (currentWeekMinute >= start && currentWeekMinute < end) return true;
    const wrappedMinute = currentWeekMinute + WEEK_MINUTES;
    if (wrappedMinute >= start && wrappedMinute < end) return true;
  }

  return false;
}

function formatTodayHours(periods: Array<{ openTime: string; closeTime: string }>) {
  if (!periods.length) return "";
  return periods
    .map((period) => `${formatTimeLabel(period.openTime)} to ${formatTimeLabel(period.closeTime)}`)
    .join(", ");
}

function resolveDisplayText(config: BusinessHoursConfig) {
  return normalizeText(config?.displayText || config?.display_text);
}

export function isBusinessHoursQuestion(queryText: string) {
  return HOURS_QUERY_RE.test(normalizeText(queryText));
}

export function buildBusinessHoursAnswerPacket(input: {
  tenantId: string;
  buildId: string;
  queryText: string;
  businessHours: BusinessHoursConfig | null | undefined;
  now?: Date;
}): DeterministicAnswerPacket | null {
  const queryText = normalizeText(input.queryText);
  if (!queryText || !isBusinessHoursQuestion(queryText)) return null;

  const businessHours = input.businessHours || {};
  const timezone = normalizeText(businessHours.timezone) || "America/Los_Angeles";
  const now = input.now instanceof Date ? input.now : new Date();
  const local = getLocalDateParts(now, timezone);
  if (!local) return null;

  const openStatus = normalizeOpenStatus(businessHours);
  const todayPeriods = getTodayPeriods(businessHours, local.day);
  const displayText = resolveDisplayText(businessHours);
  const isOpenNow = isBusinessOpenNow(businessHours, now, local.day, local.minutes);
  const asksOpenNow = OPEN_NOW_RE.test(queryText);
  const asksCloseTime = CLOSE_TIME_RE.test(queryText);
  const asksOpenTime = OPEN_TIME_RE.test(queryText);
  const asksTodayHours = TODAY_HOURS_RE.test(queryText);

  const directAnswerPoints: string[] = [];
  const qualifiers: string[] = [];
  const nextStepOptions: string[] = [];

  if (openStatus === "CLOSED_PERMANENTLY") {
    directAnswerPoints.push("The business is currently marked closed permanently.");
  } else if (openStatus === "CLOSED_TEMPORARILY") {
    directAnswerPoints.push("The business is currently marked closed temporarily.");
  } else if (asksCloseTime) {
    if (todayPeriods.length) {
      const latestClose = todayPeriods[todayPeriods.length - 1]?.closeTime || "";
      directAnswerPoints.push(`Today the business closes at ${formatTimeLabel(latestClose)}.`);
    } else {
      directAnswerPoints.push(`The business is closed today, ${DAY_LABELS[local.day] || "today"}.`);
    }
  } else if (asksOpenTime) {
    if (todayPeriods.length) {
      const firstOpen = todayPeriods[0]?.openTime || "";
      directAnswerPoints.push(`Today the business opens at ${formatTimeLabel(firstOpen)}.`);
    } else {
      directAnswerPoints.push(`The business is closed today, ${DAY_LABELS[local.day] || "today"}.`);
    }
  } else if (asksOpenNow) {
    directAnswerPoints.push(`The business is currently ${isOpenNow ? "open" : "closed"}.`);
    if (todayPeriods.length) {
      directAnswerPoints.push(`Today's hours are ${formatTodayHours(todayPeriods)}.`);
    } else {
      directAnswerPoints.push(`The business is closed today, ${DAY_LABELS[local.day] || "today"}.`);
    }
  } else if (asksTodayHours) {
    if (todayPeriods.length) {
      directAnswerPoints.push(`Today's hours are ${formatTodayHours(todayPeriods)}.`);
    } else {
      directAnswerPoints.push(`The business is closed today, ${DAY_LABELS[local.day] || "today"}.`);
    }
  }

  if (!directAnswerPoints.length && displayText) {
    directAnswerPoints.push(`Business hours are ${displayText}.`);
  }
  if (!directAnswerPoints.length) {
    return null;
  }

  if (displayText && !directAnswerPoints.some((item) => item.toLowerCase().includes(displayText.toLowerCase()))) {
    qualifiers.push(`Regular hours are ${displayText}.`);
  }
  qualifiers.push("Times are in the business's local time zone.");

  const packetBase = {
    answer_packet_id: createDeterministicId("pkt"),
    tenant_id: input.tenantId,
    build_id: input.buildId,
    query_text: queryText,
    runtime_mode: "answer" as const,
    coverage: [
      {
        requested_coverage_item_text: queryText,
        support_strength: "strong" as const,
        used_card_ids: [],
        used_fact_ids: [],
        direct_answer_points: uniqueValues(directAnswerPoints).slice(0, 4),
        qualifiers: uniqueValues(qualifiers).slice(0, 4),
        limits_or_exclusions: [],
        next_step_options: uniqueValues(nextStepOptions).slice(0, 3)
      }
    ],
    direct_answer_points: uniqueValues(directAnswerPoints).slice(0, 6),
    qualifiers: uniqueValues(qualifiers).slice(0, 6),
    limits_or_exclusions: [],
    next_step_options: uniqueValues(nextStepOptions).slice(0, 3),
    unsupported_requested_items: [],
    used_card_ids: [],
    used_fact_ids: [],
    metadata: {
      answer_source: "tenant_business_hours",
      business_hours_timezone: timezone,
      business_hours_open_status: openStatus
    }
  };

  return deterministicAnswerPacketSchema.parse({
    ...packetBase,
    token_counts: {
      packet_tokens: estimateTokenCount(packetBase),
      soft_budget_tokens: 1400,
      hard_budget_tokens: 2200
    }
  });
}
