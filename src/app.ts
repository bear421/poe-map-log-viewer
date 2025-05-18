declare var bootstrap: any;
import { Filter, MapInstance, MapSpan } from './instance-tracker';
import { LogEvent } from './event-dispatcher';
import { binarySearch, BinarySearchMode } from './binary-search';
import {
    Chart,
    ArcElement,
    Tooltip,
    Legend,
    PieController
} from 'chart.js';

Chart.register(ArcElement, Tooltip, Legend, PieController);

class MapAnalyzer {

    private worker: Worker;
    private uploadButton!: HTMLButtonElement;
    private fileInput!: HTMLInputElement;
    private resultsDiv!: HTMLDivElement;
    private progressBar!: HTMLDivElement;
    private currentMaps: MapInstance[] | null = null;
    private currentEvents: LogEvent[] | null = null;

    constructor() {
        this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
        this.setupElements();
        this.setupEventListeners();
    }

    private setupElements() {
        const container = document.createElement('div');
        container.className = 'container mt-5';
        document.body.appendChild(container);

        const filterCard = document.createElement('div');
        filterCard.className = 'card mb-3';
        filterCard.innerHTML = `
            <div class="card-header">
                <h5 class="mb-0">Filter Maps</h5>
            </div>
            <div class="card-body">
                <div class="row g-3">
                    <div class="col-md-3">
                        <label for="minLevelFilter" class="form-label">Min Level</label>
                        <input type="number" class="form-control" id="minLevelFilter" min="1" max="100">
                    </div>
                    <div class="col-md-3">
                        <label for="maxLevelFilter" class="form-label">Max Level</label>
                        <input type="number" class="form-control" id="maxLevelFilter" min="1" max="100">
                    </div>
                    <div class="col-md-3">
                        <label for="fromDateFilter" class="form-label">From Date</label>
                        <input type="date" class="form-control" id="fromDateFilter">
                    </div>
                    <div class="col-md-3">
                        <label for="toDateFilter" class="form-label">To Date</label>
                        <input type="date" class="form-control" id="toDateFilter">
                    </div>
                    <div class="col-12">
                        <button id="applyFiltersBtn" class="btn btn-primary">Apply Filters</button>
                        <button id="resetFiltersBtn" class="btn btn-outline-secondary ms-2">Reset</button>
                    </div>
                </div>
            </div>
        `;
        container.appendChild(filterCard);

        const searchGroup = document.createElement('div');
        searchGroup.className = 'input-group mb-3';
        
        const searchInput = document.createElement('input');
        searchInput.type = 'text';
        searchInput.className = 'form-control';
        searchInput.placeholder = 'Search logs...';
        
        const searchButton = document.createElement('button');
        searchButton.className = 'btn btn-secondary';
        searchButton.textContent = 'Search';
        searchButton.addEventListener('click', () => {
            const searchTerm = searchInput.value.trim();
            if (searchTerm) {
                const file = this.fileInput.files?.[0];
                if (!file) {
                    this.showError('Please select a client.txt file');
                    return;
                }
                this.clearResults();
                this.showProgress();
                this.worker.postMessage({ 
                    type: 'search', 
                    file,
                    pattern: new RegExp(searchTerm, 'i'),
                    limit: 100 
                });
            }
        });

        searchGroup.appendChild(searchInput);
        searchGroup.appendChild(searchButton);
        container.appendChild(searchGroup);

        // Create file input and upload button
        const inputGroup = document.createElement('div');
        inputGroup.className = 'input-group mb-3';

        this.fileInput = document.createElement('input');
        this.fileInput.type = 'file';
        this.fileInput.className = 'form-control';
        this.fileInput.accept = '.txt';

        this.uploadButton = document.createElement('button');
        this.uploadButton.className = 'btn btn-primary';
        this.uploadButton.textContent = 'Analyze Maps';

        inputGroup.appendChild(this.fileInput);
        inputGroup.appendChild(this.uploadButton);
        container.appendChild(inputGroup);

        // Create collapsible path helper with Bootstrap Card layout
        const pathHelperCard = document.createElement('div');
        pathHelperCard.className = 'card mb-4';
        
        // Create card header that acts as the collapse trigger
        const cardHeader = document.createElement('div');
        cardHeader.className = 'card-header';
        
        const headerButton = document.createElement('button');
        headerButton.className = 'btn btn-link w-100 text-start p-0';
        headerButton.setAttribute('type', 'button');
        headerButton.setAttribute('data-bs-toggle', 'collapse');
        headerButton.setAttribute('data-bs-target', '#pathHelperContent');
        headerButton.setAttribute('aria-expanded', 'true');
        headerButton.setAttribute('aria-controls', 'pathHelperContent');
        
        // Add header content with toggle indicators
        headerButton.innerHTML = `
            <div class="d-flex justify-content-between align-items-center">
                <h5 class="mb-0">ℹ️ Looking for your Client.txt file?</h5>
                <span class="when-closed"><i class="bi bi-chevron-down"></i></span>
                <span class="when-open"><i class="bi bi-chevron-up"></i></span>
            </div>
        `;
        
        // Add custom styles for the toggle indicators
        const style = document.createElement('style');
        style.textContent = `
            [aria-expanded="true"] .when-closed { display: none; }
            [aria-expanded="false"] .when-open { display: none; }
        `;
        document.head.appendChild(style);
        
        cardHeader.appendChild(headerButton);
        pathHelperCard.appendChild(cardHeader);
        
        const collapseDiv = document.createElement('div');
        collapseDiv.className = 'collapse show';
        collapseDiv.id = 'pathHelperContent';
        
        const cardBody = document.createElement('div');
        cardBody.className = 'card-body';
        cardBody.innerHTML = `
            <div class="mb-2">
                <strong>Standalone client:</strong>
                <div class="input-group">
                    <input type="text" class="form-control" value="%PROGRAMFILES(X86)%\\Grinding Gear Games\\Path of Exile 2\\logs\\Client.txt" readonly>
                    <button class="btn btn-outline-secondary" type="button" id="copy-standard-path">Copy</button>
                </div>
            </div>
            <div>
                <strong>Steam client:</strong>
                <div class="input-group">
                    <input type="text" class="form-control" value="%PROGRAMFILES(X86)%\\Steam\\steamapps\\common\\Path of Exile 2\\logs\\Client.txt" readonly>
                    <button class="btn btn-outline-secondary" type="button" id="copy-steam-path">Copy</button>
                </div>
            </div>
            <small class="text-muted mt-2 d-block">Note: If you installed Steam in a custom location, you'll need to adjust the path accordingly.</small>
        `;
        
        collapseDiv.appendChild(cardBody);
        pathHelperCard.appendChild(collapseDiv);
        container.appendChild(pathHelperCard);

        document.getElementById('copy-standard-path')?.addEventListener('click', (e) => {
            this.copyToClipboard(e.target as HTMLButtonElement);
        });
        document.getElementById('copy-steam-path')?.addEventListener('click', (e) => {
            this.copyToClipboard(e.target as HTMLButtonElement);
        });

        this.progressBar = document.createElement('div');
        this.progressBar.className = 'd-none text-center mb-3';
        this.progressBar.innerHTML = `
            <div class="spinner-border text-primary" role="status">
                <span class="visually-hidden">Loading...</span>
            </div>
        `;
        container.appendChild(this.progressBar);

        this.resultsDiv = document.createElement('div');
        this.resultsDiv.className = 'row';
        container.appendChild(this.resultsDiv);
    }

