
// ===================================================================
// RedNox - Enhanced Core Type Definitions
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
  _session?: any;
  _trace?: MessageTrace;
  [key: string]: any;
}

export interface MessageTrace {
  msgId: string;
  startTime: number;
  nodeExecutions: Array<{
    nodeId: string;
    nodeType: string;
    startTime: number;
    duration: number;
    status: 'success' | 'error';
    error?: string;
  }>;
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
  batchedStorage?: BatchedStorage;
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

export interface RuntimeNodeDefinition {
  type: string;
  category: string;
  color?: string;
  defaults: Record<string, any>;
  inputs: number;
  outputs: number;
  icon?: string;
  label?: string | ((this: Node) => string);
  
  execute: (msg: NodeMessage, node: Node, context: ExecutionContext) => Promise<NodeMessage | NodeMessage[] | NodeMessage[][] | null>;
  onInit?: (node: Node, context: ExecutionContext) => Promise<void>;
  onClose?: (node: Node, context: ExecutionContext) => Promise<void>;
}

export interface FlowConfig {
  id: string;
  name: string;
  description?: string;
  nodes: NodeConfig[];
  httpTriggers?: Array<{
    nodeId: string;
    path: string;
    method: string;
  }>;
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

export interface Env {
  DB: D1Database;
  FLOW_EXECUTOR: DurableObjectNamespace;
  RATE_LIMIT?: {
    requests: number;
    window: number;
  };
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface RouteCache {
  flowId: string;
  nodeId: string;
  flowConfig: FlowConfig;
  expiry: number;
}

export interface CircuitBreakerState {
  failures: number;
  lastFailure: number;
  state: 'closed' | 'open' | 'half-open';
}

// Batched Storage Interface
export interface BatchedStorage {
  get(key: string): Promise<any>;
  set(key: string, value: any): Promise<void>;
  delete(key: string): Promise<void>;
  flush(): Promise<void>;
}
