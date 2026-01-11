import { MapInstance, AreaType, MapMarkerType } from '../ingest/log-tracker';
import { binarySearchRange } from '../binary-search';
import { eventMeta, getEventMeta, LogEvent } from '../ingest/events';
import { BaseComponent } from './base-component';
import { MapDetailComponent } from './map-detail';
import { createElementFromHTML, DynamicTooltip } from '../util';
import { VirtualScroll } from '../virtual-scroll';
import { LogAggregationCube, relevantEventNames } from '../aggregate/aggregation';
import { IdentityCachingMapSorter, MapField, MapOrder } from '../aggregate/map';
import { MultiSelectComponent, MultiSelectOption } from './multi-select';

const ROW_HEIGHT = 33; // Fixed height for each row
const BUFFER_ROWS = 10; // Number of extra rows to render above/below visible area

export class MapListComponent extends BaseComponent {
    private mapDetailModal: MapDetailComponent;
    private tooltip: DynamicTooltip = new DynamicTooltip(`<span class="event-offset"></span> <span class="event-label"></span>`);
    
    private virtualScrollContainer: HTMLDivElement | null = null;
    private virtualScrollContent: HTMLDivElement | null = null;
    private virtualScrollSpacer: HTMLDivElement | null = null;
    private tableElement: HTMLTableElement | null = null;
    private tbodyElement: HTMLTableSectionElement | null = null;

    private isVirtualScrollEnabled: boolean = false;
    private virtualScroller: VirtualScroll;
    private maps: MapInstance[] = [];
    private manualMaps?: MapInstance[];
    private sorter?: IdentityCachingMapSorter;
    private order: MapOrder;
    private selectedTimeContributors: Set<MapMarkerType> = new Set([
        MapMarkerType.map,
        MapMarkerType.load,
        MapMarkerType.hideout,
        MapMarkerType.afk,
        MapMarkerType.pause,
        MapMarkerType.complete,
    ]);

    constructor(container: HTMLElement, private readonly autoLoadMaps: boolean = true, initialOrder: MapOrder = {field: MapField.startedTs, ascending: false}) {
        super(createElementFromHTML(`
            <div class="map-list-container mt-3">
                <div class="map-list-controls"></div>
                <div class="map-list-content"></div>
            </div>
        `) as HTMLDivElement, container);
        this.mapDetailModal = new MapDetailComponent();
        this.virtualScroller = new VirtualScroll(
            ROW_HEIGHT,
            BUFFER_ROWS,
            (startIndex, endIndex) => this.renderVirtualScrollRows(startIndex, endIndex)
        );
        if (!this.autoLoadMaps) {
            this.sorter = new IdentityCachingMapSorter();
        }
        const controls = this.element.querySelector('.map-list-controls') as HTMLDivElement;
        const timeContributorContainer = createElementFromHTML(`<div class="row"><div class="col-4"></div></div>`);
        controls.appendChild(timeContributorContainer);

        const options: MultiSelectOption<MapMarkerType>[] = [
            { value: MapMarkerType.map, name: 'Active Map Time', icon: 'bi-clock text-dark' },
            { value: MapMarkerType.load, name: 'Load Time', icon: eventMeta.areaPostLoad.icon + ' ' + eventMeta.areaPostLoad.color },
            { value: MapMarkerType.hideout, name: 'Hideout Time', icon: eventMeta.hideoutEntered.icon + ' ' + eventMeta.hideoutEntered.color },
            { value: MapMarkerType.afk, name: 'AFK Time', icon: eventMeta.afkModeOn.icon + ' ' + eventMeta.afkModeOn.color },
        ];

        const timeContributorSelect = new MultiSelectComponent(
            timeContributorContainer.firstElementChild as HTMLElement,
            'Time Contributors',
            options,
            Array.from(this.selectedTimeContributors),
            (selected) => {
                this.selectedTimeContributors = selected;
                this.order.timeContributors = selected;
                this.updateMapView();
            }
        );
        timeContributorSelect.setParentComponent(this);
        this.order = initialOrder;
    }

