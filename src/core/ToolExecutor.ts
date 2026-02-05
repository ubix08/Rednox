// ===================================================================
// ToolExecutor - Unified Tool Execution Engine
// ===================================================================

import { NodeMessage, ExecutionContext, ToolConfig } from '../types/core';
import { ToolCall } from '../providers/base';
import { RED } from '../utils';

export class ToolExecutor {
  /**
   * Execute a tool call using its configuration
   */
  static async execute(
    toolCall: ToolCall,
    toolConfig: ToolConfig,
    msg: NodeMessage,
    context: ExecutionContext
  ): Promise<any> {
    
    console.log(`[ToolExecutor] Executing tool: ${toolCall.function.name}`);
    
    switch (toolConfig.toolType) {
      case 'function':
        return await this.executeFunction(toolCall, toolConfig, msg, context);
      
      case 'http':
        return await this.executeHTTP(toolCall, toolConfig, msg, context);
      
      case 'openapi':
        return await this.executeOpenAPI(toolCall, toolConfig, msg, context);
      
      default:
        throw new Error(`Unknown tool type: ${toolConfig.toolType}`);
    }
  }
  
  /**
   * Execute function-based tool
   */
  private static async executeFunction(
    toolCall: ToolCall,
    toolConfig: ToolConfig,
    msg: NodeMessage,
    context: ExecutionContext
  ): Promise<any> {
    try {
      const args = JSON.parse(toolCall.function.arguments);
      
      const func = new Function(
        'args', 'msg', 'node', 'context', 'flow', 'global', 'RED',
        `'use strict';
        return (async () => {
          ${toolConfig.functionCode}
        })();`
      );
      
      const result = await func(
        args,
        msg,
        { id: toolConfig.id, name: toolConfig.name }, // Mock node
        context,
        context.flow,
        context.global,
        RED
      );
      
      return result;
      
    } catch (error: any) {
      console.error(`[ToolExecutor] Function tool error:`, error);
      throw new Error(`Function tool execution failed: ${error.message}`);
    }
  }
  
  /**
   * Execute HTTP-based tool
   */
  private static async executeHTTP(
    toolCall: ToolCall,
    toolConfig: ToolConfig,
    msg: NodeMessage,
    context: ExecutionContext
  ): Promise<any> {
    try {
      const args = JSON.parse(toolCall.function.arguments);
      
      // Replace URL parameters
      let url = toolConfig.httpUrl || '';
      for (const [key, value] of Object.entries(args)) {
        const placeholder = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
        url = url.replace(placeholder, encodeURIComponent(String(value)));
      }
      
      // Replace header values
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...toolConfig.httpHeaders
      };
      
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
      
      // Make request with timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(
        () => controller.abort(),
        toolConfig.timeout || 30000
      );
      
      try {
        const response = await fetch(url, {
          method,
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
        
        // Apply custom transform if provided
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
        
        return data;
        
      } catch (fetchError: any) {
        clearTimeout(timeoutId);
        
        if (fetchError.name === 'AbortError') {
          throw new Error(`Request timeout after ${toolConfig.timeout}ms`);
        }
        throw fetchError;
      }
      
    } catch (error: any) {
      console.error(`[ToolExecutor] HTTP tool error:`, error);
      throw new Error(`HTTP tool execution failed: ${error.message}`);
    }
  }
  
  /**
   * Execute OpenAPI-based tool
   */
  private static async executeOpenAPI(
    toolCall: ToolCall,
    toolConfig: ToolConfig,
    msg: NodeMessage,
    context: ExecutionContext
  ): Promise<any> {
    try {
      const args = JSON.parse(toolCall.function.arguments);
      
      // Fetch OpenAPI spec
      const spec = await this.fetchOpenAPISpec(toolConfig.openApiSpec!);
      
      // Find the operation that matches the tool call
      const operation = this.findOperation(spec, toolCall.function.name);
      
      if (!operation) {
        throw new Error(`Operation not found in OpenAPI spec: ${toolCall.function.name}`);
      }
      
      // Execute the operation
      return await this.executeOpenAPIOperation(
        operation,
        toolConfig.openApiBaseUrl || spec.servers?.[0]?.url || '',
        args
      );
      
    } catch (error: any) {
      console.error(`[ToolExecutor] OpenAPI tool error:`, error);
      throw new Error(`OpenAPI tool execution failed: ${error.message}`);
    }
  }
  
  /**
   * Fetch and parse OpenAPI specification
   */
  private static async fetchOpenAPISpec(specUrl: string): Promise<any> {
    const response = await fetch(specUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch OpenAPI spec: ${response.statusText}`);
    }
    
    const contentType = response.headers.get('content-type');
    if (contentType?.includes('yaml') || specUrl.endsWith('.yaml') || specUrl.endsWith('.yml')) {
      // For YAML, we'd need a YAML parser
      // For now, assume JSON or convert
      const text = await response.text();
      // Simple YAML to JSON conversion (very basic)
      // In production, use a proper YAML parser
      return JSON.parse(text);
    }
    
    return await response.json();
  }
  
  /**
   * Find operation in OpenAPI spec by operation ID or path
   */
  private static findOperation(spec: any, operationId: string): any {
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
  
  /**
   * Execute an OpenAPI operation
   */
  private static async executeOpenAPIOperation(
    operation: any,
    baseUrl: string,
    args: any
  ): Promise<any> {
    let url = baseUrl + operation.path;
    const method = operation.method.toUpperCase();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
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
}
