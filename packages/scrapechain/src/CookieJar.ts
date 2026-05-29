import { Browser, BrowserOptions } from 'scrapechain'
import { Proxy } from '@scrapechain/proxy'

type FetchCookie = (browser: Browser, url: string) => Promise<string>;

interface CookieJarOptions {
    proxies: Proxy[];
    url: string;
    browserOptions: BrowserOptions;
    fetchCookie: FetchCookie;
    acquireTimeoutMs?: number;
    refillBackoffMs?: number;
}

export interface CookieHandle {
    cookie: string;
    proxy: Proxy;
    release: (opts?: { dead?: boolean }) => void;
}

type SlotState = 'idle' | 'in_use' | 'refilling' | 'cooling_down';

class Slot {
    readonly proxy: Proxy;
    cookie: string | null = null;
    state: SlotState = 'refilling';
    constructor(proxy: Proxy) {
        this.proxy = proxy;
    }
}

type Waiter = (slot: Slot) => void;

const DEFAULT_ACQUIRE_TIMEOUT_MS = 30_000;
const DEFAULT_REFILL_BACKOFF_MS = 120_000;

export class CookieJar {
    private options: CookieJarOptions;
    private slots: Slot[];
    private waiters: Waiter[] = [];

    constructor(options: CookieJarOptions) {
        if (!options.proxies.length) {
            throw new Error('CookieJar requires at least one proxy in `proxies`');
        }
        this.options = options;
        this.slots = options.proxies.map(p => new Slot(p));
    }

    private randomString(): string {
        return Math.random().toString(36).slice(2, 12);
    }

    private async launchBrowser(proxy: Proxy): Promise<Browser> {
        const bo = this.options.browserOptions;
        return Browser.launch({
            ...bo,
            user_data_dir: `${bo.user_data_dir ?? './chrome-data'}-${this.randomString()}`,
            headless: bo.headless ?? true,
            proxy,
        });
    }

    /** Refill loops until success. Failures back off for `refillBackoffMs` and retry. */
    private async refill(slot: Slot): Promise<void> {
        const backoff = this.options.refillBackoffMs ?? DEFAULT_REFILL_BACKOFF_MS;
        while (true) {
            slot.state = 'refilling';
            try {
                const browser = await this.launchBrowser(slot.proxy);
                let cookie: string;
                try {
                    cookie = await this.options.fetchCookie(browser, this.options.url);
                } finally {
                    await browser.close().catch(() => {});
                }
                if (!cookie) throw new Error('fetchCookie returned empty cookie');
                slot.cookie = cookie;
                slot.state = 'idle';
                this.dispatchWaiters();
                return;
            } catch (err) {
                slot.cookie = null;
                slot.state = 'cooling_down';
                await new Promise(r => setTimeout(r, backoff));
            }
        }
    }

    private findIdleSlot(): Slot | null {
        for (const s of this.slots) {
            if (s.state === 'idle' && s.cookie) return s;
        }
        return null;
    }

    /** Hand off any idle slots to waiting acquirers (FIFO). */
    private dispatchWaiters(): void {
        while (this.waiters.length > 0) {
            const slot = this.findIdleSlot();
            if (!slot) return;
            slot.state = 'in_use';
            const waiter = this.waiters.shift()!;
            waiter(slot);
        }
    }

    private toHandle(slot: Slot): CookieHandle {
        const cookie = slot.cookie!;
        const proxy = slot.proxy;
        let released = false;
        return {
            cookie,
            proxy,
            release: ({ dead = false } = {}) => {
                if (released) return;
                released = true;
                this.releaseSlot(slot, dead);
            },
        };
    }

    private releaseSlot(slot: Slot, dead: boolean): void {
        if (slot.state !== 'in_use') return;
        if (dead) {
            slot.cookie = null;
            slot.state = 'refilling';
            this.refill(slot).catch(() => {});
        } else {
            slot.state = 'idle';
            this.dispatchWaiters();
        }
    }

    /** Kick off refills for every slot concurrently. Resolves when the first slot is ready. */
    async initCookieJar(): Promise<void> {
        const firstReady = this.slots.map(slot => this.refill(slot));
        await Promise.any(firstReady);
    }

    /** Acquire an `(ip, cookie)` pair. Throws if no slot becomes available within `acquireTimeoutMs`. */
    async acquire(): Promise<CookieHandle> {
        const idle = this.findIdleSlot();
        if (idle) {
            idle.state = 'in_use';
            return this.toHandle(idle);
        }
        const timeoutMs = this.options.acquireTimeoutMs ?? DEFAULT_ACQUIRE_TIMEOUT_MS;
        return new Promise<CookieHandle>((resolve, reject) => {
            const onSlot: Waiter = (slot) => {
                clearTimeout(timer);
                resolve(this.toHandle(slot));
            };
            const timer = setTimeout(() => {
                const i = this.waiters.indexOf(onSlot);
                if (i >= 0) this.waiters.splice(i, 1);
                reject(new Error(`CookieJar.acquire: timed out after ${timeoutMs}ms — no slots available`));
            }, timeoutMs);
            this.waiters.push(onSlot);
        });
    }
}
