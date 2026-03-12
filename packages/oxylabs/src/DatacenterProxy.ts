import { countryCodeMap, type Country } from "./utils/index";
import { Proxy } from '@scrapechain/proxy'
import type { ProxyDetails } from '@scrapechain/proxy'

interface DatacenterProxyOptions {
    username: string;
    password: string;
    country?: Country;
    port?: number;
    endpoint?: string;
    protocol?: "http" | "https" | "socks5";
  }

type RequiredFieldsForSterilization = "username" | "password" | "port" | "endpoint" | "protocol";
type NormalizedDatacenterProxyOptions = Required<Pick<DatacenterProxyOptions, RequiredFieldsForSterilization>> & Partial<Omit<DatacenterProxyOptions, RequiredFieldsForSterilization>>;

function normalizeOptions(options: DatacenterProxyOptions): NormalizedDatacenterProxyOptions {
  return {
    port: 8001,
    endpoint: 'dc.oxylabs.io',
    protocol: "http",
    ...options,
  }
}

export class OxylabsDatacenterProxy extends Proxy {
  public options: NormalizedDatacenterProxyOptions;

  constructor(initial_options: DatacenterProxyOptions) {
    super();
    this.options = normalizeOptions(initial_options);
  }

  private constructUsername(): string {
    let username = `user-${this.options.username}`;
    if (this.options.country) {
      username += `-country-${countryCodeMap[this.options.country]}`;
    }
    return username;
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