import { launch, type LaunchedChrome } from 'chrome-launcher';
import puppeteer, { type Browser as PuppeteerBrowser, type Page } from 'puppeteer-core';

export interface BrowserOptions {
  seed?: number;
  headless?: boolean;
  chromiumPath?: string;
  debuggingPort?: number;
  screenSize?: [number, number];
  timezone?: string;
  lang?: string;
  platform?: 'windows' | 'linux' | 'macos';
  hardwareConcurrency?: number;
  userDataDir?: string;
  proxy?: string;
  args?: string[];
}

const DEFAULT_CHROMIUM_PATH = '/Applications/Chromium.app/Contents/MacOS/Chromium';

export class Browser {
  private chrome: LaunchedChrome | null = null;
  private _browser: PuppeteerBrowser | null = null;
  private proxyCredentials: { username: string; password: string } | null = null;
  readonly seed: number;
  port: number = 0;

  constructor(private options: BrowserOptions & { resolvedSeed: number }) {
    this.seed = options.resolvedSeed;
  }

  get browser(): PuppeteerBrowser {
    if (!this._browser) throw new Error('Browser not launched');
    return this._browser;
  }

  async newPage(): Promise<Page> {
    const page = await this.browser.newPage();
    if (this.proxyCredentials) {
      await page.authenticate(this.proxyCredentials);
    }
    return page;
  }

  async launch(): Promise<void> {
    const seed = this.seed;
    const screen = this.options.screenSize ?? [1289, 807];

    const chromeFlags = [
      `--window-size=${screen[0]},${screen[1]}`,
      `--fingerprint=${seed}`,
      `--fingerprint-platform=${this.options.platform ?? 'macos'}`,
      `--timezone=${this.options.timezone ?? 'America/New_York'}`,
      `--lang=${this.options.lang ?? 'en-US'}`,
      `--accept-lang=${this.options.lang ?? 'en-US'},en`,
    ];

    if (this.options.headless !== false) chromeFlags.push('--headless=new');
    if (this.options.hardwareConcurrency) chromeFlags.push(`--fingerprint-hardware-concurrency=${this.options.hardwareConcurrency}`);
    if (this.options.args) chromeFlags.push(...this.options.args);

    if (this.options.proxy) {
      const proxyUrl = new URL(this.options.proxy);
      if (proxyUrl.username) {
        this.proxyCredentials = {
          username: decodeURIComponent(proxyUrl.username),
          password: decodeURIComponent(proxyUrl.password),
        };
      }
      chromeFlags.push(`--proxy-server=${proxyUrl.protocol}//${proxyUrl.host}`);
    }

    this.chrome = await launch({
      chromePath: this.options.chromiumPath ?? DEFAULT_CHROMIUM_PATH,
      chromeFlags,
      userDataDir: this.options.userDataDir ?? `/tmp/fp-${seed}`,
      port: this.options.debuggingPort ?? 0,
      ignoreDefaultFlags: true,
    });

    this.port = this.chrome.port;

    this._browser = await puppeteer.connect({
      browserURL: `http://127.0.0.1:${this.port}`,
    });

    // Authenticate any existing pages
    if (this.proxyCredentials) {
      for (const page of await this._browser.pages()) {
        await page.authenticate(this.proxyCredentials);
      }
    }
  }

  close(): void {
    if (this._browser) { this._browser.disconnect(); this._browser = null; }
    if (this.chrome) { this.chrome.kill(); this.chrome = null; }
  }
}
