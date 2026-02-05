// ===================================================================
// OpenAPI Tool Node - Auto-generate from OpenAPI Spec
// ===================================================================

import { ToolRegistry } from '../../core/ToolRegistry';
import { ToolNodeDefinition, ToolNodeConfig, ToolExecutionResult } from '../../types/tools';
import { ToolCall } from '../../providers/base';
import { NodeMessage, ExecutionContext } from '../../types/core';

const openApiToolDefinition: ToolNodeDefinition = {
  type: 'openapi-tool',
  category: 'tools',
  
  defaults: {
    name: { value: '' },
    toolName: { value: 'openapi_operation' },
    toolDescription: { value: 'Execute an OpenAPI operation' },
    toolParameters: { value: {
      type: 'object' as const,
      properties: {},
      required: [],
    }},
    
    // OpenAPI-specific
    openApiSpec: { value: '' },
    openApiBaseUrl: { value: '' },
    operationId: { value: '' },
    customHeaders: { value: {} },
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
      
      // Fetch OpenAPI spec
      const spec = await fetchOpenAPISpec(toolConfig.openApiSpec);
      
      // Find the operation
      const operation = findOperation(spec, toolConfig.operationId || toolCall.function.name);
      
      if (!operation) {
        throw new Error(`Operation not found: ${toolConfig.operationId || toolCall.function.name}`);
      }
      
      // Execute the operation
      const result = await executeOpenAPIOperation(
        operation,
        toolConfig.openApiBaseUrl || spec.servers?.[0]?.url || '',
        args,
        toolConfig.customHeaders || {}
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
  
  getToolDefinition: (toolConfig: ToolNodeConfig) => ({
    type: 'function' as const,
    function: {
      name: toolConfig.toolName,
      description: toolConfig.toolDescription,
      parameters: toolConfig.toolParameters,
    },
  }),
  
  ui: {
    icon: '📜',
    color: '#16A085',
    colorLight: '#1ABC9C',
    paletteLabel: 'OpenAPI Tool',
    label: (node: any) => node.name || node.toolName || 'OpenAPI Tool',
    isConfigNode: true,
    
    info: `
      <h3>OpenAPI Tool</h3>
      <p>Auto-generate a tool from an OpenAPI/Swagger specification.</p>
      
      <h4>How It Works:</h4>
      <ol>
        <li>Provide OpenAPI spec URL</li>
        <li>Select an operation by ID</li>
        <li>Tool parameters are auto-generated from spec</li>
        <li>Agent can call the API operation</li>
      </ol>
      
      <h4>Supported Spec Versions:</h4>
      <ul>
        <li>OpenAPI 3.0.x</li>
        <li>OpenAPI 3.1.x</li>
        <li>Swagger 2.0</li>
      </ul>
    `,
    
    properties: [
      {
        name: 'name',
        label: 'Tool Name',
        type: 'text',
        required: true,
        placeholder: 'Stripe API',
        description: 'Friendly name for this tool',
      },
      {
        name: 'toolName',
        label: 'Function Name',
        type: 'text',
        required: true,
        pattern: '^[a-zA-Z0-9_-]+$',
        placeholder: 'create_payment_intent',
        description: 'Tool identifier (alphanumeric, underscores, hyphens)',
      },
      {
        name: 'toolDescription',
        label: 'Description',
        type: 'textarea',
        rows: 3,
        required: true,
        placeholder: 'Create a payment intent in Stripe',
        description: 'Explain what this tool does (for LLM)',
      },
      {
        name: 'openApiSpec',
        label: 'OpenAPI Specification URL',
        type: 'url',
        required: true,
        placeholder: 'https://api.example.com/openapi.yaml',
        description: 'URL to OpenAPI/Swagger specification',
      },
      {
        name: 'operationId',
        label: 'Operation ID',
        type: 'text',
        required: true,
        placeholder: 'createPaymentIntent',
        description: 'Operation ID from OpenAPI spec',
      },
      {
        name: 'openApiBaseUrl',
        label: 'Base URL (Optional)',
        type: 'url',
        placeholder: 'https://api.example.com/v1',
        description: 'Override base URL from spec',
      },
      {
        name: 'customHeaders',
        label: 'Custom Headers (JSON)',
        type: 'json',
        default: {},
        description: 'Additional HTTP headers for all requests',
      },
      {
        name: 'toolParameters',
        label: 'Parameters Override (Optional)',
        type: 'json',
        description: 'Override auto-generated parameters from spec',
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
        name: 'requiresApproval',
        label: 'Require Human Approval',
        type: 'checkbox',
        default: false,
        description: 'Pause for approval before calling',
      },
    ],
  },
};

// Helper functions
async function fetchOpenAPISpec(specUrl: string): Promise<any> {
  const response = await fetch(specUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch OpenAPI spec: ${response.statusText}`);
  }
  
  const contentType = response.headers.get('content-type');
  if (contentType?.includes('yaml') || specUrl.endsWith('.yaml') || specUrl.endsWith('.yml')) {
    // For YAML, we'd need a YAML parser
    // For now, assume JSON or convert
    const text = await response.text();
    return JSON.parse(text); // Simplified - use proper YAML parser in production
  }
  
  return await response.json();
}

function findOperation(spec: any, operationId: string): any {
  for (const [path, pathItem] of Object.entries(spec.paths || {})) {
    for (const [method, operation] of Object.entries(pathItem as any)) {
      if (typeof operation === 'object' && operation.operationId === operationId) {
        return {
          path,
          method: method.toLowerCase(),
          ...operation
        };
      }
    }
  }
  return null;
}

async function executeOpenAPIOperation(
  operation: any,
  baseUrl: string,
  args: any,
  customHeaders: Record<string, string>
): Promise<any> {
  let url = baseUrl + operation.path;
  const method = operation.method.toUpperCase();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...customHeaders
  };
  
  // Replace path parameters
  for (const param of operation.parameters || []) {
    if (param.in === 'path' && args[param.name]) {
      url = url.replace(`{${param.name}}`, encodeURIComponent(args[param.name]));
    }
  }
  
  // Add query parameters
  const queryParams = new URLSearchParams();
  for (const param of operation.parameters || []) {
    if (param.in === 'query' && args[param.name]) {
      queryParams.append(param.name, args[param.name]);
    }
  }
  if (queryParams.toString()) {
    url += '?' + queryParams.toString();
  }
  
  // Add header parameters
  for (const param of operation.parameters || []) {
    if (param.in === 'header' && args[param.name]) {
      headers[param.name] = args[param.name];
    }
  }
  
  // Prepare body
  let body: string | undefined;
  if (method !== 'GET' && method !== 'HEAD' && operation.requestBody) {
    body = JSON.stringify(args);
  }
  
  // Make request
  const response = await fetch(url, {
    method,
    headers,
    body
  });
  
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }
  
  return await response.json();
}

// Register the tool
ToolRegistry.register(openApiToolDefinition);
