import { planMeetings, type CalendarEvent, type SkippedMeeting } from '../core/calendar';
import type { CategoryId, IsoDate } from '../core/model';
import type { StorageLike } from '../core/persist';
import type { Store, StoreEvent } from '../core/store';
import { formatTime } from '../core/time';
import { AUTH_MESSAGES, AuthError, authorizeUrl, codeChallenge, explainAuthError, randomString, redeemCode, refreshTokens, type Tokens } from './auth';
import { checkIds, readConfig, writeConfig, type OutlookConfig } from './config';
import { GraphError, fetchDayEvents } from './graph';

// Keeps the viewed day's meetings in step with Outlook while the app is
// open: on start, every five minutes, when the tab comes back, and when the
// day changes. Between fetches the last reply is kept per day, so an edit
// that frees time, or a new day window, places waiting meetings at once.
//
// Sign-in lasts 24 hours for a browser app. When it runs out as the app
// opens, the page tries once to sign in again without a prompt, which works
// while the browser is still signed in to Microsoft 365; otherwise the user
// reconnects with one click.

/** How often the viewed day is fetched again. */
export const POLL_MS = 5 * 60_000;
/** Coming back to the tab fetches again if the last try is older than this. */
const WAKE_MS = 60_000;
/** Refresh the access token this long before it runs out. */
const TOKEN_MARGIN_MS = 2 * 60_000;
/** A day change waits this long, so paging through days fetches only where it stops. */
const DAY_SETTLE_MS = 400;
/** A sign-in that expires this soon after the page opens may try the silent one. */
const STARTUP_MS = 20_000;
const PENDING_KEY = 'timetower.outlook.signin';
const SILENT_KEY = 'timetower.outlook.silent';
const REPORTED_KEY = 'timetower.outlook.reported';

export interface OutlookStatus {
  connection: 'off' | 'connecting' | 'on' | 'expired';
  /** A fetch is under way. */
  busy: boolean;
  /** When meetings last came back from Outlook. */
  updatedAt: number | null;
  /** What went wrong on the last try, if it failed. */
  problem: string | null;
  /** True when the problem needs the user, not just another try. */
  needsUser: boolean;
}

export interface OutlookHooks {
  /** A toast, with an optional action. */
  notify(message: string, action?: { label: string; run: () => void }): void;
  /** Opens the settings, where the Outlook section explains more. */
  showDetails(): void;
  /** True while the page can go to Microsoft and back unasked: nothing touched yet. */
  untouched(): boolean;
}

interface PendingSignIn {
  state: string;
  verifier: string;
  clientId: string;
  tenantId: string;
  redirectUri: string;
  silent: boolean;
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

export class OutlookSync {
  private config: OutlookConfig;
  private access: Tokens | null = null;
  private refreshing: Promise<string> | null = null;
  private readonly events = new Map<IsoDate, CalendarEvent[]>();
  private readonly skippedByDate = new Map<IsoDate, SkippedMeeting[]>();
  /** Meetings already reported as not fitting, so each is told once per tab. */
  private readonly reported: Set<string>;
  private readonly replans = new Set<IsoDate>();
  private running: Promise<void> | null = null;
  private again = false;
  private lastAttempt = 0;
  private dayTimer = 0;
  /** Bumped on disconnect, so a reply already on its way is dropped. */
  private generation = 0;
  private readonly openedAt = Date.now();
  private current: OutlookStatus;
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly store: Store,
    private readonly storage: StorageLike | null,
    private readonly session: StorageLike | null,
    private readonly hooks: OutlookHooks,
  ) {
    this.config = readConfig(storage, import.meta.env);
    this.reported = new Set(this.readList(REPORTED_KEY));
    this.current = {
      connection: this.config.refreshToken ? 'on' : this.config.account ? 'expired' : 'off',
      busy: false,
      updatedAt: null,
      problem: null,
      needsUser: false,
    };
    store.subscribe((event) => this.onStoreEvent(event));
    if (!this.finishSignIn()) {
      if (this.current.connection === 'expired') this.trySilentSignIn();
      else void this.sync();
    }
    this.startTimers();
  }

  // Reading

