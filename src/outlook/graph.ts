import { calendarViewRange, parseGraphPage, type CalendarEvent } from '../core/calendar';
import type { IsoDate } from '../core/model';

// Reads one day of the signed in user's Outlook calendar from Microsoft
// Graph. calendarView expands recurring meetings into their occurrences, so
// every event that comes back is a real meeting at a real time, in UTC.

export const GRAPH = 'https://graph.microsoft.com/v1.0';
const FIELDS = 'id,subject,start,end,isAllDay,isCancelled,showAs,responseStatus';
/** 100 events to a page; ten pages is far more than a day holds. */
const MAX_PAGES = 10;

export class GraphError extends Error {
  constructor(
    message: string,
    /** The HTTP status, or 0 when Graph could not be reached. */
    readonly status: number,
  ) {
    super(message);
    this.name = 'GraphError';
  }
}

export const GRAPH_MESSAGES = {
  network: 'Could not reach Outlook, so meetings will update when the connection is back.',
  unauthorized: 'Outlook did not accept the sign-in, so reconnect to keep meetings up to date.',
  forbidden: 'Outlook refused to share the calendar, so check that the app registration has Calendars.Read.',
  noMailbox: 'Outlook found no calendar for this account, so check that it has a Microsoft 365 mailbox.',
  busy: 'Outlook is busy, so meetings will update on the next try.',
  unreadable: 'Outlook sent a reply Time Tower could not read, so meetings will update on the next try.',
  other: (status: number) => `Outlook replied with an error (${status}), so meetings will update on the next try.`,
} as const;

/** The calendarView request for a day, from local midnight to local midnight. */
export function calendarViewUrl(date: IsoDate): string {
  const { start, end } = calendarViewRange(date);
  return (
    `${GRAPH}/me/calendarView?startDateTime=${encodeURIComponent(start)}&endDateTime=${encodeURIComponent(end)}` +
    `&$select=${FIELDS}&$orderby=start/dateTime&$top=100`
  );
}

function messageFor(status: number): string {
  if (status === 401) return GRAPH_MESSAGES.unauthorized;
  if (status === 403) return GRAPH_MESSAGES.forbidden;
  if (status === 404) return GRAPH_MESSAGES.noMailbox;
  if (status === 429 || status >= 500) return GRAPH_MESSAGES.busy;
  return GRAPH_MESSAGES.other(status);
}

/** Every event on a day, following Graph's pages. Throws GraphError. */
export async function fetchDayEvents(accessToken: string, date: IsoDate, fetcher: typeof fetch = fetch): Promise<CalendarEvent[]> {
  const events: CalendarEvent[] = [];
  let url: string | null = calendarViewUrl(date);
  for (let page = 0; url !== null && page < MAX_PAGES; page++) {
    let response: Response;
    try {
      response = await fetcher(url, {
        headers: { Authorization: `Bearer ${accessToken}`, Prefer: 'outlook.timezone="UTC"' },
      });
    } catch {
      throw new GraphError(GRAPH_MESSAGES.network, 0);
    }
    if (!response.ok) throw new GraphError(messageFor(response.status), response.status);
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    const parsed = parseGraphPage(body);
    if (!parsed) throw new GraphError(GRAPH_MESSAGES.unreadable, response.status);
    events.push(...parsed.events);
    // The token only ever goes to Graph itself.
    url = parsed.nextLink?.startsWith(`${GRAPH}/`) ? parsed.nextLink : null;
  }
  return events;
}
