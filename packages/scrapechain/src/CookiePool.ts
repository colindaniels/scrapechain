import { ScrapeChain } from './ScrapeChain'

interface CookiePoolOptions {
    scraper: ScrapeChain
    cookie_url: string
    cookie_selector: string
    max_pool_size?: number
    randomize_fingerprint?: boolean
}

export class CookiePool {
    private queue: string[] = [];
    private selected = '';
    private filling = false;
    private scraper: ScrapeChain;
    private cookie_url: string;
    private cookie_selector: string;
    private max_pool_size: number;
    private randomize_fingerprint: boolean;
    private cookieReady: Promise<void>;
    private cookieReadyResolve!: () => void;

    constructor(options: CookiePoolOptions) {
        this.scraper = options.scraper;
        this.cookie_url = options.cookie_url;
        this.cookie_selector = options.cookie_selector;
        this.max_pool_size = options.max_pool_size ?? 1;
        this.randomize_fingerprint = options.randomize_fingerprint ?? false;
        this.cookieReady = new Promise(resolve => { this.cookieReadyResolve = resolve });
        this.fill();
    }

    async getCookie(): Promise<string> {
        await this.cookieReady;
        return this.selected;
    }

    releaseCookie(cookie: string) {
        // already rotated by another caller — ignore
        if (cookie !== this.selected) return;

        const next = this.queue.shift();
        if (next) {
            this.selected = next;
            console.log(`[CookiePool] rotated cookie, ${this.queue.length}/${this.max_pool_size} in queue`)
            this.fill();
        } else {
            // queue empty — wait for fill to produce one
            this.selected = '';
            this.cookieReady = new Promise(resolve => { this.cookieReadyResolve = resolve });
            this.fill();
            console.log('[CookiePool] queue empty, waiting for new cookie...')
        }
    }

    private async fill() {
        if (this.filling) return;
        this.filling = true;
        try {
            while (this.queue.length < this.max_pool_size || !this.selected) {
                console.log(`[CookiePool] obtaining cookie... (queue: ${this.queue.length}/${this.max_pool_size})`)
                const seed = this.randomize_fingerprint ? Math.floor(Math.random() * 2147483647) : undefined;
                const cookie = await this.scraper.crawlForCookies(this.cookie_url, this.cookie_selector, { seed });

                if (!this.selected) {
                    this.selected = cookie;
                    this.cookieReadyResolve();
                    console.log('[CookiePool] selected cookie set')
                } else {
                    this.queue.push(cookie);
                    console.log(`[CookiePool] cookie added to queue (${this.queue.length}/${this.max_pool_size})`)
                }
            }
            console.log(`[CookiePool] pool full (${this.queue.length}/${this.max_pool_size})`)
        } catch (err) {
            console.log('[CookiePool] error obtaining cookie:', err)
        } finally {
            this.filling = false;
        }
    }
}