import { BaseComponent } from './base-component';
import { createElementFromHTML } from '../util';
import { App } from '../app';
import { binarySearchFindExact, binarySearchFindExactIx } from '../binary-search';
import { MapListComponent } from './map-list';
import { FilterComponent } from './filter';
import { MapInstance } from '../ingest/log-tracker';
declare var bootstrap: any;

type ParsedRange = { from?: Date; to?: Date };

export class OmniSearchComponent extends BaseComponent<HTMLDivElement> {
    private appRef: App;
    private inputEl!: HTMLInputElement;
    private resultsEl!: HTMLDivElement;
    private modalInstance: any;

    constructor(app: App, container: HTMLElement) {
        super(createElementFromHTML(
            `
            <div class="modal" id="omniModal" tabindex="-1">
                <div class="modal-dialog modal-dialog-centered modal-lg">
                    <div class="modal-content">
                        <div class="modal-body">
                            <input class="form-control omni-input" type="text" placeholder="Type: tab name, or from:/to: (e.g. from:2d to:now)">
                            <div class="omni-results mt-2"></div>
                        </div>
                    </div>
                </div>
            </div>
            `
        ) as HTMLDivElement, container);
        this.appRef = app;
        
        document.addEventListener('keydown', (e) => {
            const isCtrlK = (e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K');
            if (isCtrlK) {
                e.preventDefault();
                this.setVisible(true);
            }
        });
    }

    protected render(): void {}

    protected init(): void {
        this.inputEl = this.element.querySelector('.omni-input') as HTMLInputElement;
        this.resultsEl = this.element.querySelector('.omni-results') as HTMLDivElement;
        this.inputEl.addEventListener('input', () => this.updateResults());
        this.inputEl.addEventListener('keydown', (e) => this.handleKeydown(e));

        this.modalInstance = bootstrap.Modal.getOrCreateInstance(this.element, { backdrop: true, keyboard: true, focus: true });
        this.element.addEventListener('shown.bs.modal', () => {
        });
        this.element.addEventListener('hidden.bs.modal', () => {
            this.setVisible(false);
        });
        this.element.classList.remove('d-none');
    }

    protected visibilityChanged(): void {
        if (this.isVisible) {
            this.inputEl.value = '';
            this.resultsEl.innerHTML = '';
            this.modalInstance.show();
            this.inputEl.focus();
        } else {
            this.modalInstance.hide();
        }
    }

    private handleKeydown(e: KeyboardEvent): void {
        if (e.key === 'Escape') {
            e.preventDefault();
            this.setVisible(false);
            return;
        }
        if (e.key === 'Enter') {
            e.preventDefault();
            this.execute(this.inputEl.value.trim());
        }
    }

    private updateResults(): void {
        const q = this.inputEl.value.trim();
        const items: string[] = [];
        const tab = this.detectTab(q);
        if (tab) items.push(`Jump to tab: ${tab.label}`);
        const r = this.parseRange(q);
        if (r.from || r.to) {
            const fromStr = r.from ? r.from.toLocaleString() : '';
            const toStr = r.to ? r.to.toLocaleString() : '';
            items.push(`Range: ${fromStr || 'unset'} → ${toStr || 'unset'}`);
        }
        this.resultsEl.innerHTML = items.map(i => `<div class="omni-result-item">${i}</div>`).join('');
    }

    private execute(query: string): void {
        const tab = this.detectTab(query);
        if (tab) {
            this.appRef.showTabByName(tab.key);
            this.setVisible(false);
            return;
        }
        const r = this.parseRange(query);
        if (r.from || r.to) {
            const payload = JSON.stringify({
                from: r.from ? r.from.toISOString() : null,
                to: r.to ? r.to.toISOString() : null
            });
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(payload).catch(() => {});
            }
            this.setVisible(false);
            return;
        }
        this.setVisible(false);
    }

    private parseQuery(q: string) {
        enum Token {
            from = 'from',
            to = 'to',
            tab = 'tab',
            map = 'map',
        };
        const parts = q.split(new RegExp(`((${Object.values(Token).join('|')}:)(^\\s+)\\s*)+`, 'i'));
        if (parts.length === 0) return null;

        let from: { date: Date; label: string } | null = null;
        let to: { date: Date; label: string } | null = null;

        for (let i = 1; i < parts.length; i += 2) {
            const token = parts[i];
            const value = parts[i + 1];
            switch (token) {
                case Token.from:
                    from = this.parseDateLike(value);
                    break;
                case Token.to:
                    to = this.parseDateLike(value);
                    break;
                case Token.map:
                    let maps: MapInstance[];
                    if (value.includes("-")) {
                        const [loId, hiId] = value.split(/\s*-\s*/).map(v => parseInt(v, 10));
                        const loIx = binarySearchFindExactIx(this.data.maps, (m) => m.id - loId);
                        const hiIx = binarySearchFindExactIx(this.data.maps, (m) => m.id - hiId);
                        if (loIx >= 0 && hiIx >= 0) {
                            maps = this.data!.maps.slice(loIx, hiIx + 1);
                        } else {
                            maps = [];
                        }
                    } else {
                        const values = value.split(/\s*,\s/);
                        maps = values
                            .map(v => parseInt(v, 10))
                            .map(id => binarySearchFindExact(this.data.maps, (m) => id - m.id))
                            .filter(m => m !== undefined);
                    }
                    // TODO create temp map overlay
                    break;
            }
        }
        const filterComponent = this.app.getComponent(FilterComponent);
        filterComponent.getFilter();
        filterComponent.updateFilter();
    }

