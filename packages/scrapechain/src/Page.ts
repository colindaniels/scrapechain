import { EventEmitter } from 'node:events';
import CDP from 'chrome-remote-interface';
import type Protocol from 'devtools-protocol';

type CDPClient = Awaited<ReturnType<typeof CDP>> & EventEmitter;

export class Page {
    private cdp: CDPClient;
    readonly targetId?: string;
    private onClose?: () => Promise<void>;

    constructor(cdp: CDPClient, targetId?: string, onClose?: () => Promise<void>) {
        this.cdp = cdp;
        this.targetId = targetId;
        this.onClose = onClose;
    }

    static async create(cdp: CDPClient, targetId?: string, onClose?: () => Promise<void>): Promise<Page> {
        await cdp.send('Page.enable');
        await cdp.send('Network.enable');
        return new Page(cdp, targetId, onClose);
    }

    async close(): Promise<void> {
        if (this.onClose) {
            await this.onClose();
            this.onClose = undefined;
        }
    }

    async goto(url: string, options: { timeout?: number } = {}): Promise<string> {
        const { timeout = 30000 } = options;
        const capture = this.captureNextDocument(timeout);
        await this.cdp.send('Page.navigate', { url });
        return capture;
    }

    async waitForDocumentLoaded(timeout = 30000): Promise<string> {
        return this.captureNextDocument(timeout);
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

    private captureNextDocument(timeout: number): Promise<string> {
        return new Promise<string>((resolve, reject) => {
            let docRequestId: string | undefined;

            const cleanup = () => {
                clearTimeout(timeoutTimer);
                this.cdp.off('Network.requestWillBeSent', onRequest);
                this.cdp.off('Network.loadingFinished', onFinished);
                this.cdp.off('Network.loadingFailed', onFailed);
            };

            const onRequest = (p: Protocol.Network.RequestWillBeSentEvent) => {
                if (p.type !== 'Document') return;
                if (docRequestId) return;
                docRequestId = p.requestId;
            };

            const onFinished = async (p: Protocol.Network.LoadingFinishedEvent) => {
                if (p.requestId !== docRequestId) return;
                cleanup();
                try {
                    const { body, base64Encoded } = await this.cdp.send('Network.getResponseBody', { requestId: docRequestId });
                    resolve(base64Encoded ? Buffer.from(body, 'base64').toString('utf8') : body);
                } catch (err) {
                    reject(err as Error);
                }
            };

            const onFailed = (p: Protocol.Network.LoadingFailedEvent) => {
                if (p.requestId !== docRequestId) return; 
                cleanup();
                reject(new Error(`document request failed: ${p.errorText}`));
            };

            const timeoutTimer = setTimeout(() => {
                cleanup();
                reject(new Error(`waitForDocumentLoaded: timed out after ${timeout}ms`));
            }, timeout);

            this.cdp.on('Network.requestWillBeSent', onRequest);
            this.cdp.on('Network.loadingFinished', onFinished);
            this.cdp.on('Network.loadingFailed', onFailed);
        });
    }
}
