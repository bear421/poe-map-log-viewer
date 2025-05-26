import { MapInstance, MapSpan } from '../log-tracker';
import { LogEvent } from '../log-events';
import { binarySearchRange } from '../binary-search';
import { eventMeta, getEventMeta, EventName } from '../log-events';
import { BaseComponent } from './base-component';
import { MapDetailComponent } from './map-detail';
import { DynamicTooltip } from '../util';

const relevantEventNames = new Set<EventName>([
    "death",
    "levelUp",
    "bossKill",
    "passiveGained",
    "passiveAllocated",
    "passiveUnallocated",
    "mapReentered",
    "joinedArea",
    "leftArea",
    "tradeAccepted",
    "msgParty"
]);

export class MapListComponent extends BaseComponent {
    private mapDetailModal: MapDetailComponent;
    private tooltip: DynamicTooltip = new DynamicTooltip(`<span class="event-offset"></span> <span class="event-label"></span>`);

    constructor(container: HTMLElement) {
        super(document.createElement('div'), container);
        this.element.className = 'journey-component-container mt-3';
        this.mapDetailModal = new MapDetailComponent();
    }

    protected render(): void {
        if (!this.data) return;

        this.mapDetailModal.updateData(this.data);
        this.mapDetailModal.setApp(this.app!);

        const table = document.createElement('table');
        table.className = 'table table-sm table-striped table-fixed caption-top journey-campaign-table';
        table.innerHTML = `
            <thead>
                <tr>
                    <th class="th-area">Area</th>
                    <th class="th-events">Events</th>
                    <th class="th-time-spent">Time</th>
                    <th class="th-entered-at">Entered At</th>
                    <th class="th-area-level">Area Lvl</th>
                    <th class="th-char-level">Char Lvl</th>
                </tr>
            </thead>
            <tbody class="align-middle"></tbody>
        `;

        const tbody = table.querySelector('tbody') as HTMLTableSectionElement;
        for (let i = 0; i < this.data.maps.length; i++) {
            const map = this.data.maps[i];
            const row = tbody.insertRow();
            const mapTimeMs = MapSpan.mapTimePlusIdle(map.span);
            const mapTimeFormatted = this.formatDuration(mapTimeMs);
            
            const mapNameCell = row.insertCell();
            const mapNameLink = document.createElement('a');
            mapNameLink.href = '#';
            mapNameLink.textContent = MapInstance.label(map);
            mapNameLink.addEventListener('click', (e) => {
                e.preventDefault();
                this.mapDetailModal.show(map, this.data!);
            });
            mapNameCell.appendChild(mapNameLink);

            const eventsCell = row.insertCell();
            this.renderEvents(eventsCell, map);

            row.insertCell().textContent = mapTimeFormatted;
            row.insertCell().textContent = new Date(map.span.start).toLocaleString();
            row.insertCell().textContent = map.areaLevel.toString();
            row.insertCell().textContent = this.data!.characterAggregation.guessLevelEvent(map.span.start)?.detail.level.toString() || '?';
        }

        this.element.innerHTML = '';
        this.element.appendChild(table);
    }

    private renderEvents(cell: HTMLTableCellElement, map: MapInstance): void {
        if (!this.data) return;

        const {loIx, hiIx} = binarySearchRange(this.data.events, map.span.start, map.span.end, (e) => e.ts);
        if (loIx === -1) return;

        const relevantEvents: LogEvent[] = [];
        let eventsHTML = "";
        for (let i = loIx; i < hiIx + 1; i++) {
            const event = this.data.events[i];
            if (!relevantEventNames.has(event.name)) continue;
            
            relevantEvents.push(event);
            const meta = getEventMeta(event);
            let iconColorClass = meta.color;
            switch (meta) {
                case eventMeta.death:
                case eventMeta.levelUp:
                    if (!this.data.characterAggregation.isOwned(event.detail.character)) {
                        iconColorClass = "text-secondary";
                    }
                    break;
            }
            eventsHTML += `<i class='bi ${meta.icon} ${iconColorClass}' data-e-ix='${relevantEvents.length - 1}'></i> `;
        }
        cell.innerHTML = eventsHTML;
        this.tooltip.hook(cell, (inner, e) => {
            const targetElement = e.target as HTMLElement;
            if (targetElement.tagName !== 'I') return;

            const eventIxStr = targetElement.dataset.eIx;
            if (!eventIxStr) return;

            const event = relevantEvents[parseInt(eventIxStr)];
            if (!event) return;

            inner.querySelector('.event-offset')!.textContent = this.formatDuration(event.ts - map.span.start);
            inner.querySelector('.event-label')!.textContent = getEventMeta(event).label(event as any);
            return targetElement;
        });
    }

    private formatDuration(ms: number): string {
        const totalSeconds = Math.max(0, Math.floor(ms / 1000));
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;

        const sStr = seconds.toString().padStart(2, '0');
        const mStr = minutes.toString().padStart(2, '0');

        if (hours > 0) {
            const hStr = hours.toString().padStart(2, '0');
            return `${hStr}:${mStr}:${sStr}`;
        } else {
            return `${mStr}:${sStr}`;
        }
    }
} 