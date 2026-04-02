export const BUSINESS_HOURS_DAYS = [
  'MONDAY',
  'TUESDAY',
  'WEDNESDAY',
  'THURSDAY',
  'FRIDAY',
  'SATURDAY',
  'SUNDAY'
];

export const BUSINESS_HOURS_DAY_LABELS = {
  MONDAY: 'Mon',
  TUESDAY: 'Tue',
  WEDNESDAY: 'Wed',
  THURSDAY: 'Thu',
  FRIDAY: 'Fri',
  SATURDAY: 'Sat',
  SUNDAY: 'Sun'
};

const DAY_ALIAS_MAP = {
  mon: 'MONDAY',
  monday: 'MONDAY',
  tue: 'TUESDAY',
  tues: 'TUESDAY',
  tuesday: 'TUESDAY',
  wed: 'WEDNESDAY',
  wednesday: 'WEDNESDAY',
  thu: 'THURSDAY',
  thur: 'THURSDAY',
  thurs: 'THURSDAY',
  thursday: 'THURSDAY',
  fri: 'FRIDAY',
  friday: 'FRIDAY',
  sat: 'SATURDAY',
  saturday: 'SATURDAY',
  sun: 'SUNDAY',
  sunday: 'SUNDAY'
};

const WEEK_MINUTES = 7 * 24 * 60;

function normalizeText(value) {
  return String(value || '').trim();
}

function clampNumber(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.min(max, Math.max(min, number));
}

function zeroPad(value) {
  return String(value).padStart(2, '0');
}

export function createDefaultWeeklyHours() {
  return BUSINESS_HOURS_DAYS.map((day) => ({
    day,
    enabled: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'].includes(day),
    openTime: '07:00',
    closeTime: '20:00'
  }));
}

export function parseTimeToMinutes(value) {
  const text = normalizeText(value);
  if (!text) return null;
  if (text === '24:00') return 24 * 60;
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
  const meridiem = String(match12[3] || '').toUpperCase();
  if (hours < 1 || hours > 12 || minutes < 0 || minutes > 59) return null;
  if (hours === 12) hours = 0;
  if (meridiem === 'PM') hours += 12;
  return (hours * 60) + minutes;
}

export function minutesToTimeString(minutes) {
  const safe = clampNumber(minutes, 0, 24 * 60);
  if (safe >= 24 * 60) return '24:00';
  const hours = Math.floor(safe / 60);
  const mins = safe % 60;
  return `${zeroPad(hours)}:${zeroPad(mins)}`;
}

export function formatTimeLabel(value) {
  const minutes = parseTimeToMinutes(value);
  if (minutes === null) return normalizeText(value) || '-';
  if (minutes >= 24 * 60) return '12:00 AM';
  const hours24 = Math.floor(minutes / 60);
  const mins = minutes % 60;
  const meridiem = hours24 >= 12 ? 'PM' : 'AM';
  const hours12 = (hours24 % 12) || 12;
  return `${hours12}:${zeroPad(mins)} ${meridiem}`;
}

export function normalizeWeeklyHours(input) {
  const source = Array.isArray(input) ? input : [];
  const byDay = new Map(
    source
      .map((row) => ({
        day: normalizeText(row?.day).toUpperCase(),
        enabled: Boolean(row?.enabled),
        openTime: normalizeText(row?.openTime || row?.open_time || '07:00'),
        closeTime: normalizeText(row?.closeTime || row?.close_time || '20:00')
      }))
      .filter((row) => BUSINESS_HOURS_DAYS.includes(row.day))
      .map((row) => [row.day, row])
  );

  return BUSINESS_HOURS_DAYS.map((day) => {
    const existing = byDay.get(day);
    if (!existing) {
      return {
        day,
        enabled: false,
        openTime: '07:00',
        closeTime: '20:00'
      };
    }
    return {
      day,
      enabled: Boolean(existing.enabled),
      openTime: minutesToTimeString(parseTimeToMinutes(existing.openTime) ?? parseTimeToMinutes('07:00')),
      closeTime: minutesToTimeString(parseTimeToMinutes(existing.closeTime) ?? parseTimeToMinutes('20:00'))
    };
  });
}

