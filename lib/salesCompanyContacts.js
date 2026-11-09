// Sales contact facts are rep context, not consent or receptionist knowledge.
export const SALES_CONTACT_TITLES = Object.freeze(['Owner', 'Co-owner', 'President', 'CEO', 'General Manager', 'Office Manager', 'Operations Manager', 'Service Manager', 'Receptionist', 'Administrator', 'Other']);
export const SALES_PHONE_TYPES = Object.freeze(['cell', 'shop', 'other']);
export const SALES_COMPANY_EDIT_FIELDS = Object.freeze(['businessName', 'websiteUrl', 'businessCategory', 'competitorName', 'externalRef', 'city', 'region', 'metro', 'afterHoursClass', 'postedHours', 'callOpenerHook', 'researchNotes', 'pitchFlags', 'timezone', 'leadDeliveryEmail', 'permissionGranted', 'emailPermission']);
export function salesContactDisplayName(contact) {
  return [contact?.firstName, contact?.lastName].filter(Boolean).join(' ').trim() || contact?.legacyName || 'Unnamed contact';
}
