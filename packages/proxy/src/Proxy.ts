import axios from 'axios';
import { HttpsProxyAgent } from 'https-proxy-agent'

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


interface ProxyIPResults {
  success: boolean
  ip?: string
  latencyMs?: number
  error?: string
}

async function pingIP(d: ProxyDetails, timeout?: number): Promise<ProxyIPResults> {
  const url = toUrl(d);
  const agent = new HttpsProxyAgent(url)

  const start = Date.now()

  try {
    const response = await axios.get('https://api.ipify.org/?format=json', {
      httpAgent: agent,
      httpsAgent: agent,
      timeout: timeout
    })

    const latency = Date.now() - start
    const ip = response.data?.ip

    return {
      success: true,
      ip,
      latencyMs: latency,
    }
  } catch (error: any) {
    return {
      success: false,
      error: error.message || 'Unknown error',
    }
  }
}


// ALL PROXYS SHOULD SHARE THESE
// SHOULD BE USED AS THE MAIN PROXY TYPE
export abstract class Proxy {

  abstract get details(): ProxyDetails

  toUrl(): string {
    return toUrl(this.details)
  }
  pingIp(): Promise<ProxyIPResults> {
    return pingIP(this.details)
  }
  
}