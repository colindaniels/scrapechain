import { ScrapeChain } from './ScrapeChain'

interface CookiePoolOptions {
    cookie_url: string
    cookie_selector: string
    max_pool_size?: number
    collection_interval_ms?: number
    cookie_life_ms?: number
    scraper: ScrapeChain
}

interface ResolvedCookiePoolOptions {
    cookie_url: string
    cookie_selector: string
    max_pool_size: number
    collection_interval_ms: number
    cookie_life_ms: number
    scraper: ScrapeChain
}


export class CookiePool {
    private cookieQueue: string[] = [];
    private currentCookie: string = '';
    private options: ResolvedCookiePoolOptions

    constructor(options: CookiePoolOptions) {
        // set defaults
        this.options = {
            max_pool_size: 5,
            collection_interval_ms: 1000,
            cookie_life_ms: 1000 * 60 * 60 * 24, // one day
            ...options
        }
        this.init()
    }

    async init() {
        console.log(`cookie pool initializing. Gathering ${this.options.max_pool_size} cookies...`)
        while (this.cookieQueue.length < this.options.max_pool_size) {
            console.log('[Opening Browser...]')
            const cookie = await this.options.scraper.crawlForCookies(this.options.cookie_url, this.options.cookie_selector)
            this.cookieQueue.push(cookie);
            console.log('[Cookie Obtained]')
        }
        this.currentCookie = 
    }

    async aquireCookie() {
        
    }

    async releaseCookie() {

    }

}