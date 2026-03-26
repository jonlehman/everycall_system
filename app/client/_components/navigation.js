export const clientPrimaryNavItems = [
  {
    href: '/client/calls',
    label: 'Calls',
    icon: 'calls',
    matchPrefixes: ['/client/calls', '/client/dashboard', '/client/overview']
  },
  {
    href: '/client/receptionist/basics',
    label: 'Sales Receptionist',
    icon: 'receptionist',
    matchPrefixes: ['/client/receptionist', '/client/setup', '/client/knowledge', '/client/routing']
  },
  {
    href: '/client/team',
    label: 'Team',
    icon: 'team',
    matchPrefixes: ['/client/team']
  },
  {
    href: '/client/account/general',
    label: 'Account',
    icon: 'account',
    matchPrefixes: ['/client/account', '/client/settings', '/client/billing']
  }
];

export const receptionistNavItems = [
  { href: '/client/receptionist/basics', label: 'Basics' },
  { href: '/client/receptionist/knowledge', label: 'Knowledge' },
  { href: '/client/receptionist/go-live', label: 'Launch Readiness' }
];

export const accountNavItems = [
  { href: '/client/account/general', label: 'General' },
  { href: '/client/account/notifications', label: 'Notifications' },
  { href: '/client/account/billing', label: 'Billing' }
];

export function pathMatches(pathname, item) {
  const current = String(pathname || '').replace(/\/+$/, '') || '/';
  const prefixes = Array.isArray(item?.matchPrefixes) && item.matchPrefixes.length
    ? item.matchPrefixes
    : [item?.href || ''];
  return prefixes.some((prefix) => {
    const normalized = String(prefix || '').replace(/\/+$/, '') || '/';
    return current === normalized || current.startsWith(`${normalized}/`);
  });
}
