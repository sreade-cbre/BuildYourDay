import { describe, expect, it } from 'vitest';
import { calendarViewRange } from '../src/core/calendar';
import {
  AUTH_MESSAGES,
  AuthError,
  SCOPES,
  authorizeUrl,
  base64Url,
  codeChallenge,
  explainAuthError,
  readIdToken,
  redeemCode,
  refreshTokens,
} from '../src/outlook/auth';
import { ID_MESSAGES, OUTLOOK_KEY, checkIds, readConfig, writeConfig } from '../src/outlook/config';
import { GRAPH, GRAPH_MESSAGES, GraphError, calendarViewUrl, fetchDayEvents } from '../src/outlook/graph';

const IDS = { clientId: '11111111-2222-3333-4444-555555555555', tenantId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' };
const REDIRECT = 'http://localhost:5173/';

interface Call {
  url: string;
  init?: RequestInit;
}

/** A fetch that answers from a list, in order, and records each call. */
function fakeFetch(replies: Array<{ status?: number; body: unknown } | Error>): { fetcher: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fetcher = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const reply = replies.shift();
    if (!reply) throw new Error('No more replies');
    if (reply instanceof Error) throw reply;
    return new Response(JSON.stringify(reply.body), { status: reply.status ?? 200 });
  }) as unknown as typeof fetch;
  return { fetcher, calls };
}

function idToken(claims: Record<string, unknown>): string {
  const part = (value: unknown) => base64Url(new TextEncoder().encode(JSON.stringify(value)));
  return `${part({ alg: 'RS256' })}.${part(claims)}.signature`;
}

describe('PKCE', () => {
  it('matches the RFC 7636 example', async () => {
    expect(await codeChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });

  it('encodes base64 for URLs without padding', () => {
    expect(base64Url(new Uint8Array([251, 255, 191]))).toBe('-_-_');
    expect(base64Url(new Uint8Array([1]))).toBe('AQ');
  });
});

describe('the sign-in request', () => {
  it('asks for a code by fragment with PKCE and read only calendar access', () => {
    const url = new URL(authorizeUrl({ ...IDS, redirectUri: REDIRECT, state: 'st', challenge: 'ch', loginHint: 'sam@example.com' }));
    expect(`${url.origin}${url.pathname}`).toBe(`https://login.microsoftonline.com/${IDS.tenantId}/oauth2/v2.0/authorize`);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: IDS.clientId,
      response_type: 'code',
      redirect_uri: REDIRECT,
      response_mode: 'fragment',
      scope: SCOPES,
      state: 'st',
      code_challenge: 'ch',
      code_challenge_method: 'S256',
      login_hint: 'sam@example.com',
    });
    expect(SCOPES.split(' ')).toContain('https://graph.microsoft.com/Calendars.Read');
    expect(SCOPES).not.toMatch(/ReadWrite/);
  });

  it('can ask for no prompt at all', () => {
    const url = new URL(authorizeUrl({ ...IDS, redirectUri: REDIRECT, state: 's', challenge: 'c', silent: true }));
    expect(url.searchParams.get('prompt')).toBe('none');
    expect(url.searchParams.has('login_hint')).toBe(false);
  });
});

