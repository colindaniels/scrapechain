import { spawn, execSync, type ChildProcess } from 'child_process';
import WebSocket from 'ws';
import { Server } from 'proxy-chain'

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
  private chrome: ChildProcess | null = null;
  private ws: WebSocket | null = null;
  private msgId = 0;
  private debuggingPort: number;
  readonly seed: number;
  private proxyServer?: Server; // Store proxy server instance

  constructor(private options: BrowserOptions & { resolvedSeed: number }) {
    this.debuggingPort = options.debuggingPort ?? 9222;
    this.seed = options.resolvedSeed;
  }

  async launch(): Promise<void> {
    // kill anything on the port
    try {
      await fetch(`http://localhost:${this.debuggingPort}/json`);
      const pids = execSync(`lsof -ti :${this.debuggingPort}`, { encoding: 'utf8' }).trim();
      for (const pid of pids.split('\n')) {
        if (pid) execSync(`kill ${pid}`);
      }
      await new Promise(r => setTimeout(r, 1000));
    } catch {}

    const seed = this.seed;
    const screen = this.options.screenSize ?? [1289, 807];

    const chromeArgs = [
      `--remote-debugging-port=${this.debuggingPort}`,
      '--remote-allow-origins=*',
      '--no-first-run',
      `--user-data-dir=${this.options.userDataDir ?? `/tmp/fp-${seed}`}`,
      `--window-size=${screen[0]},${screen[1]}`,
      `--fingerprint=${seed}`,
      `--fingerprint-platform=${this.options.platform ?? 'macos'}`,
      `--timezone=${this.options.timezone ?? 'America/New_York'}`,
      `--lang=${this.options.lang ?? 'en-US'}`,
      `--accept-lang=${this.options.lang ?? 'en-US'},en`,
    ];

    if (this.options.headless !== false) chromeArgs.push('--headless=new');
    if (this.options.hardwareConcurrency) chromeArgs.push(`--fingerprint-hardware-concurrency=${this.options.hardwareConcurrency}`);
    if (this.options.args) chromeArgs.push(...this.options.args);



    if (this.options.proxy) {
      const LOCAL_PROXY_PORT = 7070;

      console.log('🚀 Starting local proxy middleman server...');
      const proxyServer = new Server({
        port: LOCAL_PROXY_PORT,
        host: 'localhost',
        verbose: false,
        prepareRequestFunction: () => {
          return {
            requestAuthentication: false,
            upstreamProxyUrl: this.options.proxy,
          };
        },
      });

      await new Promise<void>((resolve, reject) => {
        proxyServer.on('error', reject);
        proxyServer.listen(() => {
          console.log(`✅ Local proxy server is listening on port ${proxyServer.port}`);
          resolve();
        });
      });

      // Store the proxy server instance
      this.proxyServer = proxyServer;

      const localProxyAddress = `http://localhost:${proxyServer.port}`;
      console.log(localProxyAddress)

      chromeArgs.push(`--proxy-server=${localProxyAddress}`);
    }



    this.chrome = spawn(
      this.options.chromiumPath ?? DEFAULT_CHROMIUM_PATH,
      chromeArgs,
      { stdio: ['pipe', 'pipe', 'pipe'] }
    );

    // poll until ready
    for (let i = 0; i < 30; i++) {
      try {
        await fetch(`http://localhost:${this.debuggingPort}/json`);
        break;
      } catch {
        if (i === 29) {
          this.chrome.kill();
          throw new Error('Chrome failed to start');
        }
        await new Promise(r => setTimeout(r, 100));
      }
    }

    // get websocket url
    const resp = await fetch(`http://localhost:${this.debuggingPort}/json`);
    const targets = await resp.json() as any[];
    const pageTarget = targets.find((t: any) => t.type === 'page');

    if (!pageTarget) throw new Error(`No page target found. Available: ${JSON.stringify(targets)}`);

    this.ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
    await new Promise<void>((resolve, reject) => {
      this.ws!.on('open', resolve);
      this.ws!.on('error', reject);
    });

    await this.sendCDPCommand('Page.enable');
    await this.sendCDPCommand('Network.enable');
  }

  sendCDPCommand(method: string, params: Record<string, any> = {}): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.ws) return reject(new Error('Not connected'));

      this.msgId++;
      const id = this.msgId;

      this.ws.send(JSON.stringify({ id, method, params }));

      const handler = (data: WebSocket.Data) => {
        const resp = JSON.parse(data.toString());
        if (resp.id === id) {
          this.ws!.off('message', handler);
          if (resp.error) reject(new Error(resp.error.message));
          else resolve(resp.result ?? {});
        }
      };

      this.ws.on('message', handler);
    });
  }

  async listenCDP(idleTimeout = 10): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        console.log(`No events for ${idleTimeout}s, stopping listener`);
        this.ws?.off('message', handler);
        resolve();
      }, idleTimeout * 1000);

      const handler = (data: WebSocket.Data) => {
        timer.refresh();
        const resp = JSON.parse(data.toString());
        console.log(JSON.stringify(resp, null, 2));
      };

      this.ws!.on('message', handler);
    });
  }

  async goto(url: string): Promise<void> {
    await this.sendCDPCommand('Page.navigate', { url });
  }

  smartNetworkIdle(idleTime = 3, timeout = 30, debug = false): Promise<boolean> {
    const pending = new Map<string, string>();
    let mainFrameId: string | null = null;
    const start = Date.now();

    return new Promise((resolve) => {
      let idleTimer: ReturnType<typeof setTimeout> | null = null;

      const resetIdle = () => {
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(() => {
          if (pending.size === 0) {
            cleanup();
            resolve(true);
          } else if (debug) {
            console.log('Still waiting on:');
            for (const [, url] of pending) console.log(`  STUCK: ${url.slice(0, 80)}`);
          }
        }, idleTime * 1000);
      };

      const timeoutTimer = setTimeout(() => {
        cleanup();
        resolve(false);
      }, timeout * 1000);

      const handler = (data: WebSocket.Data) => {
        const resp = JSON.parse(data.toString());
        const method = resp.method ?? '';

        if (method === 'Page.frameNavigated') {
          const frame = resp.params?.frame ?? {};
          if (!frame.parentId) mainFrameId = frame.id;
        }

        if (method === 'Network.requestWillBeSent') {
          const { requestId, frameId, request, type } = resp.params;
          const url = request?.url ?? '';

          if (frameId !== mainFrameId) {
            if (debug) console.log(`IGNORED (iframe): ${type} - ${url.slice(0, 60)}`);
            resetIdle();
            return;
          }

          if (url.startsWith('blob:') || url.includes('/web-pixels@')) {
            if (debug) console.log(`IGNORED (long-lived): ${type} - ${url.slice(0, 60)}`);
            resetIdle();
            return;
          }

          pending.set(requestId, url);
          if (debug) console.log(`PENDING: ${type} - ${url.slice(0, 80)}`);
        }

        if (method === 'Network.loadingFinished' || method === 'Network.loadingFailed') {
          const requestId = resp.params.requestId;
          const url = pending.get(requestId);
          pending.delete(requestId);
          if (url && debug) console.log(`FINISHED: ${url.slice(0, 80)}`);
        }

        resetIdle();
      };

      const cleanup = () => {
        clearTimeout(timeoutTimer);
        if (idleTimer) clearTimeout(idleTimer);
        this.ws?.off('message', handler);
      };

      this.ws!.on('message', handler);
      resetIdle();
    });
  }


  async evaluate(expression: string): Promise<any> {
    const result = await this.sendCDPCommand('Runtime.evaluate', {
      expression,
      returnByValue: true,
    });

    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception.description);
    }

    return result.result?.value;
  }

  async getHTML(): Promise<string> {
    return this.evaluate('document.querySelector("html").outerHTML');
  }



  close(): void {
    if (this.ws) { this.ws.close(); this.ws = null; }
    if (this.chrome) { this.chrome.kill(); this.chrome = null; }
  }
}
