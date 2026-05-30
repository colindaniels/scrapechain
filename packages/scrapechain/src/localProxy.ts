// VIBE CODED

import http from 'node:http'
import net from 'node:net'
import type { AddressInfo } from 'node:net'

type Entry = { server: http.Server; sockets: Set<net.Socket> }
const registry = new Map<string, Entry>()

export async function anonymizeProxy(upstreamUrl: string): Promise<string> {
    const upstream = new URL(upstreamUrl)
    if (upstream.protocol !== 'http:') {
        throw new Error(`anonymizeProxy: only http:// upstream supported (got ${upstream.protocol})`)
    }
    const upstreamPort = Number(upstream.port) || 80
    const authHeader = buildAuthHeader(upstream)

    const sockets = new Set<net.Socket>()
    const track = (s: net.Socket) => {
        sockets.add(s)
        s.once('close', () => sockets.delete(s))
    }

    const server = http.createServer()
    server.on('connection', track)
    server.on('request', (req, res) =>
        handleHttp(req, res, upstream.hostname, upstreamPort, authHeader),
    )
    server.on('connect', (req, client, head) =>
        handleConnect(req, client as net.Socket, head, upstream.hostname, upstreamPort, authHeader, track),
    )

    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as AddressInfo
    const url = `http://127.0.0.1:${port}`

    registry.set(url, { server, sockets })
    return url
}

export async function closeAnonymizedProxy(url: string, closeConnections = false): Promise<void> {
    const entry = registry.get(url)
    if (!entry) return
    registry.delete(url)

    if (closeConnections) for (const s of entry.sockets) s.destroy()
    await new Promise<void>((resolve, reject) =>
        entry.server.close(err => (err ? reject(err) : resolve())),
    )
}

function buildAuthHeader(u: URL): string | null {
    if (!u.username && !u.password) return null
    const user = decodeURIComponent(u.username)
    const pass = decodeURIComponent(u.password)
    return 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64')
}

function handleHttp(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    upstreamHost: string,
    upstreamPort: number,
    authHeader: string | null,
) {
    const headers: http.OutgoingHttpHeaders = { ...req.headers }
    if (authHeader) headers['proxy-authorization'] = authHeader
    delete headers['proxy-connection']

    const proxied = http.request({
        hostname: upstreamHost,
        port: upstreamPort,
        method: req.method,
        path: req.url,
        headers,
    })

    proxied.on('response', upstreamRes => {
        res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers)
        upstreamRes.pipe(res)
    })
    proxied.on('error', err => {
        if (!res.headersSent) res.writeHead(502)
        res.end(`Upstream error: ${err.message}`)
    })
    req.pipe(proxied)
}

function handleConnect(
    req: http.IncomingMessage,
    clientSocket: net.Socket,
    head: Buffer,
    upstreamHost: string,
    upstreamPort: number,
    authHeader: string | null,
    track: (s: net.Socket) => void,
) {
    const target = req.url || req.headers.host
    if (!target) {
        clientSocket.write('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n')
        clientSocket.end()
        return
    }

    const upstreamSocket = net.connect(upstreamPort, upstreamHost)
    track(upstreamSocket)

    upstreamSocket.once('connect', () => {
        const lines = [`CONNECT ${target} HTTP/1.1`, `Host: ${target}`]
        if (authHeader) lines.push(`Proxy-Authorization: ${authHeader}`)
        upstreamSocket.write(lines.join('\r\n') + '\r\n\r\n')
    })

    let buffered = Buffer.alloc(0)
    const onUpstreamData = (chunk: Buffer) => {
        buffered = Buffer.concat([buffered, chunk])
        const end = buffered.indexOf('\r\n\r\n')
        if (end === -1) return

        upstreamSocket.removeListener('data', onUpstreamData)

        const statusLine = buffered.toString('utf8', 0, Math.min(buffered.length, 128))
        const status = parseInt(statusLine.match(/^HTTP\/1\.[01] (\d{3})/)?.[1] ?? '0', 10)

        if (status !== 200) {
            clientSocket.write(buffered)
            clientSocket.end()
            upstreamSocket.destroy()
            return
        }

        clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n')

        const leftover = buffered.subarray(end + 4)
        if (leftover.length) clientSocket.write(leftover)
        if (head.length) upstreamSocket.write(head)

        upstreamSocket.pipe(clientSocket)
        clientSocket.pipe(upstreamSocket)
    }
    upstreamSocket.on('data', onUpstreamData)

    const destroy = () => {
        upstreamSocket.destroy()
        clientSocket.destroy()
    }
    upstreamSocket.on('error', destroy)
    clientSocket.on('error', destroy)
    upstreamSocket.on('close', () => clientSocket.destroy())
    clientSocket.on('close', () => upstreamSocket.destroy())
}
