import {
  createFreebuffAuth,
  isSameOriginRequest,
  type FreebuffAuth,
} from '@freebuff/auth'
import { createRealtimeTicket } from '../../freebuff-realtime/server.js'

type Env = {
  ASSETS: Fetcher
  FREEBUFF_CLIENT_ID?: string
  FREEBUFF_ISSUER?: string
  APP_ORIGIN?: string
  REALTIME?: Fetcher
}

let auth: FreebuffAuth | undefined

const room = (value: unknown): string | null =>
  typeof value === 'string' && /^crosscut:[a-z0-9][a-z0-9-]{0,40}$/.test(value)
    ? value
    : null

async function handler(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)

  if (url.pathname === '/api/me') {
    const user = auth ? await auth.getUser(request) : null
    return Response.json(
      { user },
      { headers: { 'Cache-Control': 'private, no-store' } },
    )
  }

  if (url.pathname === '/api/realtime/ticket' && request.method === 'POST') {
    const appOrigin =
      env.APP_ORIGIN ??
      (['localhost', '127.0.0.1'].includes(url.hostname)
        ? url.origin
        : undefined)
    if (!appOrigin || !isSameOriginRequest(request, appOrigin))
      return new Response(null, { status: 403 })
    if (!env.REALTIME) return Response.json({ error: 'offline' }, { status: 503 })
    const body = (await request
      .json()
      .catch(() => null)) as { room?: unknown } | null
    const name = room(body?.room) ?? 'crosscut:global'
    // Identity comes from the server only: the signed-in account, or a
    // freshly minted guest id. The browser never supplies it.
    const user = auth ? await auth.getUser(request) : null
    const userId = user?.sub ?? `guest:${crypto.randomUUID()}`
    try {
      const ticket = await createRealtimeTicket(
        { REALTIME: env.REALTIME },
        {
          room: name,
          userId,
          origin: appOrigin,
          // The match state itself lives in the elected host client; every
          // member relays its own movement, so the room is open to publish.
          publish: true,
          presence: true,
        },
      )
      return Response.json(ticket, {
        headers: { 'Cache-Control': 'private, no-store' },
      })
    } catch {
      return Response.json({ error: 'offline' }, { status: 503 })
    }
  }

  const response = await env.ASSETS.fetch(request)
  const headers = new Headers(response.headers)
  headers.set('X-Content-Type-Options', 'nosniff')
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1'
    const appOrigin = env.APP_ORIGIN ?? (local ? url.origin : undefined)
    auth ??= env.FREEBUFF_CLIENT_ID
      ? createFreebuffAuth({
          clientId: env.FREEBUFF_CLIENT_ID,
          issuer: env.FREEBUFF_ISSUER,
          baseUrl: env.APP_ORIGIN ?? appOrigin ?? url.origin,
          // Session cookies need a secure context; loopback development is
          // the only place http is allowed.
          allowInsecureLocalhost:
            local && !!appOrigin && appOrigin.startsWith('http://localhost'),
        })
      : undefined
    return (auth?.wrap(handler) ?? handler)(request, env)
  },
} satisfies ExportedHandler<Env>
