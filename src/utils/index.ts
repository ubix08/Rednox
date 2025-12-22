
// ===================================================================
// RedNox - Enhanced Utility Functions
// ===================================================================

import { NodeMessage, Node, ExecutionContext, FlowConfig, ValidationResult, BatchedStorage } from '../types/core';

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

// ===================================================================
// Flow Validation
// ===================================================================

export function validateFlow(flow: FlowConfig): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  
  // Basic validation
  if (!flow.id || !flow.name || !flow.nodes || flow.nodes.length === 0) {
    errors.push('Flow must have id, name, and at least one node');
    return { valid: false, errors, warnings };
  }
  
  // Validate node structure
  const nodeIds = new Set<string>();
  for (const node of flow.nodes) {
    if (!node.id || !node.type) {
      errors.push(`Node missing id or type: ${JSON.stringify(node)}`);
      continue;
    }
    
    if (nodeIds.has(node.id)) {
      errors.push(`Duplicate node id: ${node.id}`);
    }
    nodeIds.add(node.id);
    
    if (!Array.isArray(node.wires)) {
      errors.push(`Node ${node.id} has invalid wires`);
    }
  }
  
  // Check for orphaned nodes
  const referencedNodes = new Set<string>();
  const entryNodes = new Set<string>();
  
  for (const node of flow.nodes) {
    if (node.type === 'http-in' || node.type === 'inject') {
      entryNodes.add(node.id);
    }
    
    for (const wireGroup of node.wires || []) {
      for (const targetId of wireGroup) {
        if (!nodeIds.has(targetId)) {
          errors.push(`Node ${node.id} references non-existent node: ${targetId}`);
        }
        referencedNodes.add(targetId);
      }
    }
  }
  
  // Warn about unreachable nodes
  for (const node of flow.nodes) {
    if (!entryNodes.has(node.id) && !referencedNodes.has(node.id)) {
      warnings.push(`Node ${node.id} (${node.name || node.type}) is not connected`);
    }
  }
  
  // Check for circular dependencies
  for (const node of flow.nodes) {
    if (hasCircularDependency(flow, node.id, new Set())) {
      errors.push(`Circular dependency detected at node ${node.id}`);
    }
  }
  
  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

function hasCircularDependency(
  flow: FlowConfig,
  nodeId: string,
  visited: Set<string>,
  path: Set<string> = new Set()
): boolean {
  if (path.has(nodeId)) return true;
  if (visited.has(nodeId)) return false;
  
  visited.add(nodeId);
  path.add(nodeId);
  
  const node = flow.nodes.find(n => n.id === nodeId);
  if (!node) return false;
  
  for (const wireGroup of node.wires || []) {
    for (const targetId of wireGroup) {
      if (hasCircularDependency(flow, targetId, visited, new Set(path))) {
        return true;
      }
    }
  }
  
  path.delete(nodeId);
  return false;
}

// ===================================================================
// Batched Storage Implementation
// ===================================================================

export class BatchedStorageImpl implements BatchedStorage {
  private pending = new Map<string, any>();
  private deleting = new Set<string>();
  private timer: any = null;
  private storage: DurableObjectStorage;
  private flushInterval: number;
  
  constructor(storage: DurableObjectStorage, flushInterval = 100) {
    this.storage = storage;
    this.flushInterval = flushInterval;
  }
  
  async get(key: string): Promise<any> {
    // Check pending writes first
    if (this.pending.has(key)) {
      return this.pending.get(key);
    }
    
    // Check if marked for deletion
    if (this.deleting.has(key)) {
      return undefined;
    }
    
    return await this.storage.get(key);
  }
  
  async set(key: string, value: any): Promise<void> {
    this.pending.set(key, value);
    this.deleting.delete(key);
    this.scheduleFlush();
  }
  
  async delete(key: string): Promise<void> {
    this.pending.delete(key);
    this.deleting.add(key);
    this.scheduleFlush();
  }
  
  private scheduleFlush(): void {
    if (!this.timer) {
      this.timer = setTimeout(() => this.flush(), this.flushInterval);
    }
  }
  
  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    
    if (this.pending.size === 0 && this.deleting.size === 0) {
      return;
    }
    
