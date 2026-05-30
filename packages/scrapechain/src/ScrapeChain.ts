import { GenericProxy } from '@scrapechain/proxy'
import type { Proxy } from "@scrapechain/proxy";
import { Browser } from './Browser';
//import { fetch, Headers, type BrowserProfile, type EmulationOS } from 'wreq-js';


export class ScrapeChain {
  private proxy?: Proxy;
  public browser?: Browser;


  setProxy(proxy: Proxy | string): this {
    if (typeof proxy === 'string') {
      this.proxy = new GenericProxy(proxy)
    }
    else {
      this.proxy = proxy;
    }
    return this;
  }




  async scrapeHttp() {

  }


}
