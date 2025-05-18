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

import mascotHappy from './assets/images/mascot_happy.webp';
import mascotHmm from './assets/images/mascot_hmm.webp';
import mascotHmm2 from './assets/images/mascot_hmm2.webp';
import mascotSurprised from './assets/images/mascot_surprised.webp';

Chart.register(ArcElement, Tooltip, Legend, PieController);

class MapAnalyzer {

    private worker: Worker;
    private uploadButton!: HTMLButtonElement;
    private fileInput!: HTMLInputElement;
    private progressBar!: HTMLDivElement;
    private overviewTabPane!: HTMLDivElement;
    private mapsTabPane!: HTMLDivElement;
    private searchLogTabPane!: HTMLDivElement;
    private currentMaps: MapInstance[] | null = null;
    private currentEvents: LogEvent[] | null = null;
    private mascotElement!: HTMLImageElement;
    private mascotAnimationInterval: number | null = null;
    private mascotCurrentFrame: number = 0;
    private mascotFrameImagePaths = [
        mascotHappy,
        mascotHmm,
        mascotHmm2,
        mascotSurprised
    ];
    private mascotSearchAnimationFrames = [1, 2, 3];
    private mascotShouldAnimateForSearch: boolean = false;
    private mascotShouldAnimateForHover: boolean = false;

    constructor() {
        this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
        this.setupElements();
        this.setupEventListeners();
    }

