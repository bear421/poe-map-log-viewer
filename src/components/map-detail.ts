import { MapInstance, MapSpan } from '../log-tracker';
import { LogEvent, LevelUpEvent, DeathEvent, BossKillEvent, PassiveGainedEvent, JoinedAreaEvent, LeftAreaEvent, getEventMeta, MsgFromEvent, MapReenteredEvent, MsgToEvent, MsgPartyEvent, MsgGuildEvent, MsgLocalEvent, AreaPostLoadEvent, TradeAcceptedEvent, HideoutExitedEvent, HideoutEnteredEvent, MapEnteredEvent, ItemsIdentifiedEvent } from '../log-events';
import { binarySearch, BinarySearchMode } from '../binary-search';
import { LogAggregation } from '../aggregation';
import { BaseComponent } from './base-component';
import { Filter } from '../log-tracker';
import { getZoneInfo } from '../data/zone_table';
import { logWorkerService } from '../log-worker-service';

declare var bootstrap: any;

export class MapDetailComponent extends BaseComponent<LogAggregation> {
    private modalElement: HTMLElement | null = null;
    private modalInstance: any = null; 
    private modalTitleElement: HTMLElement | null = null;
    private modalBodyElement: HTMLElement | null = null;

    private currentMap: MapInstance | null = null;
    private currentAggregation: LogAggregation | null = null;

    constructor(container?: HTMLElement) {
        super(document.createElement('div'), container || document.body);
        this.createModalStructure();
    }

