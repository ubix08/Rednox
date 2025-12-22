// src/utils/evaluateProperty.ts
import { NodeMessage, ExecutionContext, Node } from '../types/core';
import { RED } from './red';

export async function evaluateProperty(prop: any, msg: NodeMessage, node: Node, context: ExecutionContext): Promise<any> {
  const valueType = prop.vt || prop.tot || 'str';
  const value = prop.v || prop.to;
  
  switch (valueType) {
    case 'msg': return RED.util.getMessageProperty(msg, value);
    case 'flow': return await node.context().flow.get(value);
    case 'global': return await node.context().global.get(value);
    case 'str': return String(value);
    case 'num': return Number(value);
    case 'bool': return value === 'true' || value === true;
    case 'json':
      try { return JSON.parse(value); }
      catch { return value; }
    case 'date': return Date.now();
    case 'env': return context.env[value];
    default: return value;
  }
}