    private setupEventListeners() {
        this.uploadButton.addEventListener('click', () => {
            this.handleUpload();
        });
        
        this.fileInput.addEventListener('change', () => {
            this.handleUpload();
        });
        
        document.getElementById('applyFiltersBtn')?.addEventListener('click', () => {
            this.applyFilters();
        });
        
        document.getElementById('resetFiltersBtn')?.addEventListener('click', () => {
            this.resetFilters();
        });
        
        this.worker.onmessage = (e: MessageEvent) => {
            const { type, data } = e.data;
            switch (type) {
                case 'complete':
                    this.currentMaps = data.maps;
                    this.currentEvents = data.events;
                    this.displayResults(data.maps);
                    this.hideProgress();
                    break;
                case 'search':
                    this.currentMaps = null; // let GC free mem
                    this.displaySearchResults(data.lines);
                    this.hideProgress();
                    break;
                case 'error':
                    this.currentMaps = null; // let GC free mem
                    console.error(data.error);
                    this.showError(data.error);
                    this.hideProgress();
                    break;
            }
        };
    }

    private applyFilters() {
        if (!this.currentMaps) {
            this.showError('No map data available to filter');
            return;
        }
        
        const minLevelInput = (document.getElementById('minLevelFilter') as HTMLInputElement).value;
        const maxLevelInput = (document.getElementById('maxLevelFilter') as HTMLInputElement).value;
        const fromDateInput = (document.getElementById('fromDateFilter') as HTMLInputElement).value;
        const toDateInput = (document.getElementById('toDateFilter') as HTMLInputElement).value;
        
        const filter = new Filter();
        
        if (minLevelInput) {
            filter.fromAreaLevel = parseInt(minLevelInput);
        }
        if (maxLevelInput) {
            filter.toAreaLevel = parseInt(maxLevelInput);
        }
        
        if (fromDateInput) {
            filter.fromMillis = new Date(fromDateInput).getTime();
        }
        if (toDateInput) {
            const toDate = new Date(toDateInput);
            toDate.setHours(23, 59, 59, 999);
            filter.toMillis = toDate.getTime();
        }

        this.clearResults();
        this.displayResults(Filter.filterAll(this.currentMaps, filter));
    }

