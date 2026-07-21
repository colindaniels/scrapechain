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
    maxConcurrentRefills?: number;
    /**
     * Max requests per second per port. Acquires join a FIFO queue and are
     * granted evenly spaced (1000/rate ms apart) per slot. A slot's cookie is
     * shared by any number of concurrent handles — the rate, not exclusivity,
     * is the limit. Omit for unlimited.
     */
    maxRequestsPerSecond?: number;
}

export interface CookieHandle {
    cookie: string;
    proxy: Proxy;
    /** With `dead: true`, kills this cookie and triggers a refill (deduped
     * across concurrent handles on the same slot). Without, a no-op. */
    release: (opts?: { dead?: boolean }) => void;
    /**
     * Kill this cookie, wait for the same slot to mint a fresh one, then
     * re-acquire it. Resolves with a fresh handle for the same proxy.
     * Rejects if the refresh doesn't complete within `timeoutMs`
     * (default `acquireTimeoutMs`); the slot still refills in the background.
     */
    renew: (opts?: { timeoutMs?: number }) => Promise<CookieHandle>;
}

type SlotState = 'ready' | 'refilling' | 'cooling_down';

interface Waiter {
    resolve: (slot: Slot) => void;
    reject: (err: Error) => void;
    /** Armed only while waiting for a ready slot; cleared once a send time is
     * reserved, so rate-limit queueing doesn't count against the timeout. */
    timeout?: ReturnType<typeof setTimeout>;
}

class Slot {
    readonly proxy: Proxy;
    cookie: string | null = null;
    state: SlotState = 'refilling';
    /** Earliest time the next request may be dispatched on this slot. */
    nextSendAt = 0;
    /** Waiters that want this specific slot (renew). Served before the global queue. */
    claimants: Waiter[] = [];
    constructor(proxy: Proxy) {
        this.proxy = proxy;
    }
}

const DEFAULT_ACQUIRE_TIMEOUT_MS = 30_000;
const CLOSE_TIMEOUT_MS = 5_000; // cap on browser.close() — a killed/crashed browser never settles
const DEFAULT_REFILL_BACKOFF_MS = 120_000;
const DEFAULT_MAX_CONCURRENT_REFILLS = 20;

export class CookieJar {
    private options: CookieJarOptions;
    private slots: Slot[];
    private waiters: Waiter[] = [];
    private launchInFlight = 0;
    private launchWaiters: Array<() => void> = [];
    /** ms between dispatches per slot; 0 = unlimited. */
    private sendInterval: number;
    /** Single pending wakeup for when the earliest rate-busy port frees up. */
    private pumpTimer?: ReturnType<typeof setTimeout>;
    private pumpAt = Infinity;

    constructor(options: CookieJarOptions) {
        if (!options.proxies.length) {
            throw new Error('CookieJar requires at least one proxy in `proxies`');
        }
        if (options.maxRequestsPerSecond !== undefined && options.maxRequestsPerSecond <= 0) {
            throw new Error('CookieJar: maxRequestsPerSecond must be > 0');
        }
        this.options = options;
        this.slots = options.proxies.map(p => new Slot(p));
        this.sendInterval = options.maxRequestsPerSecond ? 1000 / options.maxRequestsPerSecond : 0;
    }

    private randomString(): string {
        return Math.random().toString(36).slice(2, 12);
    }

    private async launchBrowser(proxy: Proxy): Promise<Browser> {
        const bo = this.options.browserOptions;
        return Browser.launch({
            ...bo,
            user_data_dir: `${bo.user_data_dir ?? './chrome-profiles'}/chrome-profile-${this.randomString()}`,
            headless: bo.headless ?? true,
            proxy,
        });
    }

    /** Gate concurrent browser launches so we don't overwhelm the host. */
    private async acquireLaunchSlot(): Promise<void> {
        const max = this.options.maxConcurrentRefills ?? DEFAULT_MAX_CONCURRENT_REFILLS;
        if (this.launchInFlight < max) {
            this.launchInFlight++;
            return;
        }
        await new Promise<void>(resolve => {
            this.launchWaiters.push(() => {
                this.launchInFlight++;
                resolve();
            });
        });
    }

    private releaseLaunchSlot(): void {
        this.launchInFlight--;
        const next = this.launchWaiters.shift();
        if (next) next();
    }

