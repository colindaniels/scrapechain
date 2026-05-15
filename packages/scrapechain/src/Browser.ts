
import { Proxy } from '@scrapechain/proxy';
import * as ChromeLauncher from 'chrome-launcher';
import type { LaunchedChrome } from 'chrome-launcher'
import { existsSync, mkdirSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import CDP from 'chrome-remote-interface';
import type Protocol from 'devtools-protocol';
import { anonymizeProxy, closeAnonymizedProxy } from './localProxy'

type CDPClient = Awaited<ReturnType<typeof CDP>> & EventEmitter;

interface BrowserOptions {
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
    proxy_server?: Proxy;
    disable_spoofing?: string[];
}

export class Browser {
    private chrome: LaunchedChrome
    private browserOptions: BrowserOptions
    private localProxy?: string;
    private cdp: CDPClient;

    private constructor(chrome: LaunchedChrome, browserOptions: BrowserOptions, cdp: CDPClient, localProxy?: string) {
        this.chrome = chrome;
        this.browserOptions = browserOptions;
        this.cdp = cdp;
        this.localProxy = localProxy;
    }

    async goto(url: string) {
        return this.cdp.send('Page.navigate', { url });
    }

    async waitForNetworkIdle(idleTime = 3000, timeout = 30000): Promise<boolean> {
        const pending = new Set<string>();

        return new Promise<boolean>((resolve) => {
            let idleTimer: NodeJS.Timeout | undefined;

            const finish = (idle: boolean) => {
                clearTimeout(idleTimer);
                clearTimeout(timeoutTimer);
                this.cdp.off('Network.requestWillBeSent', onRequest);
                this.cdp.off('Network.loadingFinished', onEnd);
                this.cdp.off('Network.loadingFailed', onEnd);
                resolve(idle);
            };

            const armIdle = () => {
                clearTimeout(idleTimer);
                if (pending.size === 0) {
                    idleTimer = setTimeout(() => finish(true), idleTime);
                }
            };

            const onRequest = (p: Protocol.Network.RequestWillBeSentEvent) => {
                pending.add(p.requestId);
                clearTimeout(idleTimer);
            };

            const onEnd = (p: { requestId: string }) => {
                if (pending.delete(p.requestId)) armIdle();
            };

            const timeoutTimer = setTimeout(() => finish(false), timeout);

            this.cdp.on('Network.requestWillBeSent', onRequest);
            this.cdp.on('Network.loadingFinished', onEnd);
            this.cdp.on('Network.loadingFailed', onEnd);

            armIdle();
        });
    }

    // only entry to the class instance should be launch()
    static async launch(browserOptions: BrowserOptions): Promise<Browser> {
        if (!existsSync(browserOptions.chrome_path)) throw new Error(`chrome_path not found: ${browserOptions.chrome_path}`);
        if (!browserOptions.user_data_dir) throw new Error('user_data_dir required');

        const chromeFlags: string[] = [];

        let localProxy: string = '';
        if (browserOptions.proxy_server) {
            localProxy = await anonymizeProxy(browserOptions.proxy_server.toUrl());
            chromeFlags.push(`--proxy-server=${localProxy}`);
        }

        const fingerprint = Math.floor(10000000 + Math.random() * 90000000);
        chromeFlags.push(`--fingerprint=${fingerprint}`);

        chromeFlags.push('--fingerprint-brand=Chrome');

        const randInt = (min: number, max: number) => Math.floor(min + Math.random() * (max - min + 1));

        const windowWidth  = randInt(800, 1400);
        const windowHeight = randInt(500, 830);

        chromeFlags.push(`--window-size=${windowWidth},${windowHeight}`)

        mkdirSync(browserOptions.user_data_dir, { recursive: true });

        const chrome = await ChromeLauncher.launch({
            chromePath: browserOptions.chrome_path,
            userDataDir: browserOptions.user_data_dir,
            chromeFlags
        });

        const cdp = await CDP({ port: chrome.port }) as CDPClient;
        await cdp.send('Page.enable');
        await cdp.send('Network.enable');

        return new Browser(chrome, browserOptions, cdp, localProxy);
    }

    async close() {
        await this.cdp.close();
        this.chrome.kill();
        if (this.localProxy) await closeAnonymizedProxy(this.localProxy, true);
        await rm(this.browserOptions.user_data_dir, { recursive: true, force: true });
    }

}