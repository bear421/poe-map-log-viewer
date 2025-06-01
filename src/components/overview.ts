import { MapSpan } from '../log-tracker';
import {
    Chart,
    ArcElement,
    Tooltip,
    Legend,
    PieController,
    ChartItem,
    ChartConfiguration
} from 'chart.js';
import { BaseComponent } from './base-component';

Chart.register(ArcElement, Tooltip, Legend, PieController);

export class OverviewComponent extends BaseComponent {
    private chartInstance: Chart | null = null;

    constructor(container: HTMLElement) {
        super(document.createElement('div'), container);
        this.element.className = 'overview-component-container';
    }

    private getMedian(arr: number[]): number {
        if (arr.length === 0) return 0;
        const sorted = [...arr].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    };

    protected render(): void {
        this.element.innerHTML = '';
        const agg = this.data!;

        if (this.chartInstance) {
            this.chartInstance.destroy();
            this.chartInstance = null;
        }
        const times = agg.maps.map(map => {
            try {
                const mapTime = MapSpan.mapTime(map.span);
                const loadTime = map.span.loadTime;
                const hideoutTime = map.span.hideoutTime;
                return { mapTime, loadTime, hideoutTime };
            } catch (e) {
                console.error("Error calculating map times for overview:", e, map);
                return { mapTime: 0, loadTime: 0, hideoutTime: 0 };
            }
        });

        const medianMapTime = this.getMedian(times.map(t => t.mapTime));
        const medianLoadTime = this.getMedian(times.map(t => t.loadTime));
        const medianIdleTime = this.getMedian(times.map(t => t.hideoutTime));

        const overviewRow = document.createElement('div');
        overviewRow.className = 'row';

        const summaryCard = document.createElement('div');
        interface TotalStat {
            label: string;
            value: number | string;
            iconClass: string;
            optional: boolean;
        }
        const totalItemsIdentified = agg.events.reduce((acc, event) => acc + (event.name === "itemsIdentified" ? event.detail.count : 0), 0);
        const totals: TotalStat[] = [
            { label: 'Maps', value: agg.maps.length, iconClass: 'bi-globe', optional: false},
            { label: 'Sessions', value: agg.totalSessions, iconClass: 'bi-power', optional: false },
            { label: 'Unique maps', value: agg.mapsUnique.length, iconClass: 'bi-gem text-unique', optional: true },
            { label: 'Delve Nodes', value: agg.mapsDelve.length, iconClass: 'bi-diamond-half text-primary', optional: true },
            { label: 'Pinnacle Boss kills', value: agg.totalBossKills, iconClass: 'bi-trophy-fill text-warning', optional: true },
            { label: 'Map time', value: `${(agg.totalMapTime / (1000 * 60 * 60)).toFixed(1)}h`, iconClass: 'bi-clock', optional: false },
            { label: 'Hideout time', value: `${(agg.totalHideoutTime / (1000 * 60 * 60)).toFixed(1)}h`, iconClass: 'bi-house-fill text-primary', optional: false },
            { label: 'Load time', value: `${(agg.totalLoadTime / (1000 * 60 * 60)).toFixed(1)}h`, iconClass: 'bi-stopwatch', optional: false },
            { label: 'Deaths', value: agg.totalDeaths, iconClass: 'bi-heartbreak-fill text-danger', optional: false },
            { label: 'Witnessed deaths', value: agg.totalWitnessedDeaths, iconClass: 'bi-heartbreak-fill text-secondary', optional: false },
            { label: 'Items identified (bulk)', value: totalItemsIdentified, iconClass: 'bi-magic', optional: true },
            { label: 'Trades (NPCs and Players)', value: agg.totalTrades, iconClass: 'bi-currency-exchange text-warning', optional: false },
            { label: 'Item purchases attempted', value: agg.totalBuysAttempted, iconClass: 'bi-cart-fill', optional: true },
            { label: 'Item sales attempted', value: agg.totalSalesAttempted, iconClass: 'bi-tags-fill', optional: true }
        ];
        const totalsHtml = totals.filter(t => !t.optional || typeof t.value !== 'number' || t.value !== 0).map(t => 
            `
            <dt class="col-9"><i class="${t.iconClass} me-2"></i>${t.label}</dt>
            <dd class="col-3 text-end">${t.value}</dd>
            `
        ).join('\n');
        summaryCard.className = 'col-md-6 mb-4';
        summaryCard.innerHTML = `
            <div class="card">
                <div class="card-body">
                    <h4 class="card-title border-bottom border-fade-secondary">Totals</h4>
                    <div class="card-text">
                        <dl class="row mb-0 fs-5">
                            ${totalsHtml}
                        </dl>
                    </div>
                </div>
            </div>
        `;
        overviewRow.appendChild(summaryCard);

        const chartCard = document.createElement('div');
        chartCard.className = 'col-md-6 mb-4';
        chartCard.innerHTML = `
            <div class="card">
                <div class="card-body">
                    <h4 class="card-title border-bottom border-fade-secondary">Time Distribution (Median)</h5>
                    <canvas id="timeDistributionChartOverview"></canvas>
                </div>
            </div>
        `;
        overviewRow.appendChild(chartCard);
        this.element.appendChild(overviewRow);

        const ctx = (this.element.querySelector('#timeDistributionChartOverview') as ChartItem);
        if (ctx && agg.maps.length > 0) { // Only render chart if there's data
            const chartConfig: ChartConfiguration = {
                type: 'pie',
                data: {
                    labels: ['Active map time', 'Load time', 'Hideout time'],
                    datasets: [{
                        data: [
                            medianMapTime / 1000,    // seconds
                            medianLoadTime / 1000,   // seconds
                            medianIdleTime / 1000    // seconds
                        ],
                        backgroundColor: [
                            '#198754', // success
                            '#212529', // dark
                            '#0d6efd'  // primary
                        ]
                    }]
                },
                options: {
                    animation: { duration: 0 },
                    responsive: true,
                    maintainAspectRatio: true,
                    plugins: {
                        legend: {
                            position: 'top',
                        },
                        tooltip: {
                            callbacks: {
                                label: (context) => {
                                    const seconds = context.raw as number;
                                    const dataset = context.dataset.data;
                                    const total = dataset.reduce((acc: number, val) => acc + (typeof val === 'number' ? val : 0), 0);
                                    const percentage = total > 0 ? ((seconds / total) * 100).toFixed(1) : '0.0';

                                    if (context.label === 'Load time') {
                                        return `${context.label}: ${seconds.toFixed(1)} seconds (${percentage}%)`;
                                    }
                                    const minutes = (seconds / 60).toFixed(1);
                                    return `${context.label}: ${minutes} minutes (${percentage}%)`;
                                }
                            }
                        }
                    }
                }
            };
            this.chartInstance = new Chart(ctx, chartConfig);
        } else if (ctx) {
            // Optional: Display a message if no data for chart
             const canvasCtx = (ctx as HTMLCanvasElement).getContext('2d');
             if(canvasCtx) {
                canvasCtx.font = "16px Arial";
                canvasCtx.textAlign = "center";
                canvasCtx.fillText("No map data for chart", (ctx as HTMLCanvasElement).width / 2, (ctx as HTMLCanvasElement).height / 2);
             }
        }
    }
} 