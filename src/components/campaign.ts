import { MapInstance, MapSpan } from '../ingest/log-tracker';
import { BaseComponent } from './base-component';
import { getZoneInfo } from '../data/zone_table';
import { MapListComponent } from './map-list';
import { computeIfAbsent, createElementFromHTML } from '../util';
import { LogAggregationCube, MapField } from '../aggregate/aggregation';
import { binarySearchFindLastIx } from '../binary-search';

interface ActDefinition {
    name: string;
    maps: MapInstance[];
    duration: number;
}
export class CampaignComponent extends BaseComponent {

    private actDefinitions: ActDefinition[] = [];
    private mapListComponents = new Map<number, MapListComponent>();
    private currentActIndex: number = 0;

    constructor(container: HTMLElement) {
        super(createElementFromHTML(`
            <div class="campaign-component-container mt-3">
                <ul class="nav nav-pills mb-3" id="campaignActPills" role="tablist"></ul>
                <div class="tab-content" id="campaignActContent"></div>
            </div>
        `), container);
    }

    protected render(): void {
        this.categorizeMaps(this.data!);
        this.renderPills();
        const visibility = this.actDefinitions[this.currentActIndex]?.maps.length > 0;
        this.mapListComponents.get(this.currentActIndex)?.setVisible(visibility);
    }

    private categorizeMaps(data: LogAggregationCube): void {
        this.actDefinitions = [];
        for (let i = 0; i < 10; i++) {
            this.actDefinitions.push({ name: `Act ${i + 1}`, maps: [], duration: 0 });
        }
        const characterInfo = data.filter.character ? data.characterAggregation.characters.find(c => c.name === data.filter.character) : undefined;
        const campaignEndIx = characterInfo ? binarySearchFindLastIx(data.maps, (map) => map.span.start < characterInfo.campaignCompletedTs) : data.maps.length - 1;
        for (let i = 0; i <= campaignEndIx; i++) {
            const map = data.maps[i];
            const zoneInfo = getZoneInfo(map.name, map.areaLevel);
            if (zoneInfo?.act) {
                this.actDefinitions[zoneInfo.act - 1].maps.push(map);
            }
        }
        this.actDefinitions = this.actDefinitions.filter(a => a.maps.length > 0);
        const contentContainer = this.element.querySelector('#campaignActContent') as HTMLElement;
        for (const [index, act] of this.actDefinitions.entries()) {
            if (act.maps.length > 0) {
                act.duration = act.maps.reduce((acc, map) => acc + MapSpan.mapTimePlusIdle(map.span), 0);
            }
            const mapListComponent = computeIfAbsent(this.mapListComponents, index, () => new MapListComponent(contentContainer, false, {field: MapField.startedTs, ascending: true}));
            mapListComponent.setApp(this.app!);
            mapListComponent.updateData(data, act.maps);
        }
    }

    private renderPills(): void {
        const pillsContainer = this.element.querySelector('#campaignActPills');
        if (!pillsContainer) return;

        pillsContainer.innerHTML = '';

        this.actDefinitions.forEach((act, index) => {
            const pillItem = document.createElement('li');
            pillItem.className = 'nav-item';
            pillItem.setAttribute('role', 'presentation');

            const pillButton = document.createElement('button');
            pillButton.className = `nav-link ${index === this.currentActIndex ? 'active' : ''}`;
            pillButton.id = `campaign-act-${index}-tab-btn`;
            pillButton.type = 'button';
            pillButton.setAttribute('role', 'tab');
            pillButton.textContent = `${act.name} (${this.formatDuration(act.duration)})`;

            pillButton.addEventListener('click', (event) => {
                event.preventDefault();
                this.currentActIndex = index;
                for (const [i, component] of this.mapListComponents) {
                    component.setVisible(i === index);
                }
                pillsContainer.querySelectorAll('.nav-link').forEach(pill => {
                    pill.classList.remove('active');
                });
                pillButton.classList.add('active');
            });

            pillItem.appendChild(pillButton);
            pillsContainer.appendChild(pillItem);
        });
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