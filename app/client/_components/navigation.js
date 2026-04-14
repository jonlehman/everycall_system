export const clientPrimaryNavItems = [
  {
    href: '/client/get-started',
    label: 'Get Started',
    icon: 'dashboard',
    matchPrefixes: ['/client/get-started', '/client/overview'],
    hideWhenBillingActive: true
  },
  {
    href: '/client/calls',
    label: 'Calls',
    icon: 'calls',
    matchPrefixes: ['/client/calls']
  },
  {
    href: '/client/dashboard',
    label: 'Reports',
    icon: 'reports',
    matchPrefixes: ['/client/dashboard']
  },
  {
    href: '/client/receptionist/basics',
    label: 'Receptionist',
    icon: 'receptionist',
    matchPrefixes: ['/client/setup', '/client/receptionist', '/client/knowledge', '/client/routing']
  },
  {
    href: '/client/account/general',
    label: 'Account Settings',
    icon: 'account',
    matchPrefixes: ['/client/account/general', '/client/account/billing', '/client/settings', '/client/billing', '/client/team', '/client/account/users']
  }
];

export const receptionistNavItems = [
  { href: '/client/receptionist/basics', label: 'Basics' },
  { href: '/client/receptionist/knowledge', label: 'Train your receptionist' }
];

export const accountNavItems = [
  { href: '/client/account/general', label: 'General' },
  { href: '/client/account/billing', label: 'Billing' },
  { href: '/client/team', label: 'Send Leads To', matchPrefixes: ['/client/team', '/client/team/integrations'] },
  { href: '/client/account/users', label: 'System Users' }
];

export const sendLeadsNavItems = [
  { href: '/client/team', label: 'People' },
  { href: '/client/team/integrations', label: 'Integrations' }
];

export function pathMatches(pathname, item) {
  const current = String(pathname || '').replace(/\/+$/, '') || '/';
  const children = Array.isArray(item?.children) ? item.children : [];
  const prefixes = Array.isArray(item?.matchPrefixes) && item.matchPrefixes.length
    ? item.matchPrefixes
    : [item?.href || ''];
  const directMatch = prefixes.some((prefix) => {
    const normalized = String(prefix || '').replace(/\/+$/, '') || '/';
    return current === normalized || current.startsWith(`${normalized}/`);
  });
  if (directMatch) return true;
  return children.some((child) => pathMatches(current, child));
}
