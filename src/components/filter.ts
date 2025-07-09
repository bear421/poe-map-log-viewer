import { Filter, AreaType, areaTypeMeta } from '../ingest/log-tracker';
import { EventName, eventMeta } from '../ingest/events';
import { BaseComponent } from './base-component';
import { Facet } from './facet';
import { FacetFilterComponent } from './facet-filter';
import { relevantEventNames } from '../aggregate/aggregation';
import { BitSet } from '../bitset';

export class FilterComponent extends BaseComponent {
    private onFilterChange: (filter: Filter) => Promise<void>;

    private readonly datePresetButtonIds = ['presetLastHourBtn', 'presetLast24HoursBtn', 'presetLast7DaysBtn', 'presetLast30DaysBtn'];
    private readonly mapPresetButtonIds = ['campaignBtn', 'presetWhiteMapsBtn', 'presetYellowMapsBtn', 'presetRedMapsBtn'];
    private readonly allPresetButtonIds = [...this.datePresetButtonIds, ...this.mapPresetButtonIds];

    private prevCharactersSignature: string = "";
    private facetBitSet: BitSet | undefined;
    private filter: Filter | undefined;
    private facetFilter: FacetFilterComponent | undefined;

    constructor(onFilterChangeCallback: (filter: Filter) => Promise<void>, container: HTMLDivElement) {
        super(document.createElement('div'), container);
        this.element.className = 'card mb-3 d-none';
        this.onFilterChange = onFilterChangeCallback;
    }

    async init(): Promise<void> {
        this.element.innerHTML = `
                <div class="card-header">
                    <h4 class="mb-0">Filter Data</h4>
                </div>
                <div class="card-body">
                    <div class="filters">
                        <div class="broad row">
                            <div class="col-md-2">
                                <label for="characterFilter" class="form-label">Character</label>
                                <select id="characterFilter" class="form-select border-dark"></select>
                            </div>
                            <div class="col-md-1">
                                <label for="minCharacterLevelFilter" class="form-label">Min Lvl</label>
                                <input type="number" class="form-control border-dark" id="minCharacterLevelFilter" min="1" max="100">
                            </div>
                            <div class="col-md-1">
                                <label for="maxCharacterLevelFilter" class="form-label">Max Lvl</label>
                                <input type="number" class="form-control border-dark" id="maxCharacterLevelFilter" min="1" max="100">
                            </div>
                            <div class="col-md-2">
                                <label for="minLevelFilter" class="form-label">Min Area Lvl</label>
                                <input type="number" class="form-control border-dark" id="minLevelFilter" min="1" max="100">
                            </div>
                            <div class="col-md-2">
                                <label for="maxLevelFilter" class="form-label">Max Area Lvl</label>
                                <input type="number" class="form-control border-dark" id="maxLevelFilter" min="1" max="100">
                            </div>
                            <div class="col-md-2">
                                <label for="fromDateFilter" class="form-label">From Date</label>
                                <input type="date" class="form-control border-dark" id="fromDateFilter">
                            </div>
                            <div class="col-md-2">
                                <label for="toDateFilter" class="form-label">To Date</label>
                                <input type="date" class="form-control border-dark" id="toDateFilter">
                            </div>
                        </div>
                        <div class="facets row my-3"></div>
                        <div class="presets row">
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
                                <button id="presetLastHourBtn" class="btn btn-sm btn-outline-dark" data-bs-toggle="button">Last Hour</button>
                                <button id="presetLast24HoursBtn" class="btn btn-sm btn-outline-dark" data-bs-toggle="button">Last 24 Hours</button>
                            </div>
                            <div class="date-presets col-2 d-flex justify-content-between">
                                <button id="presetLast7DaysBtn" class="btn btn-sm btn-outline-dark" data-bs-toggle="button">Last 7 Days</button>
                                <button id="presetLast30DaysBtn" class="btn btn-sm btn-outline-dark" data-bs-toggle="button">Last 30 Days</button>
                            </div>
                        </div>
                    </div>
                </div>
            `;

        const relevantAreaTypes = this.data!.base.areaTypes.filter(at => at !== AreaType.Hideout && at !== AreaType.Town);

        const areaTypeFacet: Facet<AreaType> = {
            id: 'area-type',
            name: 'Area Type',
            operator: 'OR',
            selectedOptions: new Set(),
            getBitsetIndex: () => this.data!.base.areaTypeBitSetIndex,
            options: relevantAreaTypes.map(areaType => {
                const meta = areaTypeMeta[areaType];
                return { value: areaType, name: meta.name, icon: meta.icon, color: meta.color };
            }),
        };

        const mapNameFacet: Facet<string> = {
            id: 'map-name',
            name: 'Map Name',
            operator: 'OR',
            selectedOptions: new Set(),
            getBitsetIndex: () => this.data!.base.mapNameBitSetIndex,
            options: Array.from(this.data!.base.mapNameBitSetIndex.keys()).map(name => ({ value: name, name })),
        };

        const eventFacet: Facet<EventName> = {
            id: 'event',
            name: 'Events',
            operator: 'AND',
            selectedOptions: new Set(),
            getBitsetIndex: () => this.data!.base.eventBitSetIndex,
            options: Array.from(relevantEventNames).map(eventName => {
                const meta = eventMeta[eventName];
                return { value: eventName, name: meta.name, icon: meta.icon, color: meta.color };
            }),
        };
        
        const facetContainer = this.element.querySelector('.facets') as HTMLDivElement;
        const facetFilter = new FacetFilterComponent(facetContainer, [mapNameFacet, areaTypeFacet, eventFacet], async (combinedBitSet, _) => {
            this.facetBitSet = combinedBitSet;
            await this.applyFilters();
        });

        this.setupEventListeners();
        this.facetFilter = facetFilter;
        await facetFilter.setParentComponent(this);
    }

