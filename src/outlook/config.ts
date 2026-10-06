import type { CategoryId } from '../core/model';
import type { StorageLike } from '../core/persist';

// The Outlook connection: the app registration's two ids, where meetings go,
// and the signed in account. It has its own storage key, apart from the save
// file, so Export never writes out a sign-in and an import never brings one.

export const OUTLOOK_KEY = 'timetower.outlook';

export interface OutlookAccount {
  name: string;
  username: string;
}

export interface OutlookConfig {
  /** The Application (client) ID from the app registration in Microsoft Entra ID. */
  clientId: string;
  /** The Directory (tenant) ID, or the organization's domain. */
  tenantId: string;
  /** The category new meetings go in; null picks one by name. */
  categoryId: CategoryId | null;
  /** Who signed in, kept after sign-in expires so reconnecting can suggest them. */
  account: OutlookAccount | null;
  /** Lasts 24 hours from sign-in for a browser app, then sign-in is needed again. */
  refreshToken: string | null;
}

export const ID_MESSAGES = {
  clientId: 'The client ID is the Application (client) ID on the app registration Overview page, so paste it again.',
  tenantId: 'The tenant ID is the Directory (tenant) ID on the same page, or your organization domain, so paste it again.',
} as const;

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DOMAIN = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i;

/** An error message for ids that cannot be right, or null. */
export function checkIds(clientId: string, tenantId: string): string | null {
  if (!GUID.test(clientId.trim())) return ID_MESSAGES.clientId;
  const tenant = tenantId.trim();
  if (!GUID.test(tenant) && !DOMAIN.test(tenant)) return ID_MESSAGES.tenantId;
  return null;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * The saved connection, or an empty one. The ids can also come from
 * VITE_OUTLOOK_CLIENT_ID and VITE_OUTLOOK_TENANT_ID in a local .env file,
 * which fill in what the browser has not saved.
 */
export function readConfig(storage: StorageLike | null, env: Record<string, unknown> = {}): OutlookConfig {
  const empty: OutlookConfig = {
    clientId: text(env.VITE_OUTLOOK_CLIENT_ID).trim(),
    tenantId: text(env.VITE_OUTLOOK_TENANT_ID).trim(),
    categoryId: null,
    account: null,
    refreshToken: null,
  };
  let raw: unknown;
  try {
    const stored = storage?.getItem(OUTLOOK_KEY);
    raw = stored ? JSON.parse(stored) : null;
  } catch {
    raw = null;
  }
  if (typeof raw !== 'object' || raw === null) return empty;
  const record = raw as Record<string, unknown>;
  const account = record.account as Record<string, unknown> | null | undefined;
  return {
    clientId: text(record.clientId) || empty.clientId,
    tenantId: text(record.tenantId) || empty.tenantId,
    categoryId: text(record.categoryId) || null,
    account:
      account && typeof account === 'object' && typeof account.username === 'string'
        ? { name: text(account.name), username: account.username }
        : null,
    refreshToken: text(record.refreshToken) || null,
  };
}

/** Saves the connection. Returns false when the browser refused. */
export function writeConfig(storage: StorageLike | null, config: OutlookConfig): boolean {
  if (!storage) return false;
  try {
    storage.setItem(OUTLOOK_KEY, JSON.stringify(config));
    return true;
  } catch {
    return false;
  }
}
