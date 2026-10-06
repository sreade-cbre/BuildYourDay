import type { OutlookAccount } from './config';

// Microsoft sign-in for a browser app: the OAuth 2.0 authorization code flow
// with PKCE, against the Microsoft identity platform directly, so three stays
// the only runtime dependency. The page goes to Microsoft and comes back with
// a code in the URL fragment, which is traded for tokens. Nothing here needs
// a client secret, which a browser app cannot keep.

export const LOGIN_HOST = 'https://login.microsoftonline.com';
/** Read only access to the calendar, plus a refresh token and the account name. */
export const SCOPES = 'openid profile offline_access https://graph.microsoft.com/Calendars.Read';

export type AuthProblem = 'expired' | 'setup' | 'consent' | 'canceled' | 'network' | 'other';

export class AuthError extends Error {
  constructor(
    message: string,
    readonly problem: AuthProblem,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

export const AUTH_MESSAGES = {
  expired: 'Outlook sign-in has expired, so reconnect to keep meetings up to date.',
  network:
    'Could not finish signing in with Microsoft. If this keeps happening, check that the redirect URI is the single-page application type.',
  consent: 'Your organization needs an admin to approve calendar access for this app, so ask IT to grant admin consent for Calendars.Read.',
  canceled: 'Sign-in was canceled, so Outlook is not connected.',
  webPlatform: 'The redirect URI is registered as a web app, so change its platform to single-page application in Microsoft Entra ID.',
  unknownApp: 'That client ID is not an app in this tenant, so check both ids on the app registration Overview page.',
  unknownTenant: 'That tenant ID was not found, so check the Directory (tenant) ID.',
  otherTenant: 'Your account is not in that tenant, so check the Directory (tenant) ID.',
  scope: 'Microsoft refused the calendar permission request, so check that the app registration has Calendars.Read.',
  redirect: (uri: string) =>
    `The app registration does not list ${uri} as a redirect URI, so add it as a single-page application redirect URI in Microsoft Entra ID.`,
} as const;

export interface Tokens {
  accessToken: string;
  /** Epoch milliseconds when the access token stops working. */
  expiresAt: number;
  refreshToken: string | null;
  account: OutlookAccount | null;
}

export interface AppIds {
  clientId: string;
  tenantId: string;
}

type Fetch = typeof fetch;

export function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** A random URL safe string, for the PKCE verifier and the state check. */
export function randomString(bytes = 32): string {
  const buffer = new Uint8Array(bytes);
  crypto.getRandomValues(buffer);
  return base64Url(buffer);
}

/** The S256 code challenge for a verifier (RFC 7636). */
export async function codeChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(digest));
}

export interface AuthorizeRequest extends AppIds {
  redirectUri: string;
  state: string;
  challenge: string;
  /** Suggests the account, so signing in again can skip the account picker. */
  loginHint?: string;
  /** Only come back with a code if no prompt is needed. */
  silent?: boolean;
}

/** Where to send the page to sign in. */
export function authorizeUrl(request: AuthorizeRequest): string {
  const params = new URLSearchParams({
    client_id: request.clientId,
    response_type: 'code',
    redirect_uri: request.redirectUri,
    response_mode: 'fragment',
    scope: SCOPES,
    state: request.state,
    code_challenge: request.challenge,
    code_challenge_method: 'S256',
  });
  if (request.loginHint) params.set('login_hint', request.loginHint);
  if (request.silent) params.set('prompt', 'none');
  return `${LOGIN_HOST}/${encodeURIComponent(request.tenantId.trim())}/oauth2/v2.0/authorize?${params}`;
}

/** Trades the code from the sign-in redirect for tokens. */
export function redeemCode(ids: AppIds, code: string, verifier: string, redirectUri: string, fetcher: Fetch = fetch): Promise<Tokens> {
  return requestTokens(
    ids,
    { client_id: ids.clientId, scope: SCOPES, code, redirect_uri: redirectUri, grant_type: 'authorization_code', code_verifier: verifier },
    redirectUri,
    fetcher,
  );
}

