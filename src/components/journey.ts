import { MapInstance, MapSpan, Filter } from '../log-tracker';
import { getZoneInfo } from '../data/zone_table';
import { LogAggregation } from '../aggregation';
import { BaseComponent } from './base-component';
import { binarySearch, BinarySearchMode, binarySearchRange } from '../binary-search';
import { eventMeta, getEventMeta, LevelUpEvent, EventName } from '../log-events';
import { MapDetailComponent } from './map-detail';
import { App } from '../app';
interface ActDefinition {
    name: string;
    pattern: RegExp;
    maps: MapInstance[];
}

const journeyEventNames = new Set<EventName>([
    "death",
    "levelUp",
    "bossKill",
    "passiveGained",
    "mapReentered",
    "joinedArea",
    "leftArea",
    "tradeAccepted",
    "msgParty"
]);

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
    private mapDetailModal: MapDetailComponent;

    constructor(container: HTMLElement) {
        super(document.createElement('div'), container);
        this.element.className = 'journey-component-container mt-3';
        this.mapDetailModal = new MapDetailComponent();
    }

    private categorizeMaps(): void {
        this.actDefinitions.forEach(act => act.maps = []); // Reset maps

        const campaignActs = this.actDefinitions.slice(0, -1);
        const endgameAct = this.actDefinitions[this.actDefinitions.length - 1];

        outer: for (const map of this.data!.maps) {
            for (const act of campaignActs) {
                if (act.pattern.test(map.name)) {
                    act.maps.push(map);
                    continue outer;
                }
            }
            endgameAct.maps.push(map);
        }
    }

    protected render(): void {
        this.mapDetailModal.updateData(this.data!);
        this.mapDetailModal.setApp(this.app!);
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
        table.className = 'table table-sm table-striped caption-top journey-campaign-table';
        table.innerHTML = `
            <thead>
                <tr>
                    <th class="col-3">Area</th>
                    <th class="col">Events</th>
                    <th class="col-1">Time Spent</th>
                    <th class="col-2">Entered At</th>
                    <th class="col-1">Area Level</th>
                    <th class="col-1">Char Level</th>
                    <!--
                    <th class="col">Actions</th>
                    -->
                </tr>
            </thead>
            <tbody class="align-middle"></tbody>
        `;

        const tbody = table.querySelector('tbody');
        if (!tbody) return;

        const characterLevelIndex = this.data!.characterAggregation.characterLevelIndex;
        const sortedMaps = [...actData.maps].sort((a, b) => a.span.start - b.span.start);
        sortedMaps.forEach((map) => {
            const row = tbody.insertRow();
            const mapTimeMs = MapSpan.mapTime(map.span);
            const mapTimeFormatted = this.formatDuration(mapTimeMs);
            const prevLevelUpIx = binarySearch(characterLevelIndex, map.span.start, (e) => e.ts, BinarySearchMode.LAST);
            let prevLevelUpEvent = characterLevelIndex[prevLevelUpIx];
            let nextLevelUpEvent = characterLevelIndex[prevLevelUpIx + 1];
            let levelUpEvent;
            if (!prevLevelUpEvent) {
                // first character ever
                levelUpEvent = LevelUpEvent.of(map.span.start, "?", "?", 1);
            } else {
                const prevLevel = prevLevelUpEvent.detail.level;
                const nextLevel = nextLevelUpEvent?.detail?.level;
                if (nextLevel && prevLevel + 1 !== nextLevel) {
                    // either or both levelUpEvents do not belong to the character that is in this map
                    let heuristicLevel;
                    if (map.areaLevel === 1) {
                        // new character, necessarily implied
                        heuristicLevel = 1;
                    } else {
                        if (nextLevel && typeof nextLevel === 'number') {
                            heuristicLevel = Math.abs(map.areaLevel - nextLevel) < Math.abs(map.areaLevel - prevLevel) ? nextLevel -1 : prevLevel;
                        } else {
                            heuristicLevel = prevLevel; 
                        }
                    }
                    levelUpEvent = LevelUpEvent.of(map.span.start, "?", "?", heuristicLevel);
                } else {
                    levelUpEvent = prevLevelUpEvent;
                }
            }

            const mapNameCell = row.insertCell();
            const mapNameLink = document.createElement('a');
            mapNameLink.href = '#';
            mapNameLink.textContent = MapInstance.label(map);
            mapNameLink.title = 'Click to see map timeline';
            mapNameLink.addEventListener('click', (e) => {
                e.preventDefault();
                this.mapDetailModal.show(map, this.data!);
            });
            mapNameCell.appendChild(mapNameLink);
            row.insertCell().innerHTML = this.renderEvents(map);
            row.insertCell().textContent = mapTimeFormatted;
            row.insertCell().textContent = new Date(map.span.start).toLocaleString();
            row.insertCell().textContent = map.areaLevel.toString();
            row.insertCell().textContent = levelUpEvent.detail.level.toString();

            /*
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
            */
        });

        contentContainer.appendChild(table);
    }

    private renderEvents(map: MapInstance): string {
        const {loIx, hiIx} = binarySearchRange(this.data!.events, map.span.start, map.span.end, (e) => e.ts);
        let eventsHTML = "";
        for (let i = loIx; i < hiIx; i++) {
            const event = this.data!.events[i];
            if (!journeyEventNames.has(event.name)) continue;

            const meta = getEventMeta(event);
            let iconColorClass = meta.color;
            switch (meta) {
                case eventMeta.death:
                case eventMeta.levelUp:
                    if (event.detail && 'character' in event.detail && 
                        !this.data!.characterAggregation.characters.has((event.detail as any).character)) {
                        iconColorClass = "text-secondary";
                    }
                    break;
            }
            eventsHTML += `<i class='bi ${meta.icon} ${iconColorClass}'></i> `;
        }
        return eventsHTML;
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