// ===================================================================
// Tool Utilities - Schema Validation & Conversion
// ===================================================================

import { ToolDefinition } from '../providers/base';

export interface ToolSchema {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, {
      type: string;
      description?: string;
      enum?: string[];
      items?: any;
    }>;
    required?: string[];
  };
}

export class ToolSchemaValidator {
  static validate(schema: ToolSchema): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Validate name
    if (!schema.name || typeof schema.name !== 'string') {
      errors.push('Tool name is required and must be a string');
    } else if (!/^[a-zA-Z0-9_-]+$/.test(schema.name)) {
      errors.push('Tool name must contain only alphanumeric characters, underscores, and hyphens');
    }

    // Validate description
    if (!schema.description || typeof schema.description !== 'string') {
      errors.push('Tool description is required and must be a string');
    }

    // Validate parameters
    if (!schema.parameters || schema.parameters.type !== 'object') {
      errors.push('Parameters must be an object with type "object"');
    } else {
      if (!schema.parameters.properties || typeof schema.parameters.properties !== 'object') {
        errors.push('Parameters must have a "properties" object');
      } else {
        // Validate each parameter
        for (const [paramName, paramSchema] of Object.entries(schema.parameters.properties)) {
          if (!paramSchema.type) {
            errors.push(`Parameter "${paramName}" must have a "type" field`);
          }

          const validTypes = ['string', 'number', 'integer', 'boolean', 'array', 'object'];
          if (paramSchema.type && !validTypes.includes(paramSchema.type)) {
            errors.push(`Parameter "${paramName}" has invalid type: ${paramSchema.type}`);
          }

          if (paramSchema.type === 'array' && !paramSchema.items) {
            errors.push(`Parameter "${paramName}" is an array but missing "items" definition`);
          }
        }
      }

      // Validate required array
      if (schema.parameters.required) {
        if (!Array.isArray(schema.parameters.required)) {
          errors.push('Parameters "required" field must be an array');
        } else {
          for (const requiredParam of schema.parameters.required) {
            if (!(requiredParam in schema.parameters.properties)) {
              errors.push(`Required parameter "${requiredParam}" not found in properties`);
            }
          }
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  static createToolDefinition(schema: ToolSchema): ToolDefinition {
    return {
      type: 'function',
      function: {
        name: schema.name,
        description: schema.description,
        parameters: schema.parameters,
      },
    };
  }
}

export class ToolArgumentsParser {
  static parse(argsString: string): any {
    try {
      return JSON.parse(argsString);
    } catch (error) {
      throw new Error(`Failed to parse tool arguments: ${error}`);
    }
  }

  static validate(args: any, schema: ToolSchema): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (typeof args !== 'object' || args === null) {
      errors.push('Arguments must be an object');
      return { valid: false, errors };
    }

    // Check required parameters
    if (schema.parameters.required) {
      for (const requiredParam of schema.parameters.required) {
        if (!(requiredParam in args)) {
          errors.push(`Missing required parameter: ${requiredParam}`);
        }
      }
    }

    // Validate parameter types
    for (const [paramName, value] of Object.entries(args)) {
      const paramSchema = schema.parameters.properties[paramName];
      
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
  }
}

export class ToolResponseFormatter {
  static format(result: any, error?: Error): string {
    if (error) {
      return JSON.stringify({
        success: false,
        error: error.message,
        stack: error.stack,
      });
    }

    return JSON.stringify({
      success: true,
      result,
    });
  }

  static parse(response: string): { success: boolean; result?: any; error?: string } {
    try {
      return JSON.parse(response);
    } catch (error) {
      return {
        success: false,
        error: 'Failed to parse tool response',
      };
    }
  }
}

// Helper to create common tool schemas
export class ToolSchemaBuilder {
  private schema: ToolSchema;

  constructor(name: string, description: string) {
    this.schema = {
      name,
      description,
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    };
  }

  addStringParam(name: string, description: string, required = false, enumValues?: string[]): this {
    this.schema.parameters.properties[name] = {
      type: 'string',
      description,
      ...(enumValues && { enum: enumValues }),
    };
    if (required) {
      this.schema.parameters.required!.push(name);
    }
    return this;
  }

  addNumberParam(name: string, description: string, required = false): this {
    this.schema.parameters.properties[name] = {
      type: 'number',
      description,
    };
    if (required) {
      this.schema.parameters.required!.push(name);
    }
    return this;
  }

  addIntegerParam(name: string, description: string, required = false): this {
    this.schema.parameters.properties[name] = {
      type: 'integer',
      description,
    };
    if (required) {
      this.schema.parameters.required!.push(name);
    }
    return this;
  }

  addBooleanParam(name: string, description: string, required = false): this {
    this.schema.parameters.properties[name] = {
      type: 'boolean',
      description,
    };
    if (required) {
      this.schema.parameters.required!.push(name);
    }
    return this;
  }

  addArrayParam(name: string, description: string, itemType: string, required = false): this {
    this.schema.parameters.properties[name] = {
      type: 'array',
      description,
      items: { type: itemType },
    };
    if (required) {
      this.schema.parameters.required!.push(name);
    }
    return this;
  }

  addObjectParam(name: string, description: string, properties: Record<string, any>, required = false): this {
    this.schema.parameters.properties[name] = {
      type: 'object',
      description,
      ...properties,
    };
    if (required) {
      this.schema.parameters.required!.push(name);
    }
    return this;
  }

  build(): ToolSchema {
    const validation = ToolSchemaValidator.validate(this.schema);
    if (!validation.valid) {
      throw new Error(`Invalid tool schema: ${validation.errors.join(', ')}`);
    }
    return this.schema;
  }
}
