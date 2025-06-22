import axios from "axios";
import type { AxiosRequestConfig, AxiosRequestHeaders, AxiosResponse } from "axios";
import { HttpsProxyAgent } from "https-proxy-agent";
import { GenericProxy } from '@scrapechain/proxy'
import type { Proxy } from "@scrapechain/proxy";
import UserAgent from 'user-agents'
import puppeteer from 'puppeteer-core';
import type { Page, Browser } from 'puppeteer-core';
import * as chromeLauncher from 'chrome-launcher';
import proxyChain from 'proxy-chain'

type PageListenerCallback = (selector: string, page: Page, htmlDoc: string) => void;


// TODO: Put browser related fn's into their own class, function, or file. need to be seperated at this point.


interface BlockOptions {

  selector: string;


  maxRetries?: number;

  onBlock: (args: {
    page: Page;
    scrapeChain: ScrapeChain;
    attempts: number;
  }) => Promise<void> | void;

  onFail?: (args: {
    page: Page;
    scrapeChain: ScrapeChain;
    attempts: number;
  }) => Promise<void> | void;
}




export class ScrapeChain {
  private proxy?: Proxy;
  private userAgent?: string;
  public browser!: Browser;
  public page!: Page;


  private pageListeners: Array<{ selector: string; callback: PageListenerCallback }> = [];


  public async clearCache(): Promise<void> {
    if (!this.browser || !this.page) {
      throw new Error("clearCache() can only be called after createBrowser()");
    }

    // 1) Use the DevTools protocol to clear cookies and cache
    const client = await this.page.target().createCDPSession();
    try {
      // Clear all browser cookies
      await client.send("Network.clearBrowserCookies");
      // Clear HTTP cache
      await client.send("Network.clearBrowserCache");
    } catch (err) {
      console.warn("CDP cache‐clear commands failed:", err);
    }

    // 2) Erase localStorage & sessionStorage in the page’s context
    try {
      await this.page.evaluate(() => {
        localStorage.clear();
        sessionStorage.clear();
      });
    } catch (err) {
      console.warn("Failed to clear web storage:", err);
    }

    // 3) (Optional) If you want to completely reset IndexedDB or other storage,
    // you could do something like:
    //
    // await this.page.evaluate(async () => {
    //   const databases = await indexedDB.databases();
    //   for (const dbInfo of databases) {
    //     indexedDB.deleteDatabase(dbInfo.name!);
    //   }
    // });
    //
    // But note: not all Chromium versions support indexedDB.databases().
    // If you need full IndexedDB cleanup, you might spawn a new incognito context instead.

    // At this point, cookies, cache, and local/session storage are cleared.
    // If you want to “restart fresh” you can reload:
    // await this.page.reload({ waitUntil: "networkidle2" });
  }


  onBlock(options: BlockOptions): this {
    if (!this.browser || !this.page) {
      throw new Error("onBlock() can only be called after createBrowser()");
    }

    // Default maxRetries to 3 if not provided
    const maxRetries = options.maxRetries ?? 3;
    let attemptCount = 0;

    // Wrap the user’s onBlock so we can count attempts
    const wrappedCallback: PageListenerCallback = async (
      selector,
      page,
      htmlDoc
    ) => {
      attemptCount++;
      if (attemptCount <= maxRetries) {
        try {
          await options.onBlock({
            page,
            scrapeChain: this,
            attempts: attemptCount,
          });
        } catch (err) {
          console.error("Error in onBlock callback:", err);
        }
      }

      if (attemptCount === maxRetries) {
        // After the last allowed attempt, fire the onFail hook
        if (options.onFail) {
          try {
            await options.onFail({
              page,
              scrapeChain: this,
              attempts: attemptCount,
            });
          } catch (err) {
            console.error("Error in onFail callback:", err);
          }
        }
      }
    };

    // Use the existing watchSelector method to detect the blocking selector
    this.watchSelector(options.selector, wrappedCallback);

    return this;
  }


  watchSelector(selector: string, callback: PageListenerCallback, pollingInterval?: number): this {
    this.pageListeners.push({ selector, callback });
    if (this.page) {
      this._injectPollingListener(this.page, selector, callback, pollingInterval);
    }
    // TODO:
    // if no page, throw error. dont return self.
    return this;
  }