    private createModalStructure(): void {
        if (document.getElementById('mapInstanceDetailModal')) {
            this.modalElement = document.getElementById('mapInstanceDetailModal');
            this.modalTitleElement = this.modalElement!.querySelector('#mapInstanceDetailModalLabel');
            this.modalBodyElement = this.modalElement!.querySelector('#mapInstanceDetailModalBody');
            return;
        }

        const modal = document.createElement('div');
        modal.className = 'modal fade';
        modal.id = 'mapInstanceDetailModal';
        modal.tabIndex = -1;
        modal.setAttribute('aria-labelledby', 'mapInstanceDetailModalLabel');
        modal.setAttribute('aria-hidden', 'true');

        modal.innerHTML = `
            <div class="modal-dialog modal-xl modal-dialog-scrollable">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title" id="mapInstanceDetailModalLabel">Map Details</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                    </div>
                    <div class="modal-body" id="mapInstanceDetailModalBody"></div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        this.modalElement = modal;
        this.modalTitleElement = modal.querySelector('#mapInstanceDetailModalLabel');
        this.modalBodyElement = modal.querySelector('#mapInstanceDetailModalBody');
    }

    public show(map: MapInstance, aggregation: LogAggregation): void {
        this.currentMap = map;
        this.currentAggregation = aggregation;

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

        this.modalTitleElement.textContent = `Timeline for ${MapInstance.label(map)} (Level ${map.areaLevel}, Entered: ${new Date(map.span.start).toLocaleString()})`;
        this.modalBodyElement.innerHTML = ''; 

        const timelineContainer = document.createElement('div');
        // Basic timeline styling; can be enhanced with dedicated CSS
        timelineContainer.style.position = 'relative';
        timelineContainer.style.paddingLeft = '30px'; // Space for badges/icons

        timelineContainer.appendChild(this.createTimelineEventElement(
            0,
            'Map Started',
            `Entered ${MapInstance.label(map)}, Area Level ${map.areaLevel}`,
            'bi-play-circle',
            'text-primary'
        ));

        let relevantEvents: LogEvent[] = [];
        if (agg.events && map.span.start) { // map.span.end can be undefined for current map
            const searchEnd = map.span.end || Date.now(); // Use current time if map is ongoing
            const lo = binarySearch(agg.events, map.span.start, (e: LogEvent) => e.ts, BinarySearchMode.FIRST);
            const hi = binarySearch(agg.events, searchEnd, (e: LogEvent) => e.ts, BinarySearchMode.LAST);

            if (lo !== -1 && hi !== -1 && lo <= hi) {
                const eventSlice = agg.events.slice(lo, hi + 1);
                relevantEvents = eventSlice.length > 500 ? eventSlice.slice(0,500) : eventSlice;
                if (eventSlice.length > 500) {
                    console.warn(`Timeline for map ${map.name} truncated to 500 events out of ${eventSlice.length}`);
                }
            }
        }
        
        relevantEvents.forEach(event => {
            const el = this.formatEventToTimelineElement(event, map);
            el && timelineContainer.appendChild(el);
        });

        if (map.span.end) {
            timelineContainer.appendChild(this.createTimelineEventElement(
                map.span.end - map.span.start,
                'Map Ended',
                '',
                'bi-stop-circle',
                'text-primary'
            ));
        } else {
            timelineContainer.appendChild(this.createTimelineEventElement(
                map.span.start,
                'Map In Progress / Abrupt End',
                'End time not recorded or map is ongoing.',
                'bi-hourglass-split',
                'text-secondary'
            ));
        }

        this.modalBodyElement.appendChild(timelineContainer);

        const modalFooter = this.modalElement!.querySelector('.modal-footer');
        if (modalFooter) {
            const existingButton = modalFooter.querySelector('.btn-explore-log-segment');
            if (existingButton) {
                existingButton.remove();
            }

            const exploreButton = document.createElement('button');
            exploreButton.type = 'button';
            exploreButton.className = 'btn btn-info me-2 btn-explore-log-segment';
            exploreButton.textContent = 'Explore Log Segment';
            exploreButton.addEventListener('click', () => {
                if (this.currentMap) {
                    const tsBounds = [{
                        lo: this.currentMap.span.start,
                        hi: this.currentMap.span.end || Date.now()
                    }];
                    logWorkerService.searchLog(new RegExp(''), 1000, this.app!.getSelectedFile()!, new Filter(tsBounds)).then(results => {
                        console.log(results);
                    });
                }
            });
            modalFooter.prepend(exploreButton);
        }
    }
    
    private formatEventToTimelineElement(event: LogEvent, map: MapInstance): HTMLElement | null {
        const meta = getEventMeta(event);
        let icon = meta.icon;
        let iconColorClass = meta.color;
        let displayTitle: string = event.name;
        let details = '';

        switch (meta) { 
            case DeathEvent:
                if (!this.data!.characterAggregation.characters.has(event.detail.character)) {
                    iconColorClass = "text-secondary";
                }
                displayTitle = `${event.detail.character} has been slain`;
                break;
            case LevelUpEvent:
                if (!this.data!.characterAggregation.characters.has(event.detail.character)) {
                    iconColorClass = "text-secondary";
                }
                displayTitle = `Level up`;
                details = `Level: ${event.detail.level}. Character: ${event.detail.character}`;
                break;
            case BossKillEvent:
                details = `Boss: ${event.detail.bossName}`;
                break;
            case PassiveGainedEvent:
                details = `Passive points gained: ${event.detail.count}`;
                break;
            case MapReenteredEvent:
                displayTitle = `Map reentered`;
                break;
            case MsgFromEvent:
            case MsgToEvent:
            case MsgPartyEvent:
            case MsgGuildEvent:
            case MsgLocalEvent:
                if (event.name === "msgFrom") displayTitle = `From @${event.detail.character}`;
                else if (event.name === "msgTo") displayTitle = `To @${event.detail.character}`;
                else if (event.name === "msgParty") displayTitle = `%${event.detail.character}`;
                else if (event.name === "msgGuild") displayTitle = `&${event.detail.character}`;
                else if (event.name === "msgLocal") displayTitle = `${event.detail.character}`;
                details = `${event.detail.msg}`;
                break;
            case JoinedAreaEvent:
                displayTitle = `${event.detail.character} Joined`;
                break;
            case LeftAreaEvent:
                displayTitle = `${event.detail.character} left`;
                break;
            case HideoutEnteredEvent:
                displayTitle = `Hideout entered: ${getZoneInfo(event.detail.areaName)?.label ?? event.detail.areaName}`;
                break;
            case HideoutExitedEvent:
                displayTitle = `Hideout exited`;
                break;
            case TradeAcceptedEvent:
                displayTitle = `Trade accepted`;
                break;
            case AreaPostLoadEvent:
                displayTitle = `Loading finished`;
                details = `Took: ${(event.detail.delta / 1000).toFixed(1)}s`;
                break;
            case ItemsIdentifiedEvent:
                displayTitle = `${event.detail.count} Items identified`;
                break;
            case MapEnteredEvent:
                return null;
            default:
                if (event.detail) {
                    try {
                        details = JSON.stringify(event.detail);
                    } catch (e) { details = 'Complex object data'; }
                }
        }
        details = details.replace(/</g, "&lt;").replace(/>/g, "&gt;");
        const delta = event.ts - map.span.start;
        return this.createTimelineEventElement(delta, displayTitle, details, icon, iconColorClass);
    }

    private createTimelineEventElement(timeOffset: number, title: string, contentText: string, iconClass: string, iconColorClass: string): HTMLElement {
        const itemDiv = document.createElement('div');
        itemDiv.className = 'timeline-event-item pb-3';
        itemDiv.style.position = 'relative';
        itemDiv.style.paddingLeft = '35px';
        itemDiv.style.borderLeft = '2px solid #ddd';
        
        const timeString = this.formatDuration(timeOffset);
        const contentHTML = contentText ? `<p class="mb-0 text-muted"><small>${contentText}</small></p>` : '';
        itemDiv.innerHTML = `
            <div class="timeline-event-icon ${iconColorClass}" style="position: absolute; left: -13px; top: 0; background-color: white; border-radius: 50%;">
                <i class="bi ${iconClass} fs-4"></i>
            </div>
            <div class="timeline-event-content ps-2">
                <h6 class="fw-bold mb-0">
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