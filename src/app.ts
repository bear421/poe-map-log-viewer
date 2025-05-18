declare var bootstrap: any;
import { Filter, MapInstance } from './instance-tracker';
import { LogEvent } from './event-dispatcher';
import {
    Chart,
    ArcElement,
    Tooltip,
    Legend,
    PieController
} from 'chart.js';
import { Mascot } from './components/mascot';
import { FilterComponent } from './components/filter';
import { SearchComponent } from './components/search';
import { MapStatsComponent } from './components/map-stats';
import { OverviewComponent } from './components/overview';
import { FileSelectorComponent } from './components/file-selector';

import './assets/css/styles.css';

Chart.register(ArcElement, Tooltip, Legend, PieController);

class MapAnalyzer {

    private worker: Worker;
    private progressBar!: HTMLDivElement;
    private overviewTabPane!: HTMLDivElement;
    private mapsTabPane!: HTMLDivElement;
    private searchLogTabPane!: HTMLDivElement;
    private currentMaps: MapInstance[] = [];
    private currentEvents: LogEvent[] = [];
    private mascot!: Mascot;
    private filterComponent!: FilterComponent;
    private searchComponent!: SearchComponent;
    private mapStatsComponent!: MapStatsComponent;
    private overviewComponent!: OverviewComponent;
    private fileSelectorComponent!: FileSelectorComponent;
    private selectedFile: File | null = null;

    // Properties to manage UI element visibility
    private tabNavElement!: HTMLUListElement;
    private tabContentElement!: HTMLDivElement;

    constructor() {
        this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
        this.setupElements();
        this.setupEventListeners();
    }

    private setupElements() {
        const container = document.createElement('div');
        container.className = 'container py-2 flex-grow-1 bg-white';
        document.body.appendChild(container);

        const faviconLink = document.createElement('link');
        faviconLink.rel = 'icon';
        const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text x="50" y=".9em" font-size="80" text-anchor="middle">🐻</text></svg>`;
        faviconLink.href = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svgContent)}`;
        document.head.appendChild(faviconLink);

        const headerContainer = document.createElement('div');
        headerContainer.style.display = 'flex';
        headerContainer.style.alignItems = 'flex-start';
        headerContainer.style.marginBottom = '-10px';

        this.mascot = new Mascot(headerContainer);

        const titleElement = document.createElement('h1');
        titleElement.textContent = 'PoE Map Log Viewer';
        titleElement.style.marginLeft = '20px';
        titleElement.className = 'display-1';
        headerContainer.appendChild(titleElement);

        container.prepend(headerContainer);

        this.filterComponent = new FilterComponent((filter: Filter) => {
            if (!this.currentMaps) {
                this.showError('No map data available to filter');
                return;
            }
            this.displayResults(Filter.filterMaps(this.currentMaps, filter), Filter.filterEvents(this.currentEvents, filter));
        });
        container.appendChild(this.filterComponent.getElement());

        this.fileSelectorComponent = new FileSelectorComponent((file: File) => {
            this.selectedFile = file;
            this.handleUpload(file);
        });
        container.appendChild(this.fileSelectorComponent.getElement());

        this.searchComponent = new SearchComponent((searchTerm: string) => {
            if (!this.selectedFile) {
                this.showError('Please select a Client.txt file to search');
                return;
            }
            this.showProgress();
            this.worker.postMessage({
                type: 'search',
                file: this.selectedFile,
                pattern: new RegExp(searchTerm, 'i'),
                limit: 500
            });
        });

        this.progressBar = document.createElement('div');
        this.progressBar.className = 'd-none text-center mb-3';
        this.progressBar.innerHTML = `
            <div class="spinner-border text-primary" role="status">
                <span class="visually-hidden">Loading...</span>
            </div>
        `;
        container.appendChild(this.progressBar);

        this.tabNavElement = document.createElement('ul');
        this.tabNavElement.className = 'nav nav-tabs mt-4 d-none';
        this.tabNavElement.id = 'resultsTabs';
        this.tabNavElement.setAttribute('role', 'tablist');
        this.tabNavElement.innerHTML = `
            <li class="nav-item" role="presentation">
                <button class="nav-link active" id="overview-tab" data-bs-toggle="tab" data-bs-target="#overview-tab-pane" type="button" role="tab" aria-controls="overview-tab-pane" aria-selected="true">Overview</button>
            </li>
            <li class="nav-item" role="presentation">
                <button class="nav-link" id="maps-tab" data-bs-toggle="tab" data-bs-target="#maps-tab-pane" type="button" role="tab" aria-controls="maps-tab-pane" aria-selected="false">Map stats</button>
            </li>
            <li class="nav-item" role="presentation">
                <button class="nav-link" id="search-log-tab" data-bs-toggle="tab" data-bs-target="#search-log-tab-pane" type="button" role="tab" aria-controls="search-log-tab-pane" aria-selected="false">Search raw log</button>
            </li>
        `;
        container.appendChild(this.tabNavElement);

        this.tabContentElement = document.createElement('div');
        this.tabContentElement.className = 'tab-content d-none';
        this.tabContentElement.id = 'resultsTabContent';

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

        this.searchLogTabPane = document.createElement('div');
        this.searchLogTabPane.className = 'tab-pane fade p-3 border border-top-0 rounded-bottom';
        this.searchLogTabPane.id = 'search-log-tab-pane';
        this.searchLogTabPane.setAttribute('role', 'tabpanel');
        this.searchLogTabPane.setAttribute('aria-labelledby', 'search-log-tab');
        this.searchLogTabPane.setAttribute('tabindex', '0');
        this.searchLogTabPane.appendChild(this.searchComponent.getElement());

        this.mapStatsComponent = new MapStatsComponent();
        this.overviewComponent = new OverviewComponent();

        this.tabContentElement.appendChild(this.overviewTabPane);
        this.tabContentElement.appendChild(this.mapsTabPane);
        this.tabContentElement.appendChild(this.searchLogTabPane);
        container.appendChild(this.tabContentElement);
    }

