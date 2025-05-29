import axios from "axios";
import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import type { AxiosRequestConfig, AxiosResponse } from "axios";
import { HttpsProxyAgent } from "https-proxy-agent";
import type {} from "./index";
import UserAgent from 'user-agents'

puppeteer.use(StealthPlugin());

interface ProxyDetails {
  protocol: string;
  endpoint: string;
  port: number;
  username: string;
  password: string;
}

interface ProxyProvider {
  toUrl(): string;
  details: ProxyDetails;
  rotateProxy?(): void;
}

export class ScrapeCahin {
  private proxy?: ProxyProvider;

  setProxy(proxy: ProxyProvider): this {
    this.proxy = proxy;
    return this;
  }

  setUserAgent(userAgent: UserAgent): this {

    return this;
  }

  async scrape(
    url: string,
    config: AxiosRequestConfig = {}
  ): Promise<AxiosResponse> {
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
    //await page.setUserAgent();
  }
}

// TODO
// for now start with a super abstracted library, and later on integrate cusomibility.
