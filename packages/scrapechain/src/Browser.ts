import { launch, type LaunchedChrome } from 'chrome-launcher';
import puppeteer, { type Browser as PuppeteerBrowser, type Page } from 'puppeteer-core';
import { mkdirSync, rmSync } from 'fs';
import { execSync } from 'child_process';


export interface BrowserOptions {
  chromiumPath: string;
  userDataDir: string;
  seed?: number;
  headless?: boolean;
  debuggingPort?: number;
  screenSize?: [number, number];
  timezone?: string;
  lang?: string;
  platform?: 'windows' | 'linux' | 'macos';
  hardwareConcurrency?: number;
  proxy?: string;
  args?: string[];
}

export class Browser {
  private chrome: LaunchedChrome | null = null;
  private _browser: PuppeteerBrowser | null = null;
  private proxyCredentials: { username: string; password: string } | null = null;
  private screen: [number, number] = [0, 0];
  readonly seed: number;
  port: number = 0;
  pid: number | null = null;

  /** Kill all running processes matching a chromiumPath */
  static killAll(chromiumPath: string): void {
    try {
      execSync(`pkill -f "${chromiumPath}"`, { stdio: 'ignore' });
    } catch {
      // no matching processes — that's fine
    }
  }

  constructor(private options: BrowserOptions & { resolvedSeed: number }) {
    this.seed = options.resolvedSeed;
  }

  get browser(): PuppeteerBrowser {
    if (!this._browser) throw new Error('Browser not launched');
    return this._browser;
  }

  async newPage(): Promise<Page> {
    const page = await this.browser.newPage();
    await page.setViewport({ width: this.screen[0], height: this.screen[1] });
    if (this.proxyCredentials) {
      await page.authenticate(this.proxyCredentials);
    }
    return page;
  }

  async getCookies(): Promise<string> {
    const cookies = await this.browser.cookies();
    return cookies.map(c => `${c.name}=${c.value}`).join('; ');
  }

  async launch(): Promise<void> {
    const seed = this.seed;
    const randomX = Math.floor(Math.random() * (1300 - 1000 + 1)) + 1000;
    const randomY = Math.floor(Math.random() * (900 - 700 + 1)) + 700;
    this.screen = this.options.screenSize ?? [randomX, randomY];

    const chromeFlags = [
      `--window-size=${this.screen[0]},${this.screen[1]}`,
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

    mkdirSync(this.options.userDataDir, { recursive: true });

    this.chrome = await launch({
      chromePath: this.options.chromiumPath,
      chromeFlags,
      userDataDir: this.options.userDataDir,
      port: this.options.debuggingPort ?? 0,
      ignoreDefaultFlags: true,
    });

    this.port = this.chrome.port;
    this.pid = this.chrome.pid;

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

  async close(): Promise<void> {
    if (this._browser) {
      try { await this._browser.close(); } catch { }
      this._browser = null;
    }
    if (this.chrome) {
      this.chrome.kill();
      this.chrome = null;
    }
    // ensure the process tree is dead
    if (this.pid) {
      try { process.kill(-this.pid, 'SIGKILL'); } catch { }
      this.pid = null;
    }
  }

  cleanUserDataDir(): void {
    rmSync(this.options.userDataDir, { recursive: true, force: true });
  }
}
