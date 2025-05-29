// shared types
export interface ProxyDetails {
  protocol: string
  endpoint: string
  port: number
  username: string
  password: string
}


function toUrl(d: ProxyDetails): string {
  return `${d.protocol}://${d.username}:${d.password}@${d.endpoint}:${d.port}`
}


// ALL PROXYS SHOULD SHARE THESE
// SHOULD BE USED AS THE MAIN PROXY TYPE
export abstract class Proxy {

  abstract get details(): ProxyDetails

  toUrl(): string {
    return toUrl(this.details)
  }
}

export { GenericProxy } from './GenericProxy'