    private resetFilters() {
        (document.getElementById('minLevelFilter') as HTMLInputElement).value = '';
        (document.getElementById('maxLevelFilter') as HTMLInputElement).value = '';
        (document.getElementById('fromDateFilter') as HTMLInputElement).value = '';
        (document.getElementById('toDateFilter') as HTMLInputElement).value = '';
        
        if (this.currentMaps) {
            this.clearResults();
            this.displayResults(this.currentMaps);
        }
    }

    private handleUpload() {
        const file = this.fileInput.files?.[0];
        if (!file) {
            this.showError('Please select a client.txt file');
            return;
        }
        this.collapsePathHelper();
        this.clearResults();
        this.showProgress();
        this.worker.postMessage({ type: 'process', file });
    }

    private displayResults(maps: MapInstance[]) {
        console.log("displayResults", maps, this.currentEvents);
        const times = maps.map(map => {
            try {
                const mapTime = MapSpan.mapTime(map.span);
                const loadTime = map.span.loadTime;
                const hideoutTime = map.span.hideoutTime;
                return { mapTime, loadTime, hideoutTime };
            } catch (e) {
                console.error(e, map);
                throw e;
            }
        });

        const getMedian = (arr: number[]) => {
            const sorted = [...arr].sort((a, b) => a - b);
            const mid = Math.floor(sorted.length / 2);
            return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
        };

        const medianMapTime = getMedian(times.map(t => t.mapTime));
        const medianLoadTime = getMedian(times.map(t => t.loadTime));
        const medianIdleTime = getMedian(times.map(t => t.hideoutTime));

        const chartCard = document.createElement('div');
        chartCard.className = 'col-12 mb-4';
        chartCard.innerHTML = `
            <div class="card">
                <div class="card-body">
                    <h5 class="card-title">Time Distribution (Median)</h5>
                    <canvas id="timeDistributionChart"></canvas>
                </div>
            </div>
        `;
        this.resultsDiv.appendChild(chartCard);

        // Create pie chart
        const ctx = (document.getElementById('timeDistributionChart') as HTMLCanvasElement).getContext('2d');
        if (ctx) {
            new Chart(ctx, {
                type: 'pie',
                data: {
                    labels: ['Active map time', 'Load time', 'Hideout time'],
                    datasets: [{
                        data: [
                            medianMapTime / 1000, // Convert to seconds
                            medianLoadTime / 1000,
                            medianIdleTime / 1000
                        ],
                        backgroundColor: [
                            '#36A2EB', // Blue for map time
                            '#FF6384', // Red for load time
                            '#FFCE56'  // Yellow for idle time
                        ]
                    }]
                },
                options: {
                    plugins: {
                        tooltip: {
                            callbacks: {
                                label: (context) => {
                                    const seconds = context.raw as number;
                                    const minutes = (seconds / 60).toFixed(1);
                                    return `${context.label}: ${minutes} minutes`;
                                }
                            }
                        }
                    }
                }
            });
        }

        const mapStats = new Map<string, {
            label: string,
            count: number,
            avgTime: number,
            avgXp: number,
            totalTime: number,
            totalXp: number,
            levels: Set<number>
        }>();

        maps.forEach(map => {
            const mapTime = MapSpan.mapTime(map.span) / (1000 * 60); // Convert to minutes
            const stats = mapStats.get(map.name) || {
                label: MapInstance.label(map),
                count: 0,
                avgTime: 0,
                avgXp: 0,
                totalTime: 0,
                totalXp: 0,
                levels: new Set<number>()
            };

            stats.count++;
            stats.totalTime += mapTime;
            stats.totalXp += map.xpGained;
            stats.levels.add(map.areaLevel);
            stats.avgTime = stats.totalTime / stats.count;
            stats.avgXp = stats.totalXp / stats.count;

            mapStats.set(map.name, stats);
        });

        const summaryCard = document.createElement('div');
        summaryCard.className = 'col-12 mb-4';
        summaryCard.innerHTML = `
            <div class="card">
                <div class="card-body">
                    <h5 class="card-title">Summary</h5>
                    <p class="card-text">
                        Total Maps: ${maps.length}<br>
                        Unique Map Types: ${mapStats.size}<br>
                        Total Time: ${(maps.reduce((acc, map) => acc + MapSpan.mapTime(map.span), 0) / (1000 * 60 * 60)).toFixed(2)} hours
                    </p>
                </div>
            </div>
        `;
        this.resultsDiv.appendChild(summaryCard);

        mapStats.forEach((stats, mapName) => {
            const card = document.createElement('div');
            card.className = 'col-md-6 col-lg-4 mb-4';
            card.innerHTML = `
                <div class="card">
                    <div class="card-body">
                        <h5 class="card-title">${stats.label}</h5>
                        <p class="card-text">
                            Count: ${stats.count}<br>
                            Levels: ${Array.from(stats.levels).sort((a, b) => a - b).join(', ')}<br>
                            Avg Time: ${stats.avgTime.toFixed(2)} minutes<br>
                            Total Time: ${stats.totalTime.toFixed(2)} minutes<br>
                        </p>
                        <button class="btn btn-primary view-map-instances-btn" data-map-name="${mapName}">View Instances</button>
                    </div>
                </div>
            `;
            this.resultsDiv.appendChild(card);
        });
        
        document.querySelectorAll('.view-map-instances-btn').forEach(button => {
            button.addEventListener('click', (e) => {
                const target = e.target as HTMLElement;
                const mapName = target.getAttribute('data-map-name') || '';
                const mapInstances = maps.filter(map => map.name === mapName);
                this.showMapInstancesModal(mapName, mapInstances);
            });
        });
        
        this.createMapDetailsModal();
    }

