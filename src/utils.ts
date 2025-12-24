// ===================================================================
// RedNox - Core Utilities
// ===================================================================

import { NodeMessage, Node, ExecutionContext, FlowConfig, ValidationResult } from './types/core';

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

// ===================================================================
// Property Evaluation
// ===================================================================

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

// ===================================================================
// Flow Validation
// ===================================================================

export function validateFlow(flow: FlowConfig): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  
  if (!flow.id || !flow.name || !flow.nodes || flow.nodes.length === 0) {
    errors.push('Flow must have id, name, and at least one node');
    return { valid: false, errors, warnings };
  }
  
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
  
  for (const node of flow.nodes) {
    if (!entryNodes.has(node.id) && !referencedNodes.has(node.id)) {
      warnings.push(`Node ${node.id} (${node.name || node.type}) is not connected`);
    }
  }
  
  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

// ===================================================================
// HTTP Helpers
// ===================================================================

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
  crypto
};

export async function executeSafeFunction(
  code: string,
  args: Record<string, any>
): Promise<any> {
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

// ===================================================================
// Storage Keys
// ===================================================================

export const StorageKeys = {
  flow: (key: string) => `f:${key}`,
  global: (key: string) => `g:${key}`,
  node: (nodeId: string, key: string) => `n:${nodeId}:${key}`,
  debug: (nodeId: string, timestamp: number) => `d:${nodeId}:${timestamp}`,
  join: (nodeId: string) => `j:${nodeId}`,
  schedule: (nodeId: string) => `sched:${nodeId}`,
  
  listPrefix: (prefix: string) => prefix
};