    private setupElements() {
        const container = document.createElement('div');
        container.className = 'container mt-5';
        document.body.appendChild(container);

        const headerContainer = document.createElement('div');
        headerContainer.style.display = 'flex';
        headerContainer.style.alignItems = 'flex-start';
        headerContainer.style.marginBottom = '-10px';

        this.mascotElement = document.createElement('img');
        this.mascotElement.style.width = '128px';
        this.mascotElement.style.height = '128px';
        this.mascotElement.style.display = 'block';
        this.mascotElement.style.position = 'relative';
        this.mascotElement.style.zIndex = '1';
        this.setMascotFrame(0);
        headerContainer.appendChild(this.mascotElement);

        this.mascotElement.addEventListener('mouseenter', () => {
            this.mascotElement.classList.remove('mascot-wiggle');
            // Trigger a reflow to restart the animation
            void this.mascotElement.offsetWidth;
            this.mascotElement.classList.add('mascot-wiggle');
        });
        this.mascotElement.addEventListener('mouseleave', () => {
            this.mascotElement.classList.remove('mascot-wiggle');
        });

        const wiggleStyle = document.createElement('style');
        wiggleStyle.textContent = `
            @keyframes wiggle {
                0% { transform: rotate(0deg); }
                20% { transform: rotate(-5deg); }
                40% { transform: rotate(5deg); }
                60% { transform: rotate(-3deg); }
                80% { transform: rotate(3deg); }
                100% { transform: rotate(0deg); }
            }
            .mascot-wiggle {
                animation-name: wiggle;
                animation-duration: 1s;
                animation-timing-function: ease-in-out;
                transform-origin: bottom center;
            }
        `;
        document.head.appendChild(wiggleStyle);

        const titleElement = document.createElement('h1');
        titleElement.textContent = 'PoE Map Log Viewer';
        titleElement.style.marginLeft = '20px';
        headerContainer.appendChild(titleElement);

        container.prepend(headerContainer);

        const filterCard = document.createElement('div');
        filterCard.className = 'card mb-3';
        filterCard.innerHTML = `
            <div class="card-header">
                <h5 class="mb-0">Filter Maps</h5>
            </div>
            <div class="card-body">
                <div class="row g-3">
                    <div class="col-md-3">
                        <label for="minLevelFilter" class="form-label">Min area level</label>
                        <input type="number" class="form-control" id="minLevelFilter" min="1" max="100">
                    </div>
                    <div class="col-md-3">
                        <label for="maxLevelFilter" class="form-label">Max area level</label>
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
                    <div class="col-12 mt-2">
                        <label class="form-label">Presets:</label>
                        <div>
                            <button id="presetLastHourBtn" class="btn btn-sm btn-outline-info me-1 mb-1">Last Hour</button>
                            <button id="presetLast24HoursBtn" class="btn btn-sm btn-outline-info me-1 mb-1">Last 24 Hours</button>
                            <button id="presetLast7DaysBtn" class="btn btn-sm btn-outline-info me-1 mb-1">Last 7 Days</button>
                            <button id="presetLast30DaysBtn" class="btn btn-sm btn-outline-info mb-1">Last 30 Days</button>
                        </div>
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
                    limit: 500 
                });
            }
        });

        searchGroup.appendChild(searchInput);
        searchGroup.appendChild(searchButton);

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

        const pathHelperCard = document.createElement('div');
        pathHelperCard.className = 'card mb-4';
        
        const cardHeader = document.createElement('div');
        cardHeader.className = 'card-header';
        
        const headerButton = document.createElement('button');
        headerButton.className = 'btn btn-link w-100 text-start p-0';
        headerButton.setAttribute('type', 'button');
        headerButton.setAttribute('data-bs-toggle', 'collapse');
        headerButton.setAttribute('data-bs-target', '#pathHelperContent');
        headerButton.setAttribute('aria-expanded', 'true');
        headerButton.setAttribute('aria-controls', 'pathHelperContent');
        
        headerButton.innerHTML = `
            <div class="d-flex justify-content-between align-items-center">
                <h5 class="mb-0">ℹ️ Looking for your Client.txt file?</h5>
                <span class="when-closed"><i class="bi bi-chevron-down"></i></span>
                <span class="when-open"><i class="bi bi-chevron-up"></i></span>
            </div>
        `;
        
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

        const tabNav = document.createElement('ul');
        tabNav.className = 'nav nav-tabs mt-4';
        tabNav.id = 'resultsTabs';
        tabNav.setAttribute('role', 'tablist');
        tabNav.innerHTML = `
            <li class="nav-item" role="presentation">
                <button class="nav-link active" id="overview-tab" data-bs-toggle="tab" data-bs-target="#overview-tab-pane" type="button" role="tab" aria-controls="overview-tab-pane" aria-selected="true">Overview</button>
            </li>
            <li class="nav-item" role="presentation">
                <button class="nav-link" id="maps-tab" data-bs-toggle="tab" data-bs-target="#maps-tab-pane" type="button" role="tab" aria-controls="maps-tab-pane" aria-selected="false">Maps</button>
            </li>
            <li class="nav-item" role="presentation">
                <button class="nav-link" id="search-log-tab" data-bs-toggle="tab" data-bs-target="#search-log-tab-pane" type="button" role="tab" aria-controls="search-log-tab-pane" aria-selected="false">Search Logs</button>
            </li>
        `;
        container.appendChild(tabNav);

        const tabContent = document.createElement('div');
        tabContent.className = 'tab-content';
        tabContent.id = 'resultsTabContent';

        this.overviewTabPane = document.createElement('div');
        this.overviewTabPane.className = 'tab-pane fade show active p-3 border border-top-0 rounded-bottom';
        this.overviewTabPane.id = 'overview-tab-pane';
        this.overviewTabPane.setAttribute('role', 'tabpanel');
        this.overviewTabPane.setAttribute('aria-labelledby', 'overview-tab');
        this.overviewTabPane.setAttribute('tabindex', '0');
        
        this.mapsTabPane = document.createElement('div');
        this.mapsTabPane.className = 'tab-pane fade p-3 border border-top-0 rounded-bottom';
        this.mapsTabPane.id = 'maps-tab-pane';
        this.mapsTabPane.setAttribute('role', 'tabpanel');
        this.mapsTabPane.setAttribute('aria-labelledby', 'maps-tab');
        this.mapsTabPane.setAttribute('tabindex', '0');

        // Create the Search Log Tab Pane
        this.searchLogTabPane = document.createElement('div');
        this.searchLogTabPane.className = 'tab-pane fade p-3 border border-top-0 rounded-bottom';
        this.searchLogTabPane.id = 'search-log-tab-pane';
        this.searchLogTabPane.setAttribute('role', 'tabpanel');
        this.searchLogTabPane.setAttribute('aria-labelledby', 'search-log-tab');
        this.searchLogTabPane.setAttribute('tabindex', '0');
        this.searchLogTabPane.appendChild(searchGroup); // Append the searchGroup here

        tabContent.appendChild(this.overviewTabPane);
        tabContent.appendChild(this.mapsTabPane);
        tabContent.appendChild(this.searchLogTabPane); // Add new search tab pane to tab content
        container.appendChild(tabContent);
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
        
        document.getElementById('presetLastHourBtn')?.addEventListener('click', () => {
            this.applyPreset('lastHour');
        });

        document.getElementById('presetLast24HoursBtn')?.addEventListener('click', () => {
            this.applyPreset('last24Hours');
        });

        document.getElementById('presetLast7DaysBtn')?.addEventListener('click', () => {
            this.applyPreset('last7Days');
        });

        document.getElementById('presetLast30DaysBtn')?.addEventListener('click', () => {
            this.applyPreset('last30Days');
        });
        
        this.worker.onmessage = (e: MessageEvent) => {
            const { type, data } = e.data;
            switch (type) {
                case 'complete':
                    this.currentMaps = data.maps;
                    this.currentEvents = data.events;
                    this.clearResults();
                    this.displayResults(data.maps);
                    this.hideProgress();
                    const overviewTabButton = document.getElementById('overview-tab');
                    if (overviewTabButton) {
                        bootstrap.Tab.getOrCreateInstance(overviewTabButton).show();
                    }
                    break;
                case 'search':
                    this.displaySearchLogResults(data.lines);
                    this.hideProgress();
                    const searchLogTabButton = document.getElementById('search-log-tab');
                    if (searchLogTabButton) {
                        bootstrap.Tab.getOrCreateInstance(searchLogTabButton).show();
                    }
                    break;
                case 'error':
                    this.currentMaps = null;
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

    private applyPreset(presetType: 'lastHour' | 'last24Hours' | 'last7Days' | 'last30Days') {
        const now = new Date();
        let fromDate = new Date(now);

        switch (presetType) {
            case 'lastHour':
                fromDate.setHours(now.getHours() - 1);
                break;
            case 'last24Hours':
                fromDate.setDate(now.getDate() - 1);
                break;
            case 'last7Days':
                fromDate.setDate(now.getDate() - 7);
                break;
            case 'last30Days':
                fromDate.setDate(now.getDate() - 30);
                break;
        }

        const formatDate = (date: Date) => {
            const year = date.getFullYear();
            const month = (date.getMonth() + 1).toString().padStart(2, '0');
            const day = date.getDate().toString().padStart(2, '0');
            return `${year}-${month}-${day}`;
        };

        (document.getElementById('fromDateFilter') as HTMLInputElement).value = formatDate(fromDate);
        (document.getElementById('toDateFilter') as HTMLInputElement).value = '';

        this.applyFilters();
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
        this.overviewTabPane.innerHTML = '';
        this.mapsTabPane.innerHTML = '';

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
        this.overviewTabPane.appendChild(chartCard);

        const ctx = (document.getElementById('timeDistributionChart') as HTMLCanvasElement).getContext('2d');
        if (ctx) {
            new Chart(ctx, {
                type: 'pie',
                data: {
                    labels: ['Active map time', 'Load time', 'Hideout time'],
                    datasets: [{
                        data: [
                            medianMapTime / 1000,
                            medianLoadTime / 1000,
                            medianIdleTime / 1000
                        ],
                        backgroundColor: [
                            '#36A2EB',
                            '#FF6384',
                            '#FFCE56'
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
            const mapTime = MapSpan.mapTime(map.span) / (1000 * 60);
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
                        Total maps: ${maps.length}<br>
                        Unique map types: ${mapStats.size}<br>
                        Total map time: ${(maps.reduce((acc, map) => acc + MapSpan.mapTime(map.span), 0) / (1000 * 60 * 60)).toFixed(2)} hours<br>
                        Total items identified by the hooded one: ${this.currentEvents!.reduce((acc, event) => {
                            return acc + (event.name == "itemsIdentified" ? event.detail.count : 0);
                        }, 0)}
                    </p>
                </div>
            </div>
        `;
        this.overviewTabPane.appendChild(summaryCard);

        const tableCard = document.createElement('div');
        tableCard.innerHTML = `
            <div class="card">
                <div class="card-body">
                    <h5 class="card-title">Map Statistics</h5>
                    <div class="table-responsive">
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
                            <tbody id="mapStatsTableBody">
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        `;
        this.mapsTabPane.appendChild(tableCard);

        const mapStatsTableBody = this.mapsTabPane.querySelector('#mapStatsTableBody');
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
        }
        
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

