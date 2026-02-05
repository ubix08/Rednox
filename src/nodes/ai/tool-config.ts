// ===================================================================
// Tool Config Node - Universal Tool Configuration
// ===================================================================

import { registry } from '../../core/NodeRegistry';
import { NodeMessage } from '../../types/core';

registry.register('tool-config', {
  type: 'tool-config',
  category: 'config',
  defaults: {
    name: { value: '' },
    toolType: { value: 'function' },
    
    // Common
    toolName: { value: 'my_tool' },
    toolDescription: { value: 'Performs a custom operation' },
    toolParameters: { value: {
      type: 'object',
      properties: {
        input: {
          type: 'string',
          description: 'Input value',
        },
      },
      required: ['input'],
    }},
    requiresApproval: { value: false },
    
    // Function tool
    functionCode: { value: `// Available variables:
// - args: Tool arguments (object)
// - msg: Current message
// - context: Execution context
// - flow: Flow context
// - global: Global context

// Return your result:
return {
  result: args.input.toUpperCase(),
  success: true
};` },
    
    // HTTP tool
    httpMethod: { value: 'GET' },
    httpUrl: { value: '' },
    httpHeaders: { value: {} },
    httpQueryParams: { value: {} },
    bodyTemplate: { value: '' },
    responseTransform: { value: '' },
    timeout: { value: 30000 },
    
    // OpenAPI tool
    openApiSpec: { value: '' },
    openApiBaseUrl: { value: '' },
  },
  inputs: 0,
  outputs: 0,
  
  execute: async (msg: NodeMessage) => null,
  
  ui: {
    icon: '🔧',
    color: '#F39C12',
    colorLight: '#F5B041',
    paletteLabel: 'Tool',
    label: (node) => node.name || node.toolName || 'Tool',
    isConfigNode: true,
    
    info: `
      <h3>Tool Configuration</h3>
      <p>Configure a tool that agents can use during execution.</p>
      
      <h4>Tool Types:</h4>
      <ul>
        <li><strong>Function</strong> - Execute custom JavaScript code</li>
        <li><strong>HTTP</strong> - Call external APIs with parameter substitution</li>
        <li><strong>OpenAPI</strong> - Auto-generate tools from OpenAPI specification</li>
      </ul>
      
      <h4>Function Tool:</h4>
      <p>Write JavaScript code that executes when the tool is called.</p>
      <pre>
return {
  sum: args.numbers.reduce((a, b) => a + b, 0),
  count: args.numbers.length
};
      </pre>
      
      <h4>HTTP Tool:</h4>
      <p>Use <code>{{parameter}}</code> syntax for dynamic values:</p>
      <pre>
URL: https://api.example.com/users/{{userId}}/posts
Body: {"title": "{{title}}", "content": "{{content}}"}
      </pre>
      
      <h4>OpenAPI Tool:</h4>
      <p>Provide an OpenAPI/Swagger specification URL to auto-generate tools.</p>
    `,
    
    properties: [
      {
        name: 'name',
        label: 'Config Name',
        type: 'text',
        required: true,
        placeholder: 'My Calculator Tool',
        description: 'Friendly name for this tool configuration',
      },
      {
        name: 'toolType',
        label: 'Tool Type',
        type: 'select',
        required: true,
        options: [
          { value: 'function', label: 'Function (Code)', description: 'Execute custom JavaScript' },
          { value: 'http', label: 'HTTP Request', description: 'Call external API' },
          { value: 'openapi', label: 'OpenAPI Spec', description: 'Auto-generate from OpenAPI' },
        ],
        default: 'function',
      },
      {
        name: 'toolName',
        label: 'Tool Name',
        type: 'text',
        required: true,
        pattern: '^[a-zA-Z0-9_-]+$',
        placeholder: 'calculate_sum',
        description: 'Tool identifier (alphanumeric, underscores, hyphens)',
      },
      {
        name: 'toolDescription',
        label: 'Tool Description',
        type: 'textarea',
        rows: 3,
        required: true,
        placeholder: 'Calculates the sum of an array of numbers',
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
        description: 'JSON Schema defining tool parameters',
      },
      {
        name: 'requiresApproval',
        label: 'Require Human Approval',
        type: 'checkbox',
        default: false,
        description: 'Pause execution for human approval before calling this tool',
      },
      
      // Function Tool Properties
      {
        name: 'functionCode',
        label: 'Function Code',
        type: 'code',
        language: 'javascript',
        rows: 12,
        required: true,
        show: { toolType: 'function' },
        description: 'JavaScript code to execute',
      },
      
      // HTTP Tool Properties
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
        ],
        default: 'GET',
        show: { toolType: 'http' },
      },
      {
        name: 'httpUrl',
        label: 'URL',
        type: 'url',
        required: true,
        placeholder: 'https://api.example.com/endpoint?param={{value}}',
        show: { toolType: 'http' },
        description: 'API endpoint (use {{param}} for substitution)',
      },
      {
        name: 'httpHeaders',
        label: 'Headers (JSON)',
        type: 'json',
        default: {},
        show: { toolType: 'http' },
        description: 'HTTP headers (use {{param}} for substitution)',
      },
      {
        name: 'bodyTemplate',
        label: 'Body Template (for POST/PUT)',
        type: 'code',
        language: 'json',
        rows: 6,
        placeholder: '{"query": "{{query}}", "limit": {{limit}}}',
        show: { toolType: 'http' },
        description: 'Request body template (use {{param}})',
      },
      {
        name: 'responseTransform',
        label: 'Response Transform (Optional)',
        type: 'code',
        language: 'javascript',
        rows: 6,
        placeholder: 'return response.data;',
        show: { toolType: 'http' },
        description: 'Transform API response',
      },
      {
        name: 'timeout',
        label: 'Timeout (ms)',
        type: 'number',
        default: 30000,
        min: 1000,
        max: 300000,
        show: { toolType: 'http' },
        description: 'Request timeout in milliseconds',
      },
      
      // OpenAPI Tool Properties
      {
        name: 'openApiSpec',
        label: 'OpenAPI Specification URL',
        type: 'url',
        required: true,
        placeholder: 'https://api.example.com/openapi.yaml',
        show: { toolType: 'openapi' },
        description: 'URL to OpenAPI/Swagger specification',
      },
      {
        name: 'openApiBaseUrl',
        label: 'Base URL (Optional)',
        type: 'url',
        placeholder: 'https://api.example.com/v1',
        show: { toolType: 'openapi' },
        description: 'Override base URL from spec',
      },
    ],
  },
});
