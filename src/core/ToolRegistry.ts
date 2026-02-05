// ===================================================================
// Tool Registry - Register and Discover Tool Nodes
// ===================================================================

import { ToolNodeDefinition, ToolNodeConfig, ToolExecutionResult } from '../types/tools';
import { ToolCall } from '../providers/base';
import { NodeMessage, ExecutionContext } from '../types/core';

export class ToolRegistry {
  private static tools = new Map<string, ToolNodeDefinition>();
  
  /**
   * Register a tool node type
   */
  static register(definition: ToolNodeDefinition): void {
    if (definition.category !== 'tools') {
      throw new Error('Tool nodes must have category "tools"');
    }
    
    this.tools.set(definition.type, definition);
    console.log(`[ToolRegistry] Registered tool: ${definition.type}`);
  }
  
  /**
   * Get tool definition by type
   */
  static get(type: string): ToolNodeDefinition | undefined {
    return this.tools.get(type);
  }
  
  /**
   * Check if tool type exists
   */
  static has(type: string): boolean {
    return this.tools.has(type);
  }
  
  /**
   * Get all registered tool types
   */
  static list(): string[] {
    return Array.from(this.tools.keys());
  }
  
  /**
   * Get all tool definitions
   */
  static getAll(): ToolNodeDefinition[] {
    return Array.from(this.tools.values());
  }
  
  /**
   * Execute a tool
   */
  static async execute(
    toolCall: ToolCall,
    toolConfig: ToolNodeConfig,
    msg: NodeMessage,
    context: ExecutionContext
  ): Promise<ToolExecutionResult> {
    const definition = this.tools.get(toolConfig.type);
    
    if (!definition) {
      throw new Error(`Tool type not found: ${toolConfig.type}`);
    }
    
    // Validate arguments if validator exists
    if (definition.validate) {
      const args = JSON.parse(toolCall.function.arguments);
      const validation = definition.validate(args, toolConfig);
      
      if (!validation.valid) {
        return {
          success: false,
          error: `Invalid arguments: ${validation.errors.join(', ')}`,
        };
      }
    }
    
    // Execute tool
    const startTime = Date.now();
    
    try {
      const result = await definition.execute(toolCall, toolConfig, msg, context);
      
      return {
        ...result,
        metadata: {
          ...result.metadata,
          executionTime: Date.now() - startTime,
        },
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        metadata: {
          executionTime: Date.now() - startTime,
        },
      };
    }
  }
  
  /**
   * Get tool definition for LLM
   */
  static getToolDefinition(toolConfig: ToolNodeConfig): any {
    const definition = this.tools.get(toolConfig.type);
    
    if (!definition) {
      throw new Error(`Tool type not found: ${toolConfig.type}`);
    }
    
    return definition.getToolDefinition(toolConfig);
  }
  
  /**
   * Get all tool definitions for multiple tool configs
   */
  static getToolDefinitions(toolConfigs: ToolNodeConfig[]): any[] {
    return toolConfigs.map(config => this.getToolDefinition(config));
  }
}
