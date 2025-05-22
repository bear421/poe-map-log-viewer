import { Filter } from '../instance-tracker';
import { BaseComponent } from './base-component';
import { LogAggregation } from '../aggregation';
import { LevelUpEvent } from '../log-events';

export class FilterComponent extends BaseComponent<LogAggregation, HTMLDivElement> {
    private onFilterChange: (filter: Filter) => void;

    private readonly datePresetButtonIds = ['presetLastHourBtn', 'presetLast24HoursBtn', 'presetLast7DaysBtn', 'presetLast30DaysBtn'];
    private readonly mapPresetButtonIds = ['campaignBtn', 'presetWhiteMapsBtn', 'presetYellowMapsBtn', 'presetRedMapsBtn'];
    private readonly allPresetButtonIds = [...this.datePresetButtonIds, ...this.mapPresetButtonIds];

    private isInitialRenderDone: boolean = false;
    private prevCharactersSignature: string = "";

    constructor(onFilterChangeCallback: (filter: Filter) => void, container: HTMLDivElement) {
        super(document.createElement('div'), container);
        this.element.className = 'card mb-3 d-none';
        this.onFilterChange = onFilterChangeCallback;
    }

    protected render(): void {
        if (!this.isInitialRenderDone) {
            this.element.innerHTML = `
                <div class="card-header">
                    <h4 class="mb-0">Filter Data</h4>
                </div>
                <div class="card-body">
                    <div class="filters row g-3">
                        <div class="col-md-2">
                            <label for="characterFilter" class="form-label">Character</label>
                            <select id="characterFilter" class="form-select border-dark"></select>
                        </div>
                        <div class="col-md-1">
                            <label for="minCharacterLevelFilter" class="form-label">Min Level</label>
                            <input type="number" class="form-control border-dark" id="minCharacterLevelFilter" min="1" max="100">
                        </div>
                        <div class="col-md-1">
                            <label for="maxCharacterLevelFilter" class="form-label">Max Level</label>
                            <input type="number" class="form-control border-dark" id="maxCharacterLevelFilter" min="1" max="100">
                        </div>
                        <div class="col-md-2">
                            <label for="minLevelFilter" class="form-label">Min area Level</label>
                            <input type="number" class="form-control border-dark" id="minLevelFilter" min="1" max="100">
                        </div>
                        <div class="col-md-2">
                            <label for="maxLevelFilter" class="form-label">Max area Level</label>
                            <input type="number" class="form-control border-dark" id="maxLevelFilter" min="1" max="100">
                        </div>
                        <div class="col-md-2">
                            <label for="fromDateFilter" class="form-label">From Date</label>
                            <input type="date" class="form-control border-info" id="fromDateFilter">
                        </div>
                        <div class="col-md-2">
                            <label for="toDateFilter" class="form-label">To Date</label>
                            <input type="date" class="form-control border-info" id="toDateFilter">
                        </div>
                        <div class="col-4">
                            <button id="resetFiltersBtn" class="btn btn-outline-secondary">Reset</button>
                        </div>
                        <div class="map-presets col-2 d-flex justify-content-between">
                            <button id="campaignBtn" class="btn btn-sm btn-outline-dark" data-bs-toggle="button">
                                Campaign
                            </button>
                            <button id="presetWhiteMapsBtn" class="btn btn-sm btn-outline-dark" data-bs-toggle="button">
                                White Maps
                            </button>
                        </div>
                        <div class="map-presets col-2 d-flex justify-content-between">
                            <button id="presetYellowMapsBtn" class="btn btn-sm btn-outline-dark" data-bs-toggle="button">
                                Yellow Maps
                            </button>
                            <button id="presetRedMapsBtn" class="btn btn-sm btn-outline-dark" data-bs-toggle="button">
                                Red Maps
                            </button>
                        </div>
                        <div class="date-presets col-2 d-flex justify-content-between">
                            <button id="presetLastHourBtn" class="btn btn-sm btn-outline-info" data-bs-toggle="button">Last Hour</button>
                            <button id="presetLast24HoursBtn" class="btn btn-sm btn-outline-info" data-bs-toggle="button">Last 24 Hours</button>
                        </div>
                        <div class="date-presets col-2 d-flex justify-content-between">
                            <button id="presetLast7DaysBtn" class="btn btn-sm btn-outline-info" data-bs-toggle="button">Last 7 Days</button>
                            <button id="presetLast30DaysBtn" class="btn btn-sm btn-outline-info" data-bs-toggle="button">Last 30 Days</button>
                        </div>
                    </div>
                </div>
            `;
            this.setupEventListeners();
            this.isInitialRenderDone = true;
        }

        const characterSelect = this.element.querySelector<HTMLSelectElement>('#characterFilter')!;
        const characters: LevelUpEvent[] = (this.data) ? Array.from(this.data.characterAggregation.characters.values()) : [];
        const characterOptionsHTML = characters.map(char => 
            `<option value="${char.detail.character}">${char.detail.character} (${char.detail.level} ${char.detail.ascendancy})</option>`
        ).join('');
        if (characterOptionsHTML !== this.prevCharactersSignature) {
            const oldValue = characterSelect.value;
            characterSelect.innerHTML = `<option value="">All Characters</option>${characterOptionsHTML}`;
            
            const newOptionsArray = Array.from(characterSelect.options);
            if (newOptionsArray.some(opt => opt.value === oldValue)) {
                characterSelect.value = oldValue;
            } else {
                characterSelect.value = "";
            }

            this.prevCharactersSignature = characterOptionsHTML;
        }
    }

