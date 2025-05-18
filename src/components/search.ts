export class SearchComponent {
    private element: HTMLDivElement;
    private searchInput!: HTMLInputElement;
    private onSearch: (searchTerm: string) => void;

    constructor(onSearchCallback: (searchTerm: string) => void) {
        this.onSearch = onSearchCallback;
        this.element = document.createElement('div');
        this.element.className = 'input-group mb-3';
        this.render();
        this.setupEventListeners();
    }

    public getElement(): HTMLDivElement {
        return this.element;
    }

    private render(): void {
        this.element.innerHTML = `
            <input type="text" class="form-control" placeholder="Enter pattern...">
            <button class="btn btn-secondary" type="button">Search</button>
        `;
        this.searchInput = this.element.querySelector('input[type="text"]') as HTMLInputElement;
    }

    private setupEventListeners(): void {
        const searchButton = this.element.querySelector('button');
        searchButton?.addEventListener('click', () => {
            const searchTerm = this.searchInput.value.trim();
            if (searchTerm) {
                this.onSearch(searchTerm);
            }
        });

        this.searchInput.addEventListener('keypress', (event) => {
            if (event.key === 'Enter') {
                const searchTerm = this.searchInput.value.trim();
                if (searchTerm) {
                    this.onSearch(searchTerm);
                }
            }
        });
    }
} 