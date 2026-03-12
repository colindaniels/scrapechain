
# @scrapechain/oxylabs

A lightweight, unofficial SDK for using Oxylabs proxies.
Includes helper methods for rotating sessions, generating endpoints, and more  — all provided through a consistent interface shared across proxy providers.

&nbsp;

## 🚀 Features
- Supports both **Residential** and **Datacenter** proxies
- Converts proxy options into a ready-to-use URL
- Built-in defaults for protocol, endpoint, port, and session behavior
- Easy session rotation to change IP addresses (residential)
- Normalized configuration interface across all ScrapeChain proxy SDKs

&nbsp;

## 📦 Installation
```bash
  npm install @scrapechain/oxylabs
```

&nbsp;

## Proxy Types

### 🏠 Residential Proxy

#### Setup

```ts
import { OxylabsResidentialProxy } from '@scrapechain/oxylabs';

const proxy = new OxylabsResidentialProxy({
  username: 'yourOxylabsUsername',
  password: 'yourPassword',
  country: 'United States of America',
  sticky: true,
});
```

&nbsp;

```ts
const proxyUrl = proxy.toUrl();

console.log(proxyUrl);
```
```text
http://customer-yourOxylabsUsername-cc-US-sessid-3469265147-sesstime-10:yourPassword@pr.oxylabs.io:7777
```
Returns a full proxy URL string.

Since the `sticky` property is truthy, it embeds a random sessionid in the username.

The session length defaults to 10 min, but can be changed with `stickySessionDurationMinutes` (max 30 min). The sessionid will stay the same until `.rotate()` is invoked or manually overridden with the property `stickySessionId`.

&nbsp;

#### `.rotate()`
```ts
proxy.rotate();
```
Sets `sessionid` to a random number, which will point to a new IP address.

&nbsp;

#### `.pingIP()`
```ts
const ipDetails = await proxy.pingIp();

console.log(ipDetails)
```
```ts
{
  success: true,
  ip: "76.91.176.189",
  latencyMs: 714,
}
```
Verifies the proxy is working and returns the IP and latency.

This will make a quick request to https://api.ipify.org/?format=json

&nbsp;

#### `.details`
```ts
console.log(proxy.details)

```
```ts
{
  protocol: "http",
  endpoint: "pr.oxylabs.io",
  port: 7777,
  username: "customer-yourOxylabsUsername-cc-US-sessid-5245948176-sesstime-10",
  password: "yourPassword",
}
```
Returns a structured object with proxy connection details.

This is part of a common interface shared across all providers.

&nbsp;

#### Properties
| Property | Type | Required | Default | Description                                                                 |
|--------------------------------|-----------------------------------|----------|------------------|-----------------------------------------------------------------------------|
| `username`                    | `string`                          | ✅       | —                | Your Oxylabs customer username.                                             |
| `password`                    | `string`                          | ✅       | —                | Your Oxylabs password.                                                      |
| `country`                     | `Country` (string enum)           | ❌       | —                | Country to geo-target the proxy IP.                                         |
| `sticky`                      | `boolean`                         | ❌       | `false`          | Enables sticky sessions (same IP across requests).                          |
| `stickySessionId`             | `number`                          | ❌       | Auto-generated   | Custom session ID for sticky mode (optional override).                      |
| `stickySessionDurationMinutes`| `number`                          | ❌       | `10`             | Duration of sticky session in minutes.                                      |
| `port`                        | `number`                          | ❌       | `7777`           | Proxy port.                                                                 |
| `endpoint`                    | `string`                          | ❌       | `pr.oxylabs.io`  | Proxy hostname.                                                              |
| `protocol`                    | `"http"`, `"https"`, `"socks5"`   | ❌       | `"http"`         | Proxy protocol to use.                                                      |

&nbsp;

---

### 🏢 Datacenter Proxy

#### Setup

```ts
import { OxylabsDatacenterProxy } from '@scrapechain/oxylabs';

const proxy = new OxylabsDatacenterProxy({
  username: 'yourOxylabsUsername',
  password: 'yourPassword',
  country: 'United States of America',
});
```

&nbsp;

#### `.toUrl()`
```ts
const proxyUrl = proxy.toUrl();

console.log(proxyUrl);
```
```text
http://user-yourOxylabsUsername-country-US:yourPassword@dc.oxylabs.io:8001
```
Returns a full proxy URL string.

&nbsp;

#### `.pingIP()`
```ts
const ipDetails = await proxy.pingIp();

console.log(ipDetails)
```
```ts
{
  success: true,
  ip: "192.168.1.1",
  latencyMs: 320,
}
```
Verifies the proxy is working and returns the IP and latency.

This will make a quick request to https://api.ipify.org/?format=json

&nbsp;

#### `.details`
```ts
console.log(proxy.details)

```
```ts
{
  protocol: "http",
  endpoint: "dc.oxylabs.io",
  port: 8001,
  username: "user-yourOxylabsUsername-country-US",
  password: "yourPassword",
}
```
Returns a structured object with proxy connection details.

This is part of a common interface shared across all providers.

&nbsp;

#### Properties
| Property | Type | Required | Default | Description                                                                 |
|------------|-----------------------------------|----------|---------------------|-----------------------------------------------------------------------------|
| `username` | `string`                          | ✅       | —                   | Your Oxylabs username.                                                      |
| `password` | `string`                          | ✅       | —                   | Your Oxylabs password.                                                      |
| `country`  | `Country` (string enum)           | ❌       | —                   | Country to geo-target the proxy IP.                                         |
| `port`     | `number`                          | ❌       | `8001`              | Proxy port.                                                                 |
| `endpoint` | `string`                          | ❌       | `dc.oxylabs.io`     | Proxy hostname.                                                             |
| `protocol` | `"http"`, `"https"`, `"socks5"`   | ❌       | `"http"`            | Proxy protocol to use.                                                      |

&nbsp;

## License

This project is licensed under the [MIT](LICENSE). See the [LICENSE](LICENSE) file for details.