    private displaySearchResults(lines: string[]) {
        const resultsCard = document.createElement('div');
        resultsCard.className = 'col-12';
        resultsCard.innerHTML = `
            <div class="card">
                <div class="card-body">
                    <h5 class="card-title">Search Results (${lines.length})</h5>
                    <pre class="card-text"><code>${lines.join('\n')}</code></pre>
                </div>
            </div>
        `;
        this.resultsDiv.appendChild(resultsCard);
    }

    private showProgress() {
        this.progressBar.classList.remove('d-none');
    }

    private hideProgress() {
        this.progressBar.classList.add('d-none');
    }

    private showError(message: string) {
        const alert = document.createElement('div');
        alert.className = 'alert alert-danger alert-dismissible fade show';
        alert.innerHTML = `
            ${message}
            <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
        `;
        this.resultsDiv.prepend(alert);
    }

    private clearResults() {
        this.resultsDiv.innerHTML = '';
    }

    private copyToClipboard(button: HTMLButtonElement) {
        const input = button.previousElementSibling as HTMLInputElement;
        input.select();
        document.execCommand('copy');
        
        const originalText = button.textContent;
        button.textContent = 'Copied!';
        setTimeout(() => {
            button.textContent = originalText;
        }, 2000);
    }

    private collapsePathHelper() {
        const collapseElement = document.getElementById('pathHelperContent');
        
        if (collapseElement && collapseElement.classList.contains('show')) {
            bootstrap.Collapse.getInstance(collapseElement)?.hide();
        }
    }

