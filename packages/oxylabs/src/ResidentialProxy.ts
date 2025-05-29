import { countryCodeMap, type Country } from "./utils/index";

import type { ProxyConnectionDetails } from '@scrapechain/types'

interface ProxyOptions {
  username: string;
  password: string;
  country?: Country;
  sticky?: boolean;
  stickySessionDurationMinutes?: number;
  stickySessionId?: number;
  port?: number;
  endpoint?: string;
  protocol?: "http" | "https" | "socks5";
}

// required fields after sterilization
type RequiredFieldsForSterilization = "username" | "password" | "port" | "endpoint" | "protocol";
type NormalizedProxyOptions = Required<Pick<ProxyOptions, RequiredFieldsForSterilization>> & Partial<Omit<ProxyOptions, RequiredFieldsForSterilization>>;


function generateSessionId(): number {
  const min = 1_000_000_000;
  const max = 9_999_999_999;
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// SET DEFAULTS
function normalizeOptions(options: ProxyOptions): NormalizedProxyOptions {
  let stickySessionId, stickySessionDurationMinutes;
  if (options.sticky) {
    // sticky has to have a sessionId to continue
    if (!options.stickySessionId) {
      stickySessionId = generateSessionId();
    }
    // sticky also has to have a duration (min). default 10 min
    if (!options.stickySessionDurationMinutes) {
      stickySessionDurationMinutes = 10;
    }
  }

  return {
    port: 7777,
    endpoint: 'pr.proxylabs.io',
    protocol: "http",
    stickySessionId,
    stickySessionDurationMinutes,
    ...options,
  }
}


export class OxylabsResidentialProxy {
  // Declares that the this.options exists with a type but is not initialized yet.

  public options: NormalizedProxyOptions;

  constructor(initial_options: ProxyOptions) {
    // set defaults for the non-required and non-null
    this.options = normalizeOptions(initial_options);

  }

  private constructUsername(): string {
    let username = "";
    username += `customer-${this.options.username}`;

    if (this.options.country) {
      username += `-cc-${countryCodeMap[this.options.country]}`;
    }

    if (this.options.sticky) {
      username += `-sessid-${this.options.stickySessionId}`;
      username += `-sesstime-${this.options.stickySessionDurationMinutes}`;
    }
    return username;
  }


  public toUrl(): string {
    const { protocol, password, endpoint, port } = this.options;
    const username = this.constructUsername();

    return `${protocol}://${username}:${password}@${endpoint}:${port}`;
  }

  rotate(): this {
    if (this.options.sticky) {
      this.options.stickySessionId = generateSessionId();
    }
    return this;
  }

  get details(): ProxyConnectionDetails {
    return {
      protocol: this.options.protocol,
      endpoint: this.options.endpoint,
      port: this.options.port,
      username: this.constructUsername(),
      password: this.options.password,
    };
  }
}
