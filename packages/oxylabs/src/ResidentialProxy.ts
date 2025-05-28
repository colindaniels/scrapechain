import { countryCodeMap, type Country } from "./utils/index";

interface OxylabsResidentialProxyOptions {
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

export class OxylabsResidentialProxy {
  // Declares that the this.options exists with a type but is not initialized yet.

  private generateSessionId(): number {
    const min = 1_000_000_000;
    const max = 9_999_999_999;
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  public options: OxylabsResidentialProxyOptions;
  constructor(initial_options: OxylabsResidentialProxyOptions) {
    // set defaults
    this.options = {
      protocol: "http",
      port: 7777,
      endpoint: "pr.oxylabs.io",
      sticky: false,
      ...initial_options,
    };
    if (this.options.sticky) {
      // sticky has to have a sessionId to continue
      if (!this.options.stickySessionId) {
        this.options.stickySessionId = this.generateSessionId();
      }
      // sticky also has to have a duration (min). default 10 min
      if (!this.options.stickySessionDurationMinutes) {
        this.options.stickySessionDurationMinutes = 10;
      }
    }
  }
  toUrl(): string {
    let url = `${this.options.protocol}://`;

    // CONSTRUCT PROXY USERNAME START
    url += `customer-${this.options.username}`;

    if (this.options.country) {
      url += `-cc-${countryCodeMap[this.options.country]}`;
    }

    if (this.options.sticky) {
      url += `-sessid-${this.options.stickySessionId}`;
      url += `-sesstime-${this.options.stickySessionDurationMinutes}`;
    }
    // CONSTRUCT PROXY USERNAME END

    url += `:${this.options.password}@${this.options.endpoint}:${this.options.port}`;

    return url;
  }

  rotateProxy() {
    if (this.options.sticky) {
      this.options.stickySessionId = this.generateSessionId();
    }
    return this;
  }
}