    /** Refill loops until success. Failures back off for `refillBackoffMs` and retry. */
    private async refill(slot: Slot): Promise<void> {
        const backoff = this.options.refillBackoffMs ?? DEFAULT_REFILL_BACKOFF_MS;
        while (true) {
            slot.state = 'refilling';
            await this.acquireLaunchSlot();
            let success = false;
            try {
                const browser = await this.launchBrowser(slot.proxy);
                try {
                    const cookie = await this.options.fetchCookie(browser, this.options.url);
                    // An empty string is a VALID cookie: some proxy IPs are clean enough that the
                    // target sets no cookie, and the caller signals that by returning ''. Only a
                    // missing return (null/undefined) means the mint failed.
                    if (cookie == null) throw new Error('fetchCookie returned no cookie');
                    slot.cookie = cookie;
                    success = true;
                } finally {
                    // Never block forever here. If the browser was killed/crashed its CDP
                    // connection is gone, so close() never settles — .catch() only handles
                    // rejection, not a hang. An unbounded await would leak the launch slot
                    // (releaseLaunchSlot below never runs), and `maxConcurrentRefills` leaks
                    // deadlock the jar: no browser is ever launched again.
                    await Promise.race([
                        browser.close().catch(() => {}),
                        new Promise(r => setTimeout(r, CLOSE_TIMEOUT_MS)),
                    ]);
                }
            } catch (err) {
                slot.cookie = null;
                slot.state = 'cooling_down';
                console.error(`[CookieJar] refill failed on port ${(slot.proxy as any).options?.port ?? '?'}:`, err);
            } finally {
                this.releaseLaunchSlot();
            }
            if (success) {
                slot.state = 'ready';
                this.serveClaimants(slot);
                this.pump();
                return;
            }
            await new Promise(r => setTimeout(r, backoff));
        }
    }

    /** Lowest-index slot that is ready and may send right now — so traffic
     * fills port 1 until its rate is saturated, then spills to port 2, and so
     * on. Slots with pending renew claimants are skipped: their send capacity
     * belongs to the claimants first. */
    private pickSendableSlot(now: number): Slot | null {
        for (const s of this.slots) {
            if (s.state !== 'ready' || s.cookie == null) continue;
            if (s.claimants.length > 0) continue;
            if (s.nextSendAt <= now) return s;
        }
        return null;
    }

    private soonestReadySlot(): Slot | null {
        let best: Slot | null = null;
        for (const s of this.slots) {
            if (s.state !== 'ready' || s.cookie == null) continue;
            if (!best || s.nextSendAt < best.nextSendAt) best = s;
        }
        return best;
    }

    private anyReadySlot(): boolean {
        return this.slots.some(s => s.state === 'ready' && s.cookie != null);
    }

    /** While a cookie exists somewhere, queued waiters are only rate-limited, so
     * their acquire timeouts are paused; when no cookie is available, they tick. */
    private syncTimeouts(): void {
        if (this.anyReadySlot()) {
            for (const w of this.waiters) {
                if (w.timeout) {
                    clearTimeout(w.timeout);
                    w.timeout = undefined;
                }
            }
        } else {
            for (const w of this.waiters) {
                if (!w.timeout) this.armTimeout(w);
            }
        }
    }

    /** Dispatch queued waiters (FIFO) onto whichever ports can send right now.
     * Nothing is booked into the future: when every ready port is rate-busy, a
     * single timer wakes the pump when the earliest port frees up — so ports
     * that become ready in the meantime pick up the queue immediately. */
    private pump(): void {
        while (this.waiters.length > 0) {
            const now = Date.now();
            const slot = this.pickSendableSlot(now);
            if (!slot) break;
            const waiter = this.waiters.shift()!;
            if (waiter.timeout) {
                clearTimeout(waiter.timeout);
                waiter.timeout = undefined;
            }
            slot.nextSendAt = now + this.sendInterval;
            waiter.resolve(slot);
        }
        this.syncTimeouts();
        if (this.waiters.length > 0) {
            const soonest = this.soonestReadySlot();
            if (soonest) this.wakePumpAt(soonest.nextSendAt);
        }
    }

    private wakePumpAt(at: number): void {
        if (this.pumpTimer !== undefined) {
            if (this.pumpAt <= at) return; // an earlier wakeup is already set
            clearTimeout(this.pumpTimer);
        }
        this.pumpAt = at;
        this.pumpTimer = setTimeout(() => {
            this.pumpTimer = undefined;
            this.pumpAt = Infinity;
            this.pump();
        }, Math.max(0, at - Date.now()));
    }