    private detectTab(q: string): { key: string; label: string } | null {
        const s = q.toLowerCase().trim();
        if (!s) return null;
        const known: { key: string; aliases: string[]; label: string }[] = [
            { key: 'overview', aliases: ['overview', 'home'], label: 'Overview' },
            { key: 'analysis', aliases: ['analysis', 'analytics'], label: 'Analysis' },
            { key: 'maps', aliases: ['maps', 'map list'], label: 'Maps' },
            { key: 'map-stats', aliases: ['map stats', 'stats'], label: 'Map stats' },
            { key: 'campaign', aliases: ['campaign'], label: 'Campaign' },
            { key: 'messages', aliases: ['messages', 'msg', 'dm'], label: 'Messages' },
            { key: 'search-log', aliases: ['search', 'raw log', 'search log'], label: 'Search raw log' }
        ];
        const normalized = (t: string) => t.replace(/[^a-z0-9]+/g, ' ').trim();
        for (const k of known) {
            for (const a of k.aliases) {
                if (normalized(s) === normalized(a) || normalized(s) === `tab ${normalized(a)}`) {
                    return { key: k.key, label: k.label };
                }
            }
        }
        if (s.startsWith('tab:')) {
            const name = s.slice(4).trim();
            for (const k of known) {
                for (const a of k.aliases) {
                    if (normalized(name) === normalized(a)) return { key: k.key, label: k.label };
                }
            }
        }
        return null;
    }

    private parseRange(q: string): ParsedRange {
        if (!q) return {};
        const parts = q.split(/\s+/);
        let from: Date | undefined;
        let to: Date | undefined;
        for (const p of parts) {
            const m = p.match(/^(from|to):(.+)$/i);
            if (!m) continue;
            const which = m[1].toLowerCase();
            const val = m[2];
            const d = this.parseDateLike(val);
            if (d) {
                if (which === 'from') from = d?.date;
                else to = d?.date;
            }
        }
        if (!from && !to) return {};
        if (from && !to) to = new Date();
        return { from, to };
    }

    private parseDateLike(token: string): { date: Date; label: string } | null {
        const s = token.trim().toLowerCase();
        if (!s) return null;

        const deltas = s.match(/((\d+)\s*(y|mo|w|d|h|m)+\s*)+/);
        if (deltas) {
            const date = new Date();
            const labels: Map<number, string> = new Map();
            for (let i = 1; i < deltas.length; i += 2) {
                const n = parseInt(deltas[i], 10);
                const unit = deltas[i + 1];
                if (['y', 'yr', 'yrs', 'year', 'years'].includes(unit)) {
                    date.setFullYear(date.getFullYear() - n);
                    labels.set(7, n + ' years');
                } else if (['mo', 'mon', 'month', 'months'].includes(unit)) {
                    date.setMonth(date.getMonth() - n);
                    labels.set(6, n + ' months');
                } else if (['w', 'wk', 'wks', 'week', 'weeks'].includes(unit)) {
                    date.setDate(date.getDate() - n * 7);
                    labels.set(5, n + ' weeks');
                } else if (['d', 'day', 'days'].includes(unit)) {
                    date.setDate(date.getDate() - n);
                    labels.set(4, n + ' days');
                } else if (['h', 'hr', 'hrs', 'hour', 'hours'].includes(unit)) {
                    date.setHours(date.getHours() - n);
                    labels.set(3, n + ' hours');
                } else if (['m', 'min', 'mins', 'minute', 'minutes'].includes(unit)) {
                    date.setMinutes(date.getMinutes() - n);
                    labels.set(2, n + ' minutes');
                } else if (['s', 'sec', 'secs', 'second', 'seconds'].includes(unit)) {
                    date.setSeconds(date.getSeconds() - n);
                    labels.set(1, n + ' seconds');
                }
            }
            const label = Array.from(labels.entries()).sort(([aUnit, _], [bUnit, __]) => bUnit - aUnit).join(', ') + " ago";
            return { date, label };
        }
        let date: Date | undefined;
        const millis = s.match(/^(\d+)/);
        if (millis) {
            date = new Date(parseInt(millis[1], 10));
        }

        const ts = Date.parse(s);
        if (!isNaN(ts)) date = new Date(ts);

        const d = new Date(s);
        if (!isNaN(d.getTime())) date = d;

        if (date) return { date, label: date.toLocaleString() };

        return null;
    }
}

