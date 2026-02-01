// ===================================================================
// RedNox - Database Schema with Persistent Context
// ===================================================================

export const D1_SCHEMA = `
CREATE TABLE IF NOT EXISTS flows (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  config TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_flows_enabled ON flows(enabled);

CREATE TABLE IF NOT EXISTS http_routes (
  id TEXT PRIMARY KEY,
  flow_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  path TEXT NOT NULL,
  method TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  FOREIGN KEY (flow_id) REFERENCES flows(id) ON DELETE CASCADE,
  UNIQUE(path, method)
);

CREATE INDEX IF NOT EXISTS idx_http_routes_lookup ON http_routes(path, method, enabled);

CREATE TABLE IF NOT EXISTS execution_contexts (
  id TEXT PRIMARY KEY,
  flow_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  context_data TEXT NOT NULL,
  executed_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (flow_id) REFERENCES flows(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_execution_contexts_flow ON execution_contexts(flow_id, conversation_id, executed_at DESC);

CREATE TABLE IF NOT EXISTS flow_context_store (
  flow_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (flow_id, key),
  FOREIGN KEY (flow_id) REFERENCES flows(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_flow_context_flow ON flow_context_store(flow_id);
`;

export const D1_SCHEMA_STATEMENTS = [
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
  
  `CREATE INDEX IF NOT EXISTS idx_http_routes_lookup ON http_routes(path, method, enabled)`,
  
  `CREATE TABLE IF NOT EXISTS execution_contexts (
    id TEXT PRIMARY KEY,
    flow_id TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    context_data TEXT NOT NULL,
    executed_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (flow_id) REFERENCES flows(id) ON DELETE CASCADE
  )`,
  
  `CREATE INDEX IF NOT EXISTS idx_execution_contexts_flow ON execution_contexts(flow_id, conversation_id, executed_at DESC)`,
  
  `CREATE TABLE IF NOT EXISTS flow_context_store (
    flow_id TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (flow_id, key),
    FOREIGN KEY (flow_id) REFERENCES flows(id) ON DELETE CASCADE
  )`,
  
  `CREATE INDEX IF NOT EXISTS idx_flow_context_flow ON flow_context_store(flow_id)`
];
