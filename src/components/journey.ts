import { MapInstance, MapSpan } from '../instance-tracker';
import { getZoneInfo } from '../data/zone_table';
import { LogAggregation } from '../aggregation';
import { BaseComponent } from './base-component';
import { binarySearch, BinarySearchMode } from '../binary-search';

interface ActDefinition {
    name: string;
    pattern: RegExp;
    maps: MapInstance[];
}

export class JourneyComponent extends BaseComponent<LogAggregation> {

    private actDefinitions: ActDefinition[] = [
        { name: 'Act 1', pattern: /^G1_.*/i, maps: [] },
        { name: 'Act 2', pattern: /^G2_.*/i, maps: [] },
        { name: 'Act 3', pattern: /^G3_.*/i, maps: [] },
        { name: 'Act 4', pattern: /^(C_G1_.*|G4_.*)/i, maps: [] },
        { name: 'Act 5', pattern: /^(C_G2_.*|G5_.*)/i, maps: [] },
        { name: 'Act 6', pattern: /^(C_G3_.*|G6_.*)/i, maps: [] },
        { name: 'Endgame', pattern: /.*/i, maps: [] } // Pattern is a placeholder for endgame logic
    ];

    private currentActIndex: number = 0;

    constructor(container: HTMLElement) {
        super(document.createElement('div'), container);
        this.element.className = 'journey-component-container mt-3';
    }

    private categorizeMaps(): void {
        this.actDefinitions.forEach(act => act.maps = []); // Reset maps

        const campaignActs = this.actDefinitions.slice(0, -1);
        const endgameAct = this.actDefinitions[this.actDefinitions.length - 1];

        for (const map of this.data!.maps) {
            let categorizedToCampaign = false;
            for (const act of campaignActs) {
                if (act.pattern.test(map.name)) {
                    act.maps.push(map);
                    categorizedToCampaign = true;
                    break;
                }
            }
            if (!categorizedToCampaign) {
                const nameLower = map.name.toLowerCase();
                // Check for endgame conditions based on map.name and map.seed
                // This logic is inspired by parts of MapInstance.areaType
                if (map.seed > 1) { // A defining characteristic of non-hideout/town areas
                    if (nameLower.startsWith("map") || // Standard maps
                        nameLower.startsWith("sanctum") || // Sanctum runs
                        nameLower.startsWith("expeditionlogbook") || // Logbooks
                        [ // Known tower map names from instance-tracker
                            "maplosttowers", "mapmesa", "mapalpineridge", "mapbluff", "mapswamptower"
                        ].includes(nameLower)
                    ) {
                        endgameAct.maps.push(map);
                    }
                }
            }
        }
    }

    protected render(): void {
        this.element.innerHTML = `
            <ul class="nav nav-pills mb-3" id="journeyActPills" role="tablist"></ul>
            <div class="tab-content" id="journeyActContent"></div>
        `;
        this.categorizeMaps();
        this.renderPills();
        this.renderTableForCurrentAct();
    }

    private renderPills(): void {
        const pillsContainer = this.element.querySelector('#journeyActPills');
        if (!pillsContainer) return;

        pillsContainer.innerHTML = '';

        this.actDefinitions.forEach((act, index) => {
            const pillItem = document.createElement('li');
            pillItem.className = 'nav-item';
            pillItem.setAttribute('role', 'presentation');

            const pillButton = document.createElement('button');
            pillButton.className = `nav-link ${index === this.currentActIndex ? 'active' : ''}`;
            pillButton.id = `journey-act-${index}-tab-btn`;
            pillButton.type = 'button';
            pillButton.setAttribute('role', 'tab');
            pillButton.textContent = `${act.name} (${act.maps.length})`;

            pillButton.addEventListener('click', (event) => {
                event.preventDefault();
                this.currentActIndex = index;
                this.render();
            });

            pillItem.appendChild(pillButton);
            pillsContainer.appendChild(pillItem);
        });
    }

    private renderTableForCurrentAct(): void {
        const contentContainer = this.element.querySelector('#journeyActContent');
        if (!contentContainer) return;

        contentContainer.innerHTML = '';

        const actData = this.actDefinitions[this.currentActIndex];
        if (!actData || actData.maps.length === 0) {
            contentContainer.innerHTML = `<p class="text-center mt-3">No maps recorded for ${actData?.name || 'this section'}.</p>`;
            return;
        }

        const table = document.createElement('table');
        table.className = 'table table-striped table-hover table-sm caption-top';
        table.innerHTML = `
            <caption>Displaying maps for ${actData.name}. Sorted chronologically by entry time.</caption>
            <thead>
                <tr>
                    <th>Area</th>
                    <th>Area Level</th>
                    <th>Character Level</th>
                    <th>Time Spent</th>
                    <th>Entered At</th>
                    <th class="text-center">Actions</th>
                </tr>
            </thead>
            <tbody></tbody>
        `;

        const tbody = table.querySelector('tbody');
        if (!tbody) return;

        const characterLevelIndex = this.data!.characterAggregation.characterLevelIndex;
        const sortedMaps = [...actData.maps].sort((a, b) => a.span.start - b.span.start);
        sortedMaps.forEach((map) => {
            const row = tbody.insertRow();
            const mapTimeMs = MapSpan.mapTime(map.span);
            const mapTimeFormatted = this.formatDuration(mapTimeMs);
            const levelUpEvent = characterLevelIndex[binarySearch(characterLevelIndex, map.span.start, (e) => e.ts, BinarySearchMode.FIRST)] ?? "?";

            row.insertCell().textContent = MapInstance.label(map);
            row.insertCell().textContent = map.areaLevel.toString();
            row.insertCell().textContent = levelUpEvent.detail.level.toString();
            row.insertCell().textContent = mapTimeFormatted;
            row.insertCell().textContent = new Date(map.span.start).toLocaleString();

            const actionsCell = row.insertCell();
            const zoneInfo = getZoneInfo(map.name);
            if (zoneInfo) {
                const anchor = document.createElement('a');
                anchor.href = zoneInfo.url;
                anchor.target = "_blank";
                anchor.rel = "noopener noreferrer";
                anchor.classList.add("btn", "btn-sm", "btn-outline-secondary");
                anchor.title = `Open ${zoneInfo.label} details on poe2db.tw`;

                const icon = document.createElement('i');
                icon.classList.add("bi", "bi-box-arrow-up-right");

                anchor.appendChild(icon);
                actionsCell.appendChild(anchor);
            }
        });

        contentContainer.appendChild(table);
    }

    private formatDuration(ms: number): string {
        const totalSeconds = Math.max(0, Math.floor(ms / 1000));
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;

        const sStr = seconds.toString().padStart(2, '0');
        const mStr = minutes.toString().padStart(2, '0');

        if (hours > 0) {
            const hStr = hours.toString().padStart(2, '0');
            return `${hStr}:${mStr}:${sStr}`;
        } else {
            return `${mStr}:${sStr}`;
        }
    }
} 