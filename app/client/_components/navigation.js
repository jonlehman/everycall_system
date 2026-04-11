export const clientPrimaryNavItems = [
  {
    href: '/client/get-started',
    label: 'Get Started',
    icon: 'dashboard',
    matchPrefixes: ['/client/get-started', '/client/overview']
  },
  {
    href: '/client/calls',
    label: 'Calls',
    icon: 'calls',
    matchPrefixes: ['/client/calls']
  },
  {
    href: '/client/receptionist/basics',
    label: 'Receiptionist Setup',
    icon: 'receptionist',
    matchPrefixes: ['/client/receptionist', '/client/setup', '/client/knowledge', '/client/routing']
  },
  {
    href: '/client/team',
    label: 'Send Leads To',
    icon: 'team',
    matchPrefixes: ['/client/team', '/client/team/integrations']
  },
  {
    href: '/client/account/general',
    label: 'Account',
    icon: 'account',
    matchPrefixes: ['/client/account', '/client/settings', '/client/billing']
  },
  {
    href: '/client/dashboard',
    label: 'Reports',
    icon: 'reports',
    matchPrefixes: ['/client/dashboard']
  }
];

export const receptionistNavItems = [
  { href: '/client/receptionist/basics', label: 'Basics' },
  { href: '/client/receptionist/knowledge', label: 'Knowledge Base' }
];

export const accountNavItems = [
  { href: '/client/account/general', label: 'General' },
  { href: '/client/account/users', label: 'Users' },
  { href: '/client/account/billing', label: 'Billing' },
  { href: '/client/account/support', label: 'Support' }
];

export const sendLeadsNavItems = [
  { href: '/client/team', label: 'People' },
  { href: '/client/team/integrations', label: 'Integrations' }
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