/** A new access token from the refresh token, which also comes back renewed. */
export function refreshTokens(ids: AppIds, refreshToken: string, redirectUri: string, fetcher: Fetch = fetch): Promise<Tokens> {
  return requestTokens(
    ids,
    { client_id: ids.clientId, scope: SCOPES, refresh_token: refreshToken, grant_type: 'refresh_token' },
    redirectUri,
    fetcher,
  );
}

async function requestTokens(ids: AppIds, body: Record<string, string>, redirectUri: string, fetcher: Fetch): Promise<Tokens> {
  let response: Response;
  try {
    response = await fetcher(`${LOGIN_HOST}/${encodeURIComponent(ids.tenantId.trim())}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body).toString(),
    });
  } catch {
    throw new AuthError(AUTH_MESSAGES.network, 'network');
  }
  let reply: Record<string, unknown> = {};
  try {
    const parsed: unknown = await response.json();
    if (typeof parsed === 'object' && parsed !== null) reply = parsed as Record<string, unknown>;
  } catch {
    // An unreadable reply is explained by its status below.
  }
  if (!response.ok || typeof reply.access_token !== 'string') {
    throw explainAuthError(String(reply.error ?? `http_${response.status}`), String(reply.error_description ?? ''), redirectUri);
  }
  const expiresIn = Number(reply.expires_in);
  return {
    accessToken: reply.access_token,
    expiresAt: Date.now() + (Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 3600) * 1000,
    refreshToken: typeof reply.refresh_token === 'string' ? reply.refresh_token : null,
    account: typeof reply.id_token === 'string' ? readIdToken(reply.id_token) : null,
  };
}

/**
 * The account an ID token names. It came straight from Microsoft over HTTPS
 * and is only shown, never trusted for access, so its signature is not checked.
 */
export function readIdToken(idToken: string): OutlookAccount | null {
  const payload = idToken.split('.')[1];
  if (!payload) return null;
  try {
    const padded = payload.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(payload.length / 4) * 4, '=');
    const bytes = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
    const claims = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
    const username = [claims.preferred_username, claims.upn, claims.email].find((v): v is string => typeof v === 'string' && v !== '');
    if (!username) return null;
    return { name: typeof claims.name === 'string' ? claims.name : '', username };
  } catch {
    return null;
  }
}

/** Codes that mean the sign-in is over and needs the user again. */
const EXPIRED_CODES = new Set(['700084', '700082', '70008', '50173', '50133', '50076', '50079', '50078', '50058', '16000']);

/**
 * A plain explanation of a Microsoft sign-in error, from its error code and
 * the AADSTS number in its description.
 */
export function explainAuthError(error: string, description: string, redirectUri: string): AuthError {
  const code = /AADSTS(\d+)/.exec(description)?.[1] ?? '';
  if (code === '50011') return new AuthError(AUTH_MESSAGES.redirect(redirectUri), 'setup');
  if (code === '9002326') return new AuthError(AUTH_MESSAGES.webPlatform, 'setup');
  if (code === '700016') return new AuthError(AUTH_MESSAGES.unknownApp, 'setup');
  if (code === '90002' || code === '900023') return new AuthError(AUTH_MESSAGES.unknownTenant, 'setup');
  if (code === '90072') return new AuthError(AUTH_MESSAGES.otherTenant, 'setup');
  if (code === '70011') return new AuthError(AUTH_MESSAGES.scope, 'setup');
  if (code === '65001' || code === '90094' || error === 'consent_required') return new AuthError(AUTH_MESSAGES.consent, 'consent');
  if (EXPIRED_CODES.has(code) || ['invalid_grant', 'interaction_required', 'login_required'].includes(error)) {
    return new AuthError(AUTH_MESSAGES.expired, 'expired');
  }
  if (error === 'access_denied') return new AuthError(AUTH_MESSAGES.canceled, 'canceled');
  // Microsoft's descriptions end with trace and correlation ids; keep the sentence.
  const first = description.split(/\r?\n|Trace ID:/)[0]!.replace(/^AADSTS\d+:\s*/, '').trim();
  const detail = first || error;
  return new AuthError(`Microsoft sign-in did not finish (${detail.replace(/\.$/, '')}), so try again.`, 'other');
}
