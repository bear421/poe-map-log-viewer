import mascotHappy from '../assets/images/mascot_happy.webp';
import mascotHmm from '../assets/images/mascot_hmm.webp';
import mascotHmm2 from '../assets/images/mascot_hmm2.webp';
import mascotSurprised from '../assets/images/mascot_surprised.webp';

export class Mascot {
    private element: HTMLImageElement;
    private animationInterval: number | null = null;
    private currentFrameIndex: number = 0;

    private readonly frameImagePaths = [
        mascotHappy,
        mascotHmm,
        mascotHmm2,
        mascotSurprised
    ];
    private readonly searchAnimationFrames = [1, 2, 3];

    constructor(parentElement: HTMLElement, initialFrameIndex: number = 1) {
        this.element = document.createElement('img');
        this.element.classList.add('mascot-image');

        this.setFrame(initialFrameIndex);
        parentElement.appendChild(this.element);

        this.setupHoverWiggle();
    }

    private setFrame(frameIndex: number): void {
        if (this.frameImagePaths[frameIndex]) {
            this.element.src = this.frameImagePaths[frameIndex];
            this.currentFrameIndex = frameIndex;
        }
    }

    private setupHoverWiggle(): void {
        this.element.addEventListener('mouseenter', () => {
            this.element.classList.remove('mascot-wiggle-on-hover');
            // Trigger a reflow to restart the animation if re-entering quickly
            void this.element.offsetWidth;
            this.element.classList.add('mascot-wiggle-on-hover');
        });
        this.element.addEventListener('mouseleave', () => {
            this.element.classList.remove('mascot-wiggle-on-hover');
        });
    }

    private startSearchAnimation(): void {
        if (this.animationInterval) return; // Already animating

        const selectNewRandomFrame = () => {
            let nextFrameToDisplay;
            const currentlyDisplayedFrame = this.currentFrameIndex;
            do {
                const randomIndex = Math.floor(Math.random() * this.searchAnimationFrames.length);
                nextFrameToDisplay = this.searchAnimationFrames[randomIndex];
            } while (this.searchAnimationFrames.length > 1 && nextFrameToDisplay === currentlyDisplayedFrame);
            this.setFrame(nextFrameToDisplay);
        };

        selectNewRandomFrame(); // Set initial frame for search animation

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