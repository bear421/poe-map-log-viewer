import {
    Chart,
    BarController,
    BarElement,
    CategoryScale,
    LinearScale,
    ChartConfiguration,
    Tooltip,
    Legend
} from 'chart.js';
import { BaseComponent } from './base-component';
import { LogAggregationCube, aggregateBy, Dimension, Metric, Aggregation, metricMeta } from '../aggregate/aggregation';
import { createElementFromHTML, formatDuration } from '../util';

Chart.register(
    BarController, 
    BarElement, 
    CategoryScale, 
    LinearScale,
    Tooltip,
    Legend
);

export class AnalysisComponent extends BaseComponent {
    private chartInstance: Chart | null = null;
    private xAxisSelect!: HTMLSelectElement;
    private yAxisSelect!: HTMLSelectElement;
    private aggregationSelect!: HTMLSelectElement;

    constructor(container: HTMLElement) {
        super(createElementFromHTML(`<div class="analysis-component-container"></div>`), container);
    }

    protected init(): void {
        this.createControls();
        this.updateChart();
    }

    protected async render(): Promise<void> {
        const characterOption = this.xAxisSelect.querySelector('.character-dimension') as HTMLOptionElement;
        const filterCharacter = !!this.data!.filter.character;
        if (characterOption.selected && filterCharacter) {
            this.xAxisSelect.value = filterCharacter ? Dimension.characterLevel.toString() : Dimension.character.toString();
        }
        characterOption.disabled = filterCharacter;
        return this.updateChart();
    }

    private createControls(): void {
        const delveOption = ''; // ${this.data!.mapsDelve.length > 0 ? `<option value="${Metric.delveNodes}">Delve Nodes</option>` : ''}
        const controlsContainer = createElementFromHTML(`
            <div class="row mb-3">
                <div class="col-md-4">
                    <label for="xAxisSelect" class="form-label">Group by (X-Axis)</label>
                    <select id="xAxisSelect" class="form-select">
                        <option value="${Dimension.character}" class="character-dimension">Character</option>
                        <option value="${Dimension.characterLevel}">Character Level</option>
                        <option value="${Dimension.areaLevel}">Area Level</option>
                        <option value="${Dimension.date}">Date</option>
                        <option value="${Dimension.hourOfDay}">Hour of Day</option>
                        <option value="${Dimension.hourOfSession}">Hour of Session</option>
                        <option value="${Dimension.dayOfWeek}">Day of Week</option>
                    </select>
                </div>
                <div class="col-md-4">
                    <label for="yAxisSelect" class="form-label">Value (Y-Axis)</label>
                    <select id="yAxisSelect" class="form-select">
                        <option value="${Metric.maps}">Maps</option>
                        ${delveOption}
                        <option value="${Metric.deaths}">Deaths</option>
                        <option value="${Metric.witnessedDeaths}">Witnessed Deaths</option>
                        <option value="${Metric.mapTime}">Map Time</option>
                        <option value="${Metric.hideoutTime}">Hideout Time</option>
                        <option value="${Metric.loadTime}">Load Time</option>
                        <option value="${Metric.afkTime}">AFK Time</option>
                        <option value="${Metric.campaignTime}">Campaign Time</option>
                        <option value="${Metric.totalTime}">Total Time</option>
                        <option value="${Metric.bossKills}">Boss Kills</option>
                        <option value="${Metric.sessions}">Sessions</option>
                    </select>
                </div>
                <div class="col-md-4">
                    <label for="aggregationSelect" class="form-label">Aggregation</label>
                    <select id="aggregationSelect" class="form-select">
                        <option value="${Aggregation.total}">Total</option>
                        <option value="${Aggregation.median}">Median</option>
                        <option value="${Aggregation.average}">Average</option>
                        <option value="${Aggregation.max}">Max</option>
                        <option value="${Aggregation.min}">Min</option>
                    </select>
                </div>
            </div>
        `);
        this.element.appendChild(controlsContainer);

        this.xAxisSelect = this.element.querySelector('#xAxisSelect') as HTMLSelectElement;
        this.yAxisSelect = this.element.querySelector('#yAxisSelect') as HTMLSelectElement;
        this.aggregationSelect = this.element.querySelector('#aggregationSelect') as HTMLSelectElement;

        this.xAxisSelect.addEventListener('change', () => this.updateChart());
        this.yAxisSelect.addEventListener('change', () => this.updateChart());
        this.aggregationSelect.addEventListener('change', () => this.updateChart());
    }

