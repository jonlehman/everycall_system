export type TransferLookupMatch = {
  target_id: string;
  name: string;
  extension: string | null;
};

export type TransferTargetRow = {
  id: number;
  name: string;
  transfer_extension: string | null;
  forward_to_number: string;
};

type TransferQuery = { query: (sql: string, values: string[]) => Promise<{ rows: any[] }> };
const normalizeOptionalText = (value: unknown) => String(value || "").trim() || null;
const buildTransferTargetId = (id: number) => `tenant_user_${id}`;

export function normalizeTransferLookupText(value: unknown) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeDigitsOnly(value: unknown) {
  return String(value || "").replace(/[^\d]/g, "");
}

function levenshteinDistance(leftInput: string, rightInput: string) {
  const left = String(leftInput || "");
  const right = String(rightInput || "");
  if (left === right) return 0;
  if (!left.length) return right.length;
  if (!right.length) return left.length;

  const previous: number[] = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row += 1) {
    let diagonal = previous[0] ?? 0;
    previous[0] = row;
    for (let column = 1; column <= right.length; column += 1) {
      const temp = previous[column] ?? column;
      const current = previous[column] ?? column;
      const leftCost = previous[column - 1] ?? (column - 1);
      if (left[row - 1] === right[column - 1]) {
        previous[column] = diagonal;
      } else {
        previous[column] = Math.min(current + 1, leftCost + 1, diagonal + 1);
      }
      diagonal = temp;
    }
  }
  return previous[right.length] ?? right.length;
}

function isCloseTransferNameToken(queryToken: string, targetToken: string) {
  if (!queryToken || !targetToken) return false;
  if (queryToken === targetToken) return true;
  if (Math.abs(queryToken.length - targetToken.length) > 1) return false;
  if (queryToken.charAt(0) !== targetToken.charAt(0)) return false;
  return levenshteinDistance(queryToken, targetToken) <= 1;
}

function hasFuzzyTransferTokenMatch(targetName: string, normalizedQuery: string) {
  const queryTokens = normalizedQuery.split(" ").filter(Boolean);
  const targetTokens = normalizeTransferLookupText(targetName).split(" ").filter(Boolean);
  if (!queryTokens.length || !targetTokens.length) return false;
  return queryTokens.every((queryToken) =>
    targetTokens.some((targetToken) => isCloseTransferNameToken(queryToken, targetToken))
  );
}

// Conservative pronunciation fallback for a complete name: retain the full
// consonant sequence (in particular m versus n), rather than a short Soundex
// bucket. Vowel spelling, medial h/y and doubled consonants commonly vary in
// speech transcripts. This is a candidate match only, never transfer consent.
function transferNameSound(token: string) {
  return token.charAt(0) + token.slice(1).replace(/[aeiouhy]/g, "").replace(/(.)\1+/g, "$1");
}

function hasPhoneticTransferNameMatch(targetName: string, normalizedQuery: string) {
  const queryTokens = normalizedQuery.split(" ");
  const targetTokens = normalizeTransferLookupText(targetName).split(" ");
  if (queryTokens.length < 2 || queryTokens.length !== targetTokens.length) return false;
  return queryTokens.every((queryToken, index) => {
    const targetToken = targetTokens[index]!;
    if (queryToken === targetToken) return true;
    return /^[a-z]{3,}$/.test(queryToken) && /^[a-z]{3,}$/.test(targetToken)
      && Math.abs(queryToken.length - targetToken.length) <= 2
      && levenshteinDistance(queryToken, targetToken) <= 2
      && transferNameSound(queryToken).length >= 2
      && transferNameSound(queryToken) === transferNameSound(targetToken);
  });
}

function serializeTransferMatch(row: TransferTargetRow): TransferLookupMatch {
  return {
    target_id: buildTransferTargetId(row.id),
    name: String(row.name || "").trim(),
    extension: normalizeOptionalText(row.transfer_extension)
  };
}
export async function loadTransferTargetsForTenant(pool: TransferQuery | null, tenantKey: string): Promise<TransferTargetRow[]> {
  if (!pool) return [];
  const result = await pool.query(
    `SELECT id, name, transfer_extension, forward_to_number
     FROM tenant_users
     WHERE tenant_key = $1
       AND status = 'active'
       AND transfer_enabled = TRUE
       AND forward_to_number IS NOT NULL
       AND TRIM(forward_to_number) <> ''
     ORDER BY name ASC, id ASC`,
    [tenantKey]
  );
  return (result.rows || []).map((row: any) => ({
    id: Number(row.id),
    name: String(row.name || "").trim(),
    transfer_extension: normalizeOptionalText(row.transfer_extension),
    forward_to_number: String(row.forward_to_number || "").trim()
  }));
}

export function rankTransferMatches(targets: TransferTargetRow[], query: string) {
  const normalizedQuery = normalizeTransferLookupText(query);
  if (!normalizedQuery) return [];

  const queryDigits = normalizeDigitsOnly(query);
  if (queryDigits) {
    const extensionMatches = targets.filter((target) => normalizeDigitsOnly(target.transfer_extension) === queryDigits);
    if (extensionMatches.length) {
      return extensionMatches;
    }
  }

  const exactFullNameMatches = targets.filter((target) => normalizeTransferLookupText(target.name) === normalizedQuery);
  if (exactFullNameMatches.length) {
    return exactFullNameMatches;
  }

  const startsWithMatches = targets.filter((target) => normalizeTransferLookupText(target.name).startsWith(normalizedQuery));
  if (startsWithMatches.length) {
    return startsWithMatches;
  }

  const exactTokenMatches = targets.filter((target) => normalizeTransferLookupText(target.name).split(" ").includes(normalizedQuery));
  if (exactTokenMatches.length) {
    return exactTokenMatches;
  }

  // Keep every plausible fuzzy/phonetic candidate so collisions require the
  // caller to clarify; never pick the first candidate or score away ambiguity.
  const fuzzyTokenMatches = targets.filter((target) => hasFuzzyTransferTokenMatch(target.name, normalizedQuery)
    || hasPhoneticTransferNameMatch(target.name, normalizedQuery));
  if (fuzzyTokenMatches.length) {
    return fuzzyTokenMatches;
  }

  if (normalizedQuery.length >= 3) {
    const includesMatches = targets.filter((target) => normalizeTransferLookupText(target.name).includes(normalizedQuery));
    if (includesMatches.length) {
      return includesMatches;
    }
  }

  return [];
}

export function lookupTransferTargets(targets: TransferTargetRow[], query: string) {
  const trimmedQuery = String(query || "").trim();
  if (!targets.length) {
    return {
      status: "unavailable",
      query: trimmedQuery,
      matches: [] as TransferLookupMatch[]
    };
  }
  const matches = rankTransferMatches(targets, trimmedQuery).map(serializeTransferMatch);
  if (!matches.length) {
    return {
      status: "not_found",
      query: trimmedQuery,
      matches
    };
  }
  return {
    status: matches.length === 1 ? "match" : "ambiguous",
    query: trimmedQuery,
    matches,
    ...(matches.length === 1 ? {
      target: matches[0],
      requires_confirmation: true,
      next_step: "ask_for_confirmation_before_transfer"
    } : {})
  };
}
