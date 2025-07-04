declare var bootstrap: any;
import { Filter, LogLine, MapInstance, Progress } from './log-tracker';
import { LogEvent } from './log-events';
import { Emotion, Mascot } from './components/mascot';
import { FilterComponent } from './components/filter';
import { SearchComponent } from './components/search';
import { MapStatsComponent } from './components/map-stats';
import { OverviewComponent } from './components/overview';
import { AnalysisComponent } from './components/analysis';
import { FileSelectorComponent } from './components/file-selector';
import { JourneyComponent } from './components/journey';
import { MessagesComponent } from './components/messages';
import { LogAggregation, aggregateCached, clearAggregationCache } from './aggregation';
import { logWorkerService } from './log-worker-service';

import './assets/css/styles.css';
import { BaseComponent } from './components/base-component';

export class App {

    private progressBar!: HTMLDivElement;
    private overviewTabPane!: HTMLDivElement;
    private mapsTabPane!: HTMLDivElement;
    private searchLogTabPane!: HTMLDivElement;
    private analysisTabPane!: HTMLDivElement;
    private currentMaps: MapInstance[] = [];
    private currentEvents: LogEvent[] = [];
    private currentAggregation: LogAggregation | undefined = undefined;
    private mascot!: Mascot;
    private modalMascot!: Mascot;
    private filterComponent!: FilterComponent;
    private searchComponent!: SearchComponent;
    private mapStatsComponent!: MapStatsComponent;
    private overviewComponent!: OverviewComponent;
    private analysisComponent!: AnalysisComponent;
    private fileSelectorComponent!: FileSelectorComponent;
    private selectedFile: File | null = null;
    private journeyComponent!: JourneyComponent;
    private journeyTabPane!: HTMLDivElement;
    private messagesComponent!: MessagesComponent;
    private messagesTabPane!: HTMLDivElement;
    private components: BaseComponent<any>[] = [];
    private currentComponent: BaseComponent<any> | null = null;

    // Properties to manage UI element visibility
    private tabNavElement!: HTMLUListElement;
    private tabContentElement!: HTMLDivElement;
    private progressModalInstance!: any;

    constructor() {
        this.setupElements();
        this.setupEventListeners();
        setTimeout(() => {
            if (!this.selectedFile) {
                this.mascot.speak('Please select your Client.txt file to start', ['border-info', 'bg-gradient'], 30_000, Emotion.PLEADING);
            }
        }, 20 * 1000);
    }

