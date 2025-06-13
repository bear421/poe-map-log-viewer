// src/components/mascot.ts
import mascotHappy from '../assets/images/mascot_happy.webp';
import mascotHmm from '../assets/images/mascot_hmm.webp';
import mascotHmm2 from '../assets/images/mascot_hmm2.webp';
import mascotSurprised from '../assets/images/mascot_surprised.webp';
import mascotPleading from '../assets/images/mascot_pleading.webp';
import mascotLaughing from '../assets/images/mascot_laughing.webp';
import { BaseComponent } from './base-component';
import { createElementFromHTML } from '../util';

export namespace Emotion {
    export const HAPPY = mascotHappy;
    export const HMM = mascotHmm;
    export const HMM2 = mascotHmm2;
    export const SURPRISED = mascotSurprised;
    export const PLEADING = mascotPleading;
    export const LAUGHING = mascotLaughing;
}

export class Mascot extends BaseComponent<HTMLImageElement> {
    private animationInterval: number | null = null;
    private readonly animationEmotions = [Emotion.HMM, Emotion.HMM2, Emotion.SURPRISED];
    private currentEmotion!: string;
    private defaultEmotion: string;
    private speechBubble: HTMLDivElement;
    private measureBubble: HTMLDivElement;
    private nextSpeechCancel?: () => void;
    private heardMessages: Set<string> = new Set();
    private pokeLog: number[] = [];

    constructor(parentElement: HTMLElement, initialEmotion = Emotion.HMM2) {
        super(createElementFromHTML('<img class="mascot-image" draggable="false">') as HTMLImageElement, parentElement);
        this.setEmotion(initialEmotion);
        this.defaultEmotion = initialEmotion;
        this.speechBubble = createElementFromHTML('<div class="speech-bubble d-none">') as HTMLDivElement;
        this.measureBubble = createElementFromHTML('<div class="measure-bubble speech-bubble">') as HTMLDivElement;
        parentElement.appendChild(this.measureBubble);
        parentElement.appendChild(this.speechBubble);
        let prevPoke: any, pokeStartedAt: number | null = null;
        this.element.addEventListener('click', () => {
            this.pokeLog.push(Date.now());
            if (pokeStartedAt && Date.now() - pokeStartedAt < 500) return;

            if (prevPoke) {
                clearTimeout(prevPoke);
                this.element.classList.remove('poke');
                this.element.style.animation = 'none';
                void(this.element.offsetHeight);
                this.element.style.animation = '';
            }
            this.element.classList.add('poke');
            pokeStartedAt = Date.now();
            prevPoke = setTimeout(() => {
                this.element.classList.remove('poke');
                prevPoke = null;
                pokeStartedAt = null;
            }, 700);
            if (this.pokeLog.length > 5 && this.pokeLog[0] > Date.now() - 10_000) {
                this.pokeLog.splice(0, this.pokeLog.length);
                if (!!this.data) {
                    this.speak('Heeeey stop that!!', [], 3_000, Emotion.LAUGHING);
                } else {
                    this.speak('Grrr...', ['border-danger'], 3_000, Emotion.HMM2);
                }
            }
        });
    }

    protected init(): void {
        this.setDefaultEmotion(Emotion.HAPPY);
        const data = this.data!;
        for (const levelIndex of data.characterAggregation.characterLevelIndex.values()) {
            if (levelIndex[levelIndex.length - 1].detail.level >= 100) {
                let msg = "Wow! You've reached level 100!";
                if (data.totalDeaths <= 0) {
                    msg += " You must be some kind of mechanical god!";
                } else if (data.totalDeaths < 10) {
                    msg += " Very impressive!";
                }
                this.speak(msg, ['border-success'], 5_000, Emotion.SURPRISED);
                return;
            }
        }
        if (data.totalBossKills > 10) { 
            let msg = "Wow! You've killed so many bosses!";
            if (data.totalDeaths <= 0) {
                msg += " You must be an expert!";
            } else if (data.totalDeaths < data.totalBossKills) {
                msg += " Very impressive!";
            }
            this.speak(`${msg}`, ['border-success'], 5_000, Emotion.SURPRISED);
            return;
        }
        this.setEmotion(Emotion.HAPPY);
    }

    public setDefaultEmotion(emotion: string): void {
        this.defaultEmotion = emotion;
    }

    private setEmotion(emotion: string): void {
        this.currentEmotion = emotion;
        this.element.src = emotion;
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
            let nextEmotion;
            do {
                const randomIndex = Math.floor(Math.random() * this.animationEmotions.length);
                nextEmotion = this.animationEmotions[randomIndex];
            } while (this.animationEmotions.length > 1 && nextEmotion === this.currentEmotion);
            this.setEmotion(nextEmotion);
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
        this.setEmotion(Emotion.HAPPY);
        if (this.nextSpeechCancel) {
            this.nextSpeechCancel();
            this.nextSpeechCancel = undefined;
        }
    }

    public setAnimation(isAnimating: boolean): void {
        isAnimating && this.setVisible(true);
        if (isAnimating) {
            this.startAnimation();
        } else {
            this.stopAnimation();
        }
    }

    public speak(message: string, classes: string[] = ['bg-success', 'bg-opacity-50'], duration: number = 7_000, emotion: string = Emotion.HAPPY, once: boolean = true): { cancel: () => void } {
        if (once && this.heardMessages.has(message)) {
            return { cancel: () => {} };
        }
        if (this.nextSpeechCancel) {
            this.nextSpeechCancel();
            this.nextSpeechCancel = undefined;
        }
        this.setEmotion(emotion);
        this.heardMessages.add(message);
        this.speechBubble.classList.remove('d-none');
        this.speechBubble.classList.add(...classes);
        this.element.classList.add('mascot-speaking');
        
        this.measureBubble.textContent = message;
        let width = Math.min(this.measureBubble.offsetWidth + 1, 320);
        const height = this.measureBubble.offsetHeight;
        this.speechBubble.style.width = `${width}px`;
        this.speechBubble.style.minHeight = `${height}px`;
        
        const words = message.split(/(\s+)/);
        let currentText = words[0];
        this.speechBubble.textContent = currentText;
        let wordIndex = 1;
        const interval = setInterval(() => {
            if (wordIndex < words.length) {
                currentText += words[wordIndex];
                this.speechBubble.textContent = currentText;
                wordIndex++;
            } else {
                this.element.classList.remove('mascot-speaking');
                clearInterval(interval);
            }
        }, 500 / words.length);
        let wasCleanedUp = false;
        const cleanUp = () => {
            if (wasCleanedUp) return;

            wasCleanedUp = true;
            clearInterval(interval);
            this.speechBubble.classList.add('d-none');
            this.speechBubble.classList.remove(...classes);
            this.element.classList.remove('mascot-speaking');
            this.setEmotion(this.defaultEmotion);
        };
        setTimeout(cleanUp, duration);
        this.nextSpeechCancel = cleanUp;
        return { cancel: cleanUp };
    }

    protected render(): void {}
}