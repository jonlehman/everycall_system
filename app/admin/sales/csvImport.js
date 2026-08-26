const FIELD_DEFINITIONS = [
  {
    key: 'businessName',
    label: 'Business name',
    required: true,
    aliases: ['business', 'business name', 'business_name', 'company', 'company name', 'shop', 'shop name']
  },
  {
    key: 'contactName',
    label: 'Contact name',
    aliases: ['contact', 'contact name', 'contact_name', 'owner', 'owner name', 'first name', 'first_name']
  },
  {
    key: 'phone',
    label: 'Phone',
    required: true,
    aliases: ['phone', 'phone number', 'phone_number', 'telephone', 'mobile', 'business phone']
  },
  {
    key: 'website',
    label: 'Website',
    aliases: ['website', 'website url', 'website_url', 'url', 'domain']
  },
  {
    key: 'email',
    label: 'Contact email',
    aliases: ['email', 'contact email', 'contact_email', 'owner email']
  },
  {
    key: 'leadDeliveryEmail',
    label: 'Lead-delivery email',
    aliases: ['lead delivery email', 'lead_delivery_email', 'delivery email', 'notification email']
  },
  {
    key: 'businessCategory',
    label: 'Business category',
    aliases: ['business category', 'business_category', 'category', 'industry', 'vertical']
  },
  {
    key: 'timezone',
    label: 'Timezone',
    aliases: ['timezone', 'time zone', 'time_zone', 'tz']
  },
  {
    key: 'permission',
    label: 'Permission',
    required: true,
    aliases: ['permission', 'permission granted', 'permission_granted', 'allowed', 'consent', 'can call']
  },
  {
    key: 'emailPermission',
    label: 'Email permission',
    aliases: ['email permission', 'email_permission', 'permission to email', 'permission_to_email']
  },
  {
    key: 'suppressed',
    label: 'Suppressed / do not call',
    aliases: ['suppressed', 'suppression', 'do not call', 'do_not_call', 'dnc', 'opt out', 'opt_out']
  }
];

function normalizeHeader(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\uFEFF]/g, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ');
}

function normalizedCell(value) {
  return String(value ?? '').trim();
}

function parseYesNo(value, { blank = null } = {}) {
  const normalized = normalizeHeader(value);
  if (!normalized) return blank;
  if (['yes', 'y', 'true', '1', 'granted', 'allowed'].includes(normalized)) return true;
  if (['no', 'n', 'false', '0', 'denied', 'blocked'].includes(normalized)) return false;
  return null;
}