    private setupEventListeners(): void {
        this.element.querySelector('#characterFilter')?.addEventListener('input', () => {
            this.applyFilters();
        });

        this.element.querySelector('#applyFiltersBtn')?.addEventListener('click', () => {
            this.applyFilters();
        });
        
        this.element.querySelector('#resetFiltersBtn')?.addEventListener('click', () => {
            this.resetFilters();
        });
        
        this.element.querySelector('#presetLastHourBtn')?.addEventListener('click', (event) => {
            this.applyPreset('lastHour', event.currentTarget as HTMLButtonElement);
        });

        this.element.querySelector('#presetLast24HoursBtn')?.addEventListener('click', (event) => {
            this.applyPreset('last24Hours', event.currentTarget as HTMLButtonElement);
        });

        this.element.querySelector('#presetLast7DaysBtn')?.addEventListener('click', (event) => {
            this.applyPreset('last7Days', event.currentTarget as HTMLButtonElement);
        });

        this.element.querySelector('#presetLast30DaysBtn')?.addEventListener('click', (event) => {
            this.applyPreset('last30Days', event.currentTarget as HTMLButtonElement);
        });

        this.element.querySelector('#campaignBtn')?.addEventListener('click', (event) => {
            this.applyPreset('campaignMaps', event.currentTarget as HTMLButtonElement);
        });

        this.element.querySelector('#presetWhiteMapsBtn')?.addEventListener('click', (event) => {
            this.applyPreset('whiteMaps', event.currentTarget as HTMLButtonElement);
        });

        this.element.querySelector('#presetYellowMapsBtn')?.addEventListener('click', (event) => {
            this.applyPreset('yellowMaps', event.currentTarget as HTMLButtonElement);
        });

        this.element.querySelector('#presetRedMapsBtn')?.addEventListener('click', (event) => {
            this.applyPreset('redMaps', event.currentTarget as HTMLButtonElement);
        });

        (this.element.querySelector('#minLevelFilter') as HTMLInputElement)?.addEventListener('input', () => {
            this.deactivatePresetGroup('map');
            this.applyFilters();
        });
        (this.element.querySelector('#maxLevelFilter') as HTMLInputElement)?.addEventListener('input', () => {
            this.deactivatePresetGroup('map');
            this.applyFilters();
        });
        (this.element.querySelector('#fromDateFilter') as HTMLInputElement)?.addEventListener('input', () => {
            this.deactivatePresetGroup('date');
            this.applyFilters();
        });
        (this.element.querySelector('#toDateFilter') as HTMLInputElement)?.addEventListener('input', () => {
            this.deactivatePresetGroup('date');
            this.applyFilters();
        });
    }

    private deactivatePresetGroup(groupType: 'map' | 'date'): void {
        const buttonsToDeactivate = groupType === 'map' ? this.mapPresetButtonIds : this.datePresetButtonIds;
        buttonsToDeactivate.forEach(buttonId => {
            const btn = this.element.querySelector<HTMLButtonElement>(`#${buttonId}`);
            btn?.classList.remove('active');
        });
    }

    private applyFilters(): void {
        const minLevelInput = (this.element.querySelector('#minLevelFilter') as HTMLInputElement).value;
        const maxLevelInput = (this.element.querySelector('#maxLevelFilter') as HTMLInputElement).value;
        const fromDateInput = (this.element.querySelector('#fromDateFilter') as HTMLInputElement).value;
        const toDateInput = (this.element.querySelector('#toDateFilter') as HTMLInputElement).value;
        const characterInput = (this.element.querySelector('#characterFilter') as HTMLSelectElement).value;
        
        const filter = new Filter();
        
        if (minLevelInput) {
            filter.fromAreaLevel = parseInt(minLevelInput);
        }
        if (maxLevelInput) {
            filter.toAreaLevel = parseInt(maxLevelInput);
        }
        
        let lo = -Infinity, hi = Infinity;
        if (fromDateInput) {
            lo = new Date(fromDateInput).getTime();
        }
        if (toDateInput) {
            const toDate = new Date(toDateInput);
            toDate.setHours(23, 59, 59, 999); // Set to end of day
            hi = toDate.getTime();
        }
        filter.tsBounds = [{ lo, hi }];
        if (characterInput) {
            filter.character = characterInput;
        }
        this.onFilterChange(filter);
    }

