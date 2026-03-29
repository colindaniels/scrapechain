import { countryCodeMap, type Country } from "./utils/index";
import { Proxy } from '@scrapechain/proxy'
import type { ProxyDetails } from '@scrapechain/proxy'

interface DatacenterProxyOptions {
    username: string;
    password: string;
    country?: Country;
    port?: number;
    portRange?: [number, number];
    endpoint?: string;
    protocol?: "http" | "https" | "socks5";
  }

type RequiredFieldsForSterilization = "username" | "password" | "port" | "endpoint" | "protocol";
type NormalizedDatacenterProxyOptions = Required<Pick<DatacenterProxyOptions, RequiredFieldsForSterilization>> & Partial<Omit<DatacenterProxyOptions, RequiredFieldsForSterilization>>;

function normalizeOptions(options: DatacenterProxyOptions): NormalizedDatacenterProxyOptions {
  return {
    port: options.portRange ? options.portRange[0] : 8001,
    endpoint: 'dc.oxylabs.io',
    protocol: "http",
    ...options,
  }
}

export class OxylabsDatacenterProxy extends Proxy {
  public options: NormalizedDatacenterProxyOptions;
  private portStart: number;
  private portEnd: number;

  constructor(initial_options: DatacenterProxyOptions) {
    super();
    this.options = normalizeOptions(initial_options);
    this.portStart = initial_options.portRange?.[0] ?? this.options.port;
    this.portEnd = initial_options.portRange?.[1] ?? this.options.port;
  }

  private constructUsername(): string {
    let username = `user-${this.options.username}`;
    if (this.options.country) {
      username += `-country-${countryCodeMap[this.options.country]}`;
    }
    return username;
  }

  /** Get all ports in the range */
  get ports(): number[] {
    const result = [];
    for (let p = this.portStart; p <= this.portEnd; p++) result.push(p);
    return result;
  }

  /** Return a proxy instance for each port in the range */
  all(): OxylabsDatacenterProxy[] {
    return this.ports.map(p => this.atPort(p));
  }

  /** Return a new proxy instance locked to a specific port */
  atPort(port: number): OxylabsDatacenterProxy {
    const clone = new OxylabsDatacenterProxy({
      username: this.options.username,
      password: this.options.password,
      country: this.options.country,
      port,
      endpoint: this.options.endpoint,
      protocol: this.options.protocol,
    });
    return clone;
  }

  /** Rotate to the next port in the range */
  rotate(): this {
    if (this.options.port >= this.portEnd) {
      this.options.port = this.portStart;
    } else {
      this.options.port++;
    }
    return this;
  }

  get details(): ProxyDetails {
    return {
      protocol: this.options.protocol,
      endpoint: this.options.endpoint,
      port: this.options.port,
      username: this.constructUsername(),
      password: this.options.password,
    };
  }
}