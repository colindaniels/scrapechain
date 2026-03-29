import type { ScrapeChain } from './ScrapeChain'
import type { Browser } from './Browser'
import type { Page } from 'puppeteer-core'
import type { Proxy } from '@scrapechain/proxy'

interface BrowserPoolOptions<TArgs extends any[], TReturn> {
    scraper: ScrapeChain
    handler: (page: Page, ...args: TArgs) => Promise<TReturn>
    maxPagesPerBrowser?: number
    maxBrowsers: number
    proxies?: Proxy[]
}

interface BrowserEntry {
    browser: Browser
    pageCount: number
}

export class BrowserPool<TArgs extends any[] = any[], TReturn = any> {
    private entries: BrowserEntry[] = []
    private waiters: (() => void)[] = []
    private pageMap = new Map<Page, BrowserEntry>()
    private scraper: ScrapeChain
    private handler: (page: Page, ...args: TArgs) => Promise<TReturn>
    private maxPagesPerBrowser: number
    private maxBrowsers: number
    private proxies?: Proxy[]
    ready: Promise<void>

    constructor(options: BrowserPoolOptions<TArgs, TReturn>) {
        this.scraper = options.scraper
        this.handler = options.handler
        this.maxPagesPerBrowser = options.maxPagesPerBrowser ?? 10
        this.maxBrowsers = options.maxBrowsers
        this.proxies = options.proxies
        this.ready = this.launch()
    }

    private async launch() {
        const defaults = this.scraper.getBrowserDefaults()
        const launches = Array.from({ length: this.maxBrowsers }, async (_, i) => {
            const seed = defaults.seed ?? Math.floor(Math.random() * 2147483647)
            const proxy = this.proxies?.[i]?.toUrl()
            const browser = await this.scraper.createBrowser({
                seed,
                userDataDir: `${defaults.userDataDir ?? './chrome-data'}-${i}`,
                proxy,
            })
            this.entries.push({ browser, pageCount: 0 })
            console.log(`[BrowserPool] browser ${i} ready (seed: ${seed})`)
        })
        await Promise.all(launches)
        console.log(`[BrowserPool] all ${this.maxBrowsers} browsers ready`)
    }

    private async acquirePage(): Promise<Page> {
        while (true) {
            const entry = this.entries.find(e => e.pageCount < this.maxPagesPerBrowser)
            if (entry) {
                entry.pageCount++
                try {
                    const page = await entry.browser.newPage()
                    this.pageMap.set(page, entry)
                    return page
                } catch (err) {
                    entry.pageCount--
                    throw err
                }
            }

            // all browsers full — wait for a slot
            await new Promise<void>(resolve => { this.waiters.push(resolve) })
        }
    }

    private async releasePage(page: Page) {
        const entry = this.pageMap.get(page)
        if (!entry) return
        this.pageMap.delete(page)
        try { await page.close() } catch {}
        entry.pageCount--

        const waiter = this.waiters.shift()
        if (waiter) waiter()
    }

    async run(...args: TArgs): Promise<TReturn> {
        await this.ready
        const page = await this.acquirePage()
        try {
            return await this.handler(page, ...args)
        } finally {
            await this.releasePage(page)
        }
    }

    async closeAll() {
        for (const entry of this.entries) {
            await entry.browser.close()
            entry.browser.cleanUserDataDir()
        }
        this.entries = []
        this.pageMap.clear()
        this.waiters = []
    }

    get stats() {
        return {
            browsers: this.entries.length,
            totalPages: this.entries.reduce((sum, e) => sum + e.pageCount, 0),
            waiting: this.waiters.length,
        }
    }
}
