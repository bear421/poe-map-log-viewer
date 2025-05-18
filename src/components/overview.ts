import { MapInstance, MapSpan } from '../instance-tracker';
import { LogEvent } from '../event-dispatcher';
import {
    Chart,
    ArcElement,
    Tooltip,
    Legend,
    PieController,
    ChartItem,
    ChartConfiguration
} from 'chart.js';

// Chart.js elements are typically registered globally once.
// If Chart.register was already called in app.ts, it might not be strictly necessary here,
// but it's safe to include it to make the component self-contained regarding its dependencies.
Chart.register(ArcElement, Tooltip, Legend, PieController);

export class OverviewComponent {
    private element: HTMLDivElement;
    private chartInstance: Chart | null = null;

    constructor() {
        this.element = document.createElement('div');
        this.element.className = 'overview-component-container';
    }

    public getElement(): HTMLDivElement {
        return this.element;
    }

    public update(maps: MapInstance[], events: LogEvent[]): void {
        this.render(maps, events);
    }

    private getMedian(arr: number[]): number {
        if (arr.length === 0) return 0;
        const sorted = [...arr].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    };

    private render(maps: MapInstance[], events: LogEvent[]): void {
        this.element.innerHTML = '';

        if (this.chartInstance) {
            this.chartInstance.destroy();
            this.chartInstance = null;
        }

        const times = maps.map(map => {
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

        const foreignCharacters = new Set<string>();
        const characters = new Map<string, any>();
        let characterTsIndex: LogEvent[] = [];
        let totalItemsBought = 0, totalItemsSold = 0, totalBuysAttempted = 0, totalSalesAttempted = 0;
        let totalDeaths = 0;
        
        enum TradeState { buying, selling, none }
        let tradeState: TradeState = TradeState.none;

        events.forEach(event => {
            switch (event.name) {
                case "msgFrom":
                    if (event.detail.msg.startsWith("Hi, I would like to buy your")) {
                        tradeState = TradeState.selling;
                        totalSalesAttempted++;
                    }
                    break;
                case "msgTo":
                    if (event.detail.msg.startsWith("Hi, I would like to buy your")) {
                        tradeState = TradeState.buying;
                        totalBuysAttempted++;
                    }
                    break;
                case "tradeAccepted":
                    // this implementation is inaccurate: 
                    // A) buy / sell request order does not necessarily match tradeAccepted order
                    // B) tradeAccepted may come from a non-trade site trade (e.g. party member)
                    // FIXME instead, buffer "pending" trades and have tradeAccepted events consume them with a certain timeout threshold
                    // (otherwise, this severely overcounts failed trades for concurrent trades)
                    if (tradeState === TradeState.buying) {
                        totalItemsBought++;
                    } else if (tradeState === TradeState.selling) {
                        totalItemsSold++;
                    }
                    tradeState = TradeState.none;
                    break;
                case "levelUp":
                    characterTsIndex.push(event);
                    characters.set(event.detail.character, event.detail.level);
                    break;
                case "death":
                    characterTsIndex.push(event);
                    totalDeaths++;
                    break;
                case "msgParty":
                    characterTsIndex.push(event);
                    break;
                case "joinedArea":
                    foreignCharacters.add(event.detail.character);
                    break;
            }
        });

        foreignCharacters.forEach(character => {
            characters.delete(character);
        });
        characterTsIndex = characterTsIndex.filter(event => characters.has(event.detail.character));
        console.log(characters);

        const overviewRow = document.createElement('div');
        overviewRow.className = 'row';

        const summaryCard = document.createElement('div');
        summaryCard.className = 'col-md-6 mb-4';
        summaryCard.innerHTML = `
            <div class="card">
                <div class="card-body">
                    <h4 class="card-title">Totals</h4>
                    <div class="card-text">
                        <dl class="row mb-0 fs-5">
                            <dt class="col-9"><i class="bi bi-map me-2"></i>Maps</dt>
                            <dd class="col-3 text-end">${maps.length}</dd>

                            <dt class="col-9"><i class="bi bi-clock-history me-2"></i>Total map time</dt>
                            <dd class="col-3 text-end">${(maps.reduce((acc, map) => acc + MapSpan.mapTime(map.span), 0) / (1000 * 60 * 60)).toFixed(1)}h</dd>

                            <dt class="col-9"><i class="bi bi-stopwatch me-2"></i>Total load time</dt>
                            <dd class="col-3 text-end">${(maps.reduce((acc, map) => acc + map.span.loadTime, 0) / (1000 * 60 * 60)).toFixed(1)}h</dd>

                            <dt class="col-9"><i class="bi bi-heartbreak text-danger me-2"></i>Deaths</dt>
                            <dd class="col-3 text-end">${totalDeaths}</dd>

                            <dt class="col-9"><i class="bi bi-magic me-2"></i>Items identified</dt>
                            <dd class="col-3 text-end">${events.reduce((acc, event) => acc + (event.name === "itemsIdentified" ? event.detail.count : 0), 0)}</dd>

                            <dt class="col-9"><i class="bi bi-cart-plus text-success me-2"></i>Item purchases</dt>
                            <dd class="col-3 text-end">${totalItemsBought}</dd>

                            <dt class="col-9"><i class="bi bi-cart-x text-danger me-2"></i>Item purchases failed</dt>
                            <dd class="col-3 text-end">${totalBuysAttempted - totalItemsBought}</dd>

                            <dt class="col-9"><i class="bi bi-tags text-success me-2"></i>Item sales</dt>
                            <dd class="col-3 text-end">${totalItemsSold}</dd>

                            <dt class="col-9"><i class="bi bi-tags text-danger me-2"></i>Item sales failed</dt>
                            <dd class="col-3 text-end">${totalSalesAttempted - totalItemsSold}</dd>
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
                    <h4 class="card-title">Time Distribution (Median)</h5>
                    <canvas id="timeDistributionChartOverview"></canvas>
                </div>
            </div>
        `;
        overviewRow.appendChild(chartCard);
        this.element.appendChild(overviewRow);

        const ctx = (this.element.querySelector('#timeDistributionChartOverview') as ChartItem);
        if (ctx && maps.length > 0) { // Only render chart if there's data
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
                            '#36A2EB', // Blue
                            '#FF6384', // Red
                            '#FFCE56'  // Yellow
                        ]
                    }]
                },
                options: {
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