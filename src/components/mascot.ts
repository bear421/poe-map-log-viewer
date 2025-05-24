// src/components/mascot.ts
import mascotHappy from '../assets/images/mascot_happy.webp';
import mascotHmm from '../assets/images/mascot_hmm.webp';
import mascotHmm2 from '../assets/images/mascot_hmm2.webp';
import mascotSurprised from '../assets/images/mascot_surprised.webp';
import { BaseComponent } from './base-component';
import { createElementFromHTML } from '../util';

export class Mascot extends BaseComponent<HTMLImageElement> {
    private animationInterval: number | null = null;
    private currentFrameIndex: number = 0;
    private readonly frameImagePaths = [
        mascotHappy,
        mascotHmm,
        mascotHmm2,
        mascotSurprised
    ];
    private readonly animationFrames = [1, 2, 3];

    constructor(parentElement: HTMLElement, initialFrameIndex: number = 2) {
        super(createElementFromHTML('<img class="mascot-image">') as HTMLImageElement, parentElement);
        this.setFrame(initialFrameIndex);
    }

    private setFrame(frameIndex: number): void {
        if (this.frameImagePaths[frameIndex]) {
            this.element.src = this.frameImagePaths[frameIndex];
            this.currentFrameIndex = frameIndex;
        }
    }

    setVisible(visible: boolean): this {
        if (!visible) {
            this.stopAnimation();
        }
        return super.setVisible(visible);
    }

    private startAnimation(): void {
        if (this.animationInterval) return;

        const selectNewRandomFrame = () => {
            let nextFrameToDisplay;
            const currentlyDisplayedFrame = this.currentFrameIndex;
            do {
                const randomIndex = Math.floor(Math.random() * this.animationFrames.length);
                nextFrameToDisplay = this.animationFrames[randomIndex];
            } while (this.animationFrames.length > 1 && nextFrameToDisplay === currentlyDisplayedFrame);
            this.setFrame(nextFrameToDisplay);
        };
        selectNewRandomFrame();
        this.animationInterval = window.setInterval(() => {
            selectNewRandomFrame();
        }, 450);
    }

    public stopAnimation(): void {
        if (this.animationInterval) {
            clearInterval(this.animationInterval);
            this.animationInterval = null;
        }
        this.setFrame(0); 
    }

    public setAnimation(isAnimating: boolean): void {
        isAnimating && this.setVisible(true);
        if (isAnimating) {
            this.startAnimation();
        } else {
            this.stopAnimation();
        }
    }

    protected render(): void {}
}