    private async updateChart(): Promise<void> {
        let chartCanvas = this.element.querySelector('#analysisChart') as HTMLCanvasElement;
        if (!chartCanvas) {
            const chartCard = document.createElement('div');
            chartCard.className = 'card';
            chartCard.innerHTML = `
                <div class="card-body">
                    <canvas id="analysisChart"></canvas>
                </div>
            `;
            this.element.appendChild(chartCard);
            chartCanvas = this.element.querySelector('#analysisChart') as HTMLCanvasElement;
        }
        
        const chartCtx = chartCanvas.getContext('2d');
        if (!chartCtx) return;

        const agg = this.data!;
        const dimension = parseInt(this.xAxisSelect.value) as Dimension;
        const metric = parseInt(this.yAxisSelect.value) as Metric;
        const isTimeMetric = !metricMeta[metric].discrete;
        if (isTimeMetric) {
            this.aggregationSelect.disabled = false;
        } else {
            this.aggregationSelect.disabled = true;
            this.aggregationSelect.value = Aggregation.total.toString();
        }
        const aggregation = parseInt(this.aggregationSelect.value) as Aggregation;
        const chartData = await this.getChartData(agg, dimension, metric, aggregation);

        if (chartData.labels.length === 0) {
            chartCtx.font = "16px Arial";
            chartCtx.textAlign = "center";
            chartCtx.fillText("No data for selected dimensions", chartCanvas.width / 2, chartCanvas.height / 2);
            return;
        }

        const chartConfig: ChartConfiguration = {
            type: 'bar',
            data: {
                labels: chartData.labels,
                datasets: [{
                    label: this.yAxisSelect.options[this.yAxisSelect.selectedIndex].text,
                    data: chartData.data,
                    backgroundColor: 'rgba(13,110,253,1)',
                }]
            },
            options: {
                animation: { duration: 0 },
                responsive: true,
                maintainAspectRatio: true,
                scales: {
                    y: {
                        beginAtZero: true,
                        title: {
                            display: true,
                            text: this.yAxisSelect.options[this.yAxisSelect.selectedIndex].text
                        },
                        ticks: {
                            callback: isTimeMetric ? 
                                (value) => formatDuration(value as number) :
                                (value) => value
                        }
                    },
                    x: {
                        title: {
                            display: true,
                            text: this.xAxisSelect.options[this.xAxisSelect.selectedIndex].text
                        }
                    }
                },
                plugins: {
                    legend: {
                        display: false
                    },
                    tooltip: {
                        callbacks: {
                            label: (context) => {
                                const raw = context.raw as number;
                                const formattedValue = isTimeMetric ? formatDuration(raw) : raw;
                                return `${context.dataset.label}: ${formattedValue}`;
                            }
                        }
                    }
                }
            }
        };
        if (this.chartInstance) {
            this.chartInstance.destroy();
            this.chartInstance = null;
        }
        this.chartInstance = new Chart(chartCtx, chartConfig);
    }

    private async getChartData(agg: LogAggregationCube, dimension: Dimension, metric: Metric, aggregation: Aggregation): Promise<{ labels: string[], data: number[] }> {
        const aggregatedData = await aggregateBy(agg, dimension, metric, aggregation);
        /*
        const sortedKeys = Array.from(aggregatedData.keys()).sort((a, b) => {
            if (typeof a === 'number' && typeof b === 'number') {
                return a - b;
            }
            if (dimension === Dimension.date) {
                return new Date(a as string).getTime() - new Date(b as string).getTime();
            }
            return String(a).localeCompare(String(b));
        });
        
        const labels = sortedKeys.map(key => {
            return String(key);
        });

        const data = sortedKeys.map(key => aggregatedData.get(key)!);
        */
        const labels = Array.from(aggregatedData.keys()).map(key => String(key));
        const data = Array.from(aggregatedData.values());
        return { labels, data };
    }
} 