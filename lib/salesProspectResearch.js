// List research is operator context, never verified receptionist knowledge.
export const SALES_RESEARCH_FIELDS = Object.freeze([
  { key: 'city', column: 'city', label: 'City', maxLength: 120, aliases: ['city'] },
  { key: 'region', column: 'region', label: 'Region', maxLength: 160, aliases: ['region'] },
  { key: 'afterHoursClass', column: 'after_hours_class', label: 'After-hours classification', maxLength: 240, aliases: ['afterhoursclass', 'after_hours_class', 'after hours classification'] },
  { key: 'postedHours', column: 'posted_hours', label: 'Posted hours', maxLength: 2000, aliases: ['postedhours', 'posted_hours', 'posted hours'] },
  { key: 'callOpenerHook', column: 'call_opener_hook', label: 'Call opener hook', maxLength: 4000, aliases: ['callopenerhook', 'call_opener_hook', 'call opener hook'] },
  { key: 'researchNotes', column: 'research_notes', label: 'Research notes', maxLength: 8000, aliases: ['notes', 'researchnotes', 'research_notes', 'research notes'] }
]);
