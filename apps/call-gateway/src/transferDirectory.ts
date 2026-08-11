export type TransferDirectoryTarget = {
  name: string;
  transfer_extension?: string | null;
};

export function normalizeTransferLookupText(value: unknown) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function classifyTransferConfirmation(value: unknown) {
  const raw = String(value || "").trim();
  const normalized = normalizeTransferLookupText(value);
  if (!normalized) return "neutral" as const;
  if (/\b(no|nope|nah|not now|dont|don t|do not|cancel|stop|wait|hold on|never mind)\b/.test(normalized)) {
    return "rejected" as const;
  }
  if (/\b(but|first|before|after|later|question|tell me|explain)\b/.test(normalized)) {
    return "neutral" as const;
  }
  if (
    raw.includes("?")
    || /\b(?:is this|are you|can you|could you|would you|do you|does it|what|why|how|who|when|where)\b/.test(normalized)
  ) {
    return "neutral" as const;
  }
  if (
    /\b(?:go ahead|do it|connect me|transfer me)\b/.test(normalized)
    || /^(?:that works|sounds good)$/.test(normalized)
  ) {
    return "confirmed" as const;
  }
  const wordCount = normalized.split(" ").filter(Boolean).length;
  if (/^(?:yes|yeah|yep|sure|ok|okay|absolutely|please)\b/.test(normalized) && wordCount <= 10) {
    return "confirmed" as const;
  }
  return "neutral" as const;
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

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasContextualNameMatch(targetName: string, normalizedQuery: string) {
  const normalizedName = normalizeTransferLookupText(targetName);
  if (!normalizedName) return false;

  const queryWithBoundaries = ` ${normalizedQuery} `;
  const nameWithBoundaries = ` ${normalizedName} `;
  if (normalizedName.includes(" ") && queryWithBoundaries.includes(nameWithBoundaries)) {
    return true;
  }

  return normalizedName.split(" ").filter(Boolean).some((token) => {
    const escapedToken = escapeRegExp(token);
    return new RegExp(
      `\\b(?:to|with|for|reach|ask for|is) ${escapedToken}(?:\\b|$)|\\b${escapedToken} (?:please|available)\\b`
    ).test(normalizedQuery);
  });
}

export function isTransferDirectoryQuery(value: unknown) {
  const normalized = normalizeTransferLookupText(value);
  if (!normalized) return false;

  return (
    (/\bwho\b/.test(normalized) && /\b(transfer|connect|available|speak|talk|reach)\b/.test(normalized))
    || /\b(transfer|connection)\b.*\b(options|directory|destinations|targets|people|extensions)\b/.test(normalized)
    || /\b(options|directory|destinations|targets|people|extensions)\b.*\b(transfer|connect)\b/.test(normalized)
    || /\b(people|anyone|anybody|someone)\b.*\bavailable\b/.test(normalized)
    || /^(?:list|show|tell me).+\b(?:people|names|extensions|directory)\b/.test(normalized)
    || /^(?:anyone|anybody|someone|operator|receptionist)$/.test(normalized)
  );
}

export function rankTransferMatches<T extends TransferDirectoryTarget>(targets: T[], query: string): T[] {
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

  const fuzzyTokenMatches = targets.filter((target) => hasFuzzyTransferTokenMatch(target.name, normalizedQuery));
  if (fuzzyTokenMatches.length) {
    return fuzzyTokenMatches;
  }

  if (normalizedQuery.length >= 3) {
    const includesMatches = targets.filter((target) => normalizeTransferLookupText(target.name).includes(normalizedQuery));
    if (includesMatches.length) {
      return includesMatches;
    }
  }

  const contextualNameMatches = targets.filter((target) => hasContextualNameMatch(target.name, normalizedQuery));
  if (contextualNameMatches.length) {
    return contextualNameMatches;
  }

  return isTransferDirectoryQuery(normalizedQuery) ? targets : [];
}