export function weeklyHoursToRegularPeriods(weeklyHours) {
  return normalizeWeeklyHours(weeklyHours)
    .filter((row) => row.enabled)
    .map((row) => ({
      openDay: row.day,
      openTime: row.openTime,
      closeDay: row.day,
      closeTime: row.closeTime
    }));
}

export function regularPeriodsToWeeklyHours(periods) {
  const weeklyHours = createDefaultWeeklyHours().map((row) => ({ ...row, enabled: false }));
  let hasComplexHours = false;
  const dayIndexMap = new Map(BUSINESS_HOURS_DAYS.map((day, index) => [day, index]));

  for (const rawPeriod of Array.isArray(periods) ? periods : []) {
    const openDay = normalizeText(rawPeriod?.openDay || rawPeriod?.open_day).toUpperCase();
    const closeDay = normalizeText(rawPeriod?.closeDay || rawPeriod?.close_day || openDay).toUpperCase();
    if (!dayIndexMap.has(openDay) || !dayIndexMap.has(closeDay)) {
      hasComplexHours = true;
      continue;
    }
    const openTime = minutesToTimeString(parseTimeToMinutes(rawPeriod?.openTime || rawPeriod?.open_time || '07:00') ?? 420);
    const closeTime = minutesToTimeString(parseTimeToMinutes(rawPeriod?.closeTime || rawPeriod?.close_time || '20:00') ?? 1200);
    const row = weeklyHours[dayIndexMap.get(openDay)];
    if (openDay !== closeDay || row.enabled) {
      hasComplexHours = true;
      continue;
    }
    row.enabled = true;
    row.openTime = openTime;
    row.closeTime = closeTime;
  }

  return { weeklyHours, hasComplexHours };
}

function buildDayRangeLabel(days) {
  if (!days.length) return '';
  if (days.length === 7) return 'Daily';
  const indices = days.map((day) => BUSINESS_HOURS_DAYS.indexOf(day)).filter((index) => index >= 0).sort((a, b) => a - b);
  if (!indices.length) return '';
  if (indices.length === 1) return BUSINESS_HOURS_DAY_LABELS[days[0]] || days[0];
  let isConsecutive = true;
  for (let index = 1; index < indices.length; index += 1) {
    if (indices[index] !== indices[index - 1] + 1) {
      isConsecutive = false;
      break;
    }
  }
  if (isConsecutive) {
    const startDay = BUSINESS_HOURS_DAYS[indices[0]];
    const endDay = BUSINESS_HOURS_DAYS[indices[indices.length - 1]];
    return `${BUSINESS_HOURS_DAY_LABELS[startDay]}-${BUSINESS_HOURS_DAY_LABELS[endDay]}`;
  }
  return days.map((day) => BUSINESS_HOURS_DAY_LABELS[day] || day).join(', ');
}

export function buildBusinessHoursDisplayText(weeklyHours) {
  const normalized = normalizeWeeklyHours(weeklyHours);
  const groups = [];
  for (const row of normalized) {
    const key = row.enabled ? `${row.openTime}-${row.closeTime}` : 'CLOSED';
    const previous = groups[groups.length - 1];
    if (previous && previous.key === key) {
      previous.days.push(row.day);
    } else {
      groups.push({ key, days: [row.day], row });
    }
  }
  const openGroups = groups.filter((group) => group.key !== 'CLOSED');
  if (!openGroups.length) return 'Closed';
  if (openGroups.length === 1 && openGroups[0].days.length === 7) {
    const openTime = openGroups[0].row.openTime;
    const closeTime = openGroups[0].row.closeTime;
    if (openTime === '00:00' && closeTime === '24:00') return 'Open 24 hours';
  }
  return openGroups.map((group) => {
    const dayLabel = buildDayRangeLabel(group.days);
    return `${dayLabel} ${formatTimeLabel(group.row.openTime)} - ${formatTimeLabel(group.row.closeTime)}`;
  }).join('; ');
}

function parseDayToken(token) {
  return DAY_ALIAS_MAP[normalizeText(token).toLowerCase()] || null;
}

