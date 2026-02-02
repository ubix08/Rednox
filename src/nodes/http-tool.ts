// ===================================================================
// HTTP Tool Node - External API Call Tool
// ===================================================================

import { registry } from '../../core/NodeRegistry';
import { NodeMessage, Node, ExecutionContext } from '../../types/core';
import { ToolSchemaValidator, ToolArgumentsParser } from '../../utils/tool-utils';

registry.register('http-tool', {
  type: 'http-tool',
  category: 'AI Tools',
  defaults: {
    name: { value: '' },
    toolName: { value: 'api_call' },
    toolDescription: { value: 'Calls an external API' },
    toolParameters: { 
      value: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Search query',
          },
        },
        required: ['query'],
      },
    },
    method: { value: 'GET' },
    url: { value: 'https://api.example.com/search' },
    headers: { value: {} },
    bodyTemplate: { value: '' },
    responseTransform: { value: '' },
    timeout: { value: 30000 },
    validateArgs: { value: true },
  },
  inputs: 1,
  outputs: 1,
  
  execute: async (msg: NodeMessage, node: Node, context: ExecutionContext) => {
    try {
      node.status({ fill: 'yellow', shape: 'dot', text: 'calling API' });

      // Check if this is a tool call
      if (!msg.toolCall) {
        node.warn('HTTP tool received message without toolCall', msg);
        return msg;
      }

      const toolCall = msg.toolCall;
      
      // Validate it's for this tool
      if (toolCall.name !== node.config.toolName) {
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

      // Replace parameters in URL
      let url = node.config.url;
      for (const [key, value] of Object.entries(toolCall.arguments)) {
        const placeholder = `{{${key}}}`;
        url = url.replace(new RegExp(placeholder, 'g'), encodeURIComponent(String(value)));
      }

      // Prepare headers
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...node.config.headers,
      };

      // Replace parameters in headers
      for (const [headerKey, headerValue] of Object.entries(headers)) {
        for (const [argKey, argValue] of Object.entries(toolCall.arguments)) {
          const placeholder = `{{${argKey}}}`;
          headers[headerKey] = String(headerValue).replace(
            new RegExp(placeholder, 'g'), 
            String(argValue)
          );
        }
      }

      // Prepare body if needed
      let body: string | undefined;
      if (node.config.method !== 'GET' && node.config.method !== 'HEAD' && node.config.bodyTemplate) {
        body = node.config.bodyTemplate;
        for (const [key, value] of Object.entries(toolCall.arguments)) {
          const placeholder = `{{${key}}}`;
          body = body.replace(new RegExp(placeholder, 'g'), JSON.stringify(value));
        }
      }

      // Make HTTP request
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), node.config.timeout || 30000);

      try {
        const response = await fetch(url, {
          method: node.config.method,
          headers,
          body,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        // Parse response
        const contentType = response.headers.get('content-type');
        let data: any;

        if (contentType?.includes('application/json')) {
          data = await response.json();
        } else if (contentType?.includes('text/')) {
          data = await response.text();
        } else {
          data = await response.text();
        }

        // Transform response if transform code provided
        if (node.config.responseTransform) {
          const transformFunc = new Function(
            'response', 'args', 'msg',
            `'use strict';
            return (() => {
              ${node.config.responseTransform}
            })();`
          );

          data = transformFunc(data, toolCall.arguments, msg);
        }

        node.status({ fill: 'green', shape: 'dot', text: 'complete' });

        return {
          ...msg,
          toolResult: data,
          _msgid: crypto.randomUUID(),
        };

      } catch (fetchError: any) {
        clearTimeout(timeoutId);
        
        if (fetchError.name === 'AbortError') {
          throw new Error(`Request timeout after ${node.config.timeout}ms`);
        }
        throw fetchError;
      }

    } catch (error: any) {
      node.error(`HTTP Tool Error: ${error.message}`, msg);
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
    icon: '🌐',
    color: '#3498DB',
    colorLight: '#5DADE2',
    paletteLabel: 'HTTP Tool',
    label: (node) => node.name || node.toolName || 'HTTP Tool',
    info: `
      <h3>HTTP Tool</h3>
      <p>Create an API-based tool that the LLM agent can call.</p>
      
      <h4>How It Works:</h4>
      <ol>
        <li>Connect to LLM Agent's second output (tool calls)</li>
        <li>Connect output back to LLM Agent's input</li>
        <li>Agent will call external APIs through this tool</li>
      </ol>
      
      <h4>URL Parameter Substitution:</h4>
      <p>Use <code>{{parameterName}}</code> in URLs:</p>
      <pre>https://api.weather.com/forecast?city={{city}}&units={{units}}</pre>
      
      <h4>Body Template:</h4>
      <p>For POST/PUT requests, use JSON template:</p>
      <pre>
{
  "query": "{{query}}",
  "limit": {{limit}},
  "filters": {{filters}}
}
      </pre>
      
      <h4>Response Transform:</h4>
      <p>Optional JavaScript to transform API response:</p>
      <pre>
// response = API response data
return {
  results: response.data.items.map(item => ({
    title: item.name,
    description: item.desc
  }))
};
      </pre>
      
      <h4>Example Tool Parameters:</h4>
      <pre>
{
  "type": "object",
  "properties": {
    "city": {
      "type": "string",
      "description": "City name for weather"
    },
    "units": {
      "type": "string",
      "enum": ["metric", "imperial"],
      "description": "Temperature units"
    }
  },
  "required": ["city"]
}
      </pre>
    `,
    properties: [
      {
        name: 'name',
        label: 'Node Name',
        type: 'text',
        default: '',
        placeholder: 'Weather API',
      },
      {
        name: 'toolName',
        label: 'Tool Name',
        type: 'text',
        default: 'api_call',
        required: true,
        pattern: '^[a-zA-Z0-9_-]+$',
        description: 'Tool identifier',
      },
      {
        name: 'toolDescription',
        label: 'Tool Description',
        type: 'textarea',
        rows: 3,
        default: 'Calls an external API',
        required: true,
        description: 'Explain what this API does (for LLM)',
      },
      {
        name: 'toolParameters',
        label: 'Parameters Schema (JSON Schema)',
        type: 'json',
        default: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Search query',
            },
          },
          required: ['query'],
        },
        required: true,
        description: 'JSON Schema defining API parameters',
      },
      {
        name: 'method',
        label: 'HTTP Method',
        type: 'select',
        options: [
          { value: 'GET', label: 'GET' },
          { value: 'POST', label: 'POST' },
          { value: 'PUT', label: 'PUT' },
          { value: 'PATCH', label: 'PATCH' },
          { value: 'DELETE', label: 'DELETE' },
        ],
        default: 'GET',
        required: true,
      },
      {
        name: 'url',
        label: 'URL',
        type: 'url',
        default: 'https://api.example.com/search',
        required: true,
        placeholder: 'https://api.example.com/endpoint?param={{value}}',
        description: 'API endpoint (use {{param}} for substitution)',
      },
      {
        name: 'headers',
        label: 'Headers (JSON)',
        type: 'json',
        default: {},
        description: 'HTTP headers (use {{param}} for substitution)',
      },
      {
        name: 'bodyTemplate',
        label: 'Body Template (for POST/PUT)',
        type: 'code',
        language: 'json',
        rows: 6,
        default: '',
        placeholder: '{"query": "{{query}}", "limit": {{limit}}}',
        description: 'Request body template (use {{param}})',
      },
      {
        name: 'responseTransform',
        label: 'Response Transform (Optional)',
        type: 'code',
        language: 'javascript',
        rows: 6,
        default: '',
        placeholder: 'return response.data;',
        description: 'Transform API response',
      },
      {
        name: 'timeout',
        label: 'Timeout (ms)',
        type: 'number',
        default: 30000,
        min: 1000,
        max: 300000,
        description: 'Request timeout in milliseconds',
      },
      {
        name: 'validateArgs',
        label: 'Validate Arguments',
        type: 'checkbox',
        default: true,
        description: 'Validate args against schema',
      },
    ],
  },
});
