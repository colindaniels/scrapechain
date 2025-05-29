import { ProxyDetails, Proxy } from "./Proxy";

// non-vendor generic proxy
export class GenericProxy extends Proxy {
    private _details: ProxyDetails;
  
    constructor(initial: ProxyDetails | string) {
      super();
      if (typeof initial === 'string') {
        this._details = parseProxyUrl(initial);
      }
      else {
        this._details = initial;
      }
    }
    get details(): ProxyDetails {
      return this._details;
    }
  }
  
  
  function parseProxyUrl(urlStr: string): ProxyDetails {
    const url = new URL(urlStr)
    return {
      protocol: url.protocol.replace(':', ''),
      endpoint: url.hostname,
      port: parseInt(url.port),
      username: url.username,
      password: url.password,
    }
  }