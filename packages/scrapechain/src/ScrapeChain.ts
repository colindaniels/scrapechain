import axios from "axios";
import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import type { AxiosRequestConfig, AxiosRequestHeaders, AxiosResponse } from "axios";
import { HttpsProxyAgent } from "https-proxy-agent";
import { GenericProxy } from '@scrapechain/proxy'
import type { Proxy } from "@scrapechain/proxy";
import UserAgent from 'user-agents'


puppeteer.use(StealthPlugin())


export class ScrapeChain {
  private proxy?: Proxy;
  private userAgent?: string;

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

  async scrape(url: string, config: AxiosRequestConfig = {}): Promise<string> {
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

  async scrapeBrowser(url: string): Promise<string> {

    const browserArgs = ["--no-sandbox", "--disable-setuid-sandbox"];

    if (this.proxy) {
      browserArgs.push(
        `--proxy-server=${this.proxy.details.protocol}://${this.proxy.details.endpoint}:${this.proxy.details.port}`
      );
    }

    const browser = await puppeteer.launch({
      headless: true,
      args: browserArgs,
    });
    const page = await browser.newPage();

    if (this.proxy) {
      await page.authenticate({
        username: this.proxy.details.username,
        password: this.proxy.details.password,
      });
    }
    if (this.userAgent) {
      await page.setUserAgent(this.userAgent.toString());
    }

    await page.goto(url, { waitUntil: 'networkidle2' })
    const html = await page.content();
    browser.close();
    return html;
  }
}

// TODO:
// setBrowserEngine


//TODO:
// Be able to return the browser as an object