    private displaySearchLogResults(lines: string[]) {
        if (!this.searchLogTabPane) return;

        // Find the searchGroup to preserve it
        const searchGroup = this.searchLogTabPane.querySelector('.input-group');
        
        this.searchLogTabPane.innerHTML = ''; // Clear previous results from search tab
        
        if (searchGroup) {
            this.searchLogTabPane.appendChild(searchGroup); // Re-add search input/button
        }

        const resultsCard = document.createElement('div');
        resultsCard.className = 'mt-3'; // Add some margin top for spacing from search input
        resultsCard.innerHTML = `
            <div class="card">
                <div class="card-body">
                    <h5 class="card-title">Search Results (${lines.length})</h5>
                    <pre class="card-text"><code>${lines.join('\n')}</code></pre>
                </div>
            </div>
        `;
        this.searchLogTabPane.appendChild(resultsCard);
    }

    private showProgress() {
        this.progressBar.classList.remove('d-none');
        this.mascotShouldAnimateForSearch = true;
        this.updateMascotAnimationState();
    }

    private hideProgress() {
        this.progressBar.classList.add('d-none');
        this.mascotShouldAnimateForSearch = false;
        this.updateMascotAnimationState();
    }

    private showError(message: string) {
        const alert = document.createElement('div');
        alert.className = 'alert alert-danger alert-dismissible fade show';
        alert.innerHTML = `
            ${message}
            <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
        `;
        this.overviewTabPane.prepend(alert);
        const overviewTabButton = document.getElementById('overview-tab');
        if (overviewTabButton) {
            bootstrap.Tab.getOrCreateInstance(overviewTabButton).show();
        }
        this.mascotShouldAnimateForSearch = false;
        this.updateMascotAnimationState();
    }

