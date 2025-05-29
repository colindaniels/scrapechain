import axios from "axios";
import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import type { AxiosRequestConfig, AxiosResponse } from "axios";
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
      // pass into baseproxy as string so it can convert to normal Proxy
      this.proxy = new GenericProxy(proxy)
    }
    else {
      // can still be GenericProxy, but user has sent it in as the GenericProxy object or a vendor object
      this.proxy = proxy;
    }
    return this;

  }

  async scrape(url: string, config: AxiosRequestConfig = {}): Promise<AxiosResponse> {
    let agent = null;
    if (this.proxy) {
      const proxyUrl = this.proxy.toUrl();
      agent = new HttpsProxyAgent(proxyUrl);
    }

    const response = await axios({
      url: url,
      httpAgent: agent,
      httpsAgent: agent,
      ...config,
    });

    return response;
  }

  async browserScrape(url: string) {

    const browserArgs = ["--no-sandbox", "--disable-setuid-sandbox"];

    if (this.proxy) {
      browserArgs.push(
        `--proxy-server=${this.proxy.details.protocol}://${this.proxy.details.endpoint}:${this.proxy.details.port}`
      );
    }

    const browser = await puppeteer.launch({
      headless: false,
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
  }
}

// TODO
// for now start with a super abstracted library, and later on integrate cusomibility.




// TODO:
// for setProxy and setUserAgent, they should be able to set it with just a string, not a whole object.