    private showMapInstancesModal(mapName: string, maps: MapInstance[]) {
        const modalTitle = document.getElementById('mapDetailsModalLabel');
        const modalBody = document.getElementById('mapDetailsModalBody');
        
        if (!modalTitle || !modalBody) return;
        
        modalTitle.textContent = `${mapName} Instances`;
        modalBody.innerHTML = '';
        
        const table = document.createElement('table');
        table.className = 'table table-striped table-hover';
        table.innerHTML = `
            <thead>
                <tr>
                    <th>Date</th>
                    <th>Level</th>
                    <th>Duration</th>
                    <th>XP Gained</th>
                    <th>Actions</th>
                </tr>
            </thead>
            <tbody id="mapInstancesTableBody"></tbody>
        `;
        
        modalBody.appendChild(table);
        const tableBody = document.getElementById('mapInstancesTableBody');
        
        if (!tableBody) return;
        
        maps.forEach((map, index) => {
            const row = document.createElement('tr');
            const mapTime = MapSpan.mapTime(map.span) / (1000 * 60); // Convert to minutes
            
            row.innerHTML = `
                <td>${map.span.start.toLocaleString()}</td>
                <td>${map.areaLevel}</td>
                <td>${mapTime.toFixed(2)} min</td>
                <td>${map.xpGained.toLocaleString()}</td>
                <td>
                    <button class="btn btn-sm btn-info view-events-btn" data-map-index="${index}">
                        View Events
                    </button>
                </td>
            `;
            
            tableBody.appendChild(row);
        });
        
        document.querySelectorAll('.view-events-btn').forEach(button => {
            button.addEventListener('click', (e) => {
                const target = e.target as HTMLElement;
                const mapIndex = parseInt(target.getAttribute('data-map-index') || '0');
                this.showMapEventsModal(maps[mapIndex]);
            });
        });
        
        const modal = new bootstrap.Modal(document.getElementById('mapDetailsModal') as HTMLElement);
        modal.show();
    }