    private clearResults() {
        if (this.overviewTabPane) {
            this.overviewTabPane.innerHTML = '';
        }
        if (this.mapsTabPane) {
            this.mapsTabPane.innerHTML = '';
        }
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
            const mapTime = MapSpan.mapTime(map.span) / (1000 * 60);
            
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
                events = this.currentEvents.slice(lo, hi + 1);
            }
        }
        timeline.innerHTML += events.map(event => {
            const eventTime = new Date(event.ts);
            
            let badgeClass = 'bg-secondary';
            let icon = 'bi-info-circle-fill';
            
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
        
        const modal = new bootstrap.Modal(document.getElementById('mapEventsModal') as HTMLElement);
        modal.show();
        
        document.getElementById('backToMapsBtn')?.addEventListener('click', () => {
            modal.hide();
            mapDetailsModal?.show();
        });
    }

    private setMascotFrame(frameIndex: number) {
        if (this.mascotElement && this.mascotFrameImagePaths[frameIndex]) {
            this.mascotElement.src = this.mascotFrameImagePaths[frameIndex];
            this.mascotCurrentFrame = frameIndex;
        }
    }

    private startMascotAnimation() {
        const selectNewRandomFrame = () => {
            let nextFrameToDisplay;
            const currentlyDisplayedFrame = this.mascotCurrentFrame;
            do {
                const randomIndex = Math.floor(Math.random() * this.mascotSearchAnimationFrames.length);
                nextFrameToDisplay = this.mascotSearchAnimationFrames[randomIndex];
            } while (this.mascotSearchAnimationFrames.length > 1 && nextFrameToDisplay === currentlyDisplayedFrame);
            this.setMascotFrame(nextFrameToDisplay);
        };

        selectNewRandomFrame();

        this.mascotAnimationInterval = window.setInterval(() => {
            selectNewRandomFrame();
        }, 450);
    }

    private stopMascotAnimation() {
        if (this.mascotAnimationInterval) {
            clearInterval(this.mascotAnimationInterval);
            this.mascotAnimationInterval = null;
        }
        this.setMascotFrame(0);
    }

    private updateMascotAnimationState() {
        if (this.mascotShouldAnimateForSearch || this.mascotShouldAnimateForHover) {
            if (!this.mascotAnimationInterval) {
                this.startMascotAnimation();
            }
        } else {
            if (this.mascotAnimationInterval) {
                this.stopMascotAnimation();
            }
        }
    }
}

new MapAnalyzer(); 