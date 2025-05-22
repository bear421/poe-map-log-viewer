import { LogAggregation } from '../aggregation';
import { BaseComponent } from './base-component';

const DEBOUNCE_DELAY = 245;

export class MessagesComponent extends BaseComponent<LogAggregation> {
    private searchInput: HTMLInputElement;
    private accordionContainer: HTMLDivElement;
    private noResultsElement: HTMLParagraphElement;

    private characterOrder: string[] = [];
    private characterElements: Map<string, HTMLElement> = new Map();
    private debounceTimer: number | null = null;

    constructor(container: HTMLElement) {
        super(document.createElement('div'), container);
        this.element.className = 'messages-container';
        this.searchInput = document.createElement('input');
        this.searchInput.type = 'text';
        this.searchInput.placeholder = 'Search messages or characters (regex supported)...';
        this.searchInput.className = 'form-control mb-3';
        this.searchInput.addEventListener('input', () => {
            if (this.debounceTimer) {
                clearTimeout(this.debounceTimer);
            }
            this.debounceTimer = window.setTimeout(() => {
                this.applyFilter();
            }, DEBOUNCE_DELAY);
        });

        this.accordionContainer = document.createElement('div');
        this.accordionContainer.className = 'accordion';
        this.accordionContainer.id = 'messagesAccordion';

        this.noResultsElement = document.createElement('p');
        this.noResultsElement.className = 'text-muted mt-2';
        this.noResultsElement.style.display = 'none'; // Initially hidden

        this.element.appendChild(this.searchInput);
        this.element.appendChild(this.accordionContainer);
        this.element.appendChild(this.noResultsElement);
    }

    protected render(): void {
        this.buildFullAccordion();
        this.applyFilter();
    }

    private buildFullAccordion(): void {
        this.accordionContainer.innerHTML = '';
        this.characterOrder = [];
        this.characterElements.clear();

        // TODO: Performance Optimization for Large Number of Conversations (e.g., >30k)
        // 1. Virtualization/Windowing: Only render DOM elements for conversations visible in the viewport.
        //    As the user scrolls, recycle or re-render elements.
        // 2. Initial Load Limit: By default, consider rendering only the most recent N (e.g., 100-200) conversations.
        //    The full dataset (this.aggregationData.messages) would still be used for searching.
        // 3. Search with Load Limit:
        //    - When searching, if a match is found in a conversation not currently in the DOM (due to initial limit),
        //      it needs to be dynamically rendered and inserted, or the virtualization window adjusted.
        //    - Alternatively, if search is limited to the initially loaded subset, this needs to be clear to the user,
        //      or a "search all messages" option could trigger a potentially slower full data search and render.
        // 4. Ensure `applyFilter` correctly interacts with virtualization: it should filter the full list of characters
        //    and then instruct the virtual rendering system which items to display within its window.

        if (!this.data || !this.data.messages || this.data.messages.size === 0) {
            this.noResultsElement.textContent = 'No direct messages found.';
            this.noResultsElement.style.display = 'block';
            return;
        }
        this.noResultsElement.style.display = 'none';

        const charactersWithMessages = Array.from(this.data.messages.entries())
            .map(([character, events]) => ({
                character,
                events,
                lastMessageTs: events.length > 0 ? events[events.length - 1].ts : 0
            }))
            .sort((a, b) => b.lastMessageTs - a.lastMessageTs);

        charactersWithMessages.forEach(({ character, events }, index) => {
            if (events.length === 0) return;

            this.characterOrder.push(character);

            const card = document.createElement('div');
            card.className = 'accordion-item';
            this.characterElements.set(character, card);

            const headerId = `messages-header-${index}`;
            const collapseId = `messages-collapse-${index}`;

            const header = document.createElement('h2');
            header.className = 'accordion-header';
            header.id = headerId;

            const button = document.createElement('button');
            button.className = 'accordion-button collapsed';
            button.type = 'button';
            button.dataset.bsToggle = 'collapse';
            button.dataset.bsTarget = `#${collapseId}`;
            button.ariaExpanded = 'false';
            button.setAttribute('aria-controls', collapseId);
            button.textContent = character;

            header.appendChild(button);
            card.appendChild(header);

            const collapseDiv = document.createElement('div');
            collapseDiv.id = collapseId;
            collapseDiv.className = 'accordion-collapse collapse';
            collapseDiv.setAttribute('aria-labelledby', headerId);
            collapseDiv.dataset.bsParent = '#messagesAccordion';

            const body = document.createElement('div');
            body.className = 'accordion-body';

            const messageList = document.createElement('ul');
            messageList.className = 'list-group list-group-flush';

            events.sort((a, b) => a.ts - b.ts).forEach(event => {
                const listItem = document.createElement('li');
                listItem.className = 'list-group-item';
                const messageDirection = event.name === 'msgFrom' ? 'From' : 'To';
                const itemDate = new Date(event.ts).toLocaleString();
                listItem.innerHTML = `
                    <small class="text-muted">@${messageDirection} ${character} ${itemDate}</small><br>
                    ${event.detail.msg}
                `;
                messageList.appendChild(listItem);
            });

            body.appendChild(messageList);
            collapseDiv.appendChild(body);
            card.appendChild(collapseDiv);
            this.accordionContainer.appendChild(card);
        });
    }

    private applyFilter(): void {
        if (!this.data || !this.data.messages) {
            return;
        }

        const rawSearchTerm = this.searchInput.value.trim();
        let searchTermForRegex = rawSearchTerm;
        let searchMessage = true;
        const fromPrefix = "from:";
        if (rawSearchTerm.toLowerCase().startsWith(fromPrefix)) {
            searchMessage = false;
            searchTermForRegex = rawSearchTerm.substring(fromPrefix.length).trim();
        }

        let searchRegex: RegExp | null = null;
        if (searchTermForRegex) {
            try {
                searchRegex = new RegExp(searchTermForRegex, 'i');
            } catch (e) {
                // Invalid regex, treat as plain text search
                searchRegex = new RegExp(searchTermForRegex.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&'), 'i');
            }
        }

        let visibleCount = 0;
        this.characterOrder.forEach(character => {
            const element = this.characterElements.get(character);
            const events = this.data!.messages.get(character) || [];

            if (element) {
                let matches = false;
                if (!searchRegex) {
                    matches = true;
                } else {
                    if (searchRegex.test(character)) {
                        matches = true;
                    } else if (searchMessage && events.some(event => searchRegex!.test(event.detail.msg))) {
                        matches = true;
                    }
                }

                if (matches) {
                    element.style.display = '';
                    visibleCount++;
                } else {
                    element.style.display = 'none';
                }
            }
        });

        if (visibleCount === 0 && (this.data!.messages.size > 0 || rawSearchTerm)) {
            this.noResultsElement.textContent = rawSearchTerm ? 'No matching messages found.' : 'No direct messages found.';
            this.noResultsElement.style.display = 'block';
        } else {
            this.noResultsElement.style.display = 'none';
        }
    }
} 