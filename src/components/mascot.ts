// src/components/mascot.ts
import mascotHappy from '../assets/images/mascot_happy.webp';
import mascotHmm from '../assets/images/mascot_hmm.webp';
import mascotHmm2 from '../assets/images/mascot_hmm2.webp';
import mascotSurprised from '../assets/images/mascot_surprised.webp';

export class Mascot {
    private element: HTMLImageElement;
    private animationInterval: number | null = null;
    private currentFrameIndex: number = 0;
    private originalParentElement: HTMLElement | null = null;

    private readonly frameImagePaths = [
        mascotHappy,
        mascotHmm,
        mascotHmm2,
        mascotSurprised
    ];
    private readonly searchAnimationFrames = [1, 2, 3];

    constructor(parentElement?: HTMLElement, initialFrameIndex: number = 2) {
        this.element = document.createElement('img');
        this.element.classList.add('mascot-image');

        this.setFrame(initialFrameIndex);
        
        if (parentElement) {
            this.originalParentElement = parentElement;
            this.originalParentElement.appendChild(this.element);
        }
    }

    public getElement(): HTMLImageElement {
        return this.element;
    }

    public show(): void {
        this.element.style.display = 'block';
    }

    public hide(): void {
        this.element.style.display = 'none';
    }

    private setFrame(frameIndex: number): void {
        if (this.frameImagePaths[frameIndex]) {
            this.element.src = this.frameImagePaths[frameIndex];
            this.currentFrameIndex = frameIndex;
        }
    }

    private startSearchAnimation(): void {
        if (this.animationInterval) return;

        const selectNewRandomFrame = () => {
            let nextFrameToDisplay;
            const currentlyDisplayedFrame = this.currentFrameIndex;
            do {
                const randomIndex = Math.floor(Math.random() * this.searchAnimationFrames.length);
                nextFrameToDisplay = this.searchAnimationFrames[randomIndex];
            } while (this.searchAnimationFrames.length > 1 && nextFrameToDisplay === currentlyDisplayedFrame);
            this.setFrame(nextFrameToDisplay);
        };
        selectNewRandomFrame();
        this.animationInterval = window.setInterval(() => {
            selectNewRandomFrame();
        }, 450);
    }

    private stopSearchAnimation(): void {
        if (this.animationInterval) {
            clearInterval(this.animationInterval);
            this.animationInterval = null;
        }
        this.setFrame(0); 
    }

    public setSearchAnimation(isAnimating: boolean): void {
        if (isAnimating) {
            this.startSearchAnimation();
        } else {
            this.stopSearchAnimation();
        }
    }

}