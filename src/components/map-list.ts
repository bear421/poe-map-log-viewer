import { MapInstance, MapSpan, AreaType } from '../ingest/log-tracker';
import { LogEvent } from '../ingest/events';
import { binarySearchRange } from '../binary-search';
import { eventMeta, getEventMeta, EventName } from '../ingest/events';
import { BaseComponent } from './base-component';
import { MapDetailComponent } from './map-detail';
import { createElementFromHTML, DynamicTooltip } from '../util';
import { VirtualScroll } from '../virtual-scroll';

const relevantEventNames = new Set<EventName>([
    "death",
    "levelUp",
    "bossKill",
    "passiveGained",
    "passiveAllocated",
    "passiveUnallocated",
    "bonusGained",
    "mapReentered",
    "joinedArea",
    "leftArea",
    "tradeAccepted",
    "msgParty",
    "hideoutEntered"
]);

const ROW_HEIGHT = 33; // Fixed height for each row
const BUFFER_ROWS = 10; // Number of extra rows to render above/below visible area

export class MapListComponent extends BaseComponent {
    private mapDetailModal: MapDetailComponent;
    private tooltip: DynamicTooltip = new DynamicTooltip(`<span class="event-offset"></span> <span class="event-label"></span>`);
    private maps: MapInstance[] = [];

    private virtualScrollContainer: HTMLDivElement | null = null;
    private virtualScrollContent: HTMLDivElement | null = null;
    private virtualScrollSpacer: HTMLDivElement | null = null;
    private tableElement: HTMLTableElement | null = null;
    private tbodyElement: HTMLTableSectionElement | null = null;

    private isVirtualScrollEnabled: boolean = false;
    private virtualScroller: VirtualScroll;

    constructor(container: HTMLElement) {
        super(createElementFromHTML('<div class="map-list-container mt-3">') as HTMLDivElement, container);
        this.mapDetailModal = new MapDetailComponent();
        this.virtualScroller = new VirtualScroll(
            ROW_HEIGHT,
            BUFFER_ROWS,
            (startIndex, endIndex) => this.renderVirtualScrollRows(startIndex, endIndex)
        );
    }

    private renderVirtualScrollRows(startIndex: number, endIndex: number): void {
        if (!this.tbodyElement) return;

        const maps = this.maps;
        if (maps.length === 0) {
            this.tbodyElement. innerHTML = '';
            return;
        }

        const count = endIndex - startIndex + 1;
        this.renderMapRange(startIndex, count, maps, this.tbodyElement, 0);

        const viewportCapacity = this.tbodyElement.rows.length;
        for (let i = 0; i < viewportCapacity; i++) {
            if (this.tbodyElement.rows[i]) {
                 (this.tbodyElement.rows[i] as HTMLElement).style.display = (i < count) ? '' : 'none';
            }
        }
    };