    /** Renew claimants get the slot's send capacity before the global queue. */
    private serveClaimants(slot: Slot): void {
        while (slot.claimants.length > 0) {
            if (slot.state !== 'ready' || slot.cookie == null) return;
            const now = Date.now();
            if (slot.nextSendAt > now) {
                setTimeout(() => {
                    this.serveClaimants(slot);
                    this.pump();
                }, slot.nextSendAt - now);
                return;
            }
            slot.nextSendAt = now + this.sendInterval;
            slot.claimants.shift()!.resolve(slot);
        }
    }

    private armTimeout(waiter: Waiter, timeoutMs?: number): void {
        const waitMs = timeoutMs ?? this.options.acquireTimeoutMs ?? DEFAULT_ACQUIRE_TIMEOUT_MS;
        waiter.timeout = setTimeout(() => {
            const i = this.waiters.indexOf(waiter);
            if (i >= 0) this.waiters.splice(i, 1);
            waiter.reject(new Error(`CookieJar.acquire: timed out after ${waitMs}ms — no cookies available`));
        }, waitMs);
    }

    private toHandle(slot: Slot): CookieHandle {
        const cookie = slot.cookie!;
        const proxy = slot.proxy;
        let done = false;
        return {
            cookie,
            proxy,
            release: ({ dead = false } = {}) => {
                if (done) return;
                done = true;
                if (dead) this.killCookie(slot, cookie);
            },
            renew: ({ timeoutMs } = {}) => {
                if (done) {
                    return Promise.reject(new Error('CookieJar.renew: handle already released'));
                }
                done = true;
                return this.renewSlot(slot, cookie, timeoutMs);
            },
        };
    }

    /** Kill a slot's cookie and start one refill. Deduped: concurrent handles
     * reporting the same burned cookie trigger a single refill. */
    private killCookie(slot: Slot, cookie: string): void {
        if (slot.state === 'refilling') return;
        if (slot.cookie !== cookie) return; // already renewed since this handle was issued
        slot.cookie = null;
        this.refill(slot).catch(() => {});
        this.syncTimeouts(); // if that was the last cookie, acquire timeouts start ticking
    }

    /** Kill the slot's cookie, refill it, and re-acquire the same slot once ready. */
    private renewSlot(slot: Slot, cookie: string, timeoutMs?: number): Promise<CookieHandle> {
        this.killCookie(slot, cookie);
        const waitMs = timeoutMs ?? this.options.acquireTimeoutMs ?? DEFAULT_ACQUIRE_TIMEOUT_MS;
        return new Promise<CookieHandle>((resolve, reject) => {
            const waiter: Waiter = {
                resolve: (s) => {
                    clearTimeout(timer);
                    resolve(this.toHandle(s));
                },
                reject,
            };
            const timer = setTimeout(() => {
                const i = slot.claimants.indexOf(waiter);
                if (i >= 0) slot.claimants.splice(i, 1);
                reject(new Error(`CookieJar.renew: timed out after ${waitMs}ms waiting for port ${(slot.proxy as any).options?.port ?? '?'} to refresh`));
            }, waitMs);
            slot.claimants.push(waiter);
            // if another handle already renewed this slot, it may be ready now
            if (slot.state === 'ready' && slot.cookie != null) this.serveClaimants(slot);
        });
    }

    /** Kick off refills for every slot concurrently. Resolves when the first slot is ready. */
    async initCookieJar(): Promise<void> {
        const firstReady = this.slots.map(slot => this.refill(slot));
        await Promise.any(firstReady);
    }

    /**
     * Acquire an `(ip, cookie)` pair. Requests are granted FIFO, rate-limited
     * per port by `maxRequestsPerSecond`. The timeout only counts time spent
     * with no cookie available — not time queued behind the rate limit.
     */
    async acquire(): Promise<CookieHandle> {
        return new Promise<CookieHandle>((resolve, reject) => {
            const waiter: Waiter = {
                resolve: (slot) => resolve(this.toHandle(slot)),
                reject,
            };
            this.armTimeout(waiter);
            this.waiters.push(waiter);
            this.pump();
        });
    }
}
