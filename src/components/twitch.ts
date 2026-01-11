import { BaseComponent } from './base-component';
import { createElementFromHTML } from '../util';

interface TwitchTokenInfo {
    accessToken: string;
    refreshToken?: string;
    expiresAt: number;
    scopes: string[];
    userId: string;
    userName: string;
}

interface TwitchMutedSegment {
    duration: number;
    offset: number;
}

interface TwitchVideoData {
    id: string;
    stream_id: string;
    user_id: string;
    user_login: string;
    user_name: string;
    title: string;
    description: string;
    created_at: string;
    published_at: string;
    url: string;
    thumbnail_url: string;
    viewable: string;
    view_count: number;
    language: string;
    type: string;
    duration: string;
    muted_segments: TwitchMutedSegment[];
}

export class TwitchVideo {
    readonly id: string;
    readonly streamId: string;
    readonly userId: string;
    readonly userLogin: string;
    readonly userName: string;
    readonly title: string;
    readonly description: string;
    readonly createdAt: Date;
    readonly publishedAt: Date;
    readonly url: string;
    readonly thumbnailUrl: string;
    readonly viewable: string;
    readonly viewCount: number;
    readonly language: string;
    readonly type: string;
    readonly duration: string;
    readonly mutedSegments: TwitchMutedSegment[];

    constructor(data: TwitchVideoData) {
        this.id = data.id;
        this.streamId = data.stream_id;
        this.userId = data.user_id;
        this.userLogin = data.user_login;
        this.userName = data.user_name;
        this.title = data.title;
        this.description = data.description;
        this.createdAt = new Date(data.created_at);
        this.publishedAt = new Date(data.published_at);
        this.url = data.url;
        this.thumbnailUrl = data.thumbnail_url;
        this.viewable = data.viewable;
        this.viewCount = data.view_count;
        this.language = data.language;
        this.type = data.type;
        this.duration = data.duration;
        this.mutedSegments = data.muted_segments || [];
    }

    get durationSeconds(): number {
        const match = this.duration.match(/(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?/);
        if (!match) return 0;
        
        const hours = parseInt(match[1] || '0', 10);
        const minutes = parseInt(match[2] || '0', 10);
        const seconds = parseInt(match[3] || '0', 10);
        
        return hours * 3600 + minutes * 60 + seconds;
    }

    get durationMillis(): number {
        return this.durationSeconds * 1000;
    }

    containsDate(date: Date): boolean {
        return this.createdAt.getTime() <= date.getTime() && this.createdAt.getTime() + this.durationMillis < date.getTime();
    }

    getThumbnailUrl(width: number = 320, height: number = 180): string {
        return this.thumbnailUrl
            .replace('%{width}', width.toString())
            .replace('%{height}', height.toString());
    }

    get isVod(): boolean {
        return this.type === 'archive';
    }

    get isHighlight(): boolean {
        return this.type === 'highlight';
    }

    get isUpload(): boolean {
        return this.type === 'upload';
    }
}

export class TwitchComponent extends BaseComponent<HTMLDivElement> {
    private tokenInfo: TwitchTokenInfo | null = null;
    private connectButton: HTMLButtonElement;

    private static readonly WELL_KNOWN_CLIENT_ID = "3a1m2er8qdqnwfjmc8g1dy0x1pw2pn";
    private static readonly REDIRECT_URI = window.location + "?auth=twitch";
    private static readonly SCOPES = "user:read:email";

    constructor(container: HTMLElement) {
        super(createElementFromHTML(`
            <div class="twitch-component">
                <button class="connect-btn"></button>
            </div>
        `) as HTMLDivElement, container);

        this.connectButton = this.element.querySelector('.connect-btn') as HTMLButtonElement;
        this.loadStoredTokens();
        this.initializeEventListeners();
        this.updateUI();
    }

    private initializeEventListeners(): void {
        this.connectButton.addEventListener('click', () => {
            if (this.isConnectedToTwitch()) {
                this.disconnect();
            } else {
                this.startTwitchAuth();
            }
        });

        window.addEventListener('message', (event) => {
            if (event.origin !== window.location.origin) return;
            
            if (event.data.type === 'TWITCH_AUTH_SUCCESS' && event.data.accessToken) {
                this.handleAuthSuccess(event.data.accessToken, event.data.state);
            } else if (event.data.type === 'TWITCH_AUTH_ERROR') {
                this.handleAuthError(event.data.error);
            }
        });

        this.handleRedirectCallback();
    }

    private loadStoredTokens(): void {
        try {
            const stored = localStorage.getItem('twitch-token-info');
            if (stored) {
                const tokenInfo = JSON.parse(stored) as TwitchTokenInfo;
                if (tokenInfo.expiresAt > Date.now()) {
                    this.tokenInfo = tokenInfo;
                } else {
                    localStorage.removeItem('twitch-token-info');
                }
            }
        } catch (e) {
            console.warn('Failed to load stored Twitch tokens:', e);
            localStorage.removeItem('twitch-token-info');
        }
    }

    protected render(): void {}

    protected updateUI(): void {
        if (this.tokenInfo) {
            this.connectButton.innerHTML = `
                <i class="bi bi-twitch me-2"></i>
                ${this.tokenInfo.userName}
            `;
            this.connectButton.className = "btn btn-success connect-btn";
        } else {
            this.connectButton.innerHTML = `
                <i class="bi bi-twitch me-2"></i>
                Connect
            `;
            this.connectButton.className = "btn btn-twitch connect-btn";
        }
    }

