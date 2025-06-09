import axios from "axios";
import puppeteer from "puppeteer-extra";
///Applications/Google\ Chrome.app/Contents/MacOS/
import type { LaunchOptions, Browser, Page, BrowserContextOptions } from 'puppeteer'
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import type { AxiosRequestConfig, AxiosRequestHeaders, AxiosResponse } from "axios";
import { HttpsProxyAgent } from "https-proxy-agent";
import { GenericProxy } from '@scrapechain/proxy'
import type { Proxy } from "@scrapechain/proxy";
import UserAgent from 'user-agents'
import AnonymizeUA from 'puppeteer-extra-plugin-anonymize-ua'


puppeteer.use(StealthPlugin());
puppeteer.use(AnonymizeUA());

type PageListenerCallback = (selector: string, page: Page, htmlDoc: string) => void;


// TODO: Put browser related fn's into their own class, function, or file. need to be seperated at this point.


interface BlockOptions {
  /**
   * A CSS selector that appears when the page is “blocked” (e.g. a CAPTCHA overlay,
   * “Access Denied” banner, etc.).
   */
  selector: string;

  /**
   * Maximum number of times to attempt un‐blocking before giving up.
   * Each time the selector is detected, the `onBlock` callback is invoked and then
   * a “retry” is attempted. Once attempts reach maxRetries, no further retries happen.
   * Default: 3
   */
  maxRetries?: number;

  /**
   * Called whenever the “blocked” selector is found on the page. Passes the Page,
   * the ScrapeChain instance (so you can rotate UA, rotate proxy, etc.), and the
   * current attempt number (1-based).
   *
   * If you want to “retry” loading the page, you can trigger a reload or
   * re‐navigate within this callback. You also have access to scrapeChain.browser,
   * scrapeChain.page, scrapeChain.proxy, etc.
   */
  onBlock: (args: {
    page: Page;
    scrapeChain: ScrapeChain;
    attempts: number;
  }) => Promise<void> | void;

  /**
   * (Optional) Called when the detector has given up (i.e. attempts > maxRetries).
   * You might log an error here. Default is a no‐op.
   */
  onFail?: (args: {
    page: Page;
    scrapeChain: ScrapeChain;
    attempts: number;
  }) => Promise<void> | void;
}


export class ScrapeChain {
  public proxy?: Proxy;
  private userAgent?: string;
  public browser?: Browser;
  public page!: Page;


  // create a type for this
  private pageListeners: Array<{ selector: string; callback: PageListenerCallback, pollingInterval: number }> = [];

  // Only attach the "targetcreated" handler once
  private hasGlobalListener = false;

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



