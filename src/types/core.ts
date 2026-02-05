// core.ts
// ===================================================================
// RedNox - Pure Node-RED Compatible Types (EPHEMERAL) - REFACTORED
// ===================================================================

export interface NodeMessage {
  _msgid: string;
  topic?: string;
  payload?: any;
  parts?: MessageParts;
  error?: {
    message: string;
    source: { id: string; type: string; name?: string };
    stack?: string;
  };
  _httpResponse?: {
    statusCode: number;
    headers: Record<string, string>;
    payload: any;
  };
  conversationId?: string;
  previousContext?: any;
  toolCall?: {
    id: string;
    name: string;
    arguments: any;
  };
  toolResult?: any;
  _toolCall?: any;
  [key: string]: any;
}

export interface MessageParts {
  id: string;
  index: number;
  count: number;
  type?: string;
  ch?: string;
  key?: string;
}

export interface NodeStatus {
  fill?: 'red' | 'green' | 'yellow' | 'blue' | 'grey';
  shape?: 'ring' | 'dot';
  text?: string;
}

export interface ExecutionContext {
  storage: DurableObjectStorage;
  env: Env;
  flow: FlowContext;
  global: GlobalContext;
  flowEngine?: any;
  debugMode?: boolean;
  trace?: ExecutionTrace;
  conversationId?: string;
  previousContext?: ExecutionContextData;
}

export interface FlowContext {
  get(key: string): Promise<any>;
  set(key: string, value: any): Promise<void>;
  keys(): Promise<string[]>;
}

export interface GlobalContext {
  get(key: string): Promise<any>;
  set(key: string, value: any): Promise<void>;
  keys(): Promise<string[]>;
}

export interface NodeConfig {
  id: string;
  type: string;
  name?: string;
  wires: string[][];
  isConfigNode?: boolean; // NEW: Mark config nodes
  [key: string]: any;
}

export type NodeDone = (err?: Error) => void;
export type NodeSend = (msg: NodeMessage | NodeMessage[] | NodeMessage[][]) => void;

export interface Node {
  id: string;
  type: string;
  name?: string;
  config: NodeConfig;
  
  send(msg: NodeMessage | NodeMessage[] | NodeMessage[][]): void;
  status(status: NodeStatus): void;
  error(err: string | Error, msg?: NodeMessage): void;
  warn(warning: string): void;
  log(msg: string): void;
  context(): NodeContext;
  on(event: string, callback: Function): void;
  once(event: string, callback: Function): void;
  removeListener(event: string, callback: Function): void;
  emit(event: string, ...args: any[]): void;
  done(): void;
}

export interface NodeContext {
  flow: FlowContext;
  global: GlobalContext;
  get(key: string): Promise<any>;
  set(key: string, value: any): Promise<void>;
  keys(): Promise<string[]>;
}

// ===================================================================
// UI Metadata Types
// ===================================================================

export type PropertyFieldType = 
  | 'text' 
  | 'number' 
  | 'select' 
  | 'multiselect' // NEW
  | 'checkbox' 
  | 'textarea' 
  | 'code' 
  | 'json'
  | 'color'
  | 'url'
  | 'email'
  | 'password';

export interface NodePropertyField {
  name: string;
  label: string;
  type: PropertyFieldType;
  default?: any;
  required?: boolean;
  placeholder?: string;
  description?: string;
  options?: Array<{ value: string; label: string; description?: string }> | string[];
  min?: number;
  max?: number;
  step?: number;
  rows?: number;
  language?: string;
  pattern?: string;
  validate?: string;
  loadOptions?: string; // NEW: Async options loader
  show?: Record<string, any>; // Conditional visibility
}

export interface NodeUIMetadata {
  icon: string;
  color: string;
  colorLight?: string;
  paletteLabel?: string;
  label?: string | ((node: NodeConfig) => string);
  labelStyle?: string | ((node: NodeConfig) => string);
  properties?: NodePropertyField[];
  info?: string;
  align?: 'left' | 'right';
  button?: {
    enabled: boolean;
    onclick?: string;
  };
  isConfigNode?: boolean; // NEW: Hide from canvas
}

export interface RuntimeNodeDefinition {
  type: string;
  category: string;
  defaults: Record<string, any>;
  inputs: number;
  outputs: number;
  
  execute: (msg: NodeMessage, node: Node, context: ExecutionContext) => Promise<NodeMessage | NodeMessage[] | NodeMessage[][] | null>;
  onInit?: (node: Node, context: ExecutionContext) => Promise<void>;
  onClose?: (node: Node, context: ExecutionContext) => Promise<void>;
  
  ui?: NodeUIMetadata;
}

// ===================================================================
// API Response Types
// ===================================================================

export interface NodeDescriptor {
  type: string;
  category: string;
  inputs: number;
  outputs: number;
  defaults: Record<string, any>;
  ui: NodeUIMetadata;
}