    protected render(): void {
        if (!this.data) return;

        this.mapDetailModal.updateData(this.data);
        this.mapDetailModal.setApp(this.app!);

        const contentContainer = this.element;
        contentContainer.innerHTML = '';
        // TODO add other orders + event filtering
        const maps = this.maps = this.data!.maps.toReversed();
        this.isVirtualScrollEnabled = maps.length >= 500;

        if (this.isVirtualScrollEnabled) {
            if (!this.virtualScrollContainer) {
                this.virtualScrollContainer = createElementFromHTML(`
                    <div class="virtual-scroll-container">
                        <div class="virtual-scroll-spacer"></div>
                        <div class="virtual-scroll-content"></div>
                    </div>`
                ) as HTMLDivElement;
                this.virtualScrollSpacer = this.virtualScrollContainer.querySelector('.virtual-scroll-spacer') as HTMLDivElement;
                this.virtualScrollContent = this.virtualScrollContainer.querySelector('.virtual-scroll-content') as HTMLDivElement;
                const {table, tbody} = this.createScaffolding(100 + BUFFER_ROWS * 2);
                this.tableElement = table;
                this.tbodyElement = tbody;
                tbody.addEventListener('click', (e) => {
                    e.preventDefault();
                    const target = e.target as HTMLElement;
                    if (target.tagName === 'A') {
                        const mapIx = parseInt(target.closest('tr')?.dataset.mIx!);
                        this.mapDetailModal.show(maps[mapIx], this.data!);
                    }
                });
                this.virtualScrollContent.appendChild(this.tableElement);
            }

            if (!this.virtualScrollContainer.isConnected) {
                contentContainer.appendChild(this.virtualScrollContainer);
            }
            
            this.virtualScroller.initialize(
                this.virtualScrollContainer!,
                this.virtualScrollContent!,
                this.virtualScrollSpacer!
            );
            // reset scroll position to the top BEFORE updating data
            if (this.virtualScrollContainer) { 
                this.virtualScrollContainer.scrollTop = 0;
            }
            this.virtualScroller.attach();
            this.virtualScroller.updateData(maps.length, ROW_HEIGHT);
        } else {
            this.virtualScroller.detach();
            this.isVirtualScrollEnabled = false;

            const { table, tbody } = this.createScaffolding(maps.length);
            this.tableElement = table;
            this.tbodyElement = tbody;
            tbody.addEventListener('click', (e) => {
                e.preventDefault();
                const target = e.target as HTMLElement;
                if (target.tagName === 'A') {
                    const mapIx = parseInt(target.closest('tr')?.dataset.mIx!);
                    this.mapDetailModal.show(maps[mapIx], this.data!);
                }
            });

            this.renderMapRange(0, maps.length, maps, this.tbodyElement, 0);
            contentContainer.appendChild(this.tableElement);
        }

        if (this.tbodyElement) {
            this.hookContainer(this.tbodyElement);
        }
    }
    
    private createScaffolding(rowCount: number): { table: HTMLTableElement, tbody: HTMLTableSectionElement } {
        const table = createElementFromHTML(`
            <table class="table table-sm table-striped table-fixed caption-top map-list-table">
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
            </table>
        `) as HTMLTableElement;
        const tbody = table.tBodies[0];
        tbody.innerHTML = `<tr><td><a href="#"></a></td>${"<td></td>".repeat(5)}</tr>`.repeat(rowCount);
        return { table, tbody };
    }

    private renderMapRange(
        startIx: number, 
        count: number,              
        maps: MapInstance[],    
        targetTbody: HTMLTableSectionElement, 
        targetRowStartIndexInTbody: number = 0 
    ): void {
        for (let i = 0; i < count; i++) {
            const mapIndexInSource = startIx + i;
            const map = maps[mapIndexInSource];
    
            const rowIndexInTarget = targetRowStartIndexInTbody + i;
            
            // Ensure the target row exists. This is crucial for the virtual viewport.
            if (rowIndexInTarget >= targetTbody.rows.length) {
                console.warn(`MapListComponent: renderMapRange trying to access row ${rowIndexInTarget} but tbody only has ${targetTbody.rows.length} rows. Skipping further rendering for this call.`);
                break; 
            }
            const row = targetTbody.rows[rowIndexInTarget] as HTMLTableRowElement;
    
            if (!map) { 
                row.style.display = 'none'; // Hide row if map data is missing
                continue; 
            }
            row.style.display = ''; // Ensure row is visible if map data exists
    
            row.dataset.mIx = mapIndexInSource.toString(); 
    
            const mapNameCell = row.cells[0];
            const mapNameLink = mapNameCell.childNodes[0] as HTMLAnchorElement;
            let icon: string;
            if (map.areaType === AreaType.Campaign) {
                icon = '<i class="bi bi-map text-dark"></i>';
            } else if (map.areaType === AreaType.Sanctum) {
                icon = '<i class="bi bi-hexagon text-dark"></i>';
            } else if (map.areaType === AreaType.Labyrinth) {
                icon = '<i class="bi bi-compass text-dark"></i>';
            } else if (map.isUnique) {
                icon = '<i class="bi bi-gem text-unique"></i>';
            } else if (map.hasBoss) {
                // icon = '<i class="bi bi-asterisk text-dark"></i>';
                icon = '<i class="bi bi-globe text-danger"></i>';
            } else {
                icon = '<i class="bi bi-globe text-dark"></i>';
            }
            mapNameLink.innerHTML = icon + ' ' + MapInstance.label(map);
            row.cells[1].innerHTML = this.renderEventsHTML(map); 
            row.cells[2].textContent = this.formatDuration(MapSpan.mapTimePlusIdle(map.span));
            row.cells[3].textContent = this.formatTs(map.span.start);
            row.cells[4].textContent = map.areaLevel.toString();
            row.cells[5].textContent = this.data!.characterAggregation.guessLevel(map.span.start).toString();
        }
    }
    
