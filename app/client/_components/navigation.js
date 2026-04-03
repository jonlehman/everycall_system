export const clientPrimaryNavItems = [
  {
    href: '/client/dashboard',
    label: 'Dashboard',
    icon: 'dashboard',
    matchPrefixes: ['/client/dashboard', '/client/overview']
  },
  {
    href: '/client/calls',
    label: 'Calls',
    icon: 'calls',
    matchPrefixes: ['/client/calls']
  },
  {
    href: '/client/receptionist/basics',
    label: 'Sales Receptionist',
    icon: 'receptionist',
    matchPrefixes: ['/client/receptionist', '/client/setup', '/client/knowledge', '/client/routing']
  },
  {
    href: '/client/team',
    label: 'Users',
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
  { href: '/client/receptionist/knowledge', label: 'Knowledge Base' }
];

export const accountNavItems = [
  { href: '/client/account/general', label: 'General' },
  { href: '/client/account/integrations', label: 'Integrations' },
  { href: '/client/account/billing', label: 'Billing' },
  { href: '/client/account/support', label: 'Support' }
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
