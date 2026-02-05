// ===================================================================
// ToolExecutor - Unified Tool Execution Engine (UPDATED)
// ===================================================================

import { NodeMessage, ExecutionContext } from '../types/core';
import { ToolNodeConfig, ToolExecutionResult } from '../types/tools';
import { ToolCall } from '../providers/base';
import { ToolRegistry } from './ToolRegistry';

export class ToolExecutor {
  /**
   * Execute a tool call using the tool registry
   */
  static async execute(
    toolCall: ToolCall,
    toolConfig: ToolNodeConfig,
    msg: NodeMessage,
    context: ExecutionContext
  ): Promise<any> {
    
    console.log(`[ToolExecutor] Executing tool: ${toolCall.function.name} (${toolConfig.type})`);
    
    // Check timeout
    const timeout = toolConfig.timeout || 30000;
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error(`Tool execution timeout after ${timeout}ms`)), timeout)
    );
    
    // Execute with timeout
    const executePromise = ToolRegistry.execute(toolCall, toolConfig, msg, context);
    
    try {
      const result = await Promise.race([executePromise, timeoutPromise]) as ToolExecutionResult;
      
      if (!result.success) {
        throw new Error(result.error || 'Tool execution failed');
      }
      
      return result.result;
      
    } catch (error: any) {
      console.error(`[ToolExecutor] Tool execution error:`, error);
      throw error;
    }
  }
}
