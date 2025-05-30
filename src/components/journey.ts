import { AreaType, MapInstance, MapSpan } from '../log-tracker';
import { BaseComponent } from './base-component';
import { binarySearchRange } from '../binary-search';
import { eventMeta, getEventMeta, EventName, LogEvent } from '../log-events';
import { MapDetailComponent } from './map-detail';
import { getZoneInfo } from '../data/zone_table';
import { LogAggregation } from '../aggregation';
import { createElementFromHTML, DynamicTooltip } from '../util';
import { VirtualScroll, VirtualScrollRenderCallback } from '../virtual-scroll';

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
    // "passiveGained",
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
const VIRTUAL_SCROLL_THRESHOLD = 250; // Number of maps after which virtual scroll is enabled

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
    private tooltip: DynamicTooltip = new DynamicTooltip(`<span class="event-offset"></span> <span class="event-label"></span>`);
    
    // Virtual Scroll related DOM elements managed by JourneyComponent
    private virtualScrollContainer: HTMLDivElement | null = null;
    private virtualScrollContent: HTMLDivElement | null = null;
    private virtualScrollSpacer: HTMLDivElement | null = null;
    private tableElement: HTMLTableElement | null = null;
    private tbodyElement: HTMLTableSectionElement | null = null;

    private isVirtualScrollEnabled: boolean = false;
    private virtualScroller: VirtualScroll;

    constructor(container: HTMLElement) {
        super(document.createElement('div'), container);
        this.element.className = 'journey-component-container mt-3';
        this.mapDetailModal = new MapDetailComponent();

        this.virtualScroller = new VirtualScroll(
            ROW_HEIGHT,
            BUFFER_ROWS,
            this.renderVirtualScrollRows
        );
    }

    private renderVirtualScrollRows: VirtualScrollRenderCallback = (startIndex, endIndex) => {
        if (!this.tbodyElement || !this.data) return;

        const actData = this.actDefinitions[this.currentActIndex];
        if (!actData || actData.maps.length === 0) {
            this.tbodyElement.innerHTML = ''; // Clear if no data for the act
            return;
        }

        const countToRender = endIndex - startIndex + 1;

        this.renderMapRange(
            startIndex,          // sourceMapStartIndex in actData.maps
            countToRender,       // number of maps to render
            actData.maps,        // the full list of maps for the current act
            this.tbodyElement,   // the viewport tbody
            0                    // targetRowStartIndexInTbody (populate from row 0 of viewport)
        );

        // Ensure correct rows are visible and others are hidden in the viewport
        const viewportCapacity = this.tbodyElement.rows.length;
        for (let i = 0; i < viewportCapacity; i++) {
            if (this.tbodyElement.rows[i]) { // Check if row exists
                 (this.tbodyElement.rows[i] as HTMLElement).style.display = (i < countToRender) ? '' : 'none';
            }
        }
    };

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

    private createScaffolding(rowCount: number): { table: HTMLTableElement, tbody: HTMLTableSectionElement } {
        const table = createElementFromHTML(`
            <table class="table table-sm table-striped table-fixed caption-top journey-campaign-table">
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

    public updateData(agg: LogAggregation): void {
        super.updateData(agg);
        if (this.isVisible) {
            this.render();
        }
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
                console.warn(`JourneyComponent: renderMapRange trying to access row ${rowIndexInTarget} but tbody only has ${targetTbody.rows.length} rows. Skipping further rendering for this call.`);
                break; 
            }
            const row = targetTbody.rows[rowIndexInTarget] as HTMLTableRowElement;
    
            if (!map) { 
                // console.warn(`JourneyComponent: renderMapRange skipping due to missing map at source index: ${mapIndexInSource}. Hiding row ${rowIndexInTarget}.`);
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
            row.cells[3].textContent = new Date(map.span.start).toLocaleString();
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
            if (!journeyEventNames.has(event.name)) continue;
            
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
                this.virtualScroller.detach(); // Detach listener from old context if any
                this.currentActIndex = index;
                this.tableElement = null; // Force table rebuild for the new act
                this.tbodyElement = null;
                this.virtualScroller.reset();
                this.render(); // This will call renderTableForCurrentAct, which will re-attach
            });

            pillItem.appendChild(pillButton);
            pillsContainer.appendChild(pillItem);
        });
    }

    private renderTableForCurrentAct(): void {
        const contentContainer = this.element.querySelector('#journeyActContent');
        if (!contentContainer) return;

        contentContainer.innerHTML = ''; // Clear previous content (e.g., old table or virtual scroll container)

        const actData = this.actDefinitions[this.currentActIndex];
        if (!actData || actData.maps.length === 0 || !this.data) {
            contentContainer.innerHTML = `<p class="text-center mt-3">No maps recorded for ${actData?.name || 'this section'}.</p>`;
            this.isVirtualScrollEnabled = false;
            this.virtualScroller.detach(); // Ensure listener is detached if we switch to non-virtual
            this.tableElement = null;
            this.tbodyElement = null;
            return;
        }

        this.isVirtualScrollEnabled = actData.maps.length >= VIRTUAL_SCROLL_THRESHOLD;

        if (this.isVirtualScrollEnabled) {
            // Ensure virtual scroll scaffolding elements are created if they don't exist
            if (!this.virtualScrollContainer) {
                this.virtualScrollContainer = document.createElement('div');
                this.virtualScrollContainer.className = 'virtual-scroll-container';
                this.virtualScrollContainer.style.position = 'relative'; // CSS handles margin-top

                this.virtualScrollSpacer = document.createElement('div');
                this.virtualScrollSpacer.className = 'virtual-scroll-spacer';

                this.virtualScrollContent = document.createElement('div');
                this.virtualScrollContent.className = 'virtual-scroll-content';
                this.virtualScrollContent.style.position = 'absolute';
                this.virtualScrollContent.style.width = '100%';

                this.virtualScrollContainer.appendChild(this.virtualScrollSpacer);
                this.virtualScrollContainer.appendChild(this.virtualScrollContent);
                const {table, tbody} = this.createScaffolding(100 + BUFFER_ROWS * 2);
                this.tableElement = table;
                this.tbodyElement = tbody;
                tbody.addEventListener('click', (e) => {
                    e.preventDefault();
                    const target = e.target as HTMLElement;
                    if (target.tagName === 'A') {
                        const mapIx = parseInt(target.closest('tr')?.dataset.mIx!);
                        this.mapDetailModal.show(actData.maps[mapIx], this.data!);
                    }
                });
                this.virtualScrollContent.appendChild(this.tableElement);
            }

            // Ensure the container is in the DOM
            if (!this.virtualScrollContainer.isConnected) {
                contentContainer.appendChild(this.virtualScrollContainer);
            }
            
            // Always re-initialize, reset scroll, then update data and attach
            this.virtualScroller.initialize(
                this.virtualScrollContainer!,
                this.virtualScrollContent!,
                this.virtualScrollSpacer!
            );
            // Reset scroll position to the top BEFORE updating data
            if (this.virtualScrollContainer) { 
                this.virtualScrollContainer.scrollTop = 0;
            }
            this.virtualScroller.updateData(actData.maps.length, ROW_HEIGHT);
            this.virtualScroller.attach();

        } else {
            // Regular table rendering for small datasets (non-virtual scroll)
            this.virtualScroller.detach(); // Ensure listener is detached
            this.isVirtualScrollEnabled = false;

            // Use createScaffolding for the current act's maps
            const { table, tbody } = this.createScaffolding(actData.maps.length);
            this.tableElement = table;
            this.tbodyElement = tbody;
            tbody.addEventListener('click', (e) => {
                e.preventDefault();
                const target = e.target as HTMLElement;
                if (target.tagName === 'A') {
                    const mapIx = parseInt(target.closest('tr')?.dataset.mIx!);
                    this.mapDetailModal.show(actData.maps[mapIx], this.data!);
                }
            });

            // Populate the scaffolded rows using renderMapRange (or a similar dedicated method)
            // renderMapRange populates a pre-existing set of rows, which is what createScaffolding provides.
            this.renderMapRange(0, actData.maps.length, actData.maps, this.tbodyElement, 0);
            
            contentContainer.appendChild(this.tableElement);
        }

        if (this.tbodyElement) {
            this.hookContainer(this.tbodyElement);
        }
    }

    private hookContainer(container: HTMLElement): void {
        if (!this.data) return; 

        container.addEventListener('mouseover', (e) => {
            const iconElement = e.target as HTMLElement;
            if (iconElement.tagName === 'I' && iconElement.dataset.eIx !== undefined && this.data) {
                const tr = iconElement.closest('tr');
                if (tr && tr.dataset.mIx !== undefined) {
                    const mapIndex = parseInt(tr.dataset.mIx);
                    const eventIndexInMapDisplay = parseInt(iconElement.dataset.eIx);

                    const actData = this.actDefinitions[this.currentActIndex];
                    if (!actData || mapIndex >= actData.maps.length) return;
                    
                    const map = actData.maps[mapIndex];
                    if (!map) return;

                    const { loIx, hiIx } = binarySearchRange(this.data.events, map.span.start, map.span.end, (ev) => ev.ts);
                    if (loIx === -1) return;

                    let currentEventForTooltip: LogEvent | null = null;
                    let displayedEventCounter = 0;
                    for (let i = loIx; i <= hiIx; i++) {
                        const event = this.data.events[i];
                        if (!journeyEventNames.has(event.name)) continue;
                        
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