function detectDelimiter(input) {
  let commas = 0;
  let tabs = 0;
  let inQuotes = false;

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (character === '"') {
      if (inQuotes && input[index + 1] === '"') {
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (!inQuotes && (character === '\n' || character === '\r')) {
      break;
    } else if (!inQuotes && character === ',') {
      commas += 1;
    } else if (!inQuotes && character === '\t') {
      tabs += 1;
    }
  }

  return tabs > commas ? '\t' : ',';
}

function validPhone(value) {
  const raw = normalizedCell(value);
  const digits = raw.replace(/\D/g, '');
  if (raw.startsWith('+')) return digits.length >= 8 && digits.length <= 15;
  return digits.length === 10 || (digits.length === 11 && digits.startsWith('1'));
}

export function parseCsv(text) {
  const input = String(text ?? '');
  const delimiter = detectDelimiter(input);
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (inQuotes) {
      if (character === '"' && input[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        inQuotes = false;
      } else {
        field += character;
      }
      continue;
    }

    if (character === '"') {
      inQuotes = true;
    } else if (character === delimiter) {
      row.push(field);
      field = '';
    } else if (character === '\n') {
      row.push(field.replace(/\r$/, ''));
      if (row.some((value) => normalizedCell(value))) rows.push(row);
      row = [];
      field = '';
    } else {
      field += character;
    }
  }

  row.push(field.replace(/\r$/, ''));
  if (row.some((value) => normalizedCell(value))) rows.push(row);
  if (inQuotes) {
    throw new Error('The CSV has an unclosed quoted field.');
  }
  if (!rows.length) {
    throw new Error('The CSV is empty.');
  }

  const headers = rows[0].map((value, index) => normalizedCell(value) || `Column ${index + 1}`);
  const duplicateHeaders = headers.filter((header, index) => (
    headers.findIndex((candidate) => normalizeHeader(candidate) === normalizeHeader(header)) !== index
  ));
  if (duplicateHeaders.length) {
    throw new Error(`The CSV has duplicate column names: ${[...new Set(duplicateHeaders)].join(', ')}.`);
  }

  const dataRows = rows.slice(1).map((values, rowIndex) => {
    const record = {};
    headers.forEach((header, columnIndex) => {
      record[header] = normalizedCell(values[columnIndex]);
    });
    return {
      rowNumber: rowIndex + 2,
      record
    };
  });

  return { headers, rows: dataRows };
}

export function guessMappings(headers) {
  const used = new Set();
  return FIELD_DEFINITIONS.reduce((mappings, field) => {
    const match = headers.find((header) => {
      if (used.has(header)) return false;
      const normalized = normalizeHeader(header);
      return field.aliases.some((alias) => normalizeHeader(alias) === normalized);
    });
    if (match) used.add(match);
    mappings[field.key] = match || '';
    return mappings;
  }, {});
}

function normalizedMissingTimezonePolicy(value) {
  return normalizeHeader(value) === 'allow' ? 'allow' : 'block';
}

function validIanaTimezone(value) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

export function validateMappedRows(rows, mappings, {
  missingTimezonePolicy = 'block'
} = {}) {
  const timezonePolicy = normalizedMissingTimezonePolicy(missingTimezonePolicy);
  const requiredMappingErrors = FIELD_DEFINITIONS
    .filter((field) => (
      (field.required || (field.key === 'timezone' && timezonePolicy === 'block'))
      && !mappings[field.key]
    ))
    .map((field) => `${field.label} is not mapped.`);
  const validRecords = [];
  const errors = [];
  let permissionDenied = 0;
  let suppressed = 0;

  if (requiredMappingErrors.length) {
    return {
      validRecords,
      errors: requiredMappingErrors.map((message) => ({ rowNumber: null, message })),
      permissionDenied,
      suppressed,
      total: rows.length
    };
  }

  rows.forEach(({ rowNumber, record }) => {
    const valueFor = (key) => normalizedCell(record[mappings[key]]);
    const businessName = valueFor('businessName');
    const phone = valueFor('phone');
    const permissionSource = valueFor('permission');
    const permission = parseYesNo(permissionSource);
    const timezone = valueFor('timezone');
    const emailPermissionSource = mappings.emailPermission ? valueFor('emailPermission') : '';
    const emailPermission = parseYesNo(emailPermissionSource, { blank: permission });
    const suppressedSource = mappings.suppressed ? valueFor('suppressed') : '';
    const isSuppressed = parseYesNo(suppressedSource, { blank: false });
    const rowErrors = [];

    if (!businessName) rowErrors.push('business name is blank');
    if (!phone) rowErrors.push('phone is blank');
    if (phone && !validPhone(phone)) {
      rowErrors.push('phone must be a 10-digit U.S. number or an E.164 number beginning with +');
    }
    if (permission === null) rowErrors.push('permission must be yes or no');
    if (!timezone && timezonePolicy === 'block') {
      rowErrors.push('timezone is required by the calling policy');
    } else if (timezone && !validIanaTimezone(timezone)) {
      rowErrors.push('timezone must be a valid IANA timezone');
    }
    if (emailPermissionSource && emailPermission === null) {
      rowErrors.push('email permission must be yes or no');
    }
    if (suppressedSource && isSuppressed === null) rowErrors.push('suppressed must be yes or no');

    if (rowErrors.length) {
      errors.push({ rowNumber, message: rowErrors.join('; ') });
      return;
    }

    if (!permission) permissionDenied += 1;
    if (isSuppressed) suppressed += 1;

    validRecords.push({
      business_name: businessName,
      contact_name: valueFor('contactName'),
      phone,
      website: valueFor('website'),
      contact_email: valueFor('email'),
      lead_delivery_email: valueFor('leadDeliveryEmail'),
      business_category: valueFor('businessCategory'),
      timezone,
      permission,
      email_permission: emailPermission,
      suppressed: Boolean(isSuppressed),
      source_row_number: rowNumber
    });
  });

  return {
    validRecords,
    errors,
    permissionDenied,
    suppressed,
    total: rows.length
  };
}

export { FIELD_DEFINITIONS };
