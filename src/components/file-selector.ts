const PATH_CONFIG = {
    poe1: {
        label: 'Path of Exile 1',
        standalone: {
            path: '%PROGRAMFILES(X86)%\\Grinding Gear Games\\Path of Exile\\logs\\Client.txt',
            label: 'Standalone client:'
        },
        steam: {
            path: '%PROGRAMFILES(X86)%\\Steam\\steamapps\\common\\Path of Exile\\logs\\Client.txt',
            label: 'Steam client:'
        }
    },
    poe2: {
        label: 'Path of Exile 2',
        standalone: {
            path: '%PROGRAMFILES(X86)%\\Grinding Gear Games\\Path of Exile 2\\logs\\Client.txt',
            label: 'Standalone client:'
        },
        steam: {
            path: '%PROGRAMFILES(X86)%\\Steam\\steamapps\\common\\Path of Exile 2\\logs\\Client.txt',
            label: 'Steam client:'
        }
    }
};

export class FileSelectorComponent {
    private element: HTMLDivElement;
    private fileInputElement!: HTMLInputElement;
    private inputGroupElement!: HTMLDivElement;
    private pathHelperCardElement!: HTMLDivElement;
    private pathHelperContentDiv!: HTMLDivElement; // To dynamically update content
    private poe1SwitchElement!: HTMLInputElement;
    private poe2SwitchElement!: HTMLInputElement;

    private onFileSelected: (file: File) => void;
    private selectedGame: 'poe1' | 'poe2' = 'poe2'; // Default to PoE2

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
        this.pathHelperCardElement.className = 'card';
        
        const cardHeader = document.createElement('div');
        cardHeader.className = 'card-header';
        // Header with title and game version switcher
        cardHeader.innerHTML = `
            <div class="d-flex justify-content-between align-items-center">
                <h4 class="mb-0"><i class="bi bi-info-circle-fill text-primary me-2"></i>Looking for your Client.txt file?</h4>
                <div class="btn-group btn-group-sm" role="group" aria-label="Select Game Version">
                    <input type="radio" class="btn-check" name="gameVersionToggle" id="poe1Switch" autocomplete="off" value="poe1">
                    <label class="btn btn-outline-secondary" for="poe1Switch">PoE 1</label>
                    <input type="radio" class="btn-check" name="gameVersionToggle" id="poe2Switch" autocomplete="off" value="poe2">
                    <label class="btn btn-outline-secondary" for="poe2Switch">PoE 2</label>
                </div>
            </div>
        `;
        this.pathHelperCardElement.appendChild(cardHeader);
        
        // Store references to switch elements
        this.poe1SwitchElement = cardHeader.querySelector('#poe1Switch') as HTMLInputElement;
        this.poe2SwitchElement = cardHeader.querySelector('#poe2Switch') as HTMLInputElement;
        
        // Set initial checked state based on this.selectedGame
        if (this.selectedGame === 'poe1') {
            this.poe1SwitchElement.checked = true;
        } else {
            this.poe2SwitchElement.checked = true;
        }

        this.pathHelperContentDiv = document.createElement('div');
        this.pathHelperContentDiv.className = 'card-body path-helper';
        this.pathHelperCardElement.appendChild(this.pathHelperContentDiv);
        
        this.element.appendChild(this.pathHelperCardElement);

        // Initial rendering of path helper content
        this.renderPathHelperContents();
    }

    private renderPathHelperContents(): void {
        const gameConfig = PATH_CONFIG[this.selectedGame];
        this.pathHelperContentDiv.innerHTML = `
            <div class="mb-2">
                <strong>${gameConfig.standalone.label}</strong>
                <div class="input-group">
                    <input type="text" class="form-control" value="${gameConfig.standalone.path}" readonly>
                    <button class="btn btn-primary copy-path-btn" type="button">Copy</button>
                </div>
            </div>
            <div>
                <strong>${gameConfig.steam.label}</strong>
                <div class="input-group">
                    <input type="text" class="form-control" value="${gameConfig.steam.path}" readonly>
                    <button class="btn btn-primary copy-path-btn" type="button">Copy</button>
                </div>
            </div>
            <small class="text-muted mt-2 d-block">Note: If you installed Steam in a custom location, you'll need to adjust the path accordingly.</small>
        `;
        this.setupCopyButtonListeners(this.pathHelperContentDiv);
    }

    private setupEventListeners(): void {
        this.fileInputElement.addEventListener('change', () => {
            const file = this.fileInputElement.files?.[0];
            if (file) {
                this.onFileSelected(file);
            }
        });

        const gameVersionToggleHandler = (event: Event) => {
            const target = event.target as HTMLInputElement;
            if (target.value === 'poe1' || target.value === 'poe2') {
                this.selectedGame = target.value;
                this.renderPathHelperContents();
            }
        };

        this.poe1SwitchElement.addEventListener('change', gameVersionToggleHandler);
        this.poe2SwitchElement.addEventListener('change', gameVersionToggleHandler);
    }
    
    private setupCopyButtonListeners(container: HTMLElement): void {
        container.querySelectorAll('.copy-path-btn').forEach(button => {
            // Remove existing listener to prevent duplicates if any
            const newButton = button.cloneNode(true) as HTMLButtonElement;
            button.parentNode?.replaceChild(newButton, button);

            newButton.addEventListener('click', (e) => {
                this.copyToClipboard(e.target as HTMLButtonElement);
            });
        });
    }

    private copyToClipboard(button: HTMLButtonElement): void {
        const input = button.previousElementSibling as HTMLInputElement;
        if (input && typeof input.select === 'function') {
            input.select();
            // Modern clipboard API if available, fallback to execCommand
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(input.value).then(() => {
                    const originalText = button.textContent;
                    button.textContent = 'Copied!';
                    button.classList.add('btn-success');
                    button.classList.remove('btn-primary');
                    setTimeout(() => {
                        button.textContent = originalText;
                        button.classList.add('btn-primary');
                        button.classList.remove('btn-success');
                    }, 2000);
                }).catch(err => {
                    console.error('Failed to copy text using navigator.clipboard: ', err);
                    // Fallback to execCommand if permission denied or other error
                    this.execCommandCopy(button, input, originalText => {
                        button.textContent = originalText;
                         button.classList.add('btn-primary');
                        button.classList.remove('btn-success');
                    });
                });
            } else {
                 const originalText = button.textContent;
                 this.execCommandCopy(button, input, () => {
                     button.textContent = originalText;
                     button.classList.add('btn-primary');
                     button.classList.remove('btn-success');
                 });
            }
        }
    }

    private execCommandCopy(button: HTMLButtonElement, input: HTMLInputElement, onFinally: (originalText: string | null) => void): void {
        const originalText = button.textContent;
        try {
            input.select(); // Re-select for execCommand context
            document.execCommand('copy');
            button.textContent = 'Copied!';
            button.classList.add('btn-success');
            button.classList.remove('btn-primary');
            setTimeout(() => onFinally(originalText), 2000);
        } catch (err) {
            console.error('Failed to copy text using execCommand: ', err);
            onFinally(originalText); // Reset button text even on error
        }
    }
} 