
# @scrapechain/oxylabs

A lightweight, unofficial SDK for using Oxylabs proxies.
Includes helper methods for rotating sessions, generating endpoints, and more  — all provided through a consistent interface shared across proxy providers.

<br/>

## 🚀 Features
- Smart session management (sticky/non-sticky)
- Dynamic session ID generation
- Auto-normalized proxy options
- Consistent API shared across all scrapechain compatible proxy SDKs

<br/>

## 📦 Installation
```bash
  npm install @scrapechain/oxylabs
```

<br/>

## ⚡ Quickstart
#### `Init proxy`

```ts
import { OxylabsResidentialProxy } from '@scrapechain/oxylabs';

const proxy = new OxylabsResidentialProxy({
  username: 'yourOxylabsUsername',
  password: 'yourPassword',
  country: 'United States of America',
  sticky: true,
});
```

Construct your proxy with [Proxy Properties](#️-proxy-properties).

<br/>

#### `.toUrl()`
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

<br/>

#### `.rotate()`
```ts
proxy.rotate();
```
Sets `sessionid` to a random number, which will point to a new IP address.

<br/>

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

<br/>

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



<br/>

## ⚙️ Proxy properties
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

<br/>

## License

This project is licensed under the [MIT](LICENSE). See the [LICENSE](LICENSE) file for details.