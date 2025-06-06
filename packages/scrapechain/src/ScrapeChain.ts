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

type PageListenerCallback = (selector: string, page: Page, htmlDoc: string) => void;


// TODO: Put browser related fn's into their own class, function, or file. need to be seperated at this point.

export class ScrapeChain {
  private proxy?: Proxy;
  private userAgent?: string;
  public browser!: Browser;
  public page!: Page;


  private pageListeners: Array<{ selector: string; callback: PageListenerCallback }> = [];


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