    private renderEventsHTML(map: MapInstance): string {
        const {loIx, hiIx} = binarySearchRange(this.data!.events, map.span.start, map.span.end, (e) => e.ts);
        if (loIx === -1) return "";

        let eventsHTML = "";
        let eIx = 0;
        for (let i = loIx; i < hiIx + 1; i++) {
            const event = this.data!.events[i];
            if (!relevantEventNames.has(event.name)) continue;
            
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
            eventsHTML += `<i class='bi ${meta.icon} ${iconColorClass}' data-e-ix='${eIx}'></i> `;
            eIx++;
        }
        return eventsHTML;
    }

    private hookContainer(container: HTMLElement): void {
        const maps = this.maps;
        container.addEventListener('mouseover', (e) => {
            const iconElement = e.target as HTMLElement;
            if (iconElement.tagName === 'I' && iconElement.dataset.eIx !== undefined && this.data) {
                const tr = iconElement.closest('tr');
                if (tr && tr.dataset.mIx !== undefined) {
                    const mapIndex = parseInt(tr.dataset.mIx);
                    const eventIndexInMapDisplay = parseInt(iconElement.dataset.eIx);

                    if (mapIndex >= maps.length) return;
                    
                    const map = maps[mapIndex];
                    if (!map) return;

                    const { loIx, hiIx } = binarySearchRange(this.data.events, map.span.start, map.span.end, (ev) => ev.ts);
                    if (loIx === -1) return;

                    let currentEventForTooltip: LogEvent | null = null;
                    let displayedEventCounter = 0;
                    for (let i = loIx; i <= hiIx; i++) {
                        const event = this.data.events[i];
                        if (!relevantEventNames.has(event.name)) continue;
                        
                        if (displayedEventCounter === eventIndexInMapDisplay) {
                            currentEventForTooltip = event;
                            break;
                        }
                        displayedEventCounter++;
                    }

                    if (currentEventForTooltip) {
                        const tooltipElement = this.tooltip.getTooltipElement();
                        const tooltipInner = tooltipElement.querySelector('.tooltip-inner') as HTMLElement;
                        
                        if (tooltipInner) {
                            const offsetSpan = tooltipInner.querySelector('.event-offset') as HTMLElement;
                            const labelSpan = tooltipInner.querySelector('.event-label') as HTMLElement;

                            if (offsetSpan && labelSpan) {
                                const eventTimeOffsetMs = currentEventForTooltip.ts - map.span.start;
                                offsetSpan.textContent = `${this.formatDuration(eventTimeOffsetMs)}`;
                                
                                const meta = getEventMeta(currentEventForTooltip);
                                labelSpan.textContent = meta.label(currentEventForTooltip as any);
                            }
                        }
                        this.tooltip.update(iconElement);
                        this.tooltip.show();
                    }
                }
            }
        });

        container.addEventListener('mouseout', (e) => {
            const iconElement = e.target as HTMLElement;
            if (iconElement.tagName === 'I' && iconElement.dataset.eIx !== undefined) {
                this.tooltip.hide();
            }
        });

        document.addEventListener('scroll', (_) => {
            this.tooltip.hide();
        });
    }

    private formatTs(ts: number): string {
        const date = new Date(ts);
        const fmt2d = (n: number) => n.toString().padStart(2, '0');
        return `${date.getFullYear()}-${fmt2d(date.getMonth() + 1)}-${fmt2d(date.getDate())} ${fmt2d(date.getHours())}:${fmt2d(date.getMinutes())}:${fmt2d(date.getSeconds())}`;
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