export interface NodesDiscoveryResponse {
  nodes: NodeDescriptor[];
  count: number;
  version: string;
}

// ===================================================================
// Flow Configuration
// ===================================================================

export interface FlowConfig {
  id: string;
  name: string;
  description?: string;
  version?: string;
  nodes: NodeConfig[];
}

export interface FlowRecord {
  id: string;
  name: string;
  description?: string;
  config: string;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface HttpRoute {
  id: string;
  flow_id: string;
  node_id: string;
  path: string;
  method: string;
  enabled: boolean;
}

export interface Env {
  DB: D1Database;
  FLOW_EXECUTOR: DurableObjectNamespace;
  R2_BUCKET?: R2Bucket;
  OPENAI_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  GEMINI_API_KEY?: string;
  GOOGLE_SEARCH_API_KEY?: string;
  GOOGLE_SEARCH_CX?: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface RouteInfo {
  flowId: string;
  nodeId: string;
  flowConfig: FlowConfig;
}

export interface InjectSchedule {
  nodeId: string;
  flowId: string;
  repeat: boolean;
  cron?: string;
  interval?: number;
  nextRun?: number;
}

// ===================================================================
// DEBUG EXECUTION TYPES
// ===================================================================

export interface NodeExecutionTrace {
  nodeId: string;
  nodeType: string;
  nodeName?: string;
  startTime: number;
  endTime: number;
  duration: number;
  input: NodeMessage;
  output: NodeMessage | NodeMessage[] | NodeMessage[][] | null;
  status: 'success' | 'error' | 'skipped';
  error?: string;
  stack?: string;
  statusUpdates: NodeStatus[];
}

export interface ExecutionTrace {
  traces: NodeExecutionTrace[];
  addTrace(trace: NodeExecutionTrace): void;
  getTraces(): NodeExecutionTrace[];
}

export interface DebugExecutionResult {
  success: boolean;
  executionId: string;
  flowId: string;
  flowName: string;
  startTime: string;
  endTime: string;
  duration: number;
  entryNodeId: string;
  trace: NodeExecutionTrace[];
  finalOutput: any;
  errors: Array<{
    nodeId: string;
    message: string;
    stack?: string;
  }>;
  metadata: {
    totalNodes: number;
    executedNodes: number;
    skippedNodes: number;
    errorNodes: number;
  };
}

// ===================================================================
// Persistent Context Types
// ===================================================================

export interface PersistentContextConfig {
  maxExecutionsPerFlow: number;
  maxContextsPerConversation: number;
  cleanupOnWrite: boolean;
}

export interface ExecutionContextData {
  input: any;
  output: any;
  duration: number;
  timestamp: string;
  [key: string]: any;
}

// ===================================================================
// CONFIG NODE TYPES (NEW)
// ===================================================================

export interface LLMProviderConfig {
  id: string;
  type: 'llm-provider-config';
  name: string;
  provider: 'openai' | 'anthropic' | 'gemini' | 'groq' | 'custom';
  model: string;
  apiKey: string;
  baseUrl?: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  topK?: number;
  defaultSystemPrompt?: string;
  isConfigNode: true;
}

export interface ToolConfig {
  id: string;
  type: 'tool-config';
  name: string;
  toolType: 'function' | 'http' | 'openapi';
  
  // Common
  toolName: string;
  toolDescription: string;
  toolParameters: any;
  requiresApproval?: boolean;
  
  // Function tool
  functionCode?: string;
  
  // HTTP tool
  httpMethod?: string;
  httpUrl?: string;
  httpHeaders?: Record<string, string>;
  httpQueryParams?: Record<string, string>;
  bodyTemplate?: string;
  responseTransform?: string;
  timeout?: number;
  
  // OpenAPI tool
  openApiSpec?: string;
  openApiBaseUrl?: string;
  
  isConfigNode: true;
}

export interface MemoryConfig {
  id: string;
  type: 'memory-config';
  name: string;
  memoryType: 'conversation-buffer' | 'window-buffer' | 'summary-buffer';
  
  // Conversation buffer
  maxMessages?: number;
  
  // Window buffer
  windowSize?: number;
  
  // Summary buffer
  summaryModel?: string; // LLM provider config ID
  maxTokenLimit?: number;
  
  // Common
  storageScope: 'conversation' | 'flow' | 'global';
  ttl?: number;
  
  isConfigNode: true;
}

export interface KnowledgeConfig {
  id: string;
  type: 'knowledge-config';
  name: string;
  knowledgeType: 'vector-store' | 'document-store';
  
  // Vector store
  vectorStoreProvider?: string;
  embeddingModel?: string;
  collectionName?: string;
  
  // Document store
  documentStoreId?: string;
  
  // Common
  description: string;
  topK?: number;
  scoreThreshold?: number;
  returnSourceDocuments?: boolean;
  
  isConfigNode: true;
}