    private startTwitchAuth(): void {
        const state = crypto.randomUUID();
        sessionStorage.setItem('twitch-auth-state', state);

        const authUrl = new URL('https://id.twitch.tv/oauth2/authorize');
        authUrl.searchParams.set('client_id', TwitchComponent.WELL_KNOWN_CLIENT_ID);
        authUrl.searchParams.set('redirect_uri', TwitchComponent.REDIRECT_URI);
        authUrl.searchParams.set('response_type', 'token');
        authUrl.searchParams.set('scope', TwitchComponent.SCOPES);
        authUrl.searchParams.set('state', state);

        const popup = window.open(
            authUrl.toString(),
            'twitch-auth',
            'width=800,height=600,scrollbars=yes,resizable=yes'
        );

        if (!popup) {
            alert('Popup blocked! Please allow popups for this site and try again.');
            return;
        }

        const checkClosed = setInterval(() => {
            if (popup.closed) {
                clearInterval(checkClosed);
                sessionStorage.removeItem('twitch-auth-state');
            }
        }, 1000);
    }

    private handleRedirectCallback(): void {
        const urlParams = new URLSearchParams(window.location.search);
        const authParam = urlParams.get('auth');
        
        if (authParam === 'twitch') {
            const fragment = window.location.hash.substring(1);
            const fragmentParams = new URLSearchParams(fragment);
            const accessToken = fragmentParams.get('access_token');
            const state = fragmentParams.get('state');
            const error = urlParams.get('error');

            if (window.opener && window.opener !== window) {
                if (error) {
                    window.opener.postMessage({
                        type: 'TWITCH_AUTH_ERROR',
                        error: error
                    }, window.location.origin);
                } else if (accessToken && state) {
                    window.opener.postMessage({
                        type: 'TWITCH_AUTH_SUCCESS',
                        accessToken: accessToken,
                        state: state
                    }, window.location.origin);
                }
                window.close();
            }
        }
    }

    private async handleAuthSuccess(accessToken: string, state: string): Promise<void> {
        const storedState = sessionStorage.getItem('twitch-auth-state');
        sessionStorage.removeItem('twitch-auth-state');
        if (state !== storedState) throw new Error("CSRF token mismatch in Twitch OAuth callback");

        try {
            this.connectButton.disabled = true;
            this.connectButton.innerHTML = '<i class="bi bi-hourglass-split me-2"></i>Connecting...';

            const userResponse = await fetch('https://api.twitch.tv/helix/users', {
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Client-Id': TwitchComponent.WELL_KNOWN_CLIENT_ID,
                },
            });
            if (!userResponse.ok) throw new Error('Failed to get user info: ' + userResponse.statusText);

            const userData = await userResponse.json();
            const user = userData.data[0];

            this.tokenInfo = {
                accessToken: accessToken,
                refreshToken: undefined,
                expiresAt: Date.now() + (4 * 60 * 60 * 1000),
                scopes: TwitchComponent.SCOPES.split(' '),
                userId: user.id,
                userName: user.display_name,
            };

            localStorage.setItem('twitch-token-info', JSON.stringify(this.tokenInfo));
            this.updateUI();
            let userId = await this.getUserId("ben_");
            console.log(await this.getVideos(userId!));
        } catch (error) {
            console.error('Failed to complete Twitch authentication:', error);
            alert('Failed to connect to Twitch. Please try again.');
        } finally {
            this.connectButton.disabled = false;
        }
    }

    private async fetchAuthenticated(url: string): Promise<any> {
        if (!this.tokenInfo) throw new Error("Not connected to Twitch");

        return await fetch(url, {
            headers: {
                'Authorization': `Bearer ${this.tokenInfo.accessToken}`,
                'Client-Id': TwitchComponent.WELL_KNOWN_CLIENT_ID,
            },
        });
    }

    private handleAuthError(error: string): void {
        console.error('Twitch auth error:', error);
        alert(`Authentication failed: ${error}`);
    }

    private disconnect(): void {
        localStorage.removeItem('twitch-token-info');
        this.tokenInfo = null;
        this.updateUI();
    }

    public isConnectedToTwitch(): boolean {
        return this.tokenInfo !== null;
    }

    public getTwitchUserId(): string | null {
        return this.tokenInfo?.userId || null;
    }

    /**
     * @returns the longest video that contains the given date (preferring VODs over highlights) or null if no such video exists
     */
    public async getVideoAt(date: Date): Promise<TwitchVideo | null> {
        const videos = await this.getVideos();
        const candidates = videos.filter(v => v.containsDate(date))
            .sort((a, b) => {
                if (a.isVod && !b.isVod) return -1;

                if (!a.isVod && b.isVod) return 1;
                
                return b.durationSeconds - a.durationSeconds;
            });
        return candidates[0] || null;
    }

    public async getVideos(userId?: string): Promise<TwitchVideo[]> {
        if (!userId) {
            userId = this.tokenInfo?.userId;
        }
        const response = await this.fetchAuthenticated(`https://api.twitch.tv/helix/videos?user_id=${userId}`);
        if (!response.ok) return [];

        const data = await response.json();
        console.log("videos data", data);
        return data.data.map((videoData: TwitchVideoData) => new TwitchVideo(videoData));
    }

    public async getUserId(username: string): Promise<string | null> {
        const response = await this.fetchAuthenticated(`https://api.twitch.tv/helix/users?login=${username}`);
        if (!response.ok) return null;
        
        const data = await response.json();
        return data.data[0]?.id;
    }
} 