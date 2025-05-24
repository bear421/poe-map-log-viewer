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
    private speechBubble: HTMLDivElement;
    private measureBubble: HTMLDivElement;

    constructor(parentElement: HTMLElement, initialFrameIndex: number = 2) {
        super(createElementFromHTML('<img class="mascot-image">') as HTMLImageElement, parentElement);
        this.setFrame(initialFrameIndex);
        
        this.speechBubble = createElementFromHTML('<div class="speech-bubble d-none">') as HTMLDivElement;
        this.measureBubble = createElementFromHTML('<div class="speech-bubble d-none" style="position: absolute; visibility: hidden;">') as HTMLDivElement;
        this.element.parentElement?.insertBefore(this.speechBubble, this.element);
        this.element.parentElement?.insertBefore(this.measureBubble, this.element);
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

    public speak(message: string, classes: string[] = ['bg-success', 'bg-opacity-50'], duration: number = 7000): { cancel: () => void } {
        this.speechBubble.classList.remove('d-none');
        this.speechBubble.classList.add(...classes);
        this.element.classList.add('anim-bump');
        
        this.measureBubble.textContent = message;
        this.measureBubble.classList.remove('d-none');
        const width = this.measureBubble.offsetWidth;
        const height = this.measureBubble.offsetHeight;
        this.measureBubble.classList.add('d-none');
        
        this.speechBubble.style.width = `${width}px`;
        this.speechBubble.style.height = `${height}px`;
        
        const words = message.split(/(\s+)/);
        let currentText = '';
        let wordIndex = 0;
        
        const interval = setInterval(() => {
            if (wordIndex < words.length) {
                currentText += words[wordIndex];
                this.speechBubble.textContent = currentText;
                wordIndex++;
            } else {
                this.element.classList.remove('anim-bump');
                clearInterval(interval);
            }
        }, 400 / words.length);
        const cleanUp = () => {
            clearInterval(interval);
            this.speechBubble.classList.add('d-none');
            this.speechBubble.classList.remove(...classes);
            this.speechBubble.style.width = '';
            this.speechBubble.style.height = '';
            this.element.classList.remove('anim-bump');
        };
        setTimeout(cleanUp, duration);
        return { cancel: cleanUp };
    }

    protected render(): void {}
}