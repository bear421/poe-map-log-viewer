import { MapSpan } from '../ingest/log-tracker';
import {
    Chart,
    ArcElement,
    Tooltip,
    Legend,
    PieController,
    BarController,
    BarElement,
    CategoryScale,
    LinearScale,
    ChartItem,
    ChartConfiguration
} from 'chart.js';
import { BaseComponent } from './base-component';
import { medianQuickSelect } from '../aggregation';
import { FrameBarrier } from '../util';

Chart.register(
    ArcElement, 
    Tooltip, 
    Legend, 
    PieController, 
    BarController, 
    BarElement, 
    CategoryScale, 
    LinearScale
);

export class OverviewComponent extends BaseComponent {
    private chartInstance: Chart | null = null;

    constructor(container: HTMLElement) {
        super(document.createElement('div'), container);
        this.element.className = 'overview-component-container';
    }

    protected async render(): Promise<void> {
        const agg = this.data!;
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

        const fb = new FrameBarrier();
        const medianMapTime = times.length > 0 ? medianQuickSelect(times.map(t => t.mapTime)) : 0;
        await fb.yield();
        const medianLoadTime = times.length > 0 ? medianQuickSelect(times.map(t => t.loadTime)) : 0;
        await fb.yield();
        const medianIdleTime = times.length > 0 ? medianQuickSelect(times.map(t => t.hideoutTime)) : 0;

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
            { label: 'Maps', value: agg.maps.length, iconClass: 'bi-globe text-dark', optional: false},
            { label: 'Sessions', value: agg.totalSessions, iconClass: 'bi-power text-dark', optional: false },
            { label: 'Unique maps', value: agg.mapsUnique.length, iconClass: 'bi-gem text-unique', optional: true },
            { label: 'Delve Nodes', value: agg.mapsDelve.length, iconClass: 'bi-diamond-half text-primary', optional: true },
            { label: 'Pinnacle Boss kills', value: agg.totalBossKills, iconClass: 'bi-trophy-fill text-warning', optional: true },
            { label: `Map time`, value: `${(agg.totalMapTime / (1000 * 60 * 60)).toFixed(1)}h`, iconClass: 'bi-clock text-dark', optional: false },
            { label: `Hideout time`, value: `${(agg.totalHideoutTime / (1000 * 60 * 60)).toFixed(1)}h`, iconClass: 'bi-house-fill text-primary', optional: false },
            { label: `Load time`, value: `${(agg.totalLoadTime / (1000 * 60 * 60)).toFixed(1)}h`, iconClass: 'bi-stopwatch text-dark', optional: false },
            { label: 'Deaths', value: agg.totalDeaths, iconClass: 'bi-heartbreak-fill text-danger', optional: false },
            { label: 'Witnessed deaths', value: agg.totalWitnessedDeaths, iconClass: 'bi-heartbreak-fill text-secondary', optional: false },
            { label: 'Items identified (bulk)', value: totalItemsIdentified, iconClass: 'bi-magic text-dark', optional: true },
            { label: 'Trades (NPCs and Players)', value: agg.totalTrades, iconClass: 'bi-currency-exchange text-warning', optional: false },
            { label: 'Item purchases attempted', value: agg.totalBuysAttempted, iconClass: 'bi-cart-fill text-dark', optional: true },
            { label: 'Item sales attempted', value: agg.totalSalesAttempted, iconClass: 'bi-tags-fill text-dark', optional: true }
        ];
        const totalsHtml = totals.filter(t => !t.optional || typeof t.value !== 'number' || t.value !== 0).map(t => 
            `
            <dt class="col-9"><i class="${t.iconClass} me-2"></i>${t.label}</dt>
            <dd class="col-3 text-end">${t.value}</dd>
            `
        ).join('\n');
        /*
        const totalsHtml = totals.filter(t => !t.optional || typeof t.value !== 'number' || t.value !== 0).map(t => 
            `
            <button type="button" class="btn btn-outline-primary">
                <i class="${t.iconClass} me-2"></i>${t.label} <span class="badge rounded-pill bg-dark">${t.value}</span>
            </button>
            `
        ).join('\n');
        */
        summaryCard.className = 'col-md-6 mb-4';
        summaryCard.innerHTML = `
            <div class="card">
                <div class="card-body">
                    <h4 class="card-title border-bottom border-fade-secondary">Totals</h4>
                    <div class="card-text">
                        <dl class="row mb-0 fs-5">${totalsHtml}</dl>
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

        // clear innerHTML AFTER possibly RAF yield to avoid flickering
        this.element.innerHTML = '';
        this.element.appendChild(overviewRow);

        const timeDistCtx = (this.element.querySelector('#timeDistributionChartOverview') as ChartItem);
        if (timeDistCtx && agg.maps.length > 0) { // Only render chart if there's data
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
            if (this.chartInstance) {
                this.chartInstance.destroy();
                this.chartInstance = null;
            }
            this.chartInstance = new Chart(timeDistCtx, chartConfig);
        } else if (timeDistCtx) {
            // Optional: Display a message if no data for chart
             const canvasCtx = (timeDistCtx as HTMLCanvasElement).getContext('2d');
             if(canvasCtx) {
                canvasCtx.font = "16px Arial";
                canvasCtx.textAlign = "center";
                canvasCtx.fillText("No map data for chart", (timeDistCtx as HTMLCanvasElement).width / 2, (timeDistCtx as HTMLCanvasElement).height / 2);
             }
        }
    }
} 