    private createMapDetailsModal() {
        // Create map details modal if it doesn't exist
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
        
        // Create map events modal if it doesn't exist
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
                            <button type="button" class="btn btn-primary" id="backToMapsBtn">Back to Maps</button>
                            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
                        </div>
                    </div>
                </div>
            `;
            
            document.body.appendChild(mapEventsModal);
        }
    }

    private showMapEventsModal(map: MapInstance) {
        const mapDetailsModal = bootstrap.Modal.getInstance(document.getElementById('mapDetailsModal') as HTMLElement);
        mapDetailsModal?.hide();
        
        const modalTitle = document.getElementById('mapEventsModalTitle');
        const modalBody = document.getElementById('mapEventsModalBody');
        
        if (!modalTitle || !modalBody) return;
        
        modalTitle.textContent = `${MapInstance.label(map)} (Level ${map.areaLevel})`;
        modalBody.innerHTML = '';
        
        const timeline = document.createElement('div');
        timeline.className = 'timeline';
        
        timeline.innerHTML += `
            <div class="timeline-item">
                <div class="timeline-badge bg-primary">
                    <i class="bi bi-flag-fill"></i>
                </div>
                <div class="timeline-content">
                    <h6 class="timeline-header">Map Started</h6>
                    <p class="mb-0">${new Date(map.span.start)}</p>
                </div>
            </div>
        `;
        let events: LogEvent[] = [];
        if (this.currentEvents && map.span.end) {
            const lo = binarySearch(this.currentEvents, map.span.start, (e: LogEvent) => e.ts, BinarySearchMode.FIRST);
            const hi = binarySearch(this.currentEvents, map.span.end, (e: LogEvent) => e.ts, BinarySearchMode.LAST);
            if (lo === -1 || hi === -1) {
                events = [];
            } else {
                if (hi - lo > 1000) {
                    throw new Error("skipping map with excessive events: " + (hi - lo));
                }
                events = this.currentEvents.slice(lo, hi + 1); // +1 because slice excludes the end index
            }
        }
        timeline.innerHTML += events.map(event => {
            const eventTime = new Date(event.ts);
            
            let badgeClass = 'bg-secondary';
            let icon = 'bi-info-circle-fill';
            
            // Customize badge based on event type
            if (event.name.includes('death')) {
                badgeClass = 'bg-danger';
                icon = 'bi-heart-break-fill';
            } else if (event.name.includes('boss')) {
                badgeClass = 'bg-warning';
                icon = 'bi-trophy-fill';
            } else if (event.name.includes('level')) {
                badgeClass = 'bg-success';
                icon = 'bi-arrow-up-circle-fill';
            }
            
            return `
                <div class="timeline-item">
                    <div class="timeline-badge ${badgeClass}">
                        <i class="bi ${icon}"></i>
                    </div>
                    <div class="timeline-content">
                        <h6 class="timeline-header">${event.name}</h6>
                        <p class="mb-0">${eventTime}</p>
                        <p class="mb-0">${event.detail}</p>
                    </div>
                </div>
            `;
        }).join('\n');
        
        timeline.innerHTML += `
            <div class="timeline-item">
                <div class="timeline-badge bg-danger">
                    <i class="bi bi-flag-fill"></i>
                </div>
                <div class="timeline-content">
                    <h6 class="timeline-header">Map Ended</h6>
                    <p class="mb-0">${new Date(map.span.end!)}</p>
                    <p class="mb-0">Duration: ${(MapSpan.mapTime(map.span) / 1000 / 60).toFixed(2)} minutes</p>
                </div>
            </div>
        `;
        
        modalBody.appendChild(timeline);
        
        // Add custom styles for timeline
        const style = document.createElement('style');
        style.textContent = `
            .timeline {
                position: relative;
                padding: 20px 0;
            }
            .timeline:before {
                content: '';
                position: absolute;
                top: 0;
                bottom: 0;
                left: 20px;
                width: 4px;
                background: #e9ecef;
            }
            .timeline-item {
                position: relative;
                margin-bottom: 30px;
            }
            .timeline-badge {
                position: absolute;
                left: 0;
                width: 40px;
                height: 40px;
                border-radius: 50%;
                text-align: center;
                line-height: 40px;
                color: white;
            }
            .timeline-badge i {
                font-size: 1.2rem;
                line-height: 40px;
            }
            .timeline-content {
                margin-left: 60px;
                background: #f8f9fa;
                padding: 15px;
                border-radius: 5px;
            }
            .timeline-header {
                margin: 0;
                font-weight: bold;
            }
        `;
        document.head.appendChild(style);
        
        // Show the events modal
        const modal = new bootstrap.Modal(document.getElementById('mapEventsModal') as HTMLElement);
        modal.show();
        
        // Add event listener to back button
        document.getElementById('backToMapsBtn')?.addEventListener('click', () => {
            modal.hide();
            mapDetailsModal?.show();
        });
    }
}

new MapAnalyzer(); 