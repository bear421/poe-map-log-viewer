import { MapInstance, MapSpan } from '../log-tracker';
import { LogEvent } from '../log-events';
import { binarySearch, BinarySearchMode } from '../binary-search';
import { BaseComponent } from './base-component';

declare var bootstrap: any; 

export class MapStatsComponent extends BaseComponent {

    constructor(container: HTMLElement) {
        super(document.createElement('div'), container);
        this.createModals();
    }

    protected render(): void {
        this.element.innerHTML = '';
        const agg = this.data!;
        const mapStats = new Map<string, {
            label: string,
            count: number,
            avgTime: number,
            totalTime: number,
            levels: Set<number>
        }>();

        agg.maps.forEach(map => {
            const mapTime = MapSpan.mapTime(map.span) / (1000 * 60); // minutes
            const stats = mapStats.get(map.name) || {
                label: MapInstance.label(map),
                count: 0,
                avgTime: 0,
                totalTime: 0,
                levels: new Set<number>()
            };

            stats.count++;
            stats.totalTime += mapTime;
            stats.levels.add(map.areaLevel);
            stats.avgTime = stats.totalTime / stats.count;

            mapStats.set(map.name, stats);
        });

        const tableContainer = document.createElement('div');
        tableContainer.className = 'table-responsive';
        tableContainer.innerHTML = `
            <table class="table table-striped table-hover">
                <thead>
                    <tr>
                        <th>Map Name</th>
                        <th>Count</th>
                        <th>Levels</th>
                        <th>Avg Time (min)</th>
                        <th>Total Time (min)</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody id="mapStatsTableBodyLocal">
                </tbody>
            </table>
        `;
        this.element.appendChild(tableContainer);

        const mapStatsTableBody = this.element.querySelector('#mapStatsTableBodyLocal');
        if (mapStatsTableBody) {
            mapStats.forEach((stats, mapName) => {
                const row = document.createElement('tr');
                row.innerHTML = `
                    <td>${stats.label}</td>
                    <td>${stats.count}</td>
                    <td>${Array.from(stats.levels).sort((a, b) => a - b).join(', ')}</td>
                    <td>${stats.avgTime.toFixed(2)}</td>
                    <td>${stats.totalTime.toFixed(2)}</td>
                    <td>
                        <button class="btn btn-primary btn-sm view-map-instances-btn" data-map-name="${mapName}">View Instances</button>
                    </td>
                `;
                mapStatsTableBody.appendChild(row);
            });

            this.element.querySelectorAll('.view-map-instances-btn').forEach(button => {
                button.addEventListener('click', (e) => {
                    const target = e.target as HTMLElement;
                    const mapName = target.getAttribute('data-map-name') || '';
                    const instancesToShow = agg.maps.filter(map => map.name === mapName);
                    this.showMapInstancesModal(mapName, instancesToShow);
                });
            });
        }
    }

    private createModals(): void {
        if (!document.getElementById('mapDetailsModal')) {
            const mapDetailsModal = document.createElement('div');
            mapDetailsModal.className = 'modal fade';
            mapDetailsModal.id = 'mapDetailsModal';
            mapDetailsModal.tabIndex = -1;
            mapDetailsModal.setAttribute('aria-labelledby', 'mapDetailsModalLabel');
            mapDetailsModal.setAttribute('aria-hidden', 'true');
            
            mapDetailsModal.innerHTML = `
                <div class="modal-dialog modal-xl">
                    <div class="modal-content">
                        <div class="modal-header">
                            <h5 class="modal-title" id="mapDetailsModalLabel">Map Instances</h5>
                            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                        </div>
                        <div class="modal-body" id="mapDetailsModalBody">
                            <!-- Map details will be inserted here -->
                        </div>
                        <div class="modal-footer">
                            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
                        </div>
                    </div>
                </div>
            `;
            document.body.appendChild(mapDetailsModal);
        }
        
        if (!document.getElementById('mapEventsModal')) {
            const mapEventsModal = document.createElement('div');
            mapEventsModal.className = 'modal fade';
            mapEventsModal.id = 'mapEventsModal';
            mapEventsModal.tabIndex = -1;
            mapEventsModal.setAttribute('aria-labelledby', 'mapEventsModalLabel');
            mapEventsModal.setAttribute('aria-hidden', 'true');
            
            mapEventsModal.innerHTML = `
                <div class="modal-dialog modal-lg">
                    <div class="modal-content">
                        <div class="modal-header">
                            <h5 class="modal-title" id="mapEventsModalTitle">Map Events</h5>
                            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                        </div>
                        <div class="modal-body" id="mapEventsModalBody">
                            <!-- Map events will be inserted here -->
                        </div>
                        <div class="modal-footer">
                            <button type="button" class="btn btn-primary" id="backToMapsBtnExternal">Back to Maps</button>
                            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
                        </div>
                    </div>
                </div>
            `;
            document.body.appendChild(mapEventsModal);
        }
    }

