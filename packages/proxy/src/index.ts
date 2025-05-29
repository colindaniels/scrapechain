// shared types
export interface ProxyPrimitiveDetails {
  protocol: string
  endpoint: string
  port: number
  username: string
  password: string
}


function toUrl(d: ProxyPrimitiveDetails): string {
  return `${d.protocol}://${d.username}:${d.password}@${d.endpoint}:${d.port}`
}


// base class that vendors can extend or be used as a type
export abstract class Proxy {

  abstract get details(): ProxyPrimitiveDetails


  toUrl(): string {
    return toUrl(this.details)
  }
}

export class BaseProxy extends Proxy {
  private _details: ProxyPrimitiveDetails;

  constructor(initial: ProxyPrimitiveDetails | string) {
    super();
    if (typeof initial === 'string') {
      this._details = parseProxyUrl(initial);
    }
    else {
      this._details = initial;
    }
  }
  get details(): ProxyPrimitiveDetails {
    return this._details;
  }
}


function parseProxyUrl(urlStr: string): ProxyPrimitiveDetails {
  const url = new URL(urlStr)
  return {
    protocol: url.protocol.replace(':', ''),
    endpoint: url.hostname,
    port: parseInt(url.port),
    username: url.username,
    password: url.password,
  }
}