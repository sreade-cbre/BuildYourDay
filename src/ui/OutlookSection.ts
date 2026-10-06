import type { SkippedMeeting } from '../core/calendar';
import type { Store } from '../core/store';
import { formatDateTitle, formatTime, nowMinutes } from '../core/time';
import type { OutlookSync } from '../outlook/OutlookSync';
import { POLL_MS } from '../outlook/OutlookSync';
import { button, h } from './dom';

// The Outlook calendar section of the settings modal. Unlike the rest of the
// modal it acts at once, as the Data section does: connecting leaves the page
// for Microsoft's sign-in, and Save and Cancel do not apply to it.

const ABOUT = `Show the meetings in your Outlook calendar, Teams meetings included, as blocks. They update every ${POLL_MS / 60_000} minutes while Time Tower is open, and Outlook keeps their times and titles.`;

function why(meeting: SkippedMeeting): string {
  if (meeting.reason === 'outsideWindow') return 'outside the day window';
  if (meeting.reason === 'dayFull') return 'the day is full';
  return `overlaps ${meeting.blockedBy || 'Untitled'}`;
}

export class OutlookSection {
  readonly element: HTMLElement;
  private readonly content: HTMLElement;
  private readonly unsubscribe: () => void;
  private confirmingDisconnect = false;
  private error: string | null = null;

  constructor(
    private readonly sync: OutlookSync,
    private readonly store: Store,
  ) {
    this.content = h('div', { class: 'outlook' });
    this.element = h('section', { class: 'settings-section' }, h('h3', { class: 'settings-section__title', text: 'Outlook calendar' }), this.content);
    this.unsubscribe = sync.subscribe(() => this.render());
    this.render();
  }

  render(): void {
    // Typing in an id field must not lose its place to a status update.
    if (this.content.contains(document.activeElement) && document.activeElement instanceof HTMLInputElement) return;
    const { connection } = this.sync.status;
    if (connection === 'off') this.content.replaceChildren(...this.signInForm());
    else if (connection === 'connecting') this.content.replaceChildren(h('p', { class: 'outlook__status', text: 'Connecting…' }));
    else this.content.replaceChildren(...this.connected());
  }