function expandDayGroup(value) {
  const text = normalizeText(value);
  if (!text) return [];
  if (/^(daily|every day|7 days|seven days)$/i.test(text)) {
    return [...BUSINESS_HOURS_DAYS];
  }
  const rangeMatch = text.match(/^([A-Za-z]+)\s*-\s*([A-Za-z]+)$/);
  if (rangeMatch) {
    const start = parseDayToken(rangeMatch[1]);
    const end = parseDayToken(rangeMatch[2]);
    if (!start || !end) return [];
    const startIndex = BUSINESS_HOURS_DAYS.indexOf(start);
    const endIndex = BUSINESS_HOURS_DAYS.indexOf(end);
    if (startIndex < 0 || endIndex < 0) return [];
    if (startIndex <= endIndex) {
      return BUSINESS_HOURS_DAYS.slice(startIndex, endIndex + 1);
    }
    return [...BUSINESS_HOURS_DAYS.slice(startIndex), ...BUSINESS_HOURS_DAYS.slice(0, endIndex + 1)];
  }
  return text
    .split(/[&/]/g)
    .map((part) => parseDayToken(part))
    .filter(Boolean);
}

export function parseLegacyBusinessHoursText(text, timezone = 'America/Los_Angeles') {
  const trimmed = normalizeText(text);
  if (!trimmed || /^unknown$/i.test(trimmed)) {
    const weeklyHours = createDefaultWeeklyHours();
    return {
      timezone,
      source: 'manual',
      openStatus: 'OPEN',
      weeklyHours,
      regularHours: weeklyHoursToRegularPeriods(weeklyHours),
      specialHours: [],
      moreHours: [],
      displayText: buildBusinessHoursDisplayText(weeklyHours),
      parsed: true
    };
  }

  if (/^(24\/7|24 hours|open 24 hours)$/i.test(trimmed)) {
    const weeklyHours = BUSINESS_HOURS_DAYS.map((day) => ({
      day,
      enabled: true,
      openTime: '00:00',
      closeTime: '24:00'
    }));
    return {
      timezone,
      source: 'manual',
      openStatus: 'OPEN',
      weeklyHours,
      regularHours: weeklyHoursToRegularPeriods(weeklyHours),
      specialHours: [],
      moreHours: [],
      displayText: 'Open 24 hours',
      parsed: true
    };
  }

  const weeklyHours = createDefaultWeeklyHours().map((row) => ({ ...row, enabled: false }));
  const dayIndexMap = new Map(BUSINESS_HOURS_DAYS.map((day, index) => [day, index]));
  const segments = trimmed.split(/[;]+|,(?=\s*[A-Za-z])/g).map((item) => item.trim()).filter(Boolean);
  let parsedAny = false;

  for (const segment of segments) {
    const match = segment.match(/^(.*?)\s+(closed|24\/7|24 hours|open 24 hours|(?:\d{1,2}(?::\d{2})?\s*[AP]M)\s*-\s*(?:\d{1,2}(?::\d{2})?\s*[AP]M))$/i);
    if (!match) continue;
    const dayGroup = expandDayGroup(match[1]);
    if (!dayGroup.length) continue;
    const hoursPart = normalizeText(match[2]).toLowerCase();
    if (hoursPart === 'closed') {
      for (const day of dayGroup) {
        weeklyHours[dayIndexMap.get(day)] = { day, enabled: false, openTime: '07:00', closeTime: '20:00' };
      }
      parsedAny = true;
      continue;
    }
    const openAllDay = /^(24\/7|24 hours|open 24 hours)$/i.test(hoursPart);
    let openTime = '00:00';
    let closeTime = '24:00';
    if (!openAllDay) {
      const timeMatch = hoursPart.match(/^(.+?)\s*-\s*(.+)$/);
      const openMinutes = parseTimeToMinutes(timeMatch?.[1]);
      const closeMinutes = parseTimeToMinutes(timeMatch?.[2]);
      if (openMinutes === null || closeMinutes === null) continue;
      openTime = minutesToTimeString(openMinutes);
      closeTime = minutesToTimeString(closeMinutes);
    }
    for (const day of dayGroup) {
      weeklyHours[dayIndexMap.get(day)] = { day, enabled: true, openTime, closeTime };
    }
    parsedAny = true;
  }

  const normalized = normalizeWeeklyHours(weeklyHours);
  return {
    timezone,
    source: 'manual',
    openStatus: 'OPEN',
    weeklyHours: normalized,
    regularHours: weeklyHoursToRegularPeriods(normalized),
    specialHours: [],
    moreHours: [],
    displayText: parsedAny ? buildBusinessHoursDisplayText(normalized) : trimmed,
    parsed: parsedAny
  };
}