describe('tokens', () => {
  it('redeems a code with the verifier and reads the account', async () => {
    const { fetcher, calls } = fakeFetch([
      {
        body: {
          access_token: 'at',
          expires_in: 3599,
          refresh_token: 'rt',
          id_token: idToken({ name: 'Sam Réade', preferred_username: 'sam@example.com' }),
        },
      },
    ]);
    const before = Date.now();
    const tokens = await redeemCode(IDS, 'the-code', 'the-verifier', REDIRECT, fetcher);
    expect(tokens).toMatchObject({ accessToken: 'at', refreshToken: 'rt', account: { name: 'Sam Réade', username: 'sam@example.com' } });
    expect(tokens.expiresAt).toBeGreaterThanOrEqual(before + 3_599_000);
    expect(calls[0]!.url).toBe(`https://login.microsoftonline.com/${IDS.tenantId}/oauth2/v2.0/token`);
    expect(calls[0]!.init?.method).toBe('POST');
    expect(Object.fromEntries(new URLSearchParams(String(calls[0]!.init?.body)))).toEqual({
      client_id: IDS.clientId,
      scope: SCOPES,
      code: 'the-code',
      redirect_uri: REDIRECT,
      grant_type: 'authorization_code',
      code_verifier: 'the-verifier',
    });
  });

  it('refreshes, and explains an expired sign-in', async () => {
    const { fetcher, calls } = fakeFetch([
      { body: { access_token: 'at2', expires_in: 3600, refresh_token: 'rt2' } },
      {
        status: 400,
        body: {
          error: 'invalid_grant',
          error_description: 'AADSTS700084: The refresh token was issued to a single page app (SPA), and therefore has a fixed, limited lifetime of 1.00:00:00.\r\nTrace ID: x',
        },
      },
    ]);
    expect(await refreshTokens(IDS, 'rt', REDIRECT, fetcher)).toMatchObject({ accessToken: 'at2', refreshToken: 'rt2', account: null });
    expect(Object.fromEntries(new URLSearchParams(String(calls[0]!.init?.body)))).toMatchObject({ grant_type: 'refresh_token', refresh_token: 'rt' });
    await expect(refreshTokens(IDS, 'rt2', REDIRECT, fetcher)).rejects.toMatchObject({ problem: 'expired', message: AUTH_MESSAGES.expired });
  });

  it('reports an unreachable sign-in service', async () => {
    const { fetcher } = fakeFetch([new TypeError('Failed to fetch')]);
    const error = await refreshTokens(IDS, 'rt', REDIRECT, fetcher).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AuthError);
    expect((error as AuthError).problem).toBe('network');
  });

  it('reads the account from an ID token, or nothing from a broken one', () => {
    expect(readIdToken(idToken({ name: 'Sam', upn: 'sam@example.com' }))).toEqual({ name: 'Sam', username: 'sam@example.com' });
    expect(readIdToken(idToken({ name: 'Sam' }))).toBeNull();
    expect(readIdToken('not.a-token')).toBeNull();
    expect(readIdToken('')).toBeNull();
  });
});

describe('explaining sign-in errors', () => {
  const explain = (error: string, description: string) => explainAuthError(error, description, REDIRECT);

  it('turns the common setup mistakes into what to fix', () => {
    expect(explain('invalid_request', 'AADSTS50011: The redirect URI does not match.').message).toBe(AUTH_MESSAGES.redirect(REDIRECT));
    expect(explain('invalid_request', 'AADSTS9002326: Cross-origin token redemption is permitted only for the Single-Page Application client-type.')).toMatchObject({
      message: AUTH_MESSAGES.webPlatform,
      problem: 'setup',
    });
    expect(explain('unauthorized_client', 'AADSTS700016: Application not found.').message).toBe(AUTH_MESSAGES.unknownApp);
    expect(explain('invalid_request', 'AADSTS90002: Tenant not found.').message).toBe(AUTH_MESSAGES.unknownTenant);
    expect(explain('invalid_client', 'AADSTS65001: The user or administrator has not consented.')).toMatchObject({ problem: 'consent' });
    expect(explain('access_denied', 'AADSTS65004: User declined to consent.')).toMatchObject({ problem: 'canceled' });
    expect(explain('interaction_required', 'AADSTS50058: A silent sign-in request was sent but no user is signed in.')).toMatchObject({ problem: 'expired' });
  });

  it('keeps the first sentence of anything else, without trace ids', () => {
    const error = explain('server_error', 'AADSTS50000: There was an error issuing a token.\r\nTrace ID: abc\r\nCorrelation ID: def');
    expect(error).toMatchObject({ problem: 'other', message: 'Microsoft sign-in did not finish (There was an error issuing a token), so try again.' });
    expect(explain('temporarily_unavailable', '').message).toBe('Microsoft sign-in did not finish (temporarily_unavailable), so try again.');
  });
});

