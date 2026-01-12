import { LogLine, MapInstance, MapMarkerType } from '../ingest/log-tracker';
import { LogEvent, eventMeta, getEventMeta } from '../ingest/events';
import { binarySearch, BinarySearchMode } from '../binary-search';
import { LogAggregationCube } from '../aggregate/aggregation';
import { BaseComponent } from './base-component';
import { logWorkerService } from '../ingest/worker-service';
import { createElementFromHTML } from '../util';
import { TSRange } from '../aggregate/segmentation';
import { getZoneInfo } from '../data/areas';
import * as bootstrap from 'bootstrap';

export class MapDetailComponent extends BaseComponent {
    private modalElement: HTMLElement | null = null;
    private modalInstance: any = null; 
    private modalTitleElement: HTMLElement | null = null;
    private modalBodyElement: HTMLElement | null = null;
    private logSearchResults: LogLine[] | null = null;
    private showTimeline: boolean = true;

    private currentMap: MapInstance | null = null;
    private currentAggregation: LogAggregationCube | null = null;

    constructor(container?: HTMLElement) {
        super(document.createElement('div'), container || document.body);
        this.createModalStructure();
    }

    private createModalStructure(): void {
        const modal = document.createElement('div');
        modal.className = 'modal fade map-detail-modal';
        modal.tabIndex = -1;

        modal.innerHTML = `
            <div class="modal-dialog modal-xl modal-dialog-scrollable">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title map-detail-title">Map Details</h5>
                        <div class="form-check form-switch ms-auto user-select-none">
                            <input class="form-check-input" type="checkbox" role="switch" id="timelineSwitch">
                            <label class="form-check-label" for="timelineSwitch">View raw data</label>
                        </div>
                        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                    </div>
                    <div class="modal-body map-detail-body"></div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        this.modalElement = modal;
        this.modalTitleElement = modal.querySelector('.map-detail-title');
        this.modalBodyElement = modal.querySelector('.map-detail-body');
        
        const timelineSwitch = modal.querySelector('#timelineSwitch') as HTMLInputElement;
        timelineSwitch.addEventListener('change', (event) => {
            const isChecked = (event.target as HTMLInputElement).checked;
            if (isChecked) {
                this.showTimeline = false;
                if (!this.logSearchResults && this.currentMap) {
                    const tsBounds = {
                        lo: this.currentMap.start - this.currentMap.getTime(new Set([MapMarkerType.load])) - 1000 * 5,
                        hi: (this.currentMap.end || Date.now()) + 1000 * 60 * 10
                    };
                    logWorkerService.searchLog(new RegExp(''), 1000, this.app!.getSelectedFile()!, tsBounds).then(results => {
                        this.logSearchResults = results.lines;
                        this.showTimeline = false;
                        const currentSwitchState = this.modalElement?.querySelector('#timelineSwitch') as HTMLInputElement;
                        if (currentSwitchState) currentSwitchState.checked = true;

                        this.renderModalContent();
                    });
                } else {
                    this.renderModalContent();
                }
            } else {
                this.showTimeline = true;
                this.renderModalContent();
            }
        });
    }

    public show(map: MapInstance, aggregation: LogAggregationCube): void {
        this.currentMap = map;
        this.currentAggregation = aggregation;
        this.logSearchResults = null; 
        this.showTimeline = true; 
        const timelineSwitch = this.modalElement?.querySelector('#timelineSwitch') as HTMLInputElement;
        if (timelineSwitch) {
            timelineSwitch.checked = false;
        }
        if (!this.modalElement) {
            this.createModalStructure(); 
        }
        if (!this.modalInstance && this.modalElement) {
            this.modalInstance = bootstrap.Modal.getOrCreateInstance(this.modalElement);
        }
        this.renderModalContent();
        this.modalInstance?.show();
    }

    public hide(): void {
        this.modalInstance?.hide();
    }

    private renderModalContent(): void {
        if (!this.currentMap || !this.currentAggregation || !this.modalBodyElement || !this.modalTitleElement) {
            return;
        }

        const map = this.currentMap;
        const agg = this.currentAggregation;

        this.modalTitleElement.textContent = `${MapInstance.label(map)} ${new Date(map.start).toLocaleString()} - ${map.end ? new Date(map.end).toLocaleString() : 'Unfinished'}`;
        this.modalBodyElement.innerHTML = ''; 

        if (this.showTimeline) {
            this.renderTimelineContent(map, agg);
        } else {
            this.renderLogSearchResults();
        }
    }

    private renderTimelineContent(map: MapInstance, agg: LogAggregationCube): void {
        if (!this.modalBodyElement) return;

        this.modalBodyElement.innerHTML = '';
        const timelineContainer = document.createElement('div');
        timelineContainer.className = 'timeline-container';

        timelineContainer.appendChild(this.createTimelineEventElement(
            0,
            `Map Started`,
            '',
            'bi-play-circle',
            'text-primary'
        ));

        let relevantEvents: LogEvent[] = [];
        if (agg.events && map.start) {
            const searchEnd = map.end || Infinity;
            const lo = binarySearch(agg.events, map.start, (e: LogEvent) => e.ts, BinarySearchMode.FIRST);
            const hi = binarySearch(agg.events, searchEnd, (e: LogEvent) => e.ts, BinarySearchMode.LAST);

            if (lo !== -1 && hi !== -1 && lo <= hi) {
                const eventSlice = agg.events.slice(lo, hi + 1);
                relevantEvents = eventSlice.length > 500 ? eventSlice.slice(0, 500) : eventSlice;
                if (eventSlice.length > 500) {
                    console.warn(`Timeline for map ${map.name} truncated to 500 events out of ${eventSlice.length}`);
                }
            }
        }
        
        relevantEvents.forEach(event => {
            const el = this.formatEventToTimelineElement(event, map);
            el && timelineContainer.appendChild(el);
        });

        if (map.end) {
            timelineContainer.appendChild(this.createTimelineEventElement(
                map.end - map.start,
                'Map Ended',
                '',
                'bi-stop-circle',
                'text-primary'
            ));
        } else {
            timelineContainer.appendChild(this.createTimelineEventElement(
                map.start,
                'Map In Progress / Abrupt End',
                'End time not recorded or map is ongoing.',
                'bi-hourglass-split',
                'text-secondary'
            ));
        }

        this.modalBodyElement.appendChild(timelineContainer);
    }

    private renderLogSearchResults(): void {
        if (!this.modalBodyElement) return;

        this.modalBodyElement.innerHTML = '';
        if (this.logSearchResults && this.logSearchResults.length > 0) {
            const map = this.currentMap!;
            const listGroup = createElementFromHTML(`<ul class="list-group font-monospace raw-log"></ul>`);
            let pastMapEnd = false;
            for (let i = 0; i < this.logSearchResults.length; i++) {
                const line = this.logSearchResults[i];
                let className = 'list-group-item';
                let outOfMapBounds = pastMapEnd;
                if (!outOfMapBounds && line.ts) {
                    if (map.end && line.ts > map.end) {
                        pastMapEnd = true;
                        outOfMapBounds = true;
                    }
                    if (line.ts < map.start) {
                        outOfMapBounds = true;
                    }
                }
                if (outOfMapBounds) {
                    className += ' bg-secondary bg-opacity-25';
                }
                const listItem = createElementFromHTML(`
                    <li class="${className}">
                        <span class="ts">${line.ts ? new Date(line.ts).toLocaleString() : ''}</span>
                        <span class="line">${line.remainder ?? line.rawLine}</span>
                    </li>
                `);
                listGroup.appendChild(listItem);
            }
            let characterEvent = this.data!.characterAggregation.guessAnyEvent(map.start) as any | undefined;
            if (characterEvent && !characterEvent.detail.level) {
                const levelEvent = this.data!.characterAggregation.guessLevelEvent(map.start);
                if (levelEvent) {
                    characterEvent = Object.assign({}, characterEvent);
                    characterEvent.detail.level = levelEvent.detail.level;
                    if ('ascendancy' in levelEvent.detail) {
                        characterEvent.detail.ascendancy = levelEvent.detail.ascendancy;
                    }
                }
            }
            this.modalBodyElement.appendChild(createElementFromHTML(`
                <div class="card mb-2">
                    <div class="card-header">
                        <h5 class="mb-0">Data</h5>
                    </div>
                    <div class="card-body">
                        <div class="card-text row">
                            <div class="col">
                                <pre>Map: ${JSON.stringify(map, null, 2)}</pre>
                            </div>
                            <div class="col">
                                <pre>Attributed character event: ${JSON.stringify(characterEvent, null, 2)}</pre>
                                <pre>Character info: ${JSON.stringify(this.data!.characterAggregation.characters.find(c => c.name === characterEvent?.detail.character), null, 2)}</pre>
                                <pre>Zone info: ${JSON.stringify(getZoneInfo(map.name, map.areaLevel), null, 2)}</pre>
                            </div>
                        </div>
                    </div>
                </div>
            `));
            this.modalBodyElement.appendChild(listGroup);
        } else {
            const noResultsMessage = document.createElement('p');
            noResultsMessage.textContent = 'No log results to display or search not performed yet.';
            this.modalBodyElement.appendChild(noResultsMessage);
        }
    }

    private formatEventToTimelineElement(event: LogEvent, map: MapInstance): HTMLElement | null {
        const meta = getEventMeta(event);
        let icon = meta.icon;
        let iconColorClass = meta.color;
        let label = meta.label(event as any);
        let details = '';

        switch (meta) { 
            case eventMeta.death:
            case eventMeta.levelUp:
                if (!this.data!.characterAggregation.isOwned(event.detail.character)) {
                    iconColorClass = "text-secondary";
                }
                break;
            case eventMeta.msgFrom:
            case eventMeta.msgTo:
            case eventMeta.msgParty:
            case eventMeta.msgGuild:
            case eventMeta.msgLocal:
                //details = `${event.detail.msg}`;
                break;
            case eventMeta.mapEntered:
                return null;
        }
        details = details.replace(/</g, "&lt;").replace(/>/g, "&gt;");
        const delta = event.ts - map.start;
        return this.createTimelineEventElement(delta, label, details, icon, iconColorClass);
    }

    private createTimelineEventElement(timeOffset: number, title: string, contentText: string, iconClass: string, iconColorClass: string): HTMLElement {
        const itemDiv = document.createElement('div');
        itemDiv.className = 'timeline-event-item pb-3';
        
        const timeString = this.formatDuration(timeOffset);
        const contentHTML = contentText ? `<p class="mb-0 text-muted"><small>${contentText}</small></p>` : '';
        itemDiv.innerHTML = `
            <div class="timeline-event-icon ${iconColorClass}">
                <i class="bi ${iconClass} fs-4"></i>
            </div>
            <div class="timeline-event-content ps-2">
                <h6 class="mb-0">
                    <small class="text-muted fw-normal">${timeString}</small> <span>${title}</span>
                </h6>
                ${contentHTML}
            </div>
        `;
        return itemDiv;
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

    protected render(): void {}

} 