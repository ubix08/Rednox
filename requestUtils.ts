// src/utils/requestUtils.ts
import { Env } from '../worker';

export async function parseRequestPayload(request: Request, path: string): Promise<any> {
  const url = new URL(request.url);
  const contentType = request.headers.get('content-type') || '';
  
  let body: any = null;
  
  try {
    if (contentType.includes('application/json')) {
      body = await request.json();
    } else if (contentType.includes('application/x-www-form-urlencoded')) {
      const text = await request.text();
      body = Object.fromEntries(new URLSearchParams(text));
    } else if (contentType.includes('text/')) {
      body = await request.text();
    } else if (request.method !== 'GET' && request.method !== 'HEAD') {
      body = await request.text();
    }
  } catch (err) {
    body = null;
  }
  
  return {
    method: request.method,
    url: request.url,
    path,
    headers: Object.fromEntries(request.headers),
    query: Object.fromEntries(url.searchParams),
    body,
    params: {}
  };
}

export function jsonResponse(data: any, headers: Record<string, string> = {}, status: number = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...headers
    }
  });
}

export function logExecution(env: Env, flowId: string, status: string, duration: number, errorMessage?: string): void {
  // Fire and forget - don't block response
  env.DB.prepare(`
    INSERT INTO flow_logs (flow_id, status, duration_ms, error_message) 
    VALUES (?, ?, ?, ?)
  `).bind(flowId, status, duration, errorMessage || null).run().catch(() => {});
}
