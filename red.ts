// src/utils/red.ts
import { NodeMessage } from '../types/core';

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
