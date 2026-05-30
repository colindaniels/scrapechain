
import { Proxy } from '@scrapechain/proxy';
import * as ChromeLauncher from 'chrome-launcher';
import type { LaunchedChrome } from 'chrome-launcher'
import { existsSync, mkdirSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import CDP from 'chrome-remote-interface';
import type Protocol from 'devtools-protocol';
import { anonymizeProxy, closeAnonymizedProxy } from './localProxy'
import { Page } from './Page';

type CDPClient = Awaited<ReturnType<typeof CDP>> & EventEmitter;

export interface BrowserOptions {
    chrome_path: string;
    user_data_dir: string;
    fingerprint?: number;
    fingerprint_platform?: 'windows' | 'linux' | 'macos';
    fingerprint_platform_version?: string;
    fingerprint_brand?: 'Chrome' | 'Edge' | 'Opera' | 'Vivaldi';
    fingerprint_brand_version?: string;
    fingerprint_hardware_concurrency?: number;
    disable_non_proxied_udp?: boolean;
    lang?: string;
    accept_lang?: string;
    timezone?: string;
    proxy?: Proxy;
    disable_spoofing?: string[];
    headless?: boolean;
    window_width?: number;
    window_height?: number;
    extra_flags?: string[];
}

export class Browser {
    private chrome: LaunchedChrome
    private browserOptions: BrowserOptions
    private localProxy?: string;
    private cdp: CDPClient;
    readonly page: Page;
    private extraPages = new Set<Page>();

    private constructor(chrome: LaunchedChrome, browserOptions: BrowserOptions, cdp: CDPClient, page: Page, localProxy?: string) {
        this.chrome = chrome;
        this.browserOptions = browserOptions;
        this.cdp = cdp;
        this.page = page;
        this.localProxy = localProxy;
    }

    async newPage(): Promise<Page> {
        const { targetId } = await this.cdp.send('Target.createTarget', { url: 'about:blank' });
        const cdp = await CDP({
            port: this.chrome.port,
            target: (targets: any[]) => {
                const t = targets.find(x => x.id === targetId);
                if (!t) throw new Error(`target ${targetId} not found`);
                return t;
            },
        }) as CDPClient;

        const page: Page = await Page.create(cdp, targetId, async () => {
            try {
                await this.cdp.send('Target.closeTarget', { targetId });
            } catch { /* target may already be gone */ }
            try {
                await cdp.close();
            } catch { /* ws may already be closed */ }
            this.extraPages.delete(page);
        });

        this.extraPages.add(page);
        return page;
    }

    pages(): Page[] {
        return [this.page, ...this.extraPages];
    }

    async setCookies(cookies: Protocol.Network.CookieParam[]): Promise<void> {
        await this.cdp.send('Storage.setCookies', { cookies });
    }

    async getCookies(): Promise<Protocol.Network.Cookie[]> {
        const { cookies } = await this.cdp.send('Storage.getCookies');
        return cookies;
    }

    async clearCookies(): Promise<void> {
        await this.cdp.send('Storage.clearCookies');
    }

    // only entry to the class instance should be launch()
    static async launch(browserOptions: BrowserOptions): Promise<Browser> {
        if (!existsSync(browserOptions.chrome_path)) throw new Error(`chrome_path not found: ${browserOptions.chrome_path}`);
        if (!browserOptions.user_data_dir) throw new Error('user_data_dir required');

        const chromeFlags: string[] = [];

        let localProxy: string = '';
        if (browserOptions.proxy) {
            localProxy = await anonymizeProxy(browserOptions.proxy.toUrl());
            chromeFlags.push(`--proxy-server=${localProxy}`);
        }

        const randInt = (min: number, max: number) => Math.floor(min + Math.random() * (max - min + 1));

        browserOptions.fingerprint ??= Math.floor(10000000 + Math.random() * 90000000);
        browserOptions.fingerprint_brand ??= 'Chrome';
        browserOptions.window_width ??= randInt(800, 1400);
        browserOptions.window_height ??= randInt(500, 830);

        chromeFlags.push(`--fingerprint=${browserOptions.fingerprint}`);
        chromeFlags.push(`--fingerprint-brand=${browserOptions.fingerprint_brand}`);
        chromeFlags.push(`--window-size=${browserOptions.window_width},${browserOptions.window_height}`);

        if (browserOptions.fingerprint_platform) {
            chromeFlags.push(`--fingerprint-platform=${browserOptions.fingerprint_platform}`);
        }
        if (browserOptions.fingerprint_platform_version) {
            chromeFlags.push(`--fingerprint-platform-version=${browserOptions.fingerprint_platform_version}`);
        }
        if (browserOptions.fingerprint_brand_version) {
            chromeFlags.push(`--fingerprint-brand-version=${browserOptions.fingerprint_brand_version}`);
        }
        if (browserOptions.fingerprint_hardware_concurrency !== undefined) {
            chromeFlags.push(`--fingerprint-hardware-concurrency=${browserOptions.fingerprint_hardware_concurrency}`);
        }
        if (browserOptions.disable_non_proxied_udp) {
            chromeFlags.push('--disable-non-proxied-udp');
        }
        if (browserOptions.lang) {
            chromeFlags.push(`--lang=${browserOptions.lang}`);
        }
        if (browserOptions.accept_lang) {
            chromeFlags.push(`--accept-lang=${browserOptions.accept_lang}`);
        }
        if (browserOptions.timezone) {
            chromeFlags.push(`--timezone=${browserOptions.timezone}`);
        }
        if (browserOptions.disable_spoofing && browserOptions.disable_spoofing.length > 0) {
            chromeFlags.push(`--disable-spoofing=${browserOptions.disable_spoofing.join(',')}`);
        }

        if (browserOptions.headless) {
            chromeFlags.push('--headless=new');
        }

        chromeFlags.push('--disable-web-security')

        if (browserOptions.extra_flags && browserOptions.extra_flags.length > 0) {
            chromeFlags.push(...browserOptions.extra_flags);
        }

        mkdirSync(browserOptions.user_data_dir, { recursive: true });

        const chrome = await ChromeLauncher.launch({
            chromePath: browserOptions.chrome_path,
            userDataDir: browserOptions.user_data_dir,
            chromeFlags
        });

        const cdp = await CDP({ port: chrome.port }) as CDPClient;
        const page = await Page.create(cdp);

        return new Browser(chrome, browserOptions, cdp, page, localProxy);
    }

    async close() {
        for (const page of [...this.extraPages]) {
            try { await page.close(); } catch { /* ignore */ }
        }
        await this.cdp.close();
        this.chrome.kill();
        if (this.localProxy) await closeAnonymizedProxy(this.localProxy, true);
        await rm(this.browserOptions.user_data_dir, { recursive: true, force: true });
    }

    getFingerprint() {
        return this.browserOptions;
    }

    getWindowSize(): { width: number; height: number } {
        return {
            width: this.browserOptions.window_width!,
            height: this.browserOptions.window_height!,
        };
    }

    async getImpersonatedIdentity(): Promise<{
        userAgent: string;
        platform: string;
        hardwareConcurrency: number;
        deviceMemory: number | undefined;
        languages: readonly string[];
        webglVendor: string | null;
        webglRenderer: string | null;
    }> {
        const expression = `JSON.stringify((() => {
            const gl = document.createElement('canvas').getContext('webgl');
            const ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
            return {
                userAgent: navigator.userAgent,
                platform: navigator.platform,
                hardwareConcurrency: navigator.hardwareConcurrency,
                deviceMemory: navigator.deviceMemory,
                languages: navigator.languages,
                webglVendor: ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : null,
                webglRenderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : null,
            };
        })())`;
        const { result } = await this.cdp.send('Runtime.evaluate', {
            expression,
            returnByValue: true,
        });
        return JSON.parse(result.value);
    }
}