describe('the connection settings', () => {
  it('checks the ids', () => {
    expect(checkIds(IDS.clientId, IDS.tenantId)).toBeNull();
    expect(checkIds(` ${IDS.clientId} `, 'example.onmicrosoft.com')).toBeNull();
    expect(checkIds('my app', IDS.tenantId)).toBe(ID_MESSAGES.clientId);
    expect(checkIds(IDS.clientId, 'not a tenant')).toBe(ID_MESSAGES.tenantId);
  });

  it('round trips through storage and fills ids from the environment', () => {
    const map = new Map<string, string>();
    const storage = { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v), removeItem: (k: string) => void map.delete(k) };
    const env = { VITE_OUTLOOK_CLIENT_ID: IDS.clientId, VITE_OUTLOOK_TENANT_ID: IDS.tenantId };
    expect(readConfig(storage, env)).toEqual({ ...IDS, categoryId: null, account: null, refreshToken: null });
    const saved = { clientId: 'c', tenantId: 't', categoryId: 'meet', account: { name: 'Sam', username: 'sam@example.com' }, refreshToken: 'rt' };
    expect(writeConfig(storage, saved)).toBe(true);
    expect(readConfig(storage, env)).toEqual(saved);
    map.set(OUTLOOK_KEY, '{broken');
    expect(readConfig(storage)).toEqual({ clientId: '', tenantId: '', categoryId: null, account: null, refreshToken: null });
    expect(writeConfig(null, saved)).toBe(false);
  });
});

describe('reading a day from Graph', () => {
  const event = (id: string) => ({
    id,
    subject: id,
    start: { dateTime: '2026-10-06T14:00:00.0000000', timeZone: 'UTC' },
    end: { dateTime: '2026-10-06T15:00:00.0000000', timeZone: 'UTC' },
  });

  it('asks calendarView for the local day in UTC, with the token', async () => {
    const { fetcher, calls } = fakeFetch([{ body: { value: [event('a')] } }]);
    const events = await fetchDayEvents('at', '2026-10-06', fetcher);
    expect(events.map((e) => e.id)).toEqual(['a']);
    const url = new URL(calls[0]!.url);
    const range = calendarViewRange('2026-10-06');
    expect(`${url.origin}${url.pathname}`).toBe(`${GRAPH}/me/calendarView`);
    expect(url.searchParams.get('startDateTime')).toBe(range.start);
    expect(url.searchParams.get('endDateTime')).toBe(range.end);
    expect(url.searchParams.get('$select')).toBe('id,subject,start,end,isAllDay,isCancelled,showAs,responseStatus');
    expect(calls[0]!.init?.headers).toEqual({ Authorization: 'Bearer at', Prefer: 'outlook.timezone="UTC"' });
    expect(calendarViewUrl('2026-10-06')).toBe(calls[0]!.url);
  });

  it('follows next links on Graph, and only there', async () => {
    const { fetcher, calls } = fakeFetch([
      { body: { value: [event('a')], '@odata.nextLink': `${GRAPH}/me/calendarView?$skiptoken=2` } },
      { body: { value: [event('b')], '@odata.nextLink': 'https://elsewhere.example/steal' } },
    ]);
    expect((await fetchDayEvents('at', '2026-10-06', fetcher)).map((e) => e.id)).toEqual(['a', 'b']);
    expect(calls.map((c) => c.url.split('?')[0])).toEqual([`${GRAPH}/me/calendarView`, `${GRAPH}/me/calendarView`]);
  });

  it('turns failures into messages with their status', async () => {
    const cases: Array<[{ status?: number; body: unknown } | Error, number, string]> = [
      [new TypeError('Failed to fetch'), 0, GRAPH_MESSAGES.network],
      [{ status: 401, body: {} }, 401, GRAPH_MESSAGES.unauthorized],
      [{ status: 418, body: {} }, 418, GRAPH_MESSAGES.other(418)],
      [{ status: 403, body: {} }, 403, GRAPH_MESSAGES.forbidden],
      [{ status: 429, body: {} }, 429, GRAPH_MESSAGES.busy],
      [{ body: { nope: true } }, 200, GRAPH_MESSAGES.unreadable],
    ];
    for (const [reply, status, message] of cases) {
      const { fetcher } = fakeFetch([reply]);
      const error = await fetchDayEvents('at', '2026-10-06', fetcher).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(GraphError);
      expect(error).toMatchObject({ status, message });
    }
  });
});
