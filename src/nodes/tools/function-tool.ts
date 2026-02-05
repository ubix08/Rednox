// ===================================================================
// Function Tool Node - Execute Custom JavaScript
// ===================================================================

import { ToolRegistry } from '../../core/ToolRegistry';
import { ToolNodeDefinition, ToolNodeConfig, ToolExecutionResult } from '../../types/tools';
import { ToolCall } from '../../providers/base';
import { NodeMessage, ExecutionContext } from '../../types/core';
import { RED } from '../../utils';

const functionToolDefinition: ToolNodeDefinition = {
  type: 'function-tool',
  category: 'tools',
  
  defaults: {
    name: { value: '' },
    toolName: { value: 'my_function' },
    toolDescription: { value: 'Performs a custom function' },
    toolParameters: { value: {
      type: 'object' as const,
      properties: {
        input: {
          type: 'string' as const,
          description: 'Input value',
        },
      },
      required: ['input'],
    }},
    
    // Function-specific
    functionCode: { value: `// Available variables:
// - args: Tool arguments (object)
// - msg: Current message
// - context: Execution context
// - flow: Flow context
// - global: Global context
// - RED: Node-RED utilities

// Return your result:
return {
  result: args.input.toUpperCase(),
  success: true
};` },
    validateArgs: { value: true },
    timeout: { value: 30000 },
    requiresApproval: { value: false },
  },
  
  execute: async (
    toolCall: ToolCall,
    toolConfig: ToolNodeConfig,
    msg: NodeMessage,
    context: ExecutionContext
  ): Promise<ToolExecutionResult> => {
    try {
      const args = JSON.parse(toolCall.function.arguments);
      
      // Create safe execution context
      const func = new Function(
        'args', 'msg', 'node', 'context', 'flow', 'global', 'RED',
        `'use strict';
        return (async () => {
          ${toolConfig.functionCode}
        })();`
      );
      
      // Execute function
      const result = await func(
        args,
        msg,
        { id: toolConfig.id, name: toolConfig.name }, // Mock node
        context,
        context.flow,
        context.global,
        RED
      );
      
      return {
        success: true,
        result: result,
      };
      
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  },
  
  validate: (args: any, toolConfig: ToolNodeConfig) => {
    const errors: string[] = [];
    
    if (!toolConfig.validateArgs) {
      return { valid: true, errors: [] };
    }
    
    const schema = toolConfig.toolParameters;
    
    // Check required parameters
    if (schema.required) {
      for (const requiredParam of schema.required) {
        if (!(requiredParam in args)) {
          errors.push(`Missing required parameter: ${requiredParam}`);
        }
      }
    }
    
    // Validate parameter types
    for (const [paramName, value] of Object.entries(args)) {
      const paramSchema = schema.properties[paramName];
      
      if (!paramSchema) {
        errors.push(`Unknown parameter: ${paramName}`);
        continue;
      }
      
      const actualType = Array.isArray(value) ? 'array' : typeof value;
      const expectedType = paramSchema.type;
      
      if (expectedType === 'integer') {
        if (typeof value !== 'number' || !Number.isInteger(value)) {
          errors.push(`Parameter "${paramName}" must be an integer`);
        }
      } else if (expectedType === 'number') {
        if (typeof value !== 'number') {
          errors.push(`Parameter "${paramName}" must be a number`);
        }
      } else if (expectedType !== actualType) {
        errors.push(`Parameter "${paramName}" must be of type ${expectedType}, got ${actualType}`);
      }
      
      // Validate enum values
      if (paramSchema.enum && !paramSchema.enum.includes(value)) {
        errors.push(`Parameter "${paramName}" must be one of: ${paramSchema.enum.join(', ')}`);
      }
    }
    
    return {
      valid: errors.length === 0,
      errors,
    };
  },
  
  getToolDefinition: (toolConfig: ToolNodeConfig) => ({
    type: 'function' as const,
    function: {
      name: toolConfig.toolName,
      description: toolConfig.toolDescription,
      parameters: toolConfig.toolParameters,
    },
  }),
  
  ui: {
    icon: '⚡',
    color: '#F39C12',
    colorLight: '#F5B041',
    paletteLabel: 'Function Tool',
    label: (node: any) => node.name || node.toolName || 'Function Tool',
    isConfigNode: true,
    
    info: `
      <h3>Function Tool</h3>
      <p>Execute custom JavaScript code when the agent calls this tool.</p>
      
      <h4>Available Variables:</h4>
      <ul>
        <li><code>args</code> - Tool arguments from LLM</li>
        <li><code>msg</code> - Current message object</li>
        <li><code>node</code> - Node instance (for logging)</li>
        <li><code>context</code> - Execution context</li>
        <li><code>flow</code> - Flow context storage</li>
        <li><code>global</code> - Global context storage</li>
        <li><code>RED</code> - Node-RED utilities</li>
      </ul>
      
      <h4>Example:</h4>
      <pre>
// Calculate sum of numbers
const sum = args.numbers.reduce((a, b) => a + b, 0);

return {
  sum: sum,
  count: args.numbers.length,
  average: sum / args.numbers.length
};
      </pre>
    `,
    
    properties: [
      {
        name: 'name',
        label: 'Tool Name',
        type: 'text',
        required: true,
        placeholder: 'Calculator',
        description: 'Friendly name for this tool',
      },
      {
        name: 'toolName',
        label: 'Function Name',
        type: 'text',
        required: true,
        pattern: '^[a-zA-Z0-9_-]+$',
        placeholder: 'calculate_sum',
        description: 'Tool identifier (alphanumeric, underscores, hyphens)',
      },
      {
        name: 'toolDescription',
        label: 'Description',
        type: 'textarea',
        rows: 3,
        required: true,
        placeholder: 'Calculate the sum of an array of numbers',
        description: 'Explain what this tool does (for LLM)',
      },
      {
        name: 'toolParameters',
        label: 'Parameters Schema (JSON Schema)',
        type: 'json',
        required: true,
        default: {
          type: 'object',
          properties: {
            input: {
              type: 'string',
              description: 'Input value',
            },
          },
          required: ['input'],
        },
        description: 'JSON Schema defining function parameters',
      },
      {
        name: 'functionCode',
        label: 'Function Code',
        type: 'code',
        language: 'javascript',
        rows: 12,
        required: true,
        default: `return {
  result: args.input.toUpperCase()
};`,
        description: 'JavaScript code to execute',
      },
      {
        name: 'validateArgs',
        label: 'Validate Arguments',
        type: 'checkbox',
        default: true,
        description: 'Validate args against schema before execution',
      },
      {
        name: 'timeout',
        label: 'Timeout (ms)',
        type: 'number',
        default: 30000,
        min: 1000,
        max: 300000,
        description: 'Execution timeout in milliseconds',
      },
      {
        name: 'requiresApproval',
        label: 'Require Human Approval',
        type: 'checkbox',
        default: false,
        description: 'Pause for approval before calling',
      },
    ],
  },
};

// Register the tool
ToolRegistry.register(functionToolDefinition);
