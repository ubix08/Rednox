// ===================================================================
// HTTP Tool Node - Make HTTP Requests
// ===================================================================

import { ToolRegistry } from '../../core/ToolRegistry';
import { ToolNodeDefinition, ToolNodeConfig, ToolExecutionResult, ToolParametersSchema } from '../../types/tools';
import { ToolCall } from '../../providers/base';
import { NodeMessage, ExecutionContext } from '../../types/core';

const httpToolDefinition: ToolNodeDefinition = {
  type: 'http-tool',
  category: 'tools',
  
  defaults: {
    name: { value: '' },
    toolName: { value: 'api_call' },
    toolDescription: { value: 'Make an HTTP request to an external API' },
    toolParameters: { value: {
      type: 'object' as const,
      properties: {},
      required: [],
    }},
    
    // HTTP-specific
    httpMethod: { value: 'GET' },
    httpUrl: { value: '' },
    httpHeaders: { value: {} },
    httpQueryParams: { value: {} },
    bodyTemplate: { value: '' },
    responseTransform: { value: '' },
    timeout: { value: 30000 },
    followRedirects: { value: true },
    parseResponse: { value: true },
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
      
      // Replace URL parameters
      let url = toolConfig.httpUrl || '';
      for (const [key, value] of Object.entries(args)) {
        const placeholder = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
        url = url.replace(placeholder, encodeURIComponent(String(value)));
      }
      
      // Prepare headers
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...toolConfig.httpHeaders
      };
      
      // Replace header values
      for (const [headerKey, headerValue] of Object.entries(headers)) {
        for (const [argKey, argValue] of Object.entries(args)) {
          const placeholder = new RegExp(`\\{\\{${argKey}\\}\\}`, 'g');
          headers[headerKey] = String(headerValue).replace(
            placeholder,
            String(argValue)
          );
        }
      }
      
      // Prepare body
      let body: string | undefined;
      const method = (toolConfig.httpMethod || 'GET').toUpperCase();
      
      if (method !== 'GET' && method !== 'HEAD' && toolConfig.bodyTemplate) {
        body = toolConfig.bodyTemplate;
        for (const [key, value] of Object.entries(args)) {
          const placeholder = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
          body = body.replace(placeholder, JSON.stringify(value));
        }
      }
      
      // Make request
      const response = await fetch(url, {
        method,
        headers,
        body,
        redirect: toolConfig.followRedirects ? 'follow' : 'manual',
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      // Parse response
      let data: any;
      
      if (toolConfig.parseResponse) {
        const contentType = response.headers.get('content-type');
        if (contentType?.includes('application/json')) {
          data = await response.json();
        } else if (contentType?.includes('text/')) {
          data = await response.text();
        } else {
          data = await response.text();
        }
      } else {
        data = await response.text();
      }
      
      // Apply custom transform
      if (toolConfig.responseTransform) {
        const transformFunc = new Function(
          'response', 'args', 'msg',
          `'use strict';
          return (() => {
            ${toolConfig.responseTransform}
          })();`
        );
        
        data = transformFunc(data, args, msg);
      }
      
      return {
        success: true,
        result: data,
      };
      
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
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
    icon: '🌐',
    color: '#3498DB',
    colorLight: '#5DADE2',
    paletteLabel: 'HTTP Tool',
    label: (node: any) => node.name || node.toolName || 'HTTP Tool',
    isConfigNode: true,
    
    info: `
      <h3>HTTP Tool</h3>
      <p>Make HTTP requests to external APIs with parameter substitution.</p>
      
      <h4>URL Parameter Substitution:</h4>
      <p>Use <code>{{parameterName}}</code> in URLs:</p>
      <pre>https://api.weather.com/forecast?city={{city}}&units={{units}}</pre>
      
      <h4>Body Template:</h4>
      <p>For POST/PUT requests, use JSON template:</p>
      <pre>{"query": "{{query}}", "limit": {{limit}}}</pre>
      
      <h4>Response Transform:</h4>
      <p>Optional JavaScript to transform API response:</p>
      <pre>return response.data.items;</pre>
    `,
    
    properties: [
      {
        name: 'name',
        label: 'Tool Name',
        type: 'text',
        required: true,
        placeholder: 'Weather API',
        description: 'Friendly name for this tool',
      },
      {
        name: 'toolName',
        label: 'Function Name',
        type: 'text',
        required: true,
        pattern: '^[a-zA-Z0-9_-]+$',
        placeholder: 'get_weather',
        description: 'Tool identifier (alphanumeric, underscores, hyphens)',
      },
      {
        name: 'toolDescription',
        label: 'Description',
        type: 'textarea',
        rows: 3,
        required: true,
        placeholder: 'Get current weather for a city',
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
            query: {
              type: 'string',
              description: 'Search query',
            },
          },
          required: ['query'],
        },
        description: 'JSON Schema defining API parameters',
      },
      {
        name: 'httpMethod',
        label: 'HTTP Method',
        type: 'select',
        options: [
          { value: 'GET', label: 'GET' },
          { value: 'POST', label: 'POST' },
          { value: 'PUT', label: 'PUT' },
          { value: 'PATCH', label: 'PATCH' },
          { value: 'DELETE', label: 'DELETE' },
          { value: 'HEAD', label: 'HEAD' },
          { value: 'OPTIONS', label: 'OPTIONS' },
        ],
        default: 'GET',
        required: true,
      },
      {
        name: 'httpUrl',
        label: 'URL',
        type: 'url',
        required: true,
        placeholder: 'https://api.example.com/endpoint?param={{value}}',
        description: 'API endpoint (use {{param}} for substitution)',
      },
      {
        name: 'httpHeaders',
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
        placeholder: '{"query": "{{query}}", "limit": {{limit}}}',
        description: 'Request body template (use {{param}})',
      },
      {
        name: 'responseTransform',
        label: 'Response Transform (Optional)',
        type: 'code',
        language: 'javascript',
        rows: 6,
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
        name: 'followRedirects',
        label: 'Follow Redirects',
        type: 'checkbox',
        default: true,
        description: 'Automatically follow HTTP redirects',
      },
      {
        name: 'parseResponse',
        label: 'Parse Response',
        type: 'checkbox',
        default: true,
        description: 'Automatically parse JSON responses',
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
ToolRegistry.register(httpToolDefinition);
