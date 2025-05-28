import axios from "axios";
import type { AxiosRequestConfig, AxiosResponse } from "axios";
import { HttpsProxyAgent } from "https-proxy-agent";

interface ProxyProvider {
  toUrl(): string;
  rotateProxy?(): void;
}

export class ScrapeCahin {
  private proxy?: ProxyProvider;

  useProxy(proxy: ProxyProvider): this {
    this.proxy = proxy;
    return this;
  }

  async scrape(url: string, config: AxiosRequestConfig = {}): Promise<string> {
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
    const data = response.data;
    return data;
  }
}
