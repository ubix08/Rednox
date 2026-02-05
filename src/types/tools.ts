// ===================================================================
// Tool System Types
// ===================================================================

import { NodeMessage, Node, ExecutionContext } from './core';
import { ToolCall } from '../providers/base';

/**
 * Base interface for all tool nodes
 */
export interface ToolNodeConfig {
  id: string;
  type: string;
  name: string;
  isConfigNode: true;
  
  // Tool metadata
  toolName: string;
  toolDescription: string;
  toolParameters: ToolParametersSchema;
  
  // Execution settings
  requiresApproval?: boolean;
  timeout?: number;
  retryCount?: number;
  
  // Tool-specific config
  [key: string]: any;
}

/**
 * JSON Schema for tool parameters
 */
export interface ToolParametersSchema {
  type: 'object';
  properties: Record<string, ToolParameterProperty>;
  required?: string[];
  additionalProperties?: boolean;
}

export interface ToolParameterProperty {
  type: 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object';
  description?: string;
  enum?: any[];
  items?: ToolParameterProperty;
  properties?: Record<string, ToolParameterProperty>;
  required?: string[];
  default?: any;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
}

/**
 * Tool execution result
 */
export interface ToolExecutionResult {
  success: boolean;
  result?: any;
  error?: string;
  metadata?: {
    executionTime?: number;
    retryCount?: number;
    [key: string]: any;
  };
}

/**
 * Tool node definition
 */
export interface ToolNodeDefinition {
  type: string;
  category: 'tools';
  defaults: Record<string, any>;
  
  /**
   * Execute the tool with given arguments
   */
  execute: (
    toolCall: ToolCall,
    toolConfig: ToolNodeConfig,
    msg: NodeMessage,
    context: ExecutionContext
  ) => Promise<ToolExecutionResult>;
  
  /**
   * Validate tool arguments against schema
   */
  validate?: (
    args: any,
    toolConfig: ToolNodeConfig
  ) => { valid: boolean; errors: string[] };
  
  /**
   * Generate tool definition for LLM
   */
  getToolDefinition: (toolConfig: ToolNodeConfig) => {
    type: 'function';
    function: {
      name: string;
      description: string;
      parameters: ToolParametersSchema;
    };
  };
  
  ui?: any;
}