    // Write pending
    if (this.pending.size > 0) {
      await this.storage.put(Object.fromEntries(this.pending));
      this.pending.clear();
    }
    
    // Delete marked
    if (this.deleting.size > 0) {
      await this.storage.delete(Array.from(this.deleting));
      this.deleting.clear();
    }
  }
}

// ===================================================================
// Circuit Breaker Implementation
// ===================================================================

export class CircuitBreaker {
  private states = new Map<string, {
    failures: number;
    lastFailure: number;
    state: 'closed' | 'open' | 'half-open';
  }>();
  
  private failureThreshold = 5;
  private resetTimeout = 30000; // 30 seconds
  private halfOpenRetryDelay = 5000; // 5 seconds
  
  async execute<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const state = this.states.get(key) || {
      failures: 0,
      lastFailure: 0,
      state: 'closed' as const
    };
    
    const now = Date.now();
    
    // Check circuit state
    if (state.state === 'open') {
      if (now - state.lastFailure > this.resetTimeout) {
        state.state = 'half-open';
        this.states.set(key, state);
      } else {
        throw new Error(`Circuit breaker open for ${key}`);
      }
    }
    
    try {
      const result = await fn();
      
      // Success - reset circuit
      if (state.state === 'half-open') {
        state.state = 'closed';
        state.failures = 0;
        this.states.set(key, state);
      } else if (state.failures > 0) {
        state.failures = 0;
        this.states.set(key, state);
      }
      
      return result;
    } catch (err) {
      state.failures++;
      state.lastFailure = now;
      
      if (state.failures >= this.failureThreshold) {
        state.state = 'open';
      }
      
      this.states.set(key, state);
      throw err;
    }
  }
  
  reset(key: string): void {
    this.states.delete(key);
  }
  
  getState(key: string) {
    return this.states.get(key);
  }
}

// ===================================================================
// Storage Key Namespace Manager
// ===================================================================

export const StorageKeys = {
  flow: (key: string) => `f:${key}`,
  global: (key: string) => `g:${key}`,
  node: (nodeId: string, key: string) => `n:${nodeId}:${key}`,
  session: (key: string) => `s:${key}`,
  debug: (nodeId: string, timestamp: number) => `d:${nodeId}:${timestamp}`,
  log: (timestamp: number) => `l:${timestamp}`,
  file: (filename: string) => `file:${filename}`,
  join: (nodeId: string) => `j:${nodeId}`,
  ratelimit: (userId: string) => `rl:${userId}`,
  usage: () => `usage`,
  job: (key: string) => `job:${key}`,
  cache: (key: string) => `cache:${key}`,
  
  // List all keys with prefix
  listPrefix: (prefix: string) => prefix
};

// ===================================================================
// Rate Limiter
// ===================================================================

export class RateLimiter {
  private storage: DurableObjectStorage;
  
  constructor(storage: DurableObjectStorage) {
    this.storage = storage;
  }
  
  async check(
    key: string,
    limits: { requests: number; window: number }
  ): Promise<boolean> {
    const storageKey = StorageKeys.ratelimit(key);
    const now = Date.now();
    
    const data = await this.storage.get<any>(storageKey) || {
      count: 0,
      resetAt: now + limits.window
    };
    
    // Reset if window expired
    if (now > data.resetAt) {
      data.count = 0;
      data.resetAt = now + limits.window;
    }
    
    // Check limit
    if (data.count >= limits.requests) {
      return false;
    }
    
    // Increment
    data.count++;
    await this.storage.put(storageKey, data);
    
    return true;
  }
}

// ===================================================================
// Safe Function Execution
// ===================================================================

const SAFE_GLOBALS = {
  console,
  JSON,
  Math,
  Date,
  Array,
  Object,
  String,
  Number,
  Boolean,
  Promise,
  Set,
  Map,
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval
};

export async function executeSafeFunction(
  code: string,
  args: Record<string, any>
): Promise<any> {
  // Create async function with safe globals
  const func = new Function(
    ...Object.keys(SAFE_GLOBALS),
    ...Object.keys(args),
    `'use strict'; return (async () => { ${code} })();`
  );
  
  return await func(
    ...Object.values(SAFE_GLOBALS),
    ...Object.values(args)
  );
}