    private showMapInstancesModal(mapName: string, maps: MapInstance[]): void {
        const modalTitle = document.getElementById('mapDetailsModalLabel');
        const modalBody = document.getElementById('mapDetailsModalBody');
        
        if (!modalTitle || !modalBody) return;
        
        modalTitle.textContent = `${mapName} Instances (${maps.length})`;
        modalBody.innerHTML = '';
        
        const table = document.createElement('table');
        table.className = 'table table-striped table-hover';
        table.innerHTML = `
            <thead>
                <tr>
                    <th>Date</th>
                    <th>Level</th>
                    <th>Duration (min)</th>
                    <th>XP Gained</th>
                    <th>Actions</th>
                </tr>
            </thead>
            <tbody id="mapInstancesTableBodyLocal"></tbody>
        `;
        
        modalBody.appendChild(table);
        const tableBody = modalBody.querySelector('#mapInstancesTableBodyLocal');
        
        if (!tableBody) return;
        
        maps.forEach((map, index) => {
            const row = document.createElement('tr');
            const mapTime = MapSpan.mapTime(map.span) / (1000 * 60); // minutes
            
            row.innerHTML = `
                <td>${new Date(map.span.start).toLocaleString()}</td>
                <td>${map.areaLevel}</td>
                <td>${mapTime.toFixed(2)}</td>
                <td>${map.xpGained > 0 ? map.xpGained.toLocaleString() : '-'}</td>
                <td>
                    <button class="btn btn-sm btn-info view-events-btn-local" data-map-index="${index}">
                        View Events
                    </button>
                </td>
            `;
            
            tableBody.appendChild(row);
        });
        
        modalBody.querySelectorAll('.view-events-btn-local').forEach(button => {
            button.addEventListener('click', (e) => {
                const target = e.target as HTMLElement;
                const mapIndex = parseInt(target.getAttribute('data-map-index') || '0');
                this.showMapEventsModal(maps[mapIndex]);
            });
        });
        
        const modalElement = document.getElementById('mapDetailsModal');
        if (modalElement) {
            const modal = bootstrap.Modal.getOrCreateInstance(modalElement);
            modal.show();
        }
    }