    protected async render(): Promise<void> {
        const characterSelect = this.element.querySelector<HTMLSelectElement>('#characterFilter')!;
        const characterOptionsHTML = this.data!.filteredCharacters
            .toReversed() // most recent character at the top of the select
            .map(char => `<option value="${char.name}">${char.name} (${char.level} ${char.ascendancy})</option>`)
            .join('');

        if (characterOptionsHTML !== this.prevCharactersSignature) {
            const oldValue = this.filter?.character ?? "";
            characterSelect.innerHTML = `<option value="">All Characters</option>${characterOptionsHTML}`;
            characterSelect.value = oldValue;
            this.prevCharactersSignature = characterOptionsHTML;
        }
    }

    private setupEventListeners(): void {
        this.element.querySelector('#characterFilter')?.addEventListener('input', () => {
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
        (this.element.querySelector('#minCharacterLevelFilter') as HTMLInputElement)?.addEventListener('input', () => {
            this.applyFilters();
        });
        (this.element.querySelector('#maxCharacterLevelFilter') as HTMLInputElement)?.addEventListener('input', () => {
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

    private async applyFilters(): Promise<void> {
        const minAreaLevelInput = (this.element.querySelector('#minLevelFilter') as HTMLInputElement).value;
        const maxAreaLevelInput = (this.element.querySelector('#maxLevelFilter') as HTMLInputElement).value;
        const minCharLevelInput = (this.element.querySelector('#minCharacterLevelFilter') as HTMLInputElement).value;
        const maxCharLevelInput = (this.element.querySelector('#maxCharacterLevelFilter') as HTMLInputElement).value;
        const fromDateInput = (this.element.querySelector('#fromDateFilter') as HTMLInputElement).value;
        const toDateInput = (this.element.querySelector('#toDateFilter') as HTMLInputElement).value;
        const characterInput = (this.element.querySelector('#characterFilter') as HTMLSelectElement).value;
        
        const filter = new Filter();
        
        if (minCharLevelInput) {
            filter.fromCharacterLevel = parseInt(minCharLevelInput);
        }
        if (maxCharLevelInput) {
            filter.toCharacterLevel = parseInt(maxCharLevelInput);
        }
        if (minAreaLevelInput) {
            filter.fromAreaLevel = parseInt(minAreaLevelInput);
        }
        if (maxAreaLevelInput) {
            filter.toAreaLevel = parseInt(maxAreaLevelInput);
        }
        
        let lo = -Infinity, hi = Infinity;
        if (fromDateInput) {
            const fromDate = new Date(fromDateInput);
            fromDate.setHours(0, 0, 0, 0);
            lo = fromDate.getTime();
        }
        if (toDateInput) {
            const toDate = new Date(toDateInput);
            toDate.setHours(23, 59, 59, 999);
            hi = toDate.getTime();
        }
        if (lo !== -Infinity || hi !== Infinity) {
            filter.userTsBounds = [{ lo, hi }];
        }
        if (characterInput) {
            filter.character = characterInput;
        }
        filter.mapBitSet = this.facetBitSet;
        this.filter = filter;
        await this.onFilterChange(filter);
    }

    getFilter(): Filter | undefined {
        return this.filter;
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

            const now = new Date();
            let fromDate = new Date(now); 
            const gameVersion = this.data!.gameVersion;
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
                    (this.element.querySelector('#maxLevelFilter') as HTMLInputElement).value = gameVersion === 2 ? '64' : '67';
                    break;
                case 'whiteMaps':
                    (this.element.querySelector('#minLevelFilter') as HTMLInputElement).value = gameVersion === 2 ? '65' : '68';
                    (this.element.querySelector('#maxLevelFilter') as HTMLInputElement).value = gameVersion === 2 ? '69' : '72';
                    break;
                case 'yellowMaps':
                    (this.element.querySelector('#minLevelFilter') as HTMLInputElement).value = gameVersion === 2 ? '70' : '74';
                    (this.element.querySelector('#maxLevelFilter') as HTMLInputElement).value = gameVersion === 2 ? '74' : '78';
                    break;
                case 'redMaps':
                    (this.element.querySelector('#minLevelFilter') as HTMLInputElement).value = gameVersion === 2 ? '75' : '79';
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
        (this.element.querySelector('#minCharacterLevelFilter') as HTMLInputElement).value = '';
        (this.element.querySelector('#maxCharacterLevelFilter') as HTMLInputElement).value = '';
        (this.element.querySelector('#fromDateFilter') as HTMLInputElement).value = '';
        (this.element.querySelector('#toDateFilter') as HTMLInputElement).value = '';
        (this.element.querySelector('#characterFilter') as HTMLSelectElement).value = '';
        
        this.allPresetButtonIds.forEach(buttonId => {
            const btn = this.element.querySelector<HTMLButtonElement>(`#${buttonId}`);
            btn?.classList.remove('active');
        });

        this.filter = new Filter();
        // implicitly calls applyFilters
        this.facetFilter!.reset();
    }
} 