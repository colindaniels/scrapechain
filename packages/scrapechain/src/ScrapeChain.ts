import { Proxy } from '@scrapechain/proxy'
import { fetch, Headers, type BrowserProfile, type RequestInit, type Response } from 'wreq-js';
import { Browser, BrowserOptions } from './Browser';
import { CookieJar, type CookieHandle } from './CookieJar';

type FetchCookie = (browser: Browser, url: string) => Promise<string>;

/** Blueprint for how the pool mints a cookie for a given proxy/IP. */
interface CookiePoolConfig {
    /** URL each browser visits to obtain a cookie (challenge page, etc). */
    url: string;
    /** What to do in the browser to capture the cookie. Returns the cookie
     * value ('' is valid — means the IP was clean and set none). */
    fetchCookie: FetchCookie;
}

/** Blueprint for how HTTP requests are made once a cookie is held. */
interface RequestConfig {
    /** Browser profile wreq-js impersonates. @default 'chrome_142' */
    browser?: BrowserProfile;
    /**
     * Build the `Cookie` header value from the held cookie. Return null/undefined
     * to send no cookie header (e.g. when the value is empty). Default sends the
     * raw cookie value as-is.
     */
    cookieHeader?: (cookie: string) => string | null | undefined;
    /**
     * Decide whether a response is good. Returning false burns the cookie,
     * renews it on the same port, and retries the request.
     */
    validate: (body: string, response: Response) => boolean;
    /** Per-request timeout in ms. @default 30000 */
    timeout?: number;
    /** How long a renew waits for a fresh cookie before failing. @default 180000 */
    renewTimeoutMs?: number;
    /** Max attempts per request across invalid responses AND network errors. @default 4 */
    maxRetries?: number;
}

interface ScrapeChainOptions {
    /** Every proxy/port the pool may mint cookies on and route requests through. */
    proxies: Proxy[];
    /** Browser launch options (chrome_path, headless, fingerprint, ...). */
    browserOptions: BrowserOptions;
    /** How the cookie pool is filled. */
    cookiePool: CookiePoolConfig;
    /** How requests are sent, validated, and retried once cookies exist. */
    request: RequestConfig;
    /** Max requests/sec per port. Omit for unlimited. */
    maxRequestsPerSecond?: number;
    /** Max browsers minting cookies at once. */
    maxConcurrentRefills?: number;
    /** Backoff between failed cookie-mint attempts. */
    refillBackoffMs?: number;
    /** How long acquire() waits for any cookie to become available. */
    acquireTimeoutMs?: number;
}

export interface FetchResult {
    /** Response body text (already read; validated). */
    body: string;
    /** The underlying wreq-js response. */
    response: Response;
    /** How many attempts it took (1 = first try succeeded). */
    attempts: number;
    /** The proxy the successful request went through. */
    proxy: Proxy;
}

/**
 * The main scraper. Configure the proxy fleet, the cookie-pool blueprint, and
 * the request blueprint once; then call `fetch(url)`. Routing across ports,
 * rate limiting, cookie injection, validation, renewal, and retries are all
 * handled internally.
 */
export class ScrapeChain {
    private jar: CookieJar;
    private request: RequestConfig;

    constructor(options: ScrapeChainOptions) {
        this.request = options.request;
        this.jar = new CookieJar({
            proxies: options.proxies,
            url: options.cookiePool.url,
            fetchCookie: options.cookiePool.fetchCookie,
            browserOptions: options.browserOptions,
            maxRequestsPerSecond: options.maxRequestsPerSecond,
            maxConcurrentRefills: options.maxConcurrentRefills,
            refillBackoffMs: options.refillBackoffMs,
            acquireTimeoutMs: options.acquireTimeoutMs,
        });
    }

    /** Fill the cookie pool. Resolves once the first cookie is ready. */
    async init(): Promise<void> {
        await this.jar.initCookieJar();
    }

    private buildHeaders(cookie: string, init?: RequestInit): Headers {
        const headers = new Headers(init?.headers);
        const build = this.request.cookieHeader ?? ((c: string) => c);
        const value = build(cookie);
        if (value != null) headers.set('cookie', value);
        return headers;
    }

    /**
     * Fetch a URL through the pool: acquires a cookie (routed to the least-busy
     * ready port, rate-limited), injects it, validates the response, and on an
     * invalid response renews the cookie and retries. Network errors are also
     * retried. Rejects only after `maxRetries` attempts.
     */
    async fetch(url: string, init?: RequestInit): Promise<FetchResult> {
        const maxRetries = this.request.maxRetries ?? 4;
        const renewTimeoutMs = this.request.renewTimeoutMs ?? 180_000;
        let cookie: CookieHandle | undefined;

        try {
            for (let attempt = 1; ; attempt++) {
                cookie ??= await this.jar.acquire();

                let response: Response;
                try {
                    response = await fetch(url, {
                        ...init,
                        browser: init?.browser ?? this.request.browser ?? 'chrome_142',
                        headers: this.buildHeaders(cookie.cookie, init),
                        proxy: cookie.proxy.toUrl(),
                        timeout: init?.timeout ?? this.request.timeout ?? 30_000,
                    });
                } catch (err) {
                    // Network/proxy error — this cookie may be fine, so keep it,
                    // re-acquire a fresh send slot, and retry (rejoins rate queue).
                    if (attempt >= maxRetries) throw err;
                    cookie.release();
                    cookie = undefined;
                    continue;
                }

                const body = await response.text();
                if (this.request.validate(body, response)) {
                    const proxy = cookie.proxy;
                    cookie.release();
                    return { body, response, attempts: attempt, proxy };
                }

                // Invalid response — cookie is burned. Renew on the SAME port and
                // retry with the fresh cookie (renew handle skips the queue).
                if (attempt >= maxRetries) {
                    cookie.release({ dead: true });
                    cookie = undefined;
                    throw new Error(`ScrapeChain.fetch: ${url} still invalid after ${maxRetries} attempts`);
                }
                cookie = await cookie.renew({ timeoutMs: renewTimeoutMs });
            }
        } finally {
            // Safety net: if we broke out via an unexpected throw with a live
            // handle, don't leak it.
            cookie?.release();
        }
    }
}
