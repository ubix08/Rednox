
// ===================================================================
// RedNox - Node Registry
// ===================================================================

import { RuntimeNodeDefinition } from '../types/core';

export class NodeRegistry {
  private nodes = new Map<string, RuntimeNodeDefinition>();
  
  register(type: string, definition: RuntimeNodeDefinition) {
    this.nodes.set(type, definition);
  }
  
  get(type: string): RuntimeNodeDefinition | undefined {
    return this.nodes.get(type);
  }
  
  getAll(): RuntimeNodeDefinition[] {
    return Array.from(this.nodes.values());
  }
  
  has(type: string): boolean {
    return this.nodes.has(type);
  }
  
  list(): string[] {
    return Array.from(this.nodes.keys());
  }
}

export const registry = new NodeRegistry();
