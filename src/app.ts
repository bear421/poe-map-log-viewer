import { MapInstance, MapSpan } from './instance-tracker';
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

    constructor() {
        this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
        this.setupElements();
        this.setupEventListeners();
    }

    private setupElements() {
        const container = document.createElement('div');
        container.className = 'container mt-5';
        document.body.appendChild(container);

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

        this.progressBar = document.createElement('div');
        this.progressBar.className = 'd-none text-center mb-3';
        this.progressBar.innerHTML = `
            <div class="spinner-border text-primary" role="status">
                <span class="visually-hidden">Loading...</span>
            </div>
        `;
        container.appendChild(this.progressBar);

        // Create results container
        this.resultsDiv = document.createElement('div');
        this.resultsDiv.className = 'row';
        container.appendChild(this.resultsDiv);
    }

    private setupEventListeners() {
        this.uploadButton.addEventListener('click', () => this.handleUpload());
        
        this.worker.onmessage = (e: MessageEvent) => {
            const { type, data } = e.data;
            switch (type) {
                case 'complete':
                    this.displayResults(data.maps);
                    this.hideProgress();
                    break;
                case 'search':
                    this.displaySearchResults(data.lines);
                    this.hideProgress();
                    break;
                case 'error':
                    console.error(data.error);
                    this.showError(data.error);
                    this.hideProgress();
                    break;
            }
        };
    }

    private handleUpload() {
        const file = this.fileInput.files?.[0];
        if (!file) {
            this.showError('Please select a client.txt file');
            return;
        }

        this.clearResults();
        this.showProgress();
        this.worker.postMessage({ type: 'process', file });
    }

    private displayResults(maps: MapInstance[]) {
        // Calculate median times
        const times = maps.map(map => {
            const mapTime = MapSpan.mapTime(map.span);
            const loadTime = map.span.loadTime;
            const hideoutTime = map.span.hideoutTime;
            return { mapTime, loadTime, hideoutTime };
        });

        const getMedian = (arr: number[]) => {
            const sorted = [...arr].sort((a, b) => a - b);
            const mid = Math.floor(sorted.length / 2);
            return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
        };

        const medianMapTime = getMedian(times.map(t => t.mapTime));
        const medianLoadTime = getMedian(times.map(t => t.loadTime));
        const medianIdleTime = getMedian(times.map(t => t.hideoutTime));

        // Create pie chart container
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
                        <h5 class="card-title">${mapName}</h5>
                        <p class="card-text">
                            Count: ${stats.count}<br>
                            Levels: ${Array.from(stats.levels).sort((a, b) => a - b).join(', ')}<br>
                            Avg Time: ${stats.avgTime.toFixed(2)} minutes<br>
                            Total Time: ${stats.totalTime.toFixed(2)} minutes<br>
                        </p>
                    </div>
                </div>
            `;
            this.resultsDiv.appendChild(card);
        });
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
}

new MapAnalyzer(); 