  setProxy(proxy: Proxy | string): this {
    if (typeof proxy === 'string') {
      // pass into generic as string so it can convert to normal Proxy
      this.proxy = new GenericProxy(proxy)
    }
    else {
      // can still be GenericProxy, but user has sent it in as the GenericProxy object or a vendor object
      this.proxy = proxy;
    }
    return this;

  }
  setUserAgent(userAgent: string | UserAgent): this {

    if (typeof userAgent === 'string') {
      this.userAgent = userAgent;
    }
    else {
      this.userAgent = userAgent.toString();
    }
    return this;
  }


  setBrowser(browser: Browser): this {
    this.browser = browser;
    return this;
  }


  async createBrowser(launchOptions: chromeLauncher.Options = {}): Promise<Browser> {

    const defaultArgs: string[] = [
      //`--disable-extensions-except=${extensionPath}`,
      //`--load-extension=${extensionPath}`
      //'--headless=new',        // run headless; remove if you want the browser UI
      //'--no-sandbox'
    ];

    if (this.proxy) {
      const oldProxyUrl = this.proxy.toUrl();
      const newProxyUrl = await proxyChain.anonymizeProxy(oldProxyUrl);
      defaultArgs.push(`--proxy-server=${newProxyUrl}`);
    }

    const {
      chromeFlags: userArgs = [],
      ...otherLaunchOptions
    } = launchOptions;

    const chromeFlags = [
      ...defaultArgs,
      ...userArgs
    ];

    const chrome = await chromeLauncher.launch({
      chromeFlags,
      ...otherLaunchOptions
    });

    const browserURL = `http://localhost:${chrome.port}`;


    const browser = await puppeteer.connect({
      browserURL,
      defaultViewport: null
    });

    const [page] = await browser.pages();
    if (!page) throw new Error('NO PAGE');
    this.browser = browser;
    this.page = page;
    return browser;

  }

  private _generateListenerId(): number {
    const min = 1_000_000;
    const max = 9_999_999_999;
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }


  private async _injectPollingListener(page: Page, selector: string, callback: PageListenerCallback, pollingInterval = 2000) {

    const listenerId = this._generateListenerId();
    const exposedFnName = `__${listenerId}`;


    await page.exposeFunction(exposedFnName, async (htmlDoc: string) => {
      await callback(selector, page, htmlDoc);
    });


    const pollingFunction = (sel: string, callFn: string, intervalMs: number) => {
      // ON EVERY UNIQUE NEW DOC - this executes
      let busy = false;
      // @ts-ignore
      async function doCheck() {
        if (!busy && document.querySelector(sel)) {
          busy = true;

          const html = document.documentElement.outerHTML;
          // @ts-ignore
          await window[callFn](html);
          busy = false;
        }
      };

      // immediate call
      doCheck();

      // & setup interval to call
      setInterval(() => {
        doCheck();
      }, intervalMs);
    };


    // MAIN ENTRY
    // vvvvvvvvvv
    // on any new page OTHER THAN 1st visited page.
    // this is because evaluateOnNewDocument is created on the first page. so any page after the first where it's loaded will trigger.
    await page.evaluateOnNewDocument(pollingFunction, selector, exposedFnName, pollingInterval);


    // will run on 1st page loaded
    try {
      await page.evaluate(pollingFunction, selector, exposedFnName, pollingInterval);
    } catch (err: any) {
      const msg = err?.message || "";
      if (!msg.includes("Execution context was destroyed")) {
        throw err;
      }
    }
  }




  async scrapeHttp(url: string, config: AxiosRequestConfig = {}): Promise<string> {
    let agent = null;
    if (this.proxy) {
      const proxyUrl = this.proxy.toUrl();
      agent = new HttpsProxyAgent(proxyUrl);
    }

    // set header defaults
    config.headers = {}

    if (this.userAgent) {
      config.headers['User-Agent'] = this.userAgent;
    }

    const response = await axios({
      url: url,
      httpAgent: agent,
      httpsAgent: agent,
      ...config,
    });

    if (response.data) {
      return response.data;
    }
    else {
      // TODO: Err handle
      console.log('AXIOS ERROR')
      return ''
    }
  }

  async scrapeBrowser(url: string) {
    if (!this.page) throw new Error("Puppeteer page missing");
    await this.page.goto(url, { waitUntil: "networkidle2", timeout: 30_000 });
    return await this.page.content();
  }


}


// TODO:
// setBrowserEngine (choose between puppeteer or playwright)


// TODO:
// integrate my other AI opensource that uses RAG to parse the data