    private renderVirtualScrollRows(startIndex: number, endIndex: number): void {
        if (!this.tbodyElement) return;

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

        if (this.autoLoadMaps) {
            this.maps = this.data.getMapsSorted(this.order);
        } else if (this.manualMaps) {
            this.maps = this.sorter!.sortMaps(this.manualMaps, this.order, this.data);
        }
        this.mapDetailModal.updateData(this.data);
        this.mapDetailModal.setApp(this.app!);
        this.updateMapView();
    }

    public async updateData(newData: LogAggregationCube, maps?: MapInstance[]): Promise<void> {
        if (maps) {
            if (this.autoLoadMaps) throw new Error("cannot set maps when autoLoadMaps is true");

            this.manualMaps = maps;
        }
        await super.updateData(newData);
    }

    private updateMapView(): void {
        const contentContainer = this.element.querySelector('.map-list-content') as HTMLDivElement;
        
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

        this.tableElement!.querySelector('thead')!.addEventListener('click', (e) => this.handleHeaderClick(e));
        this.updateSortIndicator();

        if (this.tbodyElement) {
            this.hookContainer(this.tbodyElement);
        }
    }

    private handleHeaderClick(e: MouseEvent): void {
        const target = e.target as HTMLElement;
        const th = target.closest('th');
        if (!th) return;

        const fieldStr = th.dataset.field;
        if (fieldStr === undefined) return;

        const field = parseInt(fieldStr, 10) as MapField;

        if (this.order.field === field) {
            this.order.ascending = !this.order.ascending;
        } else {
            this.order.field = field;
            this.order.ascending = (field === MapField.name);
        }
        this.render();
    }
    
    private updateSortIndicator(): void {
        if (!this.tableElement) return;

        this.tableElement.querySelectorAll('th .sort-indicator').forEach(icon => icon.remove());

        const th = this.tableElement.querySelector(`th[data-field="${this.order.field}"]`);
        if (th) {
            const iconClass = this.order.ascending ? 'bi-arrow-up' : 'bi-arrow-down';
            const icon = createElementFromHTML(`<span class="sort-indicator"> <i class="bi ${iconClass}"></i></span>`);
            th.appendChild(icon);
        }
    }
    
    private createScaffolding(rowCount: number): { table: HTMLTableElement, tbody: HTMLTableSectionElement } {
        const table = createElementFromHTML(`
            <table class="table table-sm table-striped table-fixed caption-top map-list-table">
                <thead>
                    <tr>
                        <th class="th-area sortable" data-field="${MapField.name}">Area</th>
                        <th class="th-events">Events</th>
                        <th class="th-time-spent sortable" data-field="${MapField.mapTime}">Time</th>
                        <th class="th-entered-at sortable" data-field="${MapField.startedTs}">Entered At</th>
                        <th class="th-area-level sortable" data-field="${MapField.areaLevel}">Area Lvl</th>
                        <th class="th-char-level sortable" data-field="${MapField.startLevel}">Char Lvl</th>
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
            row.cells[2].textContent = this.formatDuration(map.getTime(this.selectedTimeContributors));
            row.cells[3].textContent = this.formatTs(map.start);
            row.cells[4].textContent = map.areaLevel.toString();
            row.cells[5].textContent = this.data!.characterAggregation.guessLevel(map.start).toString();
        }
    }
    
    private renderEventsHTML(map: MapInstance): string {
        const {loIx, hiIx} = binarySearchRange(this.data!.events, map.start, map.end, (e) => e.ts);
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

                    const { loIx, hiIx } = binarySearchRange(this.data.events, map.start, map.end, (ev) => ev.ts);
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
                                const eventTimeOffsetMs = currentEventForTooltip.ts - map.start;
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