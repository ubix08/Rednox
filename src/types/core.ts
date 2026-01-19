// core.ts
// ===================================================================
// RedNox - Pure Node-RED Compatible Types (EPHEMERAL)
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
  | 'checkbox' 
  | 'textarea' 
  | 'code' 
  | 'json'
  | 'color'
  | 'url'
  | 'email';

export interface NodePropertyField {
  name: string;
  label: string;
  type: PropertyFieldType;
  default?: any;
  required?: boolean;
  placeholder?: string;
  description?: string;
  options?: Array<{ value: string; label: string }> | string[];
  min?: number;
  max?: number;
  step?: number;
  rows?: number;
  language?: string;
  pattern?: string;
  validate?: string;
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

// ===================================================================
// Inject Node Schedule
// ===================================================================

export interface InjectSchedule {
  nodeId: string;
  flowId: string;
  repeat: boolean;
  cron?: string;
  interval?: number;
  nextRun?: number;
}

// ===================================================================
// DEBUG EXECUTION TYPES (Frontend-only storage)
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
// CLEAN DATABASE SCHEMA (No execution logs)
// ===================================================================

export const D1_SCHEMA_STATEMENTS = [
  // Flows table - stores flow definitions only
  `CREATE TABLE IF NOT EXISTS flows (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    config TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  
  `CREATE INDEX IF NOT EXISTS idx_flows_enabled ON flows(enabled)`,
  
  // HTTP routes - maps URLs to flow entry points
  `CREATE TABLE IF NOT EXISTS http_routes (
    id TEXT PRIMARY KEY,
    flow_id TEXT NOT NULL,
    node_id TEXT NOT NULL,
    path TEXT NOT NULL,
    method TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    FOREIGN KEY (flow_id) REFERENCES flows(id) ON DELETE CASCADE,
    UNIQUE(path, method)
  )`,
  
  `CREATE INDEX IF NOT EXISTS idx_http_routes_lookup ON http_routes(path, method, enabled)`
];
