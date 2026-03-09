import axios from "axios";
import type { AxiosRequestConfig, AxiosResponse, AxiosError } from "axios";
import { HttpsProxyAgent } from "https-proxy-agent";
import { GenericProxy } from '@scrapechain/proxy'
import type { Proxy } from "@scrapechain/proxy";
import UserAgent from 'user-agents'


export class ScrapeChain {
  private proxy?: Proxy;
  private userAgent?: string;



  setProxy(proxy: Proxy | string): this {
    if (typeof proxy === 'string') {
      // pass into generic as string so it can convert to normal Proxy
      this.proxy = new GenericProxy(proxy)
    }
    else {
      // can still be GenericProxy, but user has sent it in as the GenericProxy object or a vendor object
      this.proxy = proxy;
    }
    return this;

  }
  setUserAgent(userAgent: string | UserAgent): this {

    if (typeof userAgent === 'string') {
      this.userAgent = userAgent;
    }
    else {
      this.userAgent = userAgent.toString();
    }
    return this;
  }



  async scrapeHttp(url: string, config: AxiosRequestConfig = {}): Promise<string> {
    let agent = null;
    if (this.proxy) {
      const proxyUrl = this.proxy.toUrl();
      agent = new HttpsProxyAgent(proxyUrl);
    }

    // set header defaults
    config.headers = {}

    if (this.userAgent) {
      config.headers['User-Agent'] = this.userAgent;
    }

    try {
      const response: AxiosResponse = await axios({
        url: url,
        httpAgent: agent,
        httpsAgent: agent,
        ...config,
      });
      return response.data;

    }
    catch (error) {
      const axiosError = error as AxiosError;
      if (axios.isAxiosError(axiosError)) {
        const status = axiosError.response?.status;
        throw new Error(`HTTP request failed: ${status ?? 'no response'} - ${axiosError.message}`);
      }
      throw error;
    }
  }

}
