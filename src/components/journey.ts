import { MapInstance, MapSpan } from '../log-tracker';
import { LogAggregation } from '../aggregation';
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
}

const journeyEventNames = new Set<EventName>([
    "death",
    "levelUp",
    "bossKill",
    "passiveGained",
    "mapReentered",
    "joinedArea",
    "leftArea",
    "tradeAccepted",
    "msgParty"
]);

export class JourneyComponent extends BaseComponent<LogAggregation> {

    private actDefinitions: ActDefinition[] = [
        { name: 'Act 1', maps: [] },
        { name: 'Act 2', maps: [] },
        { name: 'Act 3', maps: [] },
        { name: 'Act 4', maps: [] },
        { name: 'Act 5', maps: [] },
        { name: 'Act 6', maps: [] },
        { name: 'Endgame', maps: [] }
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

    private categorizeMaps(): void {
        this.actDefinitions.forEach(act => act.maps = []);
        const endgameNumber = this.actDefinitions.length;
        for (const map of this.data!.maps) {
            const zoneInfo = getZoneInfo(map.name);
            const actNumber = zoneInfo?.act ?? endgameNumber;
            this.actDefinitions[actNumber - 1].maps.push(map);
        }
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
            pillButton.textContent = `${act.name} (${act.maps.length})`;

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
        table.className = 'table table-sm table-striped caption-top journey-campaign-table';
        table.innerHTML = `
            <thead>
                <tr>
                    <th class="col-3">Area</th>
                    <th class="col">Events</th>
                    <th class="col-1">Time Spent</th>
                    <th class="col-2">Entered At</th>
                    <th class="col-1">Area Level</th>
                    <th class="col-1">Char Level</th>
                </tr>
            </thead>
            <tbody class="align-middle"></tbody>
        `;

        const tbody = table.querySelector('tbody');
        if (!tbody) return;

        const characterLevelIndex = this.data!.characterAggregation.characterLevelIndex;
        actData.maps.forEach((map) => {
            const row = tbody.insertRow();
            const mapTimeMs = MapSpan.mapTimePlusIdle(map.span);
            const mapTimeFormatted = this.formatDuration(mapTimeMs);
            const prevLevelUpIx = binarySearch(characterLevelIndex, map.span.start, (e) => e.ts, BinarySearchMode.LAST);
            let prevLevelUpEvent = characterLevelIndex[prevLevelUpIx];
            let nextLevelUpEvent = characterLevelIndex[prevLevelUpIx + 1];
            let levelUpEvent;
            if (!prevLevelUpEvent) {
                // first character ever
                levelUpEvent = LevelUpEvent.of(map.span.start, "?", "?", 1);
            } else {
                const prevLevel = prevLevelUpEvent.detail.level;
                const nextLevel = nextLevelUpEvent?.detail?.level;
                if (nextLevel && prevLevel + 1 !== nextLevel) {
                    // either or both levelUpEvents do not belong to the character that is in this map
                    let heuristicLevel;
                    if (map.areaLevel === 1) {
                        // new character, necessarily implied
                        heuristicLevel = 1;
                    } else {
                        if (nextLevel && typeof nextLevel === 'number') {
                            heuristicLevel = Math.abs(map.areaLevel - nextLevel) < Math.abs(map.areaLevel - prevLevel) ? nextLevel -1 : prevLevel;
                        } else {
                            heuristicLevel = prevLevel; 
                        }
                    }
                    levelUpEvent = LevelUpEvent.of(map.span.start, "?", "?", heuristicLevel);
                } else {
                    levelUpEvent = prevLevelUpEvent;
                }
            }

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
        });

        contentContainer.appendChild(table);
    }

    private renderEvents(cell: HTMLTableCellElement, map: MapInstance): void {
        const {loIx, hiIx} = binarySearchRange(this.data!.events, map.span.start, map.span.end, (e) => e.ts);
        const events: LogEvent[] = [];
        let eventsHTML = "";
        for (let i = loIx; i < hiIx; i++) {
            const event = this.data!.events[i];
            if (!journeyEventNames.has(event.name)) continue;
            
            events.push(event);
            const meta = getEventMeta(event);
            let iconColorClass = meta.color;
            switch (meta) {
                case eventMeta.death:
                case eventMeta.levelUp:
                    if (event.detail && 'character' in event.detail && 
                        !this.data!.characterAggregation.characters.has((event.detail as any).character)) {
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