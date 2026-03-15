function normalizeText(value) {
  return String(value || "").trim();
}

function uniqueValues(values) {
  const seen = new Set();
  const output = [];
  for (const value of values || []) {
    const text = normalizeText(value);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(text);
  }
  return output;
}

function cleanLine(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeHtmlEntities(text) {
  return String(text || "")
    .replace(/&#039;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");
}

function stripHtmlToText(html) {
  const source = String(html || "");
  const body = source.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1] || source;
  return decodeHtmlEntities(
    body
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<(br|\/p|\/div|\/li|\/section|\/article|\/main|\/tr|\/td|\/h[1-6])\b[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  )
    .split(/\n+/)
    .map(cleanLine)
    .filter(Boolean)
    .join("\n");
}

function flattenJsonToText(value, prefix = "") {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => flattenJsonToText(item, prefix ? `${prefix}[${index}]` : `[${index}]`));
  }
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([key, item]) => flattenJsonToText(item, prefix ? `${prefix}.${key}` : key));
  }
  const text = normalizeText(value);
  if (!text) return [];
  return [prefix ? `${prefix}: ${text}` : text];
}

function decodePdfLiteral(value) {
  return String(value || "")
    .replace(/\\([\\()])/g, "$1")
    .replace(/\\n/g, " ")
    .replace(/\\r/g, " ")
    .replace(/\\t/g, " ")
    .replace(/\\\d{3}/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function decodePdfHex(value) {
  const normalized = String(value || "").replace(/[^0-9a-f]/gi, "");
  let output = "";
  for (let index = 0; index < normalized.length; index += 2) {
    const pair = normalized.slice(index, index + 2);
    if (pair.length < 2) break;
    output += String.fromCharCode(parseInt(pair, 16));
  }
  return cleanLine(output);
}

function extractPdfText(buffer) {
  const source = buffer.toString("latin1");
  const fragments = [];

  for (const match of source.matchAll(/\((?:\\.|[^\\)])+\)\s*Tj/g)) {
    const literal = match[0].match(/\(([\s\S]*)\)\s*Tj$/)?.[1];
    if (literal) fragments.push(decodePdfLiteral(literal));
  }

  for (const match of source.matchAll(/\[(.*?)\]\s*TJ/gs)) {
    const block = match[1] || "";
    for (const literal of block.matchAll(/\((?:\\.|[^\\)])+\)/g)) {
      fragments.push(decodePdfLiteral(literal[0].slice(1, -1)));
    }
    for (const hex of block.matchAll(/<([0-9a-fA-F\s]+)>/g)) {
      fragments.push(decodePdfHex(hex[1]));
    }
  }

  if (!fragments.length) {
    for (const literal of source.matchAll(/\((?:\\.|[^\\)]){8,}\)/g)) {
      fragments.push(decodePdfLiteral(literal[0].slice(1, -1)));
    }
  }

  return uniqueValues(fragments)
    .filter((line) => line.split(/\s+/).length >= 2)
    .join("\n");
}

function inferMimeType(explicitMimeType, filename = "", locator = "") {
  const normalizedExplicit = normalizeText(explicitMimeType).toLowerCase();
  if (normalizedExplicit) return normalizedExplicit;
  const lowerName = `${filename} ${locator}`.toLowerCase();
  if (lowerName.endsWith(".pdf")) return "application/pdf";
  if (lowerName.endsWith(".html") || lowerName.endsWith(".htm")) return "text/html";
  if (lowerName.endsWith(".md")) return "text/markdown";
  if (lowerName.endsWith(".json")) return "application/json";
  if (lowerName.endsWith(".csv")) return "text/csv";
  if (lowerName.endsWith(".txt")) return "text/plain";
  return "text/plain";
}

export function extractTextFromDocumentBuffer({ buffer, mimeType = "", filename = "", locator = "" }) {
  const resolvedMimeType = inferMimeType(mimeType, filename, locator);
  const lowerMimeType = resolvedMimeType.toLowerCase();
  let bodyText = "";
  let parseMethod = "unsupported";
  let sourceKind = "text";

  if (lowerMimeType.includes("pdf")) {
    bodyText = extractPdfText(buffer);
    parseMethod = "pdf_literal_text";
    sourceKind = "pdf";
  } else if (lowerMimeType.includes("html")) {
    bodyText = stripHtmlToText(buffer.toString("utf8"));
    parseMethod = "html_strip";
    sourceKind = "html";
  } else if (lowerMimeType.includes("json")) {
    try {
      bodyText = flattenJsonToText(JSON.parse(buffer.toString("utf8"))).join("\n");
      parseMethod = "json_flatten";
    } catch {
      bodyText = buffer.toString("utf8");
      parseMethod = "json_fallback_plain";
    }
    sourceKind = "text";
  } else {
    bodyText = buffer.toString("utf8");
    parseMethod = lowerMimeType.includes("csv") ? "csv_plain" : "plain_text";
    sourceKind = "text";
  }

  return {
    bodyText: uniqueValues(
      String(bodyText || "")
        .split(/\n+/)
        .map(cleanLine)
        .filter(Boolean)
    ).join("\n"),
    mimeType: resolvedMimeType,
    parseMethod,
    sourceKind
  };
}
