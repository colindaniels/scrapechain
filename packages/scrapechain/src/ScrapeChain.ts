import { GenericProxy } from '@scrapechain/proxy'
import type { Proxy } from "@scrapechain/proxy";
import { fetch, Headers, type BrowserProfile, type EmulationOS } from 'wreq-js';
import { Browser, type BrowserOptions } from './Browser';
import { resolve, join } from 'path';
import { tmpdir } from 'os';

export class ScrapeChain {
  private proxy?: Proxy;
  private browserDefaults: Partial<BrowserOptions> = {};
  private seed: number = Math.floor(Math.random() * 2147483647);

  setProxy(proxy: Proxy | string): this {
    if (typeof proxy === 'string') {
      this.proxy = new GenericProxy(proxy)
    }
    else {
      this.proxy = proxy;
    }
    return this;
  }

  setBrowserOptions(options: Partial<BrowserOptions>): this {
    this.browserDefaults = { ...this.browserDefaults, ...options };
    if (options.seed !== undefined) this.seed = options.seed;
    return this;
  }

  rotateBrowserFingerprint(): this {
    this.seed = Math.floor(Math.random() * 2147483647);
    return this;
  }

  private resolveBrowserOptions(overrides: Partial<BrowserOptions> = {}): BrowserOptions {
    const merged = { ...this.browserDefaults, ...overrides };
    if (!merged.chromiumPath) throw new Error('chromiumPath is required — set it via setBrowserOptions() or pass it directly');
    if (!merged.userDataDir) throw new Error('userDataDir is required — set it via setBrowserOptions() or pass it directly');
    merged.chromiumPath = resolve(merged.chromiumPath);
    merged.userDataDir = resolve(merged.userDataDir);
    return merged as BrowserOptions;
  }

  async scrapeHttp(url: string, config: { headers?: Record<string, string>; browser?: BrowserProfile; os?: EmulationOS } = {}): Promise<{ html: string; headers: Headers }> {
    try {
      const response = await fetch(url, {
        headers: config.headers,
        browser: config.browser ?? 'chrome_142',
        os: config.os ?? 'macos',
        proxy: this.proxy?.toUrl(),
      });

      if (!response.ok) {
        throw new Error(`HTTP request failed: ${response.status} - ${response.statusText}`);
      }

      const html = await response.text();
      return { html, headers: response.headers };
    }
    catch (error) {
      if (error instanceof Error) {
        throw error;
      }
      throw new Error(`HTTP request failed: ${error}`);
    }
  }

  async createBrowser(overrides?: Partial<BrowserOptions>): Promise<Browser> {
    const options = this.resolveBrowserOptions(overrides);
    const seed = options.seed ?? this.seed;
    const browser = new Browser({
      ...options,
      resolvedSeed: seed,
      proxy: options.proxy ?? this.proxy?.toUrl(),
    });
    await browser.launch();
    return browser;
  }

  async crawlForCookies(url: string, selector: string, overrides?: Partial<BrowserOptions>): Promise<string> {
    const seed = overrides?.seed ?? this.seed;
    const tempProfile = join(tmpdir(), `scrapechain-${seed}-${Date.now()}`);
    const browser = await this.createBrowser({ ...overrides, userDataDir: overrides?.userDataDir ?? tempProfile });
    try {
      const page = await browser.newPage();
      await page.goto(url);
      await page.waitForSelector(selector);
      return await browser.getCookies();
    } finally {
      await browser.close();
      browser.cleanUserDataDir();
    }
  }

}
