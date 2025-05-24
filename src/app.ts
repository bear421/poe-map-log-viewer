declare var bootstrap: any;
import { Filter, MapInstance, Progress } from './log-tracker';
import { LogEvent } from './log-events';
import { Mascot } from './components/mascot';
import { FilterComponent } from './components/filter';
import { SearchComponent } from './components/search';
import { MapStatsComponent } from './components/map-stats';
import { OverviewComponent } from './components/overview';
import { FileSelectorComponent } from './components/file-selector';
import { JourneyComponent } from './components/journey';
import { MessagesComponent } from './components/messages';
import { LogAggregation, aggregate } from './aggregation';
import { logWorkerService } from './log-worker-service';

import './assets/css/styles.css';
import { BaseComponent } from './components/base-component';

export class App {

    private progressBar!: HTMLDivElement;
    private overviewTabPane!: HTMLDivElement;
    private mapsTabPane!: HTMLDivElement;
    private searchLogTabPane!: HTMLDivElement;
    private currentMaps: MapInstance[] = [];
    private currentEvents: LogEvent[] = [];
    private currentAggregation: LogAggregation | undefined = undefined;
    private mascot!: Mascot;
    private filterComponent!: FilterComponent;
    private searchComponent!: SearchComponent;
    private mapStatsComponent!: MapStatsComponent;
    private overviewComponent!: OverviewComponent;
    private fileSelectorComponent!: FileSelectorComponent;
    private selectedFile: File | null = null;
    private modalMascot!: Mascot;
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
    }

    private setupElements() {
        const container = document.createElement('div');
        container.className = 'container py-2 flex-grow-1 bg-white';
        const gradientSpaceLeft = document.createElement('div');
        gradientSpaceLeft.className = 'gradient-space-left';
        document.body.appendChild(gradientSpaceLeft);
        document.body.appendChild(container);
        const gradientSpaceRight = document.createElement('div');
        gradientSpaceRight.className = 'gradient-space-right';
        document.body.appendChild(gradientSpaceRight);

        const faviconLink = document.createElement('link');
        faviconLink.rel = 'icon';
        const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text x="50" y=".9em" font-size="80" text-anchor="middle">🔎</text></svg>`;
        faviconLink.href = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svgContent)}`;
        document.head.appendChild(faviconLink);

        const headerContainer = document.createElement('div');
        headerContainer.className = 'app-header-container';

        this.mascot = new Mascot(headerContainer);

        const titleElement = document.createElement('h1');
        titleElement.textContent = 'PoE Map Log Viewer';
        titleElement.style.marginLeft = '20px';
        titleElement.className = 'display-1';
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
            const aggregation = aggregate(this.currentMaps, this.currentEvents, filter, this.currentAggregation);
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
            <div class="modal" id="${modalId}" tabindex="-1" aria-labelledby="progressModalLabel" aria-hidden="true" data-bs-backdrop="static" data-bs-keyboard="false">
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
        
        this.modalMascot = new Mascot();
        const modalMascotElement = this.modalMascot.getElement();
        modalMascotElement.classList.add('mascot-on-modal');
        
        const modalHeader = modalElement.querySelector('.modal-header');
        if (modalHeader) {
            modalHeader.prepend(modalMascotElement);
        }
        
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
                <button class="nav-link" id="maps-tab" data-bs-toggle="tab" data-bs-target="#maps-tab-pane" type="button" role="tab" aria-controls="maps-tab-pane" aria-selected="false">Map stats</button>
            </li>
            <li class="nav-item" role="presentation">
                <button class="nav-link" id="journey-tab" data-bs-toggle="tab" data-bs-target="#journey-tab-pane" type="button" role="tab" aria-controls="journey-tab-pane" aria-selected="false">Journey</button>
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
        this.tabContentElement.appendChild(this.journeyTabPane);
        this.tabContentElement.appendChild(this.messagesTabPane);
        this.tabContentElement.appendChild(this.searchLogTabPane);
        container.appendChild(this.tabContentElement);
        
        this.overviewComponent = new OverviewComponent(this.overviewTabPane);
        this.mapStatsComponent = new MapStatsComponent(this.mapsTabPane);
        this.journeyComponent = new JourneyComponent(this.journeyTabPane);
        this.messagesComponent = new MessagesComponent(this.messagesTabPane);
        this.components = [this.overviewComponent, this.mapStatsComponent, this.journeyComponent, this.messagesComponent, this.filterComponent];  
        this.components.forEach(component => component.setApp(this));

        const importJsonInput = document.createElement('input');
        importJsonInput.type = 'file';
        importJsonInput.accept = '.json,application/json';
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

        const informComponentOnTabChange = (tabButton: HTMLElement, component: BaseComponent<any>) => {
            tabButton.addEventListener('shown.bs.tab', () => {
                component.setVisible(true);
                this.currentComponent = component;
            });
            tabButton.addEventListener('hide.bs.tab', () => {
                component.setVisible(false);
            });
        };

        informComponentOnTabChange(document.getElementById('overview-tab') as HTMLElement, this.overviewComponent);
        informComponentOnTabChange(document.getElementById('maps-tab') as HTMLElement, this.mapStatsComponent);
        informComponentOnTabChange(document.getElementById('journey-tab') as HTMLElement, this.journeyComponent);
        informComponentOnTabChange(document.getElementById('messages-tab') as HTMLElement, this.messagesComponent);
    }

    private handleData(maps: MapInstance[], events: LogEvent[]) {
        this.currentMaps = maps;
        this.currentEvents = events;
        const agg = aggregate(this.currentMaps, this.currentEvents, new Filter());
        this.currentAggregation = agg;
        this.displayResults(agg);
    }

    private async handleUpload(file: File) {
        if (!file) {
            this.showError('Please select a client.txt file');
            return;
        }
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
        const then = performance.now();
        for (const component of this.components) {
            component.updateData(agg);
        }
        this.currentComponent?.setVisible(true);
        const took = performance.now() - then;
        if (took > 20) {
            console.warn("Data processing and rendering for displayResults took " + took + " ms");
        }
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

    private showProgress(title: string = "Processing...") {
        const modalTitleElement = document.getElementById('progressModalLabel');
        if (modalTitleElement) {
            modalTitleElement.textContent = title;
        }

        const progressBarElement = this.progressBar.querySelector('.progress-bar') as HTMLElement;
        if (progressBarElement) {
            progressBarElement.style.width = `0%`;
            progressBarElement.textContent = `0%`;
            progressBarElement.setAttribute('aria-valuenow', '0');
        }

        this.mascot?.hide();
        this.modalMascot?.show();
        this.modalMascot?.setSearchAnimation(true);

        this.progressModalInstance.show();
    }

    private hideProgress() {
        this.progressModalInstance.hide();
        this.modalMascot?.hide();
        this.modalMascot?.setSearchAnimation(false);
        this.mascot?.show();
        this.mascot?.setSearchAnimation(false);
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
        
        this.modalMascot?.hide();
        this.modalMascot?.setSearchAnimation(false);
        this.mascot?.show();
    }

    private exportJsonData() {
        if (!this.currentAggregation) {
            this.showError('No data available to download.');
            return;
        }
        const jsonData = JSON.stringify(this.currentAggregation, null, 2);
        const blob = new Blob([jsonData], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'poe_map_log_data.json';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    private handleImportJson(file: File) {
        if (!file) {
            this.showError('Please select a JSON file to import.');
            return;
        }

        this.showProgress();

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const content = e.target?.result as string;
                if (!content) {
                    throw new Error("File content is empty.");
                }
                const data: LogAggregation = JSON.parse(content);

                if (data) {
                    this.hideProgress();
                    const overviewTabButton = document.getElementById('overview-tab');
                    if (overviewTabButton) {
                        bootstrap.Tab.getOrCreateInstance(overviewTabButton).show();
                    }
                    this.handleData(data.maps, data.events);
                    this.selectedFile = null;
                } else {
                    throw new Error('Invalid JSON format. Expected "maps" and "events" arrays.');
                }
            } catch (error: any) {
                console.error("Error importing JSON:", error);
                this.showError(`Error importing JSON: ${error.message}`);
                this.hideProgress();
                this.fileSelectorComponent.show();
            }
        };
        reader.onerror = (error) => {
            console.error("Error reading file:", error);
            this.showError('Error reading the selected file.');
            this.hideProgress();
            this.fileSelectorComponent.show();
        };

        reader.readAsText(file);
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