    private setupElements() {
        const container = document.createElement('div');
        container.className = 'container py-2 rounded-4 bg-white';
        document.body.appendChild(container);

        const faviconLink = document.createElement('link');
        faviconLink.rel = 'icon';
        const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text x="50" y=".9em" font-size="80" text-anchor="middle">🔎</text></svg>`;
        faviconLink.href = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svgContent)}`;
        document.head.appendChild(faviconLink);

        const headerContainer = document.createElement('div');
        headerContainer.className = 'app-header-container';

        this.mascot = new Mascot(headerContainer);
        this.mascot.setVisible(true);

        const titleElement = document.createElement('h1');
        titleElement.textContent = 'PoE Map Log Viewer';
        titleElement.className = 'display-2';
        headerContainer.appendChild(titleElement);

        const githubButton = document.createElement('a');
        githubButton.href = 'https://github.com/bear421/poe-map-log-viewer';
        githubButton.target = '_blank';
        githubButton.rel = 'noopener noreferrer';
        githubButton.className = 'btn btn-outline-secondary ms-auto mt-2';
        githubButton.style.textDecoration = 'none';

        const githubIcon = document.createElement('i');
        githubIcon.className = 'bi bi-github me-2';

        const buttonText = document.createTextNode('View on GitHub');

        githubButton.appendChild(githubIcon);
        githubButton.appendChild(buttonText);
        headerContainer.appendChild(githubButton);

        container.prepend(headerContainer);

        this.filterComponent = new FilterComponent((filter: Filter) => {
            if (!this.currentMaps) {
                this.showError('No map data available to filter');
                return;
            }
            const aggregation = aggregateCached(this.currentMaps, this.currentEvents, filter, this.currentAggregation);
            this.currentAggregation = aggregation;
            this.displayResults(aggregation);
        }, container);

        this.fileSelectorComponent = new FileSelectorComponent((file: File) => {
            this.selectedFile = file;
            this.handleUpload(file);
        });
        container.appendChild(this.fileSelectorComponent.getElement());

        this.searchComponent = new SearchComponent((searchTerm: string) => {
            this.searchLog(searchTerm);
        });

        this.progressBar = document.createElement('div');
        this.progressBar.className = 'progress-container mb-3';
        this.progressBar.innerHTML = `
            <div class="progress" style="height: 25px;">
                <div class="progress-bar" role="progressbar" style="width: 0%;" aria-valuenow="0" aria-valuemin="0" aria-valuemax="100">0%</div>
            </div>
        `;

        const modalId = 'progressModal';
        const modalHtml = `
            <div class="modal progress-modal" id="${modalId}" tabindex="-1" data-bs-backdrop="static" data-bs-keyboard="false">
                <div class="modal-dialog modal-dialog-centered">
                    <div class="modal-content">
                        <div class="modal-header" style="position: relative;">
                            <h5 class="modal-title" id="progressModalLabel">Processing...</h5>
                        </div>
                        <div class="modal-body"></div>
                    </div>
                </div>
            </div>
        `;
        
        const modalTemplate = document.createElement('template');
        modalTemplate.innerHTML = modalHtml.trim();
        const modalElement = modalTemplate.content.firstChild as HTMLElement;
        
        this.modalMascot = new Mascot(modalElement.querySelector('.modal-header') as HTMLElement).setVisible(false);
        
        modalElement.querySelector('.modal-body')!.appendChild(this.progressBar);
        container.appendChild(modalElement);
        
        this.progressModalInstance = new bootstrap.Modal(document.getElementById(modalId) as HTMLElement);

        this.tabNavElement = document.createElement('ul');
        this.tabNavElement.className = 'nav nav-tabs mt-4 d-none';
        this.tabNavElement.id = 'resultsTabs';
        this.tabNavElement.setAttribute('role', 'tablist');
        this.tabNavElement.innerHTML = `
            <li class="nav-item" role="presentation">
                <button class="nav-link active" id="overview-tab" data-bs-toggle="tab" data-bs-target="#overview-tab-pane" type="button" role="tab" aria-controls="overview-tab-pane" aria-selected="true">Overview</button>
            </li>
            <li class="nav-item" role="presentation">
                <button class="nav-link" id="analysis-tab" data-bs-toggle="tab" data-bs-target="#analysis-tab-pane" type="button" role="tab" aria-controls="analysis-tab-pane" aria-selected="false">Analysis</button>
            </li>
            <li class="nav-item" role="presentation">
                <button class="nav-link" id="maps-tab" data-bs-toggle="tab" data-bs-target="#maps-tab-pane" type="button" role="tab" aria-controls="maps-tab-pane" aria-selected="false">Map stats</button>
            </li>
            <li class="nav-item" role="presentation">
                <button class="nav-link" id="journey-tab" data-bs-toggle="tab" data-bs-target="#journey-tab-pane" type="button" role="tab" aria-controls="journey-tab-pane" aria-selected="false">Campaign</button>
            </li>
            <li class="nav-item" role="presentation">
                <button class="nav-link" id="messages-tab" data-bs-toggle="tab" data-bs-target="#messages-tab-pane" type="button" role="tab" aria-controls="messages-tab-pane" aria-selected="false">Messages</button>
            </li>
            <li class="nav-item dropdown" role="presentation">
                <a class="nav-link dropdown-toggle" data-bs-toggle="dropdown" href="#" role="button" aria-expanded="false" id="advanced-tab">Advanced</a>
                <ul class="dropdown-menu" aria-labelledby="advanced-tab">
                    <li><button class="dropdown-item" id="search-log-tab" data-bs-toggle="tab" data-bs-target="#search-log-tab-pane" type="button" role="tab" aria-controls="search-log-tab-pane" aria-selected="false">Search raw log</button></li>
                    <li><button class="dropdown-item" type="button">Live Buffer</button></li>
                    <li><button class="dropdown-item" id="download-json-tab" type="button">Export processed JSON Data</button></li>
                    <li><button class="dropdown-item" id="import-json-tab" type="button">Import processed JSON Data</button></li>
                </ul>
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

        this.analysisTabPane = document.createElement('div');
        this.analysisTabPane.className = 'tab-pane fade p-3 border border-top-0 rounded-bottom';
        this.analysisTabPane.id = 'analysis-tab-pane';
        this.analysisTabPane.setAttribute('role', 'tabpanel');
        this.analysisTabPane.setAttribute('aria-labelledby', 'analysis-tab');
        this.analysisTabPane.setAttribute('tabindex', '0');

        this.journeyTabPane = document.createElement('div');
        this.journeyTabPane.className = 'tab-pane fade p-3 border border-top-0 rounded-bottom';
        this.journeyTabPane.id = 'journey-tab-pane';
        this.journeyTabPane.setAttribute('role', 'tabpanel');
        this.journeyTabPane.setAttribute('aria-labelledby', 'journey-tab');
        this.journeyTabPane.setAttribute('tabindex', '0');

        this.messagesTabPane = document.createElement('div');
        this.messagesTabPane.className = 'tab-pane fade p-3 border border-top-0 rounded-bottom';
        this.messagesTabPane.id = 'messages-tab-pane';
        this.messagesTabPane.setAttribute('role', 'tabpanel');
        this.messagesTabPane.setAttribute('aria-labelledby', 'messages-tab');
        this.messagesTabPane.setAttribute('tabindex', '0');

        this.searchLogTabPane = document.createElement('div');
        this.searchLogTabPane.className = 'tab-pane fade p-3 border border-top-0 rounded-bottom';
        this.searchLogTabPane.id = 'search-log-tab-pane';
        this.searchLogTabPane.setAttribute('role', 'tabpanel');
        this.searchLogTabPane.setAttribute('aria-labelledby', 'search-log-tab');
        this.searchLogTabPane.setAttribute('tabindex', '0');
        this.searchLogTabPane.appendChild(this.searchComponent.getElement());

        this.tabContentElement.appendChild(this.overviewTabPane);
        this.tabContentElement.appendChild(this.mapsTabPane);
        this.tabContentElement.appendChild(this.analysisTabPane);
        this.tabContentElement.appendChild(this.journeyTabPane);
        this.tabContentElement.appendChild(this.messagesTabPane);
        this.tabContentElement.appendChild(this.searchLogTabPane);
        container.appendChild(this.tabContentElement);
        
        this.overviewComponent = new OverviewComponent(this.overviewTabPane);
        this.mapStatsComponent = new MapStatsComponent(this.mapsTabPane);
        this.analysisComponent = new AnalysisComponent(this.analysisTabPane);
        this.journeyComponent = new JourneyComponent(this.journeyTabPane);
        this.messagesComponent = new MessagesComponent(this.messagesTabPane);
        this.components = [this.overviewComponent, this.mapStatsComponent, this.journeyComponent, this.messagesComponent, this.filterComponent, this.analysisComponent];  
        this.components.forEach(component => component.setApp(this));

        const importJsonInput = document.createElement('input');
        importJsonInput.type = 'file';
        importJsonInput.accept = '.mlv';
        importJsonInput.style.display = 'none';
        importJsonInput.id = 'import-json-input';
        container.appendChild(importJsonInput);
    }

    async searchLog(searchTerm: string, filter?: Filter) {
        if (!this.selectedFile) {
            this.showError('Please select a Client.txt file to search');
            return;
        }
        if (!filter) {
            filter = this.filterComponent.getFilter();
        }
        this.showProgress("Searching Log File...");
        try {
            const results = await logWorkerService.searchLog(new RegExp(searchTerm, 'i'), 1000, this.selectedFile, filter, (progress) => {
                this.updateProgressBar(progress.bytesRead, progress.totalBytes);
            });
            this.displaySearchLogResults(results.lines);
            this.tabNavElement.classList.remove('d-none');
            this.tabContentElement.classList.remove('d-none');
            const searchLogTabButton = document.getElementById('search-log-tab');
            if (searchLogTabButton) {
                const tabInstance = bootstrap.Tab.getOrCreateInstance(searchLogTabButton);
                tabInstance.show();
            }
        } catch (error: any) {
            console.error('Search error:', error);
            this.showError(error.message || 'Failed to search log file.');
        } finally {
            this.hideProgress();
        }
    }

    private setupEventListeners() {
        const downloadJsonButton = document.getElementById('download-json-tab');
        if (downloadJsonButton) {
            downloadJsonButton.addEventListener('click', () => this.exportJsonData());
        }

        const importJsonButton = document.getElementById('import-json-tab');
        const importJsonInput = document.getElementById('import-json-input') as HTMLInputElement;

        if (importJsonButton && importJsonInput) {
            importJsonButton.addEventListener('click', () => {
                importJsonInput.click();
            });

            importJsonInput.addEventListener('change', (event) => {
                const target = event.target as HTMLInputElement;
                if (target.files && target.files.length > 0) {
                    this.handleImportJson(target.files[0]);
                    target.value = '';
                }
            });
        }

        const informComponentOnTabChange = (tabId: string, component: BaseComponent<any>) => {
            const tabButton = document.getElementById(tabId) as HTMLElement;
            tabButton.addEventListener('shown.bs.tab', () => {
                component.setVisible(true);
                this.currentComponent = component;
                if (tabId === 'journey-tab' && !this.filterComponent.getFilter()?.character) {
                    this.mascot.speak('Please select a character to use the Campaign tab', ['border-warning']);
                }
            });
            tabButton.addEventListener('hide.bs.tab', () => {
                component.setVisible(false);
            });
        };

        informComponentOnTabChange('overview-tab', this.overviewComponent);
        informComponentOnTabChange('maps-tab', this.mapStatsComponent);
        informComponentOnTabChange('analysis-tab', this.analysisComponent);
        informComponentOnTabChange('journey-tab', this.journeyComponent);
        informComponentOnTabChange('messages-tab', this.messagesComponent);
    }

    private handleData(maps: MapInstance[], events: LogEvent[]) {
        this.currentMaps = maps;
        this.currentEvents = events;
        const agg = aggregateCached(this.currentMaps, this.currentEvents, new Filter());
        this.currentAggregation = agg;
        this.displayResults(agg);
    }

    private async handleUpload(file: File) {
        if (!file) {
            this.showError('Please select a client.txt file');
            return;
        }
        clearAggregationCache();
        this.showProgress("Processing Log File...");

        this.filterComponent.setVisible(false);
        this.tabNavElement.classList.add('d-none');
        this.tabContentElement.classList.add('d-none');
        try {
            const result = await logWorkerService.ingestLog(file, (progress: Progress) => {
                this.updateProgressBar(progress.bytesRead, progress.totalBytes);
            });
            this.fileSelectorComponent.hide();
            this.filterComponent.setVisible(true);
            this.tabNavElement.classList.remove('d-none');
            this.tabContentElement.classList.remove('d-none');
            const overviewTabButton = document.getElementById('overview-tab');
            if (overviewTabButton) {
                bootstrap.Tab.getOrCreateInstance(overviewTabButton).show();
            }
            this.currentComponent = this.overviewComponent;
            this.handleData(result.maps, result.events);
        } catch (error: any) {
            this.currentMaps = [];
            this.currentEvents = [];
            console.error('Processing error:', error);
            this.showError(error.message || 'Failed to process log file.');
            this.fileSelectorComponent.show();
        } finally {
            this.hideProgress();
        }
    }

    private displayResults(agg: LogAggregation) {
        for (const component of this.components) {
            component.updateData(agg);
        }
        this.mascot.updateData(agg);
        this.currentComponent?.setVisible(true);
    }

    private displaySearchLogResults(lines: LogLine[]) {
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
                    <pre class="card-text"><code>${lines.map(l => l.rawLine).join('\n')}</code></pre>
                </div>
            </div>
        `;
        this.searchLogTabPane.appendChild(resultsCard);
    }