    private applyPreset(presetType: 'lastHour' | 'last24Hours' | 'last7Days' | 'last30Days' | 'campaignMaps' | 'whiteMaps' | 'yellowMaps' | 'redMaps', clickedButton: HTMLButtonElement): void {
        const isActive = clickedButton.classList.contains('active');

        if (isActive) {
            const groupOfClicked = this.datePresetButtonIds.includes(clickedButton.id) ? this.datePresetButtonIds : this.mapPresetButtonIds;
            groupOfClicked.forEach(id => {
                if (id !== clickedButton.id) {
                    this.element.querySelector<HTMLButtonElement>(`#${id}`)?.classList.remove('active');
                }
            });

            // Apply the preset values
            const now = new Date();
            let fromDate = new Date(now); 
            switch (presetType) {
                case 'lastHour':
                    fromDate.setHours(now.getHours() - 1);
                    (this.element.querySelector('#fromDateFilter') as HTMLInputElement).value = this.formatDate(fromDate);
                    (this.element.querySelector('#toDateFilter') as HTMLInputElement).value = '';
                    break;
                case 'last24Hours':
                    fromDate.setDate(now.getDate() - 1);
                    (this.element.querySelector('#fromDateFilter') as HTMLInputElement).value = this.formatDate(fromDate);
                    (this.element.querySelector('#toDateFilter') as HTMLInputElement).value = '';
                    break;
                case 'last7Days':
                    fromDate.setDate(now.getDate() - 7);
                    (this.element.querySelector('#fromDateFilter') as HTMLInputElement).value = this.formatDate(fromDate);
                    (this.element.querySelector('#toDateFilter') as HTMLInputElement).value = '';
                    break;
                case 'last30Days':
                    fromDate.setDate(now.getDate() - 30);
                    (this.element.querySelector('#fromDateFilter') as HTMLInputElement).value = this.formatDate(fromDate);
                    (this.element.querySelector('#toDateFilter') as HTMLInputElement).value = '';
                    break;
                case 'campaignMaps':
                    (this.element.querySelector('#minLevelFilter') as HTMLInputElement).value = '1';
                    (this.element.querySelector('#maxLevelFilter') as HTMLInputElement).value = '67';
                    break;
                case 'whiteMaps':
                    (this.element.querySelector('#minLevelFilter') as HTMLInputElement).value = '65';
                    (this.element.querySelector('#maxLevelFilter') as HTMLInputElement).value = '69';
                    break;
                case 'yellowMaps':
                    (this.element.querySelector('#minLevelFilter') as HTMLInputElement).value = '70';
                    (this.element.querySelector('#maxLevelFilter') as HTMLInputElement).value = '74';
                    break;
                case 'redMaps':
                    (this.element.querySelector('#minLevelFilter') as HTMLInputElement).value = '75';
                    (this.element.querySelector('#maxLevelFilter') as HTMLInputElement).value = ''; 
                    break;
            }
        } else {
            if (this.datePresetButtonIds.includes(clickedButton.id)) {
                (this.element.querySelector('#fromDateFilter') as HTMLInputElement).value = '';
                (this.element.querySelector('#toDateFilter') as HTMLInputElement).value = '';
            } else if (this.mapPresetButtonIds.includes(clickedButton.id)) {
                (this.element.querySelector('#minLevelFilter') as HTMLInputElement).value = '';
                (this.element.querySelector('#maxLevelFilter') as HTMLInputElement).value = '';
            }
        }
        this.applyFilters();
    }

    private formatDate(date: Date): string {
        const year = date.getFullYear();
        const month = (date.getMonth() + 1).toString().padStart(2, '0');
        const day = date.getDate().toString().padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    private resetFilters(): void {
        (this.element.querySelector('#minLevelFilter') as HTMLInputElement).value = '';
        (this.element.querySelector('#maxLevelFilter') as HTMLInputElement).value = '';
        (this.element.querySelector('#fromDateFilter') as HTMLInputElement).value = '';
        (this.element.querySelector('#toDateFilter') as HTMLInputElement).value = '';
        
        this.allPresetButtonIds.forEach(buttonId => {
            const btn = this.element.querySelector<HTMLButtonElement>(`#${buttonId}`);
            btn?.classList.remove('active');
        });

        this.onFilterChange(new Filter());
    }
} 