    private showMapEventsModal(map: MapInstance): void {
        const agg = this.data!;
        const mapDetailsModalElement = document.getElementById('mapDetailsModal');
        if (mapDetailsModalElement) {
            const mapDetailsBsModal = bootstrap.Modal.getInstance(mapDetailsModalElement);
            mapDetailsBsModal?.hide();
        }
        
        const modalTitle = document.getElementById('mapEventsModalTitle');
        const modalBody = document.getElementById('mapEventsModalBody');
        
        if (!modalTitle || !modalBody) return;
        
        modalTitle.textContent = `${MapInstance.label(map)} (Level ${map.areaLevel}) - ${new Date(map.span.start).toLocaleString()}`;
        modalBody.innerHTML = '';
        
        const timeline = document.createElement('div');
        timeline.className = 'timeline';
        
        timeline.innerHTML += `
            <div class="timeline-item">
                <div class="timeline-badge bg-primary"><i class="bi bi-flag-fill"></i></div>
                <div class="timeline-content">
                    <h6 class="timeline-header">Map Started</h6>
                    <p class="mb-0">${new Date(map.span.start).toLocaleString()}</p>
                </div>
            </div>
        `;
        
        let relevantEvents: LogEvent[] = [];
        if (agg.events && map.span.end && map.span.start) {
            const lo = binarySearch(agg.events, map.span.start, (e: LogEvent) => e.ts, BinarySearchMode.FIRST);
            const hi = binarySearch(agg.events, map.span.end, (e: LogEvent) => e.ts, BinarySearchMode.LAST);

            if (lo !== -1 && hi !== -1 && lo <= hi) {
                if (hi - lo + 1 > 1000) {
                    console.warn(`Slicing events for map ${map.name} due to large number: ${hi - lo + 1}`);
                    relevantEvents = agg.events.slice(lo, lo + 1000); 
                } else {
                    relevantEvents = agg.events.slice(lo, hi + 1);
                }
            }
        }

        timeline.innerHTML += relevantEvents.map(event => {
            const eventTime = new Date(event.ts).toLocaleString();
            let badgeClass = 'bg-secondary';
            let icon = 'bi-info-circle-fill';
            let details = '';

            switch(event.name) {
                case "death":
                    badgeClass = 'bg-danger';
                    icon = 'bi-heartbreak-fill';
                    details = `Character: ${event.detail.character}`;
                    break;
                case "levelUp":
                    badgeClass = 'bg-success';
                    icon = 'bi-arrow-up-circle-fill';
                    details = `Character: ${event.detail.character}, Level: ${event.detail.level}`;
                    break;
                case "msgFrom":
                    details = `@From ${event.detail.character}: ${event.detail.msg}`;
                    break;
                case "msgTo":
                    details = `@To ${event.detail.character}: ${event.detail.msg}`;
                    break;
                case "msgParty":
                    icon = 'bi-chat-dots-fill';
                    details = `%${event.detail.character}: ${event.detail.msg}`;
                    break;
                default:
                    details = typeof event.detail === 'object' ? JSON.stringify(event.detail) : String(event.detail);
            }
            
            return `
                <div class="timeline-item">
                    <div class="timeline-badge ${badgeClass}"><i class="bi ${icon}"></i></div>
                    <div class="timeline-content">
                        <h6 class="timeline-header">${event.name}</h6>
                        <p class="mb-1"><small>${eventTime}</small></p>
                        <p class="mb-0 event-detail-text"><small>${details.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</small></p>
                    </div>
                </div>
            `;
        }).join('\n');
        
        if (map.span.end) {
            timeline.innerHTML += `
                <div class="timeline-item">
                    <div class="timeline-badge bg-primary"><i class="bi bi-flag-checkered"></i></div>
                    <div class="timeline-content">
                        <h6 class="timeline-header">Map Ended</h6>
                        <p class="mb-0">${new Date(map.span.end).toLocaleString()}</p>
                        <p class="mb-0"><small>Duration: ${(MapSpan.mapTime(map.span) / 1000 / 60).toFixed(2)} minutes</small></p>
                    </div>
                </div>
            `;
        } else {
             timeline.innerHTML += `
                <div class="timeline-item">
                    <div class="timeline-badge bg-secondary"><i class="bi bi-hourglass-split"></i></div>
                    <div class="timeline-content">
                        <h6 class="timeline-header">Map In Progress / Ended Abruptly</h6>
                        <p class="mb-0"><small>End time not recorded.</small></p>
                    </div>
                </div>
            `;
        }
        
        modalBody.appendChild(timeline);
        
        const modalElement = document.getElementById('mapEventsModal');
        if (modalElement) {
            const modal = bootstrap.Modal.getOrCreateInstance(modalElement);
            modal.show();

            const backButton = document.getElementById('backToMapsBtnExternal');
            if (backButton) {
                // Clone and replace to remove old listeners
                const newBackButton = backButton.cloneNode(true);
                backButton.parentNode?.replaceChild(newBackButton, backButton);
                newBackButton.addEventListener('click', () => {
                    modal.hide();
                    const mapDetailsElem = document.getElementById('mapDetailsModal');
                    if (mapDetailsElem) {
                         bootstrap.Modal.getOrCreateInstance(mapDetailsElem).show();
                    }
                });
            }
        }
    }
}