  private signInForm(): Node[] {
    const ids = this.sync.ids;
    const clientId = h('input', {
      class: 'input',
      attrs: { type: 'text', value: ids.clientId, autocomplete: 'off', spellcheck: 'false', placeholder: '00000000-0000-0000-0000-000000000000', 'aria-label': 'Application (client) ID' },
    });
    const tenantId = h('input', {
      class: 'input',
      attrs: { type: 'text', value: ids.tenantId, autocomplete: 'off', spellcheck: 'false', placeholder: 'Directory (tenant) ID or domain', 'aria-label': 'Directory (tenant) ID' },
    });
    const errorNode = h('p', { class: 'form-error', text: this.error ?? '', attrs: { role: 'alert' } });
    errorNode.hidden = !this.error;
    const connect = button('Connect Outlook', 'button button--primary', () => {
      this.error = this.sync.setIds(clientId.value, tenantId.value);
      if (this.error) {
        errorNode.textContent = this.error;
        errorNode.hidden = false;
        return;
      }
      void this.sync.connect().then((error) => {
        if (!error) return;
        this.error = error;
        errorNode.textContent = error;
        errorNode.hidden = false;
      });
    });
    for (const input of [clientId, tenantId]) {
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') connect.click();
      });
    }
    const problem = this.sync.status.problem;
    const nodes: Array<Node | null> = [
      h('p', { class: 'field-note outlook__about', text: ABOUT }),
      problem ? h('p', { class: 'outlook__problem', text: problem }) : null,
      h('label', { class: 'settings-row' }, h('span', { class: 'settings-row__label', text: 'Client ID' }), clientId),
      h('label', { class: 'settings-row' }, h('span', { class: 'settings-row__label', text: 'Tenant ID' }), tenantId),
      h(
        'p',
        { class: 'field-note' },
        'Both are on the app registration Overview page in Microsoft Entra ID. Register this address as a single-page application redirect URI: ',
        h('code', { class: 'outlook__uri', text: this.sync.redirectUri }),
      ),
      errorNode,
      h('div', { class: 'button-row' }, connect),
    ];
    return nodes.filter((node): node is Node => node !== null);
  }

  private connected(): Node[] {
    const status = this.sync.status;
    const account = this.sync.account;
    const who = account ? `${account.name || account.username}${account.name ? ` (${account.username})` : ''}` : 'your Microsoft account';
    const nodes: Node[] = [];
    if (status.connection === 'expired') {
      nodes.push(h('p', { class: 'outlook__problem', text: status.problem ?? 'Outlook sign-in has expired, so reconnect to keep meetings up to date.' }));
    } else {
      nodes.push(h('p', { class: 'outlook__status', text: `Connected as ${who}.` }));
      const settings = this.store.settings;
      const line = status.busy
        ? 'Updating…'
        : status.problem
          ? status.problem
          : status.updatedAt !== null
            ? `Updated at ${formatTime(Math.floor(nowMinutes(new Date(status.updatedAt))), settings)}.`
            : 'Waiting for the first update.';
      nodes.push(h('p', { class: status.problem && !status.busy ? 'outlook__problem' : 'field-note', text: line }));
    }

    const categories = this.store.savedSettings.categories;
    const category = h(
      'select',
      { class: 'select', attrs: { 'aria-label': 'Category for meetings' } },
      ...categories.map((c) => h('option', { text: c.name, attrs: { value: c.id } })),
    );
    category.value = this.sync.meetingsCategory();
    category.addEventListener('change', () => this.sync.setCategory(category.value));
    nodes.push(h('label', { class: 'settings-row' }, h('span', { class: 'settings-row__label', text: 'Meetings go in' }), category));

    const date = this.store.viewedDate;
    const skipped = this.sync.skipped(date);
    if (skipped.length > 0) {
      const settings = this.store.settings;
      nodes.push(
        h('p', { class: 'outlook__skipped-title', text: `Not on the tower for ${formatDateTitle(date)}:` }),
        h(
          'ul',
          { class: 'outlook__skipped' },
          ...skipped.map((m) => h('li', { text: `${formatTime(m.start, settings)} ${m.title || 'Untitled'}: ${why(m)}` })),
        ),
      );
    }

    const actions = h('div', { class: 'button-row' });
    if (status.connection === 'expired') {
      actions.append(button('Reconnect', 'button button--primary', () => void this.sync.connect()));
    } else {
      const update = button(status.busy ? 'Updating…' : 'Update now', 'button', () => void this.sync.sync());
      update.disabled = status.busy;
      actions.append(update);
    }
    actions.append(
      button('Disconnect', 'button button--quiet', () => {
        this.confirmingDisconnect = true;
        this.render();
      }),
    );
    nodes.push(actions);
    if (this.confirmingDisconnect) nodes.push(this.disconnectPrompt());
    return nodes;
  }

  private disconnectPrompt(): HTMLElement {
    const finish = (keep: boolean | null) => {
      this.confirmingDisconnect = false;
      if (keep === null) this.render();
      else this.sync.disconnect(keep);
    };
    const remove = button('Remove meetings', 'button button--danger', () => finish(false));
    queueMicrotask(() => remove.focus());
    return h(
      'div',
      { class: 'confirm-clear', attrs: { role: 'group', 'aria-label': 'Confirm disconnect' } },
      h('p', { text: 'Meetings will stop updating. Keep them on the tower as your own blocks, or remove them?' }),
      h(
        'div',
        { class: 'button-row' },
        remove,
        button('Keep as my blocks', 'button', () => finish(true)),
        button('Stay connected', 'button button--quiet', () => finish(null)),
      ),
    );
  }

  dispose(): void {
    this.unsubscribe();
  }
}