  watchSelector(selector: string, callback: PageListenerCallback, pollingInterval: number = 2000): this {
    if (!this.browser || !this.page) throw new Error('watchSelector() can only be applied after createBrowser()')
    this.pageListeners.push({ selector, callback, pollingInterval });

    this._injectPollingListener(this.page, selector, callback, pollingInterval);



    if (!this.hasGlobalListener) {
      this.hasGlobalListener = true;

      this.browser.on("targetcreated", async (target) => {
        if (target.type() !== "page") return;
        const newPage = await target.page();
        if (!newPage) return;

        console.log("NEW PAGE (caught by targetcreated)");

        // Re‐inject every selector that’s in pageListeners
        for (const { selector: sel, callback: cb, pollingInterval: pi } of this.pageListeners) {
          console.log("injecting", sel);
          await this._injectPollingListener(newPage, sel, cb, pi);
        }
      });
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


  async createBrowser(launchOptions: LaunchOptions = {}): Promise<Browser> {
    const defaultArgs = [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-blink-features=AutomationControlled",
    ];

    if (this.proxy) {
      const { protocol, endpoint, port } = this.proxy.details;
      defaultArgs.push(`--proxy-server=${protocol}://${endpoint}:${port}`);
    }

    const { args: userArgs = [], ...otherLaunchOptions } = launchOptions;

    const combinedArgs = [...defaultArgs, ...userArgs];

    const browser = await puppeteer.launch({
      headless: true,
      executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      defaultViewport: null,
      ignoreDefaultArgs: ['--enable-automation'],
      args: combinedArgs,
      ...otherLaunchOptions,

    });
    this.browser = browser;



    const page = await browser.newPage();

    if (this.proxy) {
      const { username, password } = this.proxy.details;
      await page.authenticate({
        username: username,
        password: password,
      });
    }
    if (this.userAgent) {
      //@ts-ignore
      await page.setUserAgent(this.userAgent.toString());
    }

    this.page = page;
    return browser;
  }

  private _generateListenerId(): number {
    const min = 1_000_000;
    const max = 9_999_999_999;
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }


  private async _injectPollingListener(page: Page, selector: string, callback: PageListenerCallback, pollingInterval: number) {

    const listenerId = this._generateListenerId();
    const exposedFnName = `__${listenerId}`;


    await page.exposeFunction(exposedFnName, async (htmlDoc: string) => {
      await callback(selector, page, htmlDoc);
    });




    await page.evaluateOnNewDocument(() => {
      // —————————————————————————
      // 1) CDP‐detection patch
      // —————————————————————————

      // Swallow the “stack” getter trick:
      const _origDefine = Object.defineProperty;
      Object.defineProperty = function (obj: any, prop: string, descriptor: PropertyDescriptor) {
        if (prop === 'stack' && typeof descriptor.get === 'function') {
          // skip their detector
          return obj;
        }
        return _origDefine(obj, prop, descriptor);
      };

      // Patch console.log so it never reads error.stack:
      const _origLog = console.log;
      console.log = function (...args: any[]) {
        const safe = args.map(a => a instanceof Error ? '[Error]' : a);
        _origLog.apply(console, safe);
      };

      // —————————————————————————
      // 2) Normalize navigator.hardwareConcurrency
      // —————————————————————————

      // Pick a realistic value (e.g. 4)
      const CORES = 4;
      Object.defineProperty(navigator, 'hardwareConcurrency', {
        get: () => CORES
      });

      // —————————————————————————
      // 3) Inject the same patch into all Workers
      // —————————————————————————

      // Helper: wrap a worker script URL inside a Blob that first runs our patch,
      // then loads their script via importScripts().
      function wrapWithPatch(originalUrl: string) {
        const blobContent = `
          // re‐apply the same patch inside the worker:
          (${(() => {
            // swallow stack getter
            const D = Object.defineProperty;
            Object.defineProperty = function (o: any, p: string, d: PropertyDescriptor) {
              if (p === 'stack' && typeof d.get === 'function') return o;
              return D(o, p, d);
            };
            // patch console.log
            const L = console.log;
            console.log = function (...a: any[]) {
              const s = a.map(x => x instanceof Error ? '[Error]' : x);
              L.apply(console, s);
            };
            // patch hardwareConcurrency
            Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => CORES });
          }).toString()})();
          // now load the actual worker:
          importScripts('${originalUrl}');
        `;
        return new Blob([blobContent], { type: 'application/javascript' });
      }

      // Override Worker and SharedWorker:
      const RealWorker = window.Worker;
      const RealSharedWorker = window.SharedWorker;

      // @ts-ignore
      window.Worker = function (url: string, options?: WorkerOptions) {
        const blobURL = URL.createObjectURL(wrapWithPatch(url));
        return new RealWorker(blobURL, options);
      };
      // preserve the prototype so instanceof still works:
      window.Worker.prototype = RealWorker.prototype;

      // @ts-ignore
      window.SharedWorker = function (url: string, options?: string | SharedWorkerOptions) {
        const blobURL = URL.createObjectURL(wrapWithPatch(url));
        return new RealSharedWorker(blobURL, options as any);
      };
      window.SharedWorker.prototype = RealSharedWorker.prototype;
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
    try {

      // on any new page OTHER THAN 1st visited page.
      // this is because evaluateOnNewDocument is created on the first page. so any page after the first where it's loaded will trigger.
      await page.evaluateOnNewDocument(pollingFunction, selector, exposedFnName, pollingInterval);
      // will run on 1st page loaded.
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

  async scrapeBrowser(url?: string) {
    if (!this.page) throw new Error("Puppeteer page missing");
    if (url) await this.page.goto(url, { waitUntil: "networkidle2", timeout: 30_000 });
    return await this.page.content();
  }


}



// TODO:
// Add failCondition()
// This will add a css selector watcher. if it detects it, it will have a set rules, like rotate proxy, tray again n times before failing.

// TODO:
// setBrowserEngine (choose between puppeteer or playwright)


// TODO:
// integrate my other AI opensource that uses RAG to parse the data