    private setupEventListeners() {
        this.worker.onmessage = (e: MessageEvent) => {
            const { type, data } = e.data;
            switch (type) {
                case 'complete':
                    this.currentMaps = data.maps;
                    this.currentEvents = data.events;
                    this.displayResults(data.maps, data.events);
                    this.hideProgress();

                    this.fileSelectorComponent.hide();

                    this.filterComponent.show();
                    this.tabNavElement.classList.remove('d-none');
                    this.tabContentElement.classList.remove('d-none');

                    const overviewTabButton = document.getElementById('overview-tab');
                    if (overviewTabButton) {
                        bootstrap.Tab.getOrCreateInstance(overviewTabButton).show();
                    }
                    break;
                case 'search':
                    this.displaySearchLogResults(data.lines);
                    this.hideProgress();
                    this.tabNavElement.classList.remove('d-none');
                    this.tabContentElement.classList.remove('d-none');

                    const searchLogTabButton = document.getElementById('search-log-tab');
                    if (searchLogTabButton) {
                        bootstrap.Tab.getOrCreateInstance(searchLogTabButton).show();
                    }
                    break;
                case 'error':
                    this.currentMaps = [];
                    this.currentEvents = [];
                    console.error(data.error);
                    this.showError(data.error);
                    this.hideProgress();
                    break;
            }
        };
    }

    private handleUpload(file: File) {
        if (!file) {
            this.showError('Please select a client.txt file');
            return;
        }
        this.clearResults();
        this.showProgress();

        this.filterComponent.hide();
        this.tabNavElement.classList.add('d-none');
        this.tabContentElement.classList.add('d-none');

        this.worker.postMessage({ type: 'process', file });
    }

    private displayResults(maps: MapInstance[], events: LogEvent[]) {
        this.clearResults();
        this.overviewTabPane.innerHTML = '';
        this.mapsTabPane.innerHTML = '';

        const then = performance.now();

        this.overviewTabPane.innerHTML = '';
        this.overviewComponent.update(maps, events);
        this.overviewTabPane.appendChild(this.overviewComponent.getElement());

        this.mapsTabPane.innerHTML = '';
        this.mapStatsComponent.update(maps, events);
        this.mapsTabPane.appendChild(this.mapStatsComponent.getElement());

        console.log("Data processing and rendering for displayResults took", (performance.now() - then) + " ms");
    }

    private displaySearchLogResults(lines: string[]) {
        if (!this.searchLogTabPane) return;

        const searchElement = this.searchComponent.getElement();
        
        this.searchLogTabPane.innerHTML = '';
        
        if (searchElement) {
            this.searchLogTabPane.appendChild(searchElement);
        }

        const resultsCard = document.createElement('div');
        resultsCard.className = 'mt-3';
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
        this.mascot.setSearchAnimation(true);
    }

    private hideProgress() {
        this.progressBar.classList.add('d-none');
        this.mascot.setSearchAnimation(false);
    }

    private showError(message: string) {
        const alert = document.createElement('div');
        alert.className = 'alert alert-danger alert-dismissible fade show';
        alert.innerHTML = `
            ${message}
            <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
        `;
        const mainContainer = document.querySelector('.container');
        if (this.overviewTabPane && this.overviewTabPane.closest('.tab-content') && !this.tabContentElement.classList.contains('d-none')) {
            this.overviewTabPane.prepend(alert);
        } else if (mainContainer) {
            mainContainer.prepend(alert);
        } else {
            document.body.prepend(alert);
        }

        this.fileSelectorComponent.show();
        this.filterComponent.hide();
        this.tabNavElement.classList.add('d-none');
        this.tabContentElement.classList.add('d-none');

        const overviewTabButton = document.getElementById('overview-tab');
        if (overviewTabButton) {
            bootstrap.Tab.getOrCreateInstance(overviewTabButton).show();
        }
        this.mascot.setSearchAnimation(false);
    }

    private clearResults() {
        if (this.overviewTabPane) {
            this.overviewTabPane.innerHTML = '';
        }
        if (this.mapsTabPane) {
            this.mapsTabPane.innerHTML = '';
        }
    }
}

new MapAnalyzer(); 