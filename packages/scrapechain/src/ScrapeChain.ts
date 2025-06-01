import axios from "axios";
import puppeteer from "puppeteer-extra";
import type { LaunchOptions } from 'puppeteer'
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import type { AxiosRequestConfig, AxiosRequestHeaders, AxiosResponse } from "axios";
import { HttpsProxyAgent } from "https-proxy-agent";
import { GenericProxy } from '@scrapechain/proxy'
import type { Proxy } from "@scrapechain/proxy";
import type { Browser, Page, BrowserContextOptions } from 'puppeteer'
import UserAgent from 'user-agents'


puppeteer.use(StealthPlugin())

type PageListenerCallback = (selector: string, page: Page) => void;


export class ScrapeChain {
  private proxy?: Proxy;
  private userAgent?: string;
  public browser!: Browser;
  public page!: Page;


  private pageListeners: Array<{ selector: string; callback: PageListenerCallback }> = [];

  /** Register a callback whenever `selector` appears anywhere in the page. */
  setPageListener(selector: string, callback: PageListenerCallback, pollingInterval?: number): this {
    this.pageListeners.push({ selector, callback });
    // If there's already a page open, attach this listener immediately:
    if (this.page) {
      this._injectPollingListener(this.page, selector, callback, pollingInterval);
    }
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
    const browserArgs = ["--no-sandbox", "--disable-setuid-sandbox"];

    if (this.proxy) {
      const { protocol, endpoint, port } = this.proxy.details;
      browserArgs.push(
        `--proxy-server=${protocol}://${endpoint}:${port}`,
      );
    }

    const browser = await puppeteer.launch({
      headless: true,
      args: browserArgs,
      ...launchOptions
    });
    const page = await browser.newPage();

    if (this.proxy) {
      const { username, password } = this.proxy.details;
      await page.authenticate({
        username: username,
        password: password,
      });
    }
    if (this.userAgent) {
      await page.setUserAgent(this.userAgent.toString());
    }

    this.browser = browser;
    this.page = page;
    return browser;
  }

  private _generateListenerId(): number {
    const min = 1_000_000;
    const max = 9_999_999_999;
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }


  private async _injectPollingListener(page: Page,
    selector: string,
    callback: PageListenerCallback,
    pollingInterval = 2000
  ) {
    // for the end user, this should all happen on a _blank target, no new page.
    // random function name to avoid overlap
    const listnerId = this._generateListenerId();
    // expose unique function name on window that puppeteer can call back into node
    const exposedFnName = `__${listnerId}`;
    const resetFnName   = `__r${listnerId}`;


    await page.exposeFunction(resetFnName, () => {
      // No-op here; this just creates window[resetFnName]() in page context.
      // The actual logic of resetting `busy` is inside our pollingFunction below.
    });

    // set cacllback function in browser window
    await page.exposeFunction(exposedFnName, () => {
      callback(selector, page);
    });


    function JSpollingFunction(sel: string, fn: string, intervalMs: number) {
      const doCheck = () => {
        try {
          if (document.querySelector(sel)) {
            // @ts-ignore
            window[fn]();
            return true;
          }
        } catch {
          // ignore transient DOM errors
        }
        return false;
      };

      // Run a 1 off immediate check right now:
      if (doCheck()) {
        return;
      }

      // 3b) Otherwise, poll every `interval` ms until we succeed:
      const timer = setInterval(() => {
        if (doCheck()) {
          clearInterval(timer);
        }
      }, intervalMs);
    };



    // on any new page OTHER THAN 1st visited page.
    // this is because evaluateOnNewDocument is created on the first page. so any page after the first where it's loaded will trigger.
    await page.evaluateOnNewDocument(JSpollingFunction, selector, exposedFnName, pollingInterval);


    // run on 1st
    try {
      await page.evaluate(JSpollingFunction, selector, exposedFnName, pollingInterval);
    } catch (err: any) {
      const message = err?.message || "";
      if (!message.includes("Execution context was destroyed")) {
        throw err;
      }
      // otherwise ignore, because navigation raced our injection
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


//TODO:
// Be able to return the browser as an object


// TODO:
// Be able to rotate user agent

// TODO:
// Can get the browser at any time.
// good example would be set the captcha listeners, then get the browser object, then do their own scraping with puppeteer/playwright

// TODO:
// not sure if plausible, but after a solved captcha, they can put it back into the ScrapeChain object and then continue through the ScrapeChain. idk though


// TODO:
// integrate my other AI opensource that utilizes AI to parse the data