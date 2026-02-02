// ===================================================================
// Function Tool Node - Code-based LLM Tool
// ===================================================================

import { registry } from '../../core/NodeRegistry';
import { NodeMessage, Node, ExecutionContext } from '../../types/core';
import { ToolSchemaValidator, ToolArgumentsParser, ToolResponseFormatter } from '../../utils/tool-utils';
import { RED } from '../../utils';

registry.register('function-tool', {
  type: 'function-tool',
  category: 'AI Tools',
  defaults: {
    name: { value: '' },
    toolName: { value: 'my_function' },
    toolDescription: { value: 'Performs a custom function' },
    toolParameters: { 
      value: {
        type: 'object',
        properties: {
          input: {
            type: 'string',
            description: 'Input value',
          },
        },
        required: ['input'],
      },
    },
    functionCode: { 
      value: `// Available variables:
// - args: Tool arguments (object)
// - msg: Current message
// - node: Node instance
// - context: Execution context
// - flow: Flow context
// - global: Global context

// Return your result:
return {
  result: args.input.toUpperCase(),
  processed: true
};`,
    },
    validateArgs: { value: true },
  },
  inputs: 1,
  outputs: 1,
  
  execute: async (msg: NodeMessage, node: Node, context: ExecutionContext) => {
    try {
      node.status({ fill: 'yellow', shape: 'dot', text: 'executing' });

      // Check if this is a tool call
      if (!msg.toolCall) {
        node.warn('Function tool received message without toolCall', msg);
        return msg;
      }

      const toolCall = msg.toolCall;
      
      // Validate it's for this tool
      if (toolCall.name !== node.config.toolName) {
        // Not for us, pass through
        return msg;
      }

      // Validate arguments if enabled
      if (node.config.validateArgs) {
        const validation = ToolArgumentsParser.validate(
          toolCall.arguments,
          {
            name: node.config.toolName,
            description: node.config.toolDescription,
            parameters: node.config.toolParameters,
          }
        );

        if (!validation.valid) {
          throw new Error(`Invalid arguments: ${validation.errors.join(', ')}`);
        }
      }

      // Execute the function
      const func = new Function(
        'args', 'msg', 'node', 'context', 'flow', 'global', 'RED',
        `'use strict';
        return (async () => {
          ${node.config.functionCode}
        })();`
      );

      const result = await func(
        toolCall.arguments,
        msg,
        node,
        context,
        context.flow,
        context.global,
        RED
      );

      node.status({ fill: 'green', shape: 'dot', text: 'complete' });

      // Return result to agent
      return {
        ...msg,
        toolResult: result,
        _msgid: crypto.randomUUID(),
      };

    } catch (error: any) {
      node.error(`Function Tool Error: ${error.message}`, msg);
      node.status({ fill: 'red', shape: 'dot', text: 'error' });

      return {
        ...msg,
        toolResult: {
          error: error.message,
          success: false,
        },
        _msgid: crypto.randomUUID(),
      };
    }
  },
  
  ui: {
    icon: '⚡',
    color: '#F39C12',
    colorLight: '#F5B041',
    paletteLabel: 'Function Tool',
    label: (node) => node.name || node.toolName || 'Function Tool',
    info: `
      <h3>Function Tool</h3>
      <p>Create a code-based tool that the LLM agent can call.</p>
      
      <h4>How It Works:</h4>
      <ol>
        <li>Connect to LLM Agent's second output (tool calls)</li>
        <li>Connect output back to LLM Agent's input</li>
        <li>Agent will automatically discover and use this tool</li>
      </ol>
      
      <h4>Function Code:</h4>
      <p>Your function has access to:</p>
      <ul>
        <li><code>args</code> - Tool arguments (from LLM)</li>
        <li><code>msg</code> - Current message</li>
        <li><code>node</code> - Node instance (for logging)</li>
        <li><code>context</code> - Execution context</li>
        <li><code>flow</code> - Flow context storage</li>
        <li><code>global</code> - Global context storage</li>
        <li><code>RED</code> - Node-RED utilities</li>
      </ul>
      
      <h4>Example:</h4>
      <pre>
// Calculate something
const sum = args.numbers.reduce((a, b) => a + b, 0);

return {
  sum: sum,
  count: args.numbers.length,
  average: sum / args.numbers.length
};
      </pre>
      
      <h4>Tool Parameters Schema:</h4>
      <p>Define the function signature using JSON Schema:</p>
      <pre>
{
  "type": "object",
  "properties": {
    "numbers": {
      "type": "array",
      "items": { "type": "number" },
      "description": "Array of numbers to sum"
    }
  },
  "required": ["numbers"]
}
      </pre>
    `,
    properties: [
      {
        name: 'name',
        label: 'Node Name',
        type: 'text',
        default: '',
        placeholder: 'Calculator',
      },
      {
        name: 'toolName',
        label: 'Tool Name',
        type: 'text',
        default: 'my_function',
        required: true,
        pattern: '^[a-zA-Z0-9_-]+$',
        description: 'Tool identifier (alphanumeric, underscores, hyphens)',
      },
      {
        name: 'toolDescription',
        label: 'Tool Description',
        type: 'textarea',
        rows: 3,
        default: 'Performs a custom function',
        required: true,
        description: 'Explain what this tool does (for LLM)',
      },
      {
        name: 'toolParameters',
        label: 'Parameters Schema (JSON Schema)',
        type: 'json',
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
        required: true,
        description: 'JSON Schema defining function parameters',
      },
      {
        name: 'functionCode',
        label: 'Function Code',
        type: 'code',
        language: 'javascript',
        rows: 12,
        default: `return {
  result: args.input.toUpperCase()
};`,
        required: true,
        description: 'JavaScript code to execute',
      },
      {
        name: 'validateArgs',
        label: 'Validate Arguments',
        type: 'checkbox',
        default: true,
        description: 'Validate args against schema before execution',
      },
    ],
  },
});
