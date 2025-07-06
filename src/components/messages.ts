import { BaseComponent } from './base-component';
import { FrameBarrier } from '../util';

const DEBOUNCE_DELAY = 245;
const INITIAL_RENDER_LIMIT = 100;

export class MessagesComponent extends BaseComponent {
    private searchInput: HTMLInputElement;
    private accordionContainer: HTMLDivElement;
    private noResultsElement: HTMLParagraphElement;
    private resultsInfoElement: HTMLParagraphElement;

    private characterOrder: string[] = [];
    private debounceTimer: number | null = null;
    private searchInProgress = false;

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
                this.updateView();
            }, DEBOUNCE_DELAY);
        });

        this.accordionContainer = document.createElement('div');
        this.accordionContainer.className = 'accordion';
        this.accordionContainer.id = 'messagesAccordion';

        this.noResultsElement = document.createElement('p');
        this.noResultsElement.className = 'text-muted mt-2';
        this.noResultsElement.style.display = 'none'; // Initially hidden

        this.resultsInfoElement = document.createElement('p');
        this.resultsInfoElement.className = 'text-muted mt-2';
        this.resultsInfoElement.style.display = 'none';

        this.element.appendChild(this.searchInput);
        this.element.appendChild(this.resultsInfoElement);
        this.element.appendChild(this.accordionContainer);
        this.element.appendChild(this.noResultsElement);
    }

    protected render(): void {
        this.prepareCharacterList();
        this.updateView();
    }

    private prepareCharacterList(): void {
        if (!this.data || !this.data.messages || this.data.messages.size === 0) {
            this.characterOrder = [];
            return;
        }

        const charactersWithMessages = Array.from(this.data.messages.entries())
            .map(([character, events]) => ({
                character,
                lastMessageTs: events.length > 0 ? events[events.length - 1].ts : 0
            }))
            .sort((a, b) => b.lastMessageTs - a.lastMessageTs);
        
        this.characterOrder = charactersWithMessages.map(({ character }) => character);
    }

    private async updateView(): Promise<void> {
        if (this.searchInProgress) {
            return;
        }
        this.searchInProgress = true;

        this.accordionContainer.innerHTML = '';
        this.resultsInfoElement.style.display = 'none';
        
        try {
            if (this.characterOrder.length === 0) {
                this.noResultsElement.textContent = 'No direct messages found.';
                this.noResultsElement.style.display = 'block';
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

            let filteredCharacters: string[] = [];
            if (searchRegex) {
                this.resultsInfoElement.textContent = 'Searching...';
                this.resultsInfoElement.style.display = 'block';
                this.noResultsElement.style.display = 'none';

                const fb = new FrameBarrier();
                for (const character of this.characterOrder) {
                    if (fb.shouldYield()) await fb.yield();
                    
                    let isMatch = false;
                    if (searchRegex.test(character)) {
                        isMatch = true;
                    } else if (searchMessage) {
                        const events = this.data!.messages.get(character);
                        if (events && events.some(event => searchRegex!.test(event.detail.msg))) {
                            isMatch = true;
                        }
                    }
                    if (isMatch) {
                        filteredCharacters.push(character);
                    }
                }
            } else {
                filteredCharacters = this.characterOrder;
            }

            this.resultsInfoElement.style.display = 'none';

            if (filteredCharacters.length > INITIAL_RENDER_LIMIT) {
                if (searchRegex) {
                    this.resultsInfoElement.textContent = `Showing the first ${INITIAL_RENDER_LIMIT} of ${filteredCharacters.length} matches. Refine your search to see more.`;
                } else {
                    this.resultsInfoElement.textContent = `Showing the ${INITIAL_RENDER_LIMIT} most recent of ${filteredCharacters.length} conversations.`;
                }
                this.resultsInfoElement.style.display = 'block';
            }

            const charactersToRender = filteredCharacters.slice(0, INITIAL_RENDER_LIMIT);

            if (charactersToRender.length === 0) {
                this.noResultsElement.textContent = rawSearchTerm ? 'No matching messages found.' : 'No direct messages found.';
                this.noResultsElement.style.display = 'block';
                return;
            }
            
            this.noResultsElement.style.display = 'none';

            charactersToRender.forEach((character, index) => {
                const events = this.data!.messages.get(character)!;

                const card = document.createElement('div');
                card.className = 'accordion-item';

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
        } finally {
            this.searchInProgress = false;
        }
    }
} 