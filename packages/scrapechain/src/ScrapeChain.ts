import { GenericProxy } from '@scrapechain/proxy'
import type { Proxy } from "@scrapechain/proxy";
import { fetch, type BrowserProfile } from 'wreq-js';
import { Browser, type BrowserOptions } from './Browser';

export class ScrapeChain {
  private proxy?: Proxy;

  setProxy(proxy: Proxy | string): this {
    if (typeof proxy === 'string') {
      this.proxy = new GenericProxy(proxy)
    }
    else {
      this.proxy = proxy;
    }
    return this;
  }

  async scrapeHttp(url: string, config: { headers?: Record<string, string> } = {}): Promise<string> {
    try {
      const response = await fetch(url, {
        headers: config.headers,
        browser: 'chrome_123',
        os: 'macos',
        proxy: this.proxy?.toUrl(),
      });

      if (!response.ok) {
        throw new Error(`HTTP request failed: ${response.status} - ${response.statusText}`);
      }

      return await response.text();
    }
    catch (error) {
      if (error instanceof Error) {
        throw error;
      }
      throw new Error(`HTTP request failed: ${error}`);
    }
  }

  async createBrowser(options: BrowserOptions = {}): Promise<Browser> {
    const seed = options.seed ?? Math.floor(Math.random() * 2147483647);
    const browser = new Browser({
      ...options,
      resolvedSeed: seed,
      proxy: options.proxy ?? this.proxy?.toUrl(),
    });
    await browser.launch();
    return browser;
  }
}
