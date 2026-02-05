// ===================================================================
// ConfigNodeRegistry - Load and Cache Config Nodes
// ===================================================================

import { FlowConfig, ExecutionContext, NodeConfig } from '../types/core';

export class ConfigNodeRegistry {
  private cache = new Map<string, NodeConfig>();
  private flowConfig: FlowConfig;
  
  constructor(flowConfig: FlowConfig) {
    this.flowConfig = flowConfig;
  }
  
  /**
   * Load a config node by ID
   */
  async load(configId: string): Promise<NodeConfig> {
    // Check cache
    if (this.cache.has(configId)) {
      return this.cache.get(configId)!;
    }
    
    // Find in flow nodes
    const configNode = this.flowConfig.nodes.find(n => 
      n.id === configId && n.isConfigNode === true
    );
    
    if (!configNode) {
      throw new Error(`Config node not found: ${configId}`);
    }
    
    // Validate it's actually a config node
    if (!configNode.isConfigNode) {
      throw new Error(`Node ${configId} is not a config node`);
    }
    
    // Cache and return
    this.cache.set(configId, configNode);
    return configNode;
  }
  
  /**
   * Load multiple config nodes by IDs
   */
  async loadMultiple(configIds: string[]): Promise<NodeConfig[]> {
    const configs: NodeConfig[] = [];
    
    for (const id of configIds) {
      try {
        const config = await this.load(id);
        configs.push(config);
      } catch (error) {
        console.error(`Failed to load config node ${id}:`, error);
      }
    }
    
    return configs;
  }
  
  /**
   * Load all config nodes of a specific type
   */
  async loadByType(type: string): Promise<NodeConfig[]> {
    return this.flowConfig.nodes.filter(n => 
      n.type === type && n.isConfigNode === true
    );
  }
  
  /**
   * Check if a config node exists
   */
  exists(configId: string): boolean {
    return this.flowConfig.nodes.some(n => 
      n.id === configId && n.isConfigNode === true
    );
  }
  
  /**
   * Get all config nodes
   */
  getAll(): NodeConfig[] {
    return this.flowConfig.nodes.filter(n => n.isConfigNode === true);
  }
  
  /**
   * Get all visible nodes (non-config)
   */
  getVisibleNodes(): NodeConfig[] {
    return this.flowConfig.nodes.filter(n => !n.isConfigNode);
  }
  
  /**
   * Clear cache (call at end of execution)
   */
  clearCache(): void {
    this.cache.clear();
  }
  
  /**
   * Validate all config references in a node
   */
  validateReferences(node: NodeConfig): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    
    // Check LLM provider reference
    if (node.llmProvider && !this.exists(node.llmProvider)) {
      errors.push(`LLM provider not found: ${node.llmProvider}`);
    }
    
    // Check memory reference
    if (node.memory && !this.exists(node.memory)) {
      errors.push(`Memory config not found: ${node.memory}`);
    }
    
    // Check tool references
    if (Array.isArray(node.tools)) {
      for (const toolId of node.tools) {
        if (!this.exists(toolId)) {
          errors.push(`Tool config not found: ${toolId}`);
        }
      }
    }
    
    // Check knowledge references
    if (Array.isArray(node.knowledge)) {
      for (const knowledgeId of node.knowledge) {
        if (!this.exists(knowledgeId)) {
          errors.push(`Knowledge config not found: ${knowledgeId}`);
        }
      }
    }
    
    return {
      valid: errors.length === 0,
      errors
    };
  }
}

/**
 * Helper function to create config registry from context
 */
export function createConfigRegistry(context: ExecutionContext): ConfigNodeRegistry {
  const flowConfig = context.flowEngine?.flowConfig;
  if (!flowConfig) {
    throw new Error('Flow config not available in context');
  }
  return new ConfigNodeRegistry(flowConfig);
}
