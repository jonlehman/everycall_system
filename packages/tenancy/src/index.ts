import fs from "node:fs";
import path from "node:path";

export type TenantRouting = {
  tenantId: string;
  numberId: string;
  phoneNumber: string;
  active: boolean;
};

type TenantRoutingFileRecord = TenantRouting;

let cache: TenantRouting[] = [];
let cacheMtimeMs = -1;

function normalizePhone(value: string): string {
  const digits = value.replace(/[^\d+]/g, "");
  return digits.startsWith("+") ? digits : `+${digits}`;
}

function loadTenantRoutings(filePath: string): TenantRouting[] {
  const absolutePath = path.resolve(filePath);
  const stat = fs.statSync(absolutePath);
  if (stat.mtimeMs === cacheMtimeMs) {
    return cache;
  }

  const raw = fs.readFileSync(absolutePath, "utf8");
  const parsed = JSON.parse(raw) as TenantRoutingFileRecord[];

  cache = parsed.map((item) => ({
    tenantId: item.tenantId,
    numberId: item.numberId,
    phoneNumber: normalizePhone(item.phoneNumber),
    active: Boolean(item.active)
  }));
  cacheMtimeMs = stat.mtimeMs;
  return cache;
}

export function resolveTenantByToNumber(toNumber: string, filePath: string): TenantRouting | null {
  const normalized = normalizePhone(toNumber);
  const routings = loadTenantRoutings(filePath);
  return routings.find((entry) => entry.phoneNumber === normalized) ?? null;
}
