
// ===================================================================
// RedNox - Node Registry with UI Discovery
// ===================================================================

import { RuntimeNodeDefinition, NodeDescriptor, NodesDiscoveryResponse } from '../types/core';

export class NodeRegistry {
  private nodes = new Map<string, RuntimeNodeDefinition>();
  
  register(type: string, definition: RuntimeNodeDefinition) {
    // Ensure UI metadata exists
    if (!definition.ui) {
      definition.ui = {
        icon: '⚙️',
        color: '#dddddd',
        paletteLabel: type
      };
    }
    
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
  
  // ===================================================================
  // UI Discovery API
  // ===================================================================
  
  exportForUI(): NodesDiscoveryResponse {
    const nodes: NodeDescriptor[] = [];
    
    for (const [type, definition] of this.nodes) {
      nodes.push({
        type,
        category: definition.category,
        inputs: definition.inputs,
        outputs: definition.outputs,
        defaults: definition.defaults,
        ui: {
          icon: definition.ui?.icon || '⚙️',
          color: definition.ui?.color || '#dddddd',
          colorLight: definition.ui?.colorLight || '#eeeeee',
          paletteLabel: definition.ui?.paletteLabel || type,
          label: typeof definition.ui?.label === 'string' 
            ? definition.ui.label 
            : undefined,
          labelStyle: typeof definition.ui?.labelStyle === 'string'
            ? definition.ui.labelStyle
            : undefined,
          properties: definition.ui?.properties || [],
          info: definition.ui?.info,
          align: definition.ui?.align,
          button: definition.ui?.button
        }
      });
    }
    
    // Sort by category then by palette label
    nodes.sort((a, b) => {
      const catCompare = a.category.localeCompare(b.category);
      if (catCompare !== 0) return catCompare;
      return (a.ui.paletteLabel || a.type).localeCompare(b.ui.paletteLabel || b.type);
    });
    
    return {
      nodes,
      count: nodes.length,
      version: '3.0.0'
    };
  }
  
  // Get nodes by category
  getByCategory(): Map<string, NodeDescriptor[]> {
    const byCategory = new Map<string, NodeDescriptor[]>();
    const discovery = this.exportForUI();
    
    for (const node of discovery.nodes) {
      if (!byCategory.has(node.category)) {
        byCategory.set(node.category, []);
      }
      byCategory.get(node.category)!.push(node);
    }
    
    return byCategory;
  }
}

export const registry = new NodeRegistry();
