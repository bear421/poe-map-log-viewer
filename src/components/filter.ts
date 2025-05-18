import { Filter } from '../instance-tracker';

export class FilterComponent {
    private element: HTMLDivElement;
    private onFilterChange: (filter: Filter) => void;

    constructor(onFilterChangeCallback: (filter: Filter) => void) {
        this.onFilterChange = onFilterChangeCallback;
        this.element = document.createElement('div');
        this.element.className = 'card mb-3 d-none';
        this.render();
        this.setupEventListeners();
    }

    public getElement(): HTMLDivElement {
        return this.element;
    }

    public show(): void {
        this.element.classList.remove('d-none');
    }

    public hide(): void {
        this.element.classList.add('d-none');
    }

    private render(): void {
        this.element.innerHTML = `
            <div class="card-header">
                <h5 class="mb-0">Filter Data</h5>
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
    }

    private setupEventListeners(): void {
        this.element.querySelector('#applyFiltersBtn')?.addEventListener('click', () => {
            this.applyFilters();
        });
        
        this.element.querySelector('#resetFiltersBtn')?.addEventListener('click', () => {
            this.resetFilters();
        });
        
        this.element.querySelector('#presetLastHourBtn')?.addEventListener('click', () => {
            this.applyPreset('lastHour');
        });

        this.element.querySelector('#presetLast24HoursBtn')?.addEventListener('click', () => {
            this.applyPreset('last24Hours');
        });

        this.element.querySelector('#presetLast7DaysBtn')?.addEventListener('click', () => {
            this.applyPreset('last7Days');
        });

        this.element.querySelector('#presetLast30DaysBtn')?.addEventListener('click', () => {
            this.applyPreset('last30Days');
        });
    }

    private applyFilters(): void {
        const minLevelInput = (this.element.querySelector('#minLevelFilter') as HTMLInputElement).value;
        const maxLevelInput = (this.element.querySelector('#maxLevelFilter') as HTMLInputElement).value;
        const fromDateInput = (this.element.querySelector('#fromDateFilter') as HTMLInputElement).value;
        const toDateInput = (this.element.querySelector('#toDateFilter') as HTMLInputElement).value;
        
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
            toDate.setHours(23, 59, 59, 999); // Set to end of day
            filter.toMillis = toDate.getTime();
        }
        this.onFilterChange(filter);
    }

    private applyPreset(presetType: 'lastHour' | 'last24Hours' | 'last7Days' | 'last30Days'): void {
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

        (this.element.querySelector('#fromDateFilter') as HTMLInputElement).value = formatDate(fromDate);
        (this.element.querySelector('#toDateFilter') as HTMLInputElement).value = ''; // Clear toDate for presets

        this.applyFilters();
    }

    private resetFilters(): void {
        (this.element.querySelector('#minLevelFilter') as HTMLInputElement).value = '';
        (this.element.querySelector('#maxLevelFilter') as HTMLInputElement).value = '';
        (this.element.querySelector('#fromDateFilter') as HTMLInputElement).value = '';
        (this.element.querySelector('#toDateFilter') as HTMLInputElement).value = '';
        
        this.onFilterChange(new Filter());
    }
} 