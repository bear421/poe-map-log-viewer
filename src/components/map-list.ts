import { MapInstance, MapSpan, AreaType } from '../ingest/log-tracker';
import { binarySearchRange } from '../binary-search';
import { eventMeta, getEventMeta, EventName, LogEvent } from '../ingest/events';
import { BaseComponent } from './base-component';
import { MapDetailComponent } from './map-detail';
import { createElementFromHTML, DynamicTooltip } from '../util';
import { VirtualScroll } from '../virtual-scroll';
import { BitSet } from '../bitset';
import { relevantEventNames } from '../aggregate/aggregation';

const ROW_HEIGHT = 33; // Fixed height for each row
const BUFFER_ROWS = 10; // Number of extra rows to render above/below visible area

export class MapListComponent extends BaseComponent {
    private mapDetailModal: MapDetailComponent;
    private tooltip: DynamicTooltip = new DynamicTooltip(`<span class="event-offset"></span> <span class="event-label"></span>`);
    
    private allMaps: MapInstance[] = [];
    private maps: MapInstance[] = [];

    private virtualScrollContainer: HTMLDivElement | null = null;
    private virtualScrollContent: HTMLDivElement | null = null;
    private virtualScrollSpacer: HTMLDivElement | null = null;
    private tableElement: HTMLTableElement | null = null;
    private tbodyElement: HTMLTableSectionElement | null = null;

    private isVirtualScrollEnabled: boolean = false;
    private virtualScroller: VirtualScroll;

    // Filtering properties
    private mapCountSpan: HTMLSpanElement | null = null;
    private filterContainer: HTMLDivElement | null = null;
    private selectedEvents: Set<EventName> = new Set();

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