  /** Calls `listener` when the status, the connection, or the skipped meetings change. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    for (const listener of [...this.listeners]) listener();
  }

  get status(): Readonly<OutlookStatus> {
    return this.current;
  }

  get ids(): { clientId: string; tenantId: string } {
    return { clientId: this.config.clientId, tenantId: this.config.tenantId };
  }

  get account(): OutlookConfig['account'] {
    return this.config.account;
  }

  /** Signed in, with a way to get a token without asking the user. */
  get connected(): boolean {
    return this.config.refreshToken !== null || (this.access !== null && this.access.expiresAt > Date.now());
  }

  /** The address to register in Microsoft Entra ID, which sign-in comes back to. */
  get redirectUri(): string {
    return `${window.location.origin}${window.location.pathname}`;
  }

  /** Meetings on a day that are not on the tower, from the last plan. */
  skipped(date: IsoDate): readonly SkippedMeeting[] {
    return this.skippedByDate.get(date) ?? [];
  }

  /**
   * The category new meetings go in: the one the user picked, else one
   * named Meetings, else the default Meetings category, else the first.
   */
  meetingsCategory(): CategoryId {
    const categories = this.store.settings.categories;
    const chosen = this.config.categoryId;
    if (chosen && categories.some((c) => c.id === chosen)) return chosen;
    const named = categories.find((c) => c.name.trim().toLowerCase() === 'meetings') ?? categories.find((c) => c.id === 'meet');
    return (named ?? categories[0]!).id;
  }

  // Connecting

  /** Saves the app registration's ids. Returns an error to show, or null. */
  setIds(clientId: string, tenantId: string): string | null {
    const error = checkIds(clientId, tenantId);
    if (error) return error;
    this.config = { ...this.config, clientId: clientId.trim(), tenantId: tenantId.trim() };
    this.save();
    return null;
  }

  /** Sends the page to Microsoft to sign in. Returns an error to show, or null. */
  async connect(silent = false): Promise<string | null> {
    const error = checkIds(this.config.clientId, this.config.tenantId);
    if (error) return error;
    const verifier = randomString(32);
    const pending: PendingSignIn = {
      state: randomString(16),
      verifier,
      clientId: this.config.clientId,
      tenantId: this.config.tenantId,
      redirectUri: this.redirectUri,
      silent,
    };
    const challenge = await codeChallenge(verifier);
    try {
      if (!this.session) throw new Error('No session storage');
      this.session.setItem(PENDING_KEY, JSON.stringify(pending));
    } catch {
      return 'This browser would not hold the sign-in while it is under way, so allow site data and try again.';
    }
    window.location.assign(
      authorizeUrl({ ...pending, challenge, loginHint: this.config.account?.username, silent }),
    );
    return null;
  }

  /**
   * Forgets the sign-in. `keep` turns the meetings into the user's own
   * blocks; otherwise they leave the tower.
   */
  disconnect(keep: boolean): number {
    this.config = { ...this.config, account: null, refreshToken: null };
    this.access = null;
    this.generation += 1;
    this.events.clear();
    this.skippedByDate.clear();
    this.reported.clear();
    this.session?.removeItem(REPORTED_KEY);
    this.save();
    this.setStatus({ connection: 'off', busy: false, updatedAt: null, problem: null, needsUser: false });
    return this.store.releaseMeetings(keep);
  }

  /** Picks the category for meetings and moves the meetings already in the old one. */
  setCategory(id: CategoryId): void {
    const previous = this.meetingsCategory();
    this.config = { ...this.config, categoryId: id };
    this.save();
    this.store.recategorizeMeetings(previous, id);
    this.emit();
  }

