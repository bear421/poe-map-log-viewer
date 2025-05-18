export class FileSelectorComponent {
    private element: HTMLDivElement;
    private fileInputElement!: HTMLInputElement;
    private inputGroupElement!: HTMLDivElement;
    private pathHelperCardElement!: HTMLDivElement;
    private onFileSelected: (file: File) => void;

    constructor(onFileSelectedCallback: (file: File) => void) {
        this.onFileSelected = onFileSelectedCallback;
        this.element = document.createElement('div');
        this.render();
        this.setupEventListeners();
    }

    public getElement(): HTMLDivElement {
        return this.element;
    }

    public getSelectedFile(): File | null {
        return this.fileInputElement.files?.[0] || null;
    }

    public show(): void {
        this.inputGroupElement.classList.remove('d-none');
        this.pathHelperCardElement.classList.remove('d-none');
    }

    public hide(): void {
        this.inputGroupElement.classList.add('d-none');
        this.pathHelperCardElement.classList.add('d-none');
    }

    private render(): void {
        this.inputGroupElement = document.createElement('div');
        this.inputGroupElement.className = 'input-group mb-3';

        this.fileInputElement = document.createElement('input');
        this.fileInputElement.type = 'file';
        this.fileInputElement.className = 'form-control custom-file-input-tall';
        this.fileInputElement.accept = '.txt';

        this.inputGroupElement.appendChild(this.fileInputElement);
        this.element.appendChild(this.inputGroupElement);

        this.pathHelperCardElement = document.createElement('div');
        this.pathHelperCardElement.className = 'card mb-4';
        
        const cardHeader = document.createElement('div');
        cardHeader.className = 'card-header';
        cardHeader.innerHTML = `<h4 class="mb-0">ℹ️ Looking for your Client.txt file?</h5>`;
        this.pathHelperCardElement.appendChild(cardHeader);
        
        const contentDiv = document.createElement('div');
        contentDiv.className = 'card-body';
        contentDiv.innerHTML = `
            <div class="mb-2">
                <strong>Standalone client:</strong>
                <div class="input-group">
                    <input type="text" class="form-control" value="%PROGRAMFILES(X86)%\\Grinding Gear Games\\Path of Exile 2\\logs\\Client.txt" readonly>
                    <button class="btn btn-primary copy-path-btn" type="button">Copy</button>
                </div>
            </div>
            <div>
                <strong>Steam client:</strong>
                <div class="input-group">
                    <input type="text" class="form-control" value="%PROGRAMFILES(X86)%\\Steam\\steamapps\\common\\Path of Exile 2\\logs\\Client.txt" readonly>
                    <button class="btn btn-primary copy-path-btn" type="button">Copy</button>
                </div>
            </div>
            <small class="text-muted mt-2 d-block">Note: If you installed Steam in a custom location, you'll need to adjust the path accordingly.</small>
        `;
        this.pathHelperCardElement.appendChild(contentDiv);
        this.element.appendChild(this.pathHelperCardElement);
    }

    private setupEventListeners(): void {
        this.fileInputElement.addEventListener('change', () => {
            const file = this.fileInputElement.files?.[0];
            if (file) {
                this.onFileSelected(file);
            }
        });

        this.element.querySelectorAll('.copy-path-btn').forEach(button => {
            button.addEventListener('click', (e) => {
                this.copyToClipboard(e.target as HTMLButtonElement);
            });
        });
    }

    private copyToClipboard(button: HTMLButtonElement): void {
        const input = button.previousElementSibling as HTMLInputElement;
        if (input && typeof input.select === 'function') {
            input.select();
            try {
                document.execCommand('copy');
                const originalText = button.textContent;
                button.textContent = 'Copied!';
                setTimeout(() => {
                    button.textContent = originalText;
                }, 2000);
            } catch (err) {
                console.error('Failed to copy text: ', err);
            }
        }
    }
} 