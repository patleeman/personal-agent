export interface Env {
  DOWNLOADS: R2Bucket;
  DOWNLOAD_TOKEN: string;
}

function unauthorized(): Response {
  return new Response('Unauthorized', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Bearer',
      'Cache-Control': 'no-store',
    },
  });
}

function extractToken(request: Request): string | null {
  const authorization = request.headers.get('authorization');
  if (authorization) {
    const match = authorization.match(/^Bearer\s+(.+)$/i);
    if (match) {
      return match[1].trim();
    }
  }

  const url = new URL(request.url);
  const queryToken = url.searchParams.get('token');
  return queryToken?.trim() || null;
}

function buildObjectHeaders(object: R2ObjectBody, key: string): Headers {
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  headers.set('cache-control', 'private, max-age=0, must-revalidate');

  if (!headers.has('content-type')) {
    headers.set('content-type', 'application/octet-stream');
  }

  if (!headers.has('content-disposition')) {
    const filename = key.split('/').pop() || key;
    headers.set('content-disposition', `attachment; filename="${filename.replaceAll('"', '')}"`);
  }

  return headers;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (!['GET', 'HEAD'].includes(request.method)) {
      return new Response('Method Not Allowed', {
        status: 405,
        headers: {
          Allow: 'GET, HEAD',
        },
      });
    }

    const url = new URL(request.url);
    const key = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
    if (!key) {
      return new Response(JSON.stringify({
        ok: true,
        service: 'personal-agent-download-gate',
        usage: 'Request /<object-key> with Authorization: Bearer <token> or ?token=<token>.',
      }, null, 2), {
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store',
        },
      });
    }

    const token = extractToken(request);
    if (!token || token !== env.DOWNLOAD_TOKEN) {
      return unauthorized();
    }

    const object = await env.DOWNLOADS.get(key);
    if (!object) {
      return new Response('Not Found', { status: 404 });
    }

    const headers = buildObjectHeaders(object, key);
    if (request.method === 'HEAD') {
      return new Response(null, { headers });
    }

    return new Response(object.body, { headers });
  },
};