  /**
   * Finishes a sign-in when the page comes back from Microsoft with a code
   * (or an error) in its fragment, and the state matches the one sent.
   * Returns true when it did.
   */
  private finishSignIn(): boolean {
    const hash = window.location.hash.replace(/^#/, '');
    if (!hash) return false;
    const params = new URLSearchParams(hash);
    const state = params.get('state');
    let pending: PendingSignIn | null = null;
    try {
      const raw = this.session?.getItem(PENDING_KEY);
      pending = raw ? (JSON.parse(raw) as PendingSignIn) : null;
    } catch {
      pending = null;
    }
    if (!state || !pending || pending.state !== state) return false;
    this.session?.removeItem(PENDING_KEY);
    // The code is single use, but keep it out of the address bar and history.
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}`);

    const error = params.get('error');
    const code = params.get('code');
    if (error || !code) {
      const problem = explainAuthError(error ?? 'no_code', params.get('error_description') ?? '', pending.redirectUri);
      this.setStatus({
        ...this.current,
        connection: this.config.refreshToken ? 'on' : this.config.account ? 'expired' : 'off',
        problem: problem.message,
        needsUser: problem.problem !== 'expired',
      });
      // A silent try that needs a prompt just leaves the Reconnect chip.
      if (!(pending.silent && problem.problem === 'expired')) this.hooks.notify(problem.message);
      return true;
    }

    this.setStatus({ ...this.current, connection: 'connecting', problem: null, needsUser: false });
    void this.redeem(pending, code);
    return true;
  }

  private async redeem(pending: PendingSignIn, code: string): Promise<void> {
    try {
      const tokens = await redeemCode(pending, code, pending.verifier, pending.redirectUri);
      this.access = tokens;
      this.config = {
        ...this.config,
        clientId: pending.clientId,
        tenantId: pending.tenantId,
        account: tokens.account ?? this.config.account,
        refreshToken: tokens.refreshToken,
      };
      this.save();
      this.session?.removeItem(SILENT_KEY);
      this.setStatus({ ...this.current, connection: 'on', problem: null, needsUser: false });
      if (!pending.silent) {
        const name = this.config.account?.name || this.config.account?.username;
        this.hooks.notify(name ? `Connected to Outlook as ${name}.` : 'Connected to Outlook.');
      }
      await this.sync();
    } catch (error) {
      const message = error instanceof AuthError ? error.message : AUTH_MESSAGES.network;
      this.setStatus({ ...this.current, connection: this.config.account ? 'expired' : 'off', problem: message, needsUser: true });
      this.hooks.notify(message);
    }
  }

  /**
   * Once per tab, signs in again without a prompt if sign-in ran out as the
   * app opened and nothing has been touched yet, so no edit is cut off.
   */
  private trySilentSignIn(): void {
    if (!this.config.account || Date.now() - this.openedAt > STARTUP_MS || !this.hooks.untouched()) return;
    try {
      if (!this.session || this.session.getItem(SILENT_KEY)) return;
      this.session.setItem(SILENT_KEY, '1');
    } catch {
      return;
    }
    void this.connect(true);
  }

  // Syncing

  /** Fetches the viewed day from Outlook and applies it. */
  sync(): Promise<void> {
    if (!this.connected) return Promise.resolve();
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = this.run().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async run(): Promise<void> {
    do {
      this.again = false;
      const date = this.store.viewedDate;
      const generation = this.generation;
      this.lastAttempt = Date.now();
      this.setStatus({ ...this.current, busy: true });
      try {
        const events = await this.withToken((token) => fetchDayEvents(token, date));
        if (generation !== this.generation) break;
        this.events.set(date, events);
        this.apply(date);
        this.setStatus({ ...this.current, connection: 'on', updatedAt: Date.now(), problem: null, needsUser: false });
      } catch (error) {
        if (generation !== this.generation) break;
        this.fail(error);
        if (!this.connected) break;
      }
    } while (this.again);
    this.setStatus({ ...this.current, busy: false });
  }

  /** Runs a Graph call with a fresh token, and once more after a 401 with a renewed one. */
  private async withToken<T>(call: (token: string) => Promise<T>): Promise<T> {
    try {
      return await call(await this.token());
    } catch (error) {
      if (!(error instanceof GraphError) || error.status !== 401) throw error;
      this.access = null;
      return call(await this.token());
    }
  }

  private token(): Promise<string> {
    if (this.access && this.access.expiresAt - TOKEN_MARGIN_MS > Date.now()) return Promise.resolve(this.access.accessToken);
    const refresh = this.config.refreshToken;
    if (!refresh) return Promise.reject(new AuthError(AUTH_MESSAGES.expired, 'expired'));
    this.refreshing ??= refreshTokens(this.config, refresh, this.redirectUri)
      .then((tokens) => {
        this.access = tokens;
        this.config = {
          ...this.config,
          refreshToken: tokens.refreshToken ?? this.config.refreshToken,
          account: tokens.account ?? this.config.account,
        };
        this.save();
        return tokens.accessToken;
      })
      .finally(() => {
        this.refreshing = null;
      });
    return this.refreshing;
  }

  private fail(error: unknown): void {
    if (error instanceof AuthError && error.problem === 'expired') {
      this.access = null;
      this.config = { ...this.config, refreshToken: null };
      this.save();
      this.setStatus({ ...this.current, connection: 'expired', problem: error.message, needsUser: true });
      this.trySilentSignIn();
      return;
    }
    if (error instanceof AuthError || error instanceof GraphError) {
      const needsUser = error instanceof AuthError ? error.problem !== 'network' : [401, 403, 404].includes(error.status);
      this.setStatus({ ...this.current, problem: error.message, needsUser });
      return;
    }
    console.error('Time Tower could not update meetings from Outlook:', error);
    this.setStatus({ ...this.current, problem: 'Something went wrong updating meetings, so they will update on the next try.', needsUser: false });
  }

  /** Places a day's meetings from the last reply, around the blocks as they are now. */
  private apply(date: IsoDate): void {
    const events = this.events.get(date);
    // A settings preview is not saved, so meetings wait for Save or Cancel.
    if (!events || this.store.isPreviewingSettings) return;
    const plan = planMeetings(date, events, this.store.blocksFor(date), this.store.settings);
    const result = this.store.syncCalendarDay(date, plan.placed, this.meetingsCategory());
    if (!result.ok) {
      console.warn('Time Tower could not place meetings from Outlook:', result.error);
      return;
    }
    this.skippedByDate.set(date, plan.skipped);
    if (date === this.store.viewedDate) this.report(date, plan.skipped);
    this.emit();
  }

  /** Tells the user, once each, about meetings that would overlap their blocks. */
  private report(date: IsoDate, skipped: readonly SkippedMeeting[]): void {
    const fresh = skipped.filter((s) => s.reason !== 'outsideWindow' && !this.reported.has(`${date} ${s.eventId}`));
    if (fresh.length === 0) return;
    for (const s of fresh) this.reported.add(`${date} ${s.eventId}`);
    try {
      this.session?.setItem(REPORTED_KEY, JSON.stringify([...this.reported].slice(-200)));
    } catch {
      // Without session storage a reload may tell again, which is harmless.
    }
    const show = { label: 'Show', run: () => this.hooks.showDetails() };
    if (fresh.length > 1) {
      this.hooks.notify(`${plural(fresh.length, 'meeting', 'meetings')} would overlap your blocks, so they are not on the tower.`, show);
      return;
    }
    const meeting = fresh[0]!;
    const what = `${meeting.title || 'Untitled'} at ${formatTime(meeting.start, this.store.settings)}`;
    this.hooks.notify(
      meeting.reason === 'dayFull'
        ? `The day is full, so ${what} is not on the tower.`
        : `${what} overlaps ${meeting.blockedBy || 'Untitled'}, so it is not on the tower.`,
      show,
    );
  }

  // Events and timers

  private onStoreEvent(event: StoreEvent): void {
    switch (event.type) {
      case 'blocks':
        // The user's own edits may free time, or take it; replanning never loops,
        // since the store announces the meetings it applies as 'calendar'.
        if (event.origin !== 'calendar' && this.events.has(event.date)) this.replan(event.date);
        break;
      case 'settings':
        if (!this.store.isPreviewingSettings) this.replan(this.store.viewedDate);
        break;
      case 'loaded':
        this.replan(this.store.viewedDate);
        break;
      case 'viewedDate':
        this.replan(event.current);
        window.clearTimeout(this.dayTimer);
        this.dayTimer = window.setTimeout(() => void this.sync(), DAY_SETTLE_MS);
        this.emit();
        break;
    }
  }

  /** Replans after the store has told everyone else, never in the middle. */
  private replan(date: IsoDate): void {
    if (!this.events.has(date) || this.replans.has(date)) return;
    this.replans.add(date);
    queueMicrotask(() => {
      this.replans.delete(date);
      this.apply(date);
    });
  }

  private startTimers(): void {
    window.setInterval(() => {
      if (!document.hidden && Date.now() - this.lastAttempt >= POLL_MS) void this.sync();
    }, 30_000);
    const wake = () => {
      if (!document.hidden && Date.now() - this.lastAttempt >= WAKE_MS) void this.sync();
    };
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('focus', wake);
    window.addEventListener('online', wake);
  }

  private setStatus(next: OutlookStatus): void {
    this.current = next;
    this.emit();
  }

  private save(): void {
    writeConfig(this.storage, this.config);
  }

  private readList(key: string): string[] {
    try {
      const value: unknown = JSON.parse(this.session?.getItem(key) ?? '[]');
      return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
    } catch {
      return [];
    }
  }
}
