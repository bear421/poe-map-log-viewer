import { MapInstance, MapSpan } from '../log-tracker';
import { BaseComponent } from './base-component';
import { binarySearch, BinarySearchMode, binarySearchRange } from '../binary-search';
import { eventMeta, getEventMeta, LevelUpEvent, EventName, LogEvent } from '../log-events';
import { MapDetailComponent } from './map-detail';
import { getZoneInfo } from '../data/zone_table';
import { createElementFromHTML } from '../util';

declare var Popper: any;

interface ActDefinition {
    name: string;
    maps: MapInstance[];
    duration: number;
}

const journeyEventNames = new Set<EventName>([
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

export class JourneyComponent extends BaseComponent {

    private actDefinitions: ActDefinition[] = [
        { name: 'Act 1', maps: [], duration: 0 },
        { name: 'Act 2', maps: [], duration: 0 },
        { name: 'Act 3', maps: [], duration: 0 },
        { name: 'Act 4', maps: [], duration: 0 },
        { name: 'Act 5', maps: [], duration: 0 },
        { name: 'Act 6', maps: [], duration: 0 },
        { name: 'Endgame', maps: [], duration: 0 }
    ];

    private currentActIndex: number = 0;
    private mapDetailModal: MapDetailComponent;
    private tooltipElement: HTMLElement | null = null;
    private popperInstance: any | null = null;
    private popperTarget: HTMLElement | null = null;

    constructor(container: HTMLElement) {
        super(document.createElement('div'), container);
        this.element.className = 'journey-component-container mt-3';
        this.mapDetailModal = new MapDetailComponent();
    }

    protected render(): void {
        this.mapDetailModal.updateData(this.data!);
        this.mapDetailModal.setApp(this.app!);
        this.element.innerHTML = `
            <ul class="nav nav-pills mb-3" id="journeyActPills" role="tablist"></ul>
            <div class="tab-content" id="journeyActContent"></div>
        `;
        this.categorizeMaps();
        this.renderPills();
        this.renderTableForCurrentAct();
    }

    private categorizeMaps(): void {
        this.actDefinitions.forEach(a => {
            a.maps = [];
            a.duration = 0;
        });
        const endgameNumber = this.actDefinitions.length;
        for (const map of this.data!.maps) {
            const zoneInfo = getZoneInfo(map.name, map.areaLevel);
            const actNumber = zoneInfo?.act ?? endgameNumber;
            this.actDefinitions[actNumber - 1].maps.push(map);
        }
        for (const act of this.actDefinitions) {
            if (act.maps.length === 1) {
                act.duration = MapSpan.mapTimePlusIdle(act.maps[0].span);
            } else if (act.maps.length > 1) {
                act.duration = act.maps.reduce((acc, map) => acc + MapSpan.mapTimePlusIdle(map.span), 0);
            }
        }
    }

    private renderPills(): void {
        const pillsContainer = this.element.querySelector('#journeyActPills');
        if (!pillsContainer) return;

        pillsContainer.innerHTML = '';

        this.actDefinitions.forEach((act, index) => {
            const pillItem = document.createElement('li');
            pillItem.className = 'nav-item';
            pillItem.setAttribute('role', 'presentation');

            const pillButton = document.createElement('button');
            pillButton.className = `nav-link ${index === this.currentActIndex ? 'active' : ''}`;
            pillButton.id = `journey-act-${index}-tab-btn`;
            pillButton.type = 'button';
            pillButton.setAttribute('role', 'tab');
            pillButton.textContent = `${act.name} (${this.formatDuration(act.duration)})`;

            pillButton.addEventListener('click', (event) => {
                event.preventDefault();
                this.currentActIndex = index;
                this.render();
            });

            pillItem.appendChild(pillButton);
            pillsContainer.appendChild(pillItem);
        });
    }

    private renderTableForCurrentAct(): void {
        const contentContainer = this.element.querySelector('#journeyActContent');
        if (!contentContainer) return;

        contentContainer.innerHTML = '';

        const actData = this.actDefinitions[this.currentActIndex];
        if (!actData || actData.maps.length === 0) {
            contentContainer.innerHTML = `<p class="text-center mt-3">No maps recorded for ${actData?.name || 'this section'}.</p>`;
            return;
        }

        const table = document.createElement('table');
        table.className = 'table table-sm table-striped table-fixed caption-top journey-campaign-table';
        table.innerHTML = `
            <thead>
                <tr>
                    <th class="th-area">Area</th>
                    <th class="th-events">Events</th>
                    <th class="th-time-spent">Time Spent</th>
                    <th class="th-entered-at">Entered At</th>
                    <th class="th-area-level">Area Level</th>
                    <th class="th-char-level">Char Level</th>
                </tr>
            </thead>
            <tbody class="align-middle"></tbody>
        `;

        const tbody = table.querySelector('tbody') as HTMLTableSectionElement;
        for (let i = 0; i < actData.maps.length; i++) {
            const map = actData.maps[i];
            const row = tbody.insertRow();
            const mapTimeMs = MapSpan.mapTimePlusIdle(map.span);
            const mapTimeFormatted = this.formatDuration(mapTimeMs);
            let levelUpEvent = this.data!.characterAggregation.guessLevelEvent(map.span.start)!;
            const mapNameCell = row.insertCell();
            const mapNameLink = document.createElement('a');
            mapNameLink.href = '#';
            mapNameLink.textContent = MapInstance.label(map);
            mapNameLink.title = 'Click to see map timeline';
            mapNameLink.addEventListener('click', (e) => {
                e.preventDefault();
                this.mapDetailModal.show(map, this.data!);
            });
            mapNameCell.appendChild(mapNameLink);
            this.renderEvents(row.insertCell(), map);
            row.insertCell().textContent = mapTimeFormatted;
            row.insertCell().textContent = new Date(map.span.start).toLocaleString();
            row.insertCell().textContent = map.areaLevel.toString();
            row.insertCell().textContent = levelUpEvent.detail.level.toString();
            {
                let nextMap;
                if (i < actData.maps.length - 1) {
                    nextMap = actData.maps[i + 1];
                } else if (this.actDefinitions[this.currentActIndex + 1]?.maps[0]) {
                    nextMap = this.actDefinitions[this.currentActIndex + 1]!.maps[0];
                }
                if (nextMap) {
                    const gap = nextMap.span.start - map.span.end!;
                    if (gap > 0) {
                        // FIXME gapped maps that succeed subsequent maps (in higher acts) should not be part of the journey
                        const gapRow = tbody.insertRow();
                        gapRow.classList.add('table-dark');
                        gapRow.insertCell().textContent = `Gap`;
                        gapRow.insertCell();
                        gapRow.insertCell().textContent = this.formatDuration(gap);
                        gapRow.insertCell().textContent = new Date(map.span.end!).toLocaleString();
                        gapRow.insertCell();
                        gapRow.insertCell();
                    }
                }
            }
        }
        contentContainer.appendChild(table);
    }

    private renderEvents(cell: HTMLTableCellElement, map: MapInstance): void {
        const {loIx, hiIx} = binarySearchRange(this.data!.events, map.span.start, map.span.end, (e) => e.ts);
        if (loIx === -1) return;

        const events: LogEvent[] = [];
        let eventsHTML = "";
        for (let i = loIx; i < hiIx + 1; i++) {
            const event = this.data!.events[i];
            if (!journeyEventNames.has(event.name)) continue;
            
            events.push(event);
            const meta = getEventMeta(event);
            let iconColorClass = meta.color;
            switch (meta) {
                case eventMeta.death:
                case eventMeta.levelUp:
                    if (!this.data!.characterAggregation.isOwned(event.detail.character)) {
                        iconColorClass = "text-secondary";
                    }
                    break;
            }
            eventsHTML += `<i class='bi ${meta.icon} ${iconColorClass}' data-event-ix='${events.length - 1}'></i> `;
        }
        cell.innerHTML = eventsHTML;

        cell.addEventListener('mouseover', (e) => {
            const targetElement = e.target as HTMLElement;
            if (targetElement.tagName !== 'I') return;

            const eventIxStr = targetElement.dataset.eventIx;
            if (eventIxStr) {
                const event = events[parseInt(eventIxStr)];
                if (!event) return;

                const tooltipElement = this.ensureTooltipElement();
                const offsetDuration = this.formatDuration(event.ts - map.span.start);
                const tooltipInner = tooltipElement.querySelector('.tooltip-inner') as HTMLElement;
                tooltipInner.querySelector('.event-offset')!.textContent = offsetDuration;
                tooltipInner.querySelector('.event-label')!.textContent = getEventMeta(event).label(event as any);
                this.popperTarget = targetElement;

                if (!this.popperInstance) {
                    const virtualRef = {
                        getBoundingClientRect: () => this.popperTarget!.getBoundingClientRect()
                    };
                    this.popperInstance = Popper.createPopper(virtualRef, tooltipElement, {
                        placement: 'top',
                        modifiers: [
                            {
                                name: 'offset',
                                options: {
                                    offset: [0, 8],
                                },
                            },
                            {
                                name: 'arrow', 
                                options: {
                                    element: tooltipElement.querySelector('.tooltip-arrow'),
                                    padding: 4,
                                }
                            },
                            {
                                name: 'preventOverflow',
                                options: { padding: 8 },
                            },
                            {
                                name: 'flip',
                                options: { fallbackPlacements: ['bottom', 'left', 'right'] },
                            }
                        ],
                    });
                } else {
                    this.popperInstance.update();
                }
                tooltipElement.classList.add('show');
            }
        });

        cell.addEventListener('mouseout', (e) => {
            const targetElement = e.target as HTMLElement;
            if (targetElement.tagName !== 'I') return;

            this.tooltipElement!.classList.remove('show');
        });
    }

    private ensureTooltipElement(): HTMLElement {
        if (!this.tooltipElement) {
            this.tooltipElement = createElementFromHTML(`
                <div class="tooltip journey-event-tooltip bs-tooltip-auto fade hide" role="tooltip">
                    <div class="tooltip-arrow"></div>
                    <div class="tooltip-inner">
                        <span class="event-offset text-light"></span>
                        <span class="event-label"></span>
                    </div>
                </div>
            `);
            document.body.appendChild(this.tooltipElement);
        }
        return this.tooltipElement;
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