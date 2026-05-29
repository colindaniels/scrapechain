import { Browser, BrowserOptions } from 'scrapechain'
import { Proxy } from '@scrapechain/proxy'




type FetchCookie = (browser: Browser, url: string) => Promise<string>;

interface CookieJarOptions {
    size: number;
    url: string;
    browserOptions: BrowserOptions;
    proxy?: Proxy;
    fetchCookie: FetchCookie;
}

export class CookieJar {

    private options: CookieJarOptions;
    private cookieJar: string[] = [];
    private currentCookie: string = '';

    constructor(options: CookieJarOptions) {
        this.options = options;
    }

    randomString() {
        return Math.random().toString(36).slice(2, 12);
    }


    launchBrowser() {
        const browserOptions = this.options.browserOptions;
        return Browser.launch({
            ...browserOptions,
            user_data_dir: browserOptions.user_data_dir ?? `./chrome-data-${this.randomString()}`,
            headless: browserOptions.headless ?? true,
            proxy: browserOptions.proxy ?? undefined,
        })
    }


    private async produceCookie(): Promise<string> {
        const browser = await this.launchBrowser();
        try {
            return await this.options.fetchCookie(browser, this.options.url);
        } finally {
            await browser.close();
        }
    }

    private async startGatheringCookies() {
        while (true) {
            if (this.cookieJar.length < this.options.size) {
                this.cookieJar.push(await this.produceCookie());
            }
            await new Promise(r => setTimeout(r, 1000));
            console.log(this.cookieJar.length)
        }
    }

    private async waitForAnyCookie(maxPolls?: number): Promise<void> {
        if (maxPolls === undefined) maxPolls = Infinity;
        let currentPoll = 0;
        while (this.cookieJar.length < 1 && currentPoll < maxPolls) {
            await new Promise(r => setTimeout(r, 500));
            currentPoll++;
        }
        return;
    }

    async initCookieJar(): Promise<void> {
        this.startGatheringCookies();

        await this.waitForAnyCookie();
        return;
    }

    async aquireCookie() {
        await this.waitForAnyCookie();
        return this.cookieJar.shift();
    }
}