import { MapInstance, AreaType, MapMarkerType } from '../ingest/log-tracker';
import { BaseComponent } from './base-component';
import { MapListComponent } from './map-list';

declare var bootstrap: any; 

export class MapStatsComponent extends BaseComponent {

    constructor(container: HTMLElement) {
        super(document.createElement('div'), container);
        this.element.className = 'journey-component-container mt-3';
        this.createModals();
    }

    protected render(): void {
        this.element.innerHTML = '';
        const agg = this.data!;
        const maps = agg.maps.filter(map => map.areaType !== AreaType.Campaign);
        const mapStats = new Map<string, {
            label: string,
            count: number,
            avgTime: number,
            totalTime: number,
            levels: Set<number>
        }>();

        maps.forEach(map => {
            const mapTime = map.getTime(new Set([MapMarkerType.map])) / (1000 * 60); // minutes
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

        const table = document.createElement('table');
        table.className = 'table table-sm table-striped table-fixed caption-top';
        table.innerHTML = `
            <thead>
                <tr>
                    <th class="th-area">Map Name</th>
                    <th class="th-count">Count</th>
                    <th class="th-levels">Levels</th>
                    <th class="th-avg-time">Avg Time (min)</th>
                    <th class="th-total-time">Total Time (min)</th>
                </tr>
            </thead>
            <tbody class="align-middle"></tbody>
        `;

        const tbody = table.querySelector('tbody') as HTMLTableSectionElement;
        mapStats.forEach((stats, mapName) => {
            const row = tbody.insertRow();
            const mapNameCell = row.insertCell();
            const mapNameLink = document.createElement('a');
            mapNameLink.href = '#';
            mapNameLink.textContent = stats.label;
            mapNameLink.addEventListener('click', (e) => {
                e.preventDefault();
                const instancesToShow = maps.filter(map => map.name === mapName);
                this.showMapInstancesModal(mapName, instancesToShow);
            });
            mapNameCell.appendChild(mapNameLink);
            row.insertCell().textContent = stats.count.toString();
            row.insertCell().textContent = Array.from(stats.levels).sort((a, b) => a - b).join(', ');
            row.insertCell().textContent = stats.avgTime.toFixed(2);
            row.insertCell().textContent = stats.totalTime.toFixed(2);
        });

        this.element.appendChild(table);
    }

    private createModals(): void {
        if (!document.getElementById('mapDetailsModal')) {
            const mapDetailsModal = document.createElement('div');
            mapDetailsModal.className = 'modal fade';
            mapDetailsModal.id = 'mapDetailsModal';
            mapDetailsModal.tabIndex = -1;
            mapDetailsModal.setAttribute('aria-labelledby', 'mapDetailsModalLabel');
            
            mapDetailsModal.innerHTML = `
                <div class="modal-dialog modal-fullscreen-lg-down modal-xl">
                    <div class="modal-content">
                        <div class="modal-header">
                            <h5 class="modal-title" id="mapDetailsModalLabel">Map Instances</h5>
                            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                        </div>
                        <div class="modal-body" id="mapDetailsModalBody"></div>
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
            
            mapEventsModal.innerHTML = `
                <div class="modal-dialog modal-lg">
                    <div class="modal-content">
                        <div class="modal-header">
                            <h5 class="modal-title" id="mapEventsModalTitle">Map Events</h5>
                            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                        </div>
                        <div class="modal-body" id="mapEventsModalBody"></div>
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

        const mapListComponent = new MapListComponent(modalBody);
        mapListComponent.updateData(this.data!);
        mapListComponent.setApp(this.app!);
        mapListComponent.setVisible(true);
        
        const modalElement = document.getElementById('mapDetailsModal');
        if (modalElement) {
            const modal = bootstrap.Modal.getOrCreateInstance(modalElement);
            modal.show();
        }
    }

}