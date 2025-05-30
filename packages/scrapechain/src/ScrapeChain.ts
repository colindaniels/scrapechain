import axios from "axios";
import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import type { AxiosRequestConfig, AxiosRequestHeaders, AxiosResponse } from "axios";
import { HttpsProxyAgent } from "https-proxy-agent";
import { GenericProxy } from '@scrapechain/proxy'
import type { Proxy } from "@scrapechain/proxy";
import type { Browser, Page, BrowserContextOptions } from 'puppeteer'
import UserAgent from 'user-agents'


puppeteer.use(StealthPlugin())




export class ScrapeChain {
  private proxy?: Proxy;
  private userAgent?: string;
  private browser?: Browser;
  private page?: Page;


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


  async createBrowser(): Promise<Browser> {
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