        console.log('renderVirtualScrollRows', startIndex, endIndex);
        const maps = this.maps;
        if (maps.length === 0) {
            console.log('maps is empty for range', startIndex, endIndex);
            this.tbodyElement.innerHTML = '';
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

    protected async render(): Promise<void> {
        if (!this.data) return;

        this.allMaps = this.data.reversedMaps;
        this.renderFilterUI();
        this.mapDetailModal.updateData(this.data);
        this.mapDetailModal.setApp(this.app!);
        this.applyFilters();
    }

    private renderFilterUI(): void {
        this.element.querySelector('.map-list-controls')?.remove();

        const controlsRow = createElementFromHTML('<div class="row map-list-controls mb-3"></div>');

        const mapCountContainer = createElementFromHTML(`
            <div class="col-md-4 fs-5">
                Showing <span class="map-count"></span> maps
            </div>
        `) as HTMLDivElement;
        this.mapCountSpan = mapCountContainer.querySelector('.map-count');
        controlsRow.appendChild(mapCountContainer);

        const areaTypeContainer = createElementFromHTML(`
            <div class="col-md-4"></div>
        `) as HTMLDivElement;
        controlsRow.appendChild(areaTypeContainer);

        this.filterContainer = createElementFromHTML(`
            <div class="facet-filter-container col-md-4 m-s-2 fs-5">
                <div class="position-relative">
                    <button class="btn btn-outline-primary facet-filter-toggle d-flex justify-content-between align-items-center">
                        <span>Events</span>
                        <i class="bi bi-chevron-down"></i>
                    </button>
                    <div class="facet-filter-options shadow-sm mt-1"></div>
                </div>
            </div>
        `) as HTMLDivElement;
        
        const optionsContainer = this.filterContainer.querySelector('.facet-filter-options') as HTMLDivElement;

        for (const eventName of relevantEventNames) {
            const filterId = `filter-${eventName}`;
            const meta = eventMeta[eventName];
            const isChecked = this.selectedEvents.has(eventName);
            const element = createElementFromHTML(`
                <div class="form-check">
                    <input class="form-check-input" type="checkbox" id="${filterId}" value="${eventName}" ${isChecked ? 'checked' : ''}>
                    <label class="form-check-label" for="${filterId}">
                        <span class="facet-label-content">
                            <i class="${meta.icon} ${meta.color}"></i>
                            ${meta.name}
                        </span>
                        <span class="facet-count-container"><span class="facet-count">0</span></span>
                    </label>
                </div>
            `);
            optionsContainer.appendChild(element);
        }

        const toggleButton = this.filterContainer.querySelector('.facet-filter-toggle') as HTMLButtonElement;
        
        toggleButton.addEventListener('click', (e) => {
            e.stopPropagation();
            optionsContainer.classList.toggle('active');
        });

        document.addEventListener('click', () => {
            optionsContainer.classList.remove('active');
        });

        optionsContainer.addEventListener('click', (e) => {
            e.stopPropagation();
        });

        optionsContainer.addEventListener('change', (e) => {
            const target = e.target as HTMLInputElement;
            if (target.type === 'checkbox') {
                if (target.checked) {
                    this.selectedEvents.add(target.value as EventName);
                } else {
                    this.selectedEvents.delete(target.value as EventName);
                }
                this.applyFilters();
            }
        });

        controlsRow.appendChild(this.filterContainer);
        this.element.appendChild(controlsRow);
    }
    
    private applyFilters(): void {
        const eventBitSetIndex = this.data!.eventBitSetIndex;
        let resultBitSet: BitSet | undefined;
        if (this.selectedEvents.size === 0) {
            this.maps = this.allMaps;
            resultBitSet = undefined;
        } else {
            const selectedEventNames = Array.from(this.selectedEvents);
            resultBitSet = eventBitSetIndex.get(selectedEventNames[0])!.clone();
    
            for (let i = 1; i < selectedEventNames.length; i++) {
                const nextBitset = eventBitSetIndex.get(selectedEventNames[i])!;
                resultBitSet = resultBitSet.and(nextBitset);
            }
    
            this.maps = this.allMaps.filter((m) => resultBitSet!.get(m.id));
        }
    
        if (this.maps.length === this.allMaps.length) {
            this.mapCountSpan!.textContent = `${this.allMaps.length}`;
        } else {
            this.mapCountSpan!.textContent = `${this.maps.length} / ${this.allMaps.length}`;
        }

        for (const eventName of relevantEventNames) {
            const eventBitSet = eventBitSetIndex.get(eventName)!;
            const next = resultBitSet ? resultBitSet.and(eventBitSet) : eventBitSet;
            const count = next.cardinality();
            
            const countSpan = this.filterContainer!.querySelector(`#filter-${eventName}`)?.nextElementSibling?.querySelector('.facet-count');
            if (countSpan) {
                countSpan.textContent = count.toString();
            }
        }
        this.updateMapView();
    }

    private updateMapView(): void {
        const contentContainer = this.element;
        
        // Detach listener and remove old elements
        this.virtualScroller.detach();
        this.virtualScrollContainer?.remove();
        this.tableElement?.remove();

        const maps = this.maps;
        this.isVirtualScrollEnabled = maps.length >= 500;

        const handleRowClick = (e: MouseEvent) => {
            e.preventDefault();
            const target = e.target as HTMLElement;
            if (target.tagName === 'A') {
                const mIx = target.closest('tr')?.dataset.mIx;
                if (mIx) {
                    const map = this.maps[parseInt(mIx, 10)];
                    if (map) this.mapDetailModal.show(map, this.data!);
                }
            }
        };

        if (this.isVirtualScrollEnabled) {
            this.virtualScrollContainer = createElementFromHTML(
                `<div class="virtual-scroll-container">
                    <div class="virtual-scroll-spacer"></div>
                    <div class="virtual-scroll-content"></div>
                </div>`
            ) as HTMLDivElement;
            this.virtualScrollSpacer = this.virtualScrollContainer.querySelector('.virtual-scroll-spacer') as HTMLDivElement;
            this.virtualScrollContent = this.virtualScrollContainer.querySelector('.virtual-scroll-content') as HTMLDivElement;
            
            const { table, tbody } = this.createScaffolding(100 + BUFFER_ROWS * 2);
            this.tableElement = table;
            this.tbodyElement = tbody;
            tbody.addEventListener('click', handleRowClick);

            this.virtualScrollContent.appendChild(this.tableElement);
            contentContainer.appendChild(this.virtualScrollContainer);

            this.virtualScroller.initialize(
                this.virtualScrollContainer,
                this.virtualScrollContent,
                this.virtualScrollSpacer
            );
            this.virtualScroller.attach();
            this.virtualScroller.updateData(maps.length);
        } else {
            const { table, tbody } = this.createScaffolding(maps.length);
            this.tableElement = table;
            this.tbodyElement = tbody;
            tbody.addEventListener('click', handleRowClick);
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
        if (rowCount > 0) {
            tbody.innerHTML = `<tr><td><a href="#"></a></td>${"<td></td>".repeat(5)}</tr>`.repeat(rowCount);
        } else {
            tbody.innerHTML = '';
        }
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
            const mapIndexInFiltered = startIx + i;
            const map = maps[mapIndexInFiltered];
    
            const rowIndexInTarget = targetRowStartIndexInTbody + i;
            
            // Ensure the target row exists. This is crucial for the virtual viewport.
            if (rowIndexInTarget >= targetTbody.rows.length) {
                console.warn(`MapListComponent: renderMapRange trying to access row ${rowIndexInTarget} but tbody only has ${targetTbody.rows.length} rows. Skipping further rendering for this call.`);
                throw new Error("REMOVE ME?");
                break; 
            }
            const row = targetTbody.rows[rowIndexInTarget] as HTMLTableRowElement;
    
            if (!map) { 
                row.style.display = 'none'; // Hide row if map data is missing
                continue; 
            }
            row.style.display = ''; // Ensure row is visible if map data exists
    
            row.dataset.mIx = mapIndexInFiltered.toString(); 
    
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