export function createBusinessHoursConfig(input = {}, fallbackTimezone = 'America/Los_Angeles') {
  const timezone = normalizeText(input.timezone) || fallbackTimezone;
  const source = normalizeText(input.source) || 'manual';
  const openStatus = normalizeText(input.openStatus || input.open_status) || 'OPEN';
  const specialHours = Array.isArray(input.specialHours || input.special_hours) ? (input.specialHours || input.special_hours) : [];
  const moreHours = Array.isArray(input.moreHours || input.more_hours) ? (input.moreHours || input.more_hours) : [];

  if (Array.isArray(input.weeklyHours || input.weekly_hours)) {
    const weeklyHours = normalizeWeeklyHours(input.weeklyHours || input.weekly_hours);
    return {
      timezone,
      source,
      openStatus,
      weeklyHours,
      regularHours: weeklyHoursToRegularPeriods(weeklyHours),
      specialHours,
      moreHours,
      displayText: normalizeText(input.displayText || input.display_text) || buildBusinessHoursDisplayText(weeklyHours)
    };
  }

  if (Array.isArray(input.regularHours || input.regular_hours)) {
    const { weeklyHours, hasComplexHours } = regularPeriodsToWeeklyHours(input.regularHours || input.regular_hours);
    return {
      timezone,
      source,
      openStatus,
      weeklyHours,
      regularHours: Array.isArray(input.regularHours || input.regular_hours) ? (input.regularHours || input.regular_hours) : [],
      specialHours,
      moreHours,
      displayText: normalizeText(input.displayText || input.display_text) || buildBusinessHoursDisplayText(weeklyHours),
      hasComplexHours
    };
  }

  if (normalizeText(input.displayText || input.display_text || input.businessHours || input.business_hours)) {
    return parseLegacyBusinessHoursText(
      input.displayText || input.display_text || input.businessHours || input.business_hours,
      timezone
    );
  }

  const weeklyHours = createDefaultWeeklyHours();
  return {
    timezone,
    source,
    openStatus,
    weeklyHours,
    regularHours: weeklyHoursToRegularPeriods(weeklyHours),
    specialHours,
    moreHours,
    displayText: buildBusinessHoursDisplayText(weeklyHours)
  };
}

function getLocalDateParts(value, timezone) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone || 'America/Los_Angeles',
    weekday: 'long',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(date).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value])
  );
  const day = parseDayToken(parts.weekday);
  if (!day) return null;
  return {
    day,
    year: parts.year,
    month: parts.month,
    dayOfMonth: parts.day,
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: ((Number(parts.hour) || 0) * 60) + (Number(parts.minute) || 0)
  };
}

function isWithinRegularPeriods(periods, localDay, localMinutes) {
  const currentIndex = BUSINESS_HOURS_DAYS.indexOf(localDay);
  if (currentIndex < 0) return false;
  const currentWeekMinute = (currentIndex * 1440) + localMinutes;

  for (const rawPeriod of Array.isArray(periods) ? periods : []) {
    const openDay = normalizeText(rawPeriod?.openDay || rawPeriod?.open_day).toUpperCase();
    const closeDay = normalizeText(rawPeriod?.closeDay || rawPeriod?.close_day || openDay).toUpperCase();
    const openIndex = BUSINESS_HOURS_DAYS.indexOf(openDay);
    const closeIndex = BUSINESS_HOURS_DAYS.indexOf(closeDay);
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

export function isBusinessOpenAt(config, timestamp) {
  const openStatus = normalizeText(config?.openStatus || config?.open_status || 'OPEN').toUpperCase();
  if (openStatus === 'CLOSED_PERMANENTLY' || openStatus === 'CLOSED_TEMPORARILY') return false;
  const timezone = normalizeText(config?.timezone) || 'America/Los_Angeles';
  const local = getLocalDateParts(timestamp, timezone);
  if (!local) return false;
  const regularHours = Array.isArray(config?.regularHours || config?.regular_hours)
    ? (config?.regularHours || config?.regular_hours)
    : weeklyHoursToRegularPeriods(config?.weeklyHours || config?.weekly_hours || []);
  return isWithinRegularPeriods(regularHours, local.day, local.minutes);
}