    private showProgress(title: string = "Processing...") {
        document.getElementById('progressModalLabel')!.textContent = title;

        const progressBarElement = this.progressBar.querySelector('.progress-bar') as HTMLElement;
        if (progressBarElement) {
            progressBarElement.style.width = `0%`;
            progressBarElement.textContent = `0%`;
            progressBarElement.setAttribute('aria-valuenow', '0');
        }

        this.mascot.setVisible(false);
        this.modalMascot?.setAnimation(true);
        this.progressModalInstance.show();
    }

    private hideProgress() {
        this.progressModalInstance.hide();
        this.modalMascot?.setVisible(false);
        this.mascot?.setVisible(true);
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
        this.filterComponent.setVisible(false);
        this.tabNavElement.classList.add('d-none');
        this.tabContentElement.classList.add('d-none');

        const overviewTabButton = document.getElementById('overview-tab');
        if (overviewTabButton) {
            bootstrap.Tab.getOrCreateInstance(overviewTabButton).show();
        }
        
        this.modalMascot?.setVisible(false);
        this.mascot?.setVisible(true);
    }

    private async exportJsonData() {
        if (!this.currentAggregation) {
            this.showError('No data available to download.');
            return;
        }
        const data = { "maps": this.currentAggregation.maps, "events": this.currentAggregation.events };
        const jsonData = JSON.stringify(data, null, 2);
        const stream = new Blob([jsonData], { type: 'application/json' }).stream();
        const compressedStream = stream.pipeThrough(new CompressionStream('gzip'));
        const blob = await new Response(compressedStream).blob();

        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'poe_map_log_data.mlv';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    private async handleImportJson(file: File) {
        if (!file) {
            this.mascot.speak('Please select a file to import.', ['border-danger'], 30_000);
            return;
        }
        clearAggregationCache();

        this.showProgress("Importing Data...");
        try {
            const fileStream = file.stream();
            const decompressedStream = fileStream.pipeThrough(new DecompressionStream('gzip'));
            const reader = decompressedStream.getReader();
            let result = '';
            let done = false;
            const decoder = new TextDecoder();
            while (!done) {
                const { value, done: readerDone } = await reader.read();
                if (readerDone) {
                    done = true;
                    break;
                }
                result += decoder.decode(value, { stream: true });
            }
            result += decoder.decode(); // append tail

            if (!result) throw new Error("File content is empty or could not be decompressed.");

            const data: LogAggregation = JSON.parse(result);

            if (data && data.maps && data.events) {
                this.hideProgress();
                const overviewTabButton = document.getElementById('overview-tab');
                if (overviewTabButton) {
                    bootstrap.Tab.getOrCreateInstance(overviewTabButton).show();
                }
                this.handleData(data.maps, data.events);
                this.selectedFile = null;
            } else {
                this.mascot.speak('Invalid JSON format. Expected "maps" and "events" arrays.', ['border-danger'], 30_000);
                console.error("Invalid JSON format. Expected 'maps' and 'events' arrays.");
                this.hideProgress();
                this.fileSelectorComponent.show();
            }
        } catch (error: any) {
            this.mascot.speak(error.message || 'Failed to import file.', ['border-danger'], 30_000);
            console.error("Error processing imported file:", error);
            this.showError(error.message || 'Error processing the selected file.');
            this.hideProgress();
            this.fileSelectorComponent.show();
        }
    }

    private updateProgressBar(bytesRead: number, totalBytes: number) {
        if (totalBytes > 0) {
            const percent = Math.round((bytesRead / totalBytes) * 100);
            const progressBarElement = this.progressBar.querySelector('.progress-bar') as HTMLElement;
            if (progressBarElement) {
                progressBarElement.style.width = `${percent}%`;
                progressBarElement.textContent = `${percent}%`;
                progressBarElement.setAttribute('aria-valuenow', percent.toString());
            }
        }
    }

    getSelectedFile(): File | null {
        return this.selectedFile;
    }
}
new App(); 