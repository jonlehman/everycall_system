function normalizeText(value: unknown) {
  return String(value || "").trim();
}

function asRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function uniqueValues(values: Iterable<unknown>) {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const text = normalizeText(value);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(text);
  }
  return output;
}

function asStringArray(value: unknown) {
  return Array.isArray(value) ? value.map((item) => normalizeText(item)).filter(Boolean) : [];
}

function maxScore(values: string[], scores: Record<string, number>) {
  let best = 0;
  for (const value of values) {
    const normalized = normalizeText(value).toLowerCase();
    best = Math.max(best, scores[normalized] || 0);
  }
  return best;
}

const SOURCE_CHANNEL_SCORES: Record<string, number> = {
  owner_interview: 0.1,
  uploaded_document: 0.06,
  website_file: 0.03,
  website_page: 0
};

const SOURCE_AUTHORITY_SCORES: Record<string, number> = {
  owner_interview_confirmed: 0.12,
  owner_interview_unconfirmed: 0.04,
  uploaded_first_party_policy: 0.1,
  uploaded_first_party_operational: 0.08,
  uploaded_first_party_reference: 0.05,
  uploaded_first_party_marketing: 0.01,
  uploaded_unclassified_pending_review: 0.02,
  website_public_downloadable: 0.02,
  website_public_page: 0
};

const CONTENT_CLASS_SCORES: Record<string, number> = {
  policy_boundary: 0.03,
  operational_core: 0.02,
  descriptive: 0,
  restricted_process: -0.01,
  educational: -0.02,
  marketing: -0.04
};

export function sourcePrecedenceScoreFromMetadata(metadataInput: unknown) {
  const metadata = asRecord(metadataInput);
  const sourceChannels = uniqueValues([
    normalizeText(metadata.source_channel),
    ...asStringArray(metadata.source_channels)
  ]);
  const sourceAuthorities = uniqueValues([
    normalizeText(metadata.source_authority),
    ...asStringArray(metadata.source_authorities)
  ]);
  const contentClasses = uniqueValues([
    normalizeText(metadata.content_class),
    ...asStringArray(metadata.content_classes)
  ]);

  const score = maxScore(sourceChannels, SOURCE_CHANNEL_SCORES)
    + maxScore(sourceAuthorities, SOURCE_AUTHORITY_SCORES)
    + maxScore(contentClasses, CONTENT_CLASS_SCORES);

  return Number(score.toFixed(4));
}
