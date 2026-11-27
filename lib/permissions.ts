export const PERMISSIONS = [
  { key: "VIEW_REPORTS", label: "View sales, staff and shift reports" },
  { key: "VIEW_ALL_ORDERS", label: "View all cashier orders and order details" },
  { key: "MANAGE_INVENTORY", label: "Manage ingredient inventory and stock adjustments" },
  { key: "MANAGE_PURCHASING", label: "Manage suppliers, purchase orders and invoices" },
  { key: "PROCESS_REFUNDS", label: "Process refunds and voids" },
  { key: "MANAGE_TABLES", label: "Manage dining tables" },
  { key: "MANAGE_CATALOG", label: "Manage products and categories" },
] as const;
export type PermissionKey = (typeof PERMISSIONS)[number]["key"];
export type PermissionOverrides = Partial<Record<PermissionKey, boolean>>;
export type Role = "OWNER" | "MANAGER" | "CASHIER" | "KITCHEN";
const DEFAULTS: Record<Role, Record<PermissionKey, boolean>> = {
  OWNER: { VIEW_REPORTS: true, VIEW_ALL_ORDERS: true, MANAGE_INVENTORY: true, MANAGE_PURCHASING: true, PROCESS_REFUNDS: true, MANAGE_TABLES: true, MANAGE_CATALOG: true },
  MANAGER: { VIEW_REPORTS: true, VIEW_ALL_ORDERS: true, MANAGE_INVENTORY: true, MANAGE_PURCHASING: true, PROCESS_REFUNDS: true, MANAGE_TABLES: true, MANAGE_CATALOG: true },
  CASHIER: { VIEW_REPORTS: false, VIEW_ALL_ORDERS: false, MANAGE_INVENTORY: false, MANAGE_PURCHASING: false, PROCESS_REFUNDS: false, MANAGE_TABLES: false, MANAGE_CATALOG: false },
  KITCHEN: { VIEW_REPORTS: false, VIEW_ALL_ORDERS: false, MANAGE_INVENTORY: false, MANAGE_PURCHASING: false, PROCESS_REFUNDS: false, MANAGE_TABLES: false, MANAGE_CATALOG: false },
};
export function normalizePermissionOverrides(value: unknown): PermissionOverrides {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const input = value as Record<string, unknown>;
  const result: PermissionOverrides = {};
  for (const { key } of PERMISSIONS) if (typeof input[key] === "boolean") result[key] = input[key] as boolean;
  return result;
}
export function effectivePermissions(role: Role, overrides: unknown): Record<PermissionKey, boolean> {
  const normalized = normalizePermissionOverrides(overrides);
  return Object.fromEntries(PERMISSIONS.map(({ key }) => [key, role === "OWNER" ? true : normalized[key] ?? DEFAULTS[role][key]])) as Record<PermissionKey, boolean>;
}
export function hasPermission(role: Role, overrides: unknown, permission: PermissionKey): boolean {
  return effectivePermissions(role, overrides)[permission];
}
