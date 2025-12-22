// ===================================================================
// RedNox - Utility Functions
// ===================================================================

import { NodeMessage, Node, ExecutionContext } from '../types/core';

export const RED = {
  util: {
    cloneMessage(msg: NodeMessage): NodeMessage {
      return JSON.parse(JSON.stringify(msg));
    },
    generateId(): string {
      return crypto.randomUUID();
    },
    getMessageProperty(msg: any, expr: string): any {
      if (!expr) return undefined;
      const parts = expr.split('.');
      let value = msg;
      for (const part of parts) {
        if (value && typeof value === 'object' && part in value) {
          value = value[part];
        } else {
          return undefined;
        }
      }
      return value;
    },
    setMessageProperty(msg: any, expr: string, value: any): void {
      const parts = expr.split('.');
      let obj = msg;
      for (let i = 0; i < parts.length - 1; i++) {
        if (!(parts[i] in obj) || typeof obj[parts[i]] !== 'object') {
          obj[parts[i]] = {};
        }
        obj = obj[parts[i]];
      }
      obj[parts[parts.length - 1]] = value;
    }
  }
};

export async function evaluateProperty(
  prop: any,
  msg: NodeMessage,
  node: Node,
  context: ExecutionContext
): Promise<any> {
  const valueType = prop.vt || prop.tot || 'str';
  const value = prop.v || prop.to;
  
  switch (valueType) {
    case 'msg':
      return RED.util.getMessageProperty(msg, value);
    case 'flow':
      return await node.context().flow.get(value);
    case 'global':
      return await node.context().global.get(value);
    case 'str':
      return String(value);
    case 'num':
      return Number(value);
    case 'bool':
      return value === 'true' || value === true;
    case 'json':
      try {
        return JSON.parse(value);
      } catch {
        return value;
      }
    case 'date':
      return Date.now();
    case 'env':
      return context.env[value];
    default:
      return value;
  }
}

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

export function jsonResponse(
  data: any,
  headers: Record<string, string> = {},
  status: number = 200
): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...headers
    }
  });
}
