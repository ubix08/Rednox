// script.js
const API_BASE = window.location.origin;
let editor;
let currentFlow = null;
let nodeIdCounter = 1;
let flows = [];

// Node Templates
const nodeTemplates = {
  'http-in': { icon: '🌐', name: 'HTTP In', category: 'Input', color: '#6366f1', desc: 'HTTP endpoint', inputs: 0, outputs: 1 },
  'http-response': { icon: '📤', name: 'HTTP Response', category: 'Output', color: '#10b981', desc: 'Send response', inputs: 1, outputs: 0 },
  'http-request': { icon: '🔗', name: 'HTTP Request', category: 'Function', color: '#f59e0b', desc: 'HTTP call', inputs: 1, outputs: 1 },
  'function': { icon: '⚡', name: 'Function', category: 'Function', color: '#f59e0b', desc: 'JavaScript code', inputs: 1, outputs: 1 },
  'inject': { icon: '💉', name: 'Inject', category: 'Input', color: '#6366f1', desc: 'Trigger', inputs: 0, outputs: 1 },
  'debug': { icon: '🐛', name: 'Debug', category: 'Output', color: '#10b981', desc: 'Log output', inputs: 1, outputs: 0 },
  'switch': { icon: '🔀', name: 'Switch', category: 'Function', color: '#f59e0b', desc: 'Route by rules', inputs: 1, outputs: 3 },
  'change': { icon: '✏️', name: 'Change', category: 'Function', color: '#f59e0b', desc: 'Modify message', inputs: 1, outputs: 1 },
  'template': { icon: '📝', name: 'Template', category: 'Function', color: '#f59e0b', desc: 'Templating', inputs: 1, outputs: 1 },
  'json': { icon: '{ }', name: 'JSON', category: 'Parser', color: '#f59e0b', desc: 'Parse JSON', inputs: 1, outputs: 1 },
  'delay': { icon: '⏱️', name: 'Delay', category: 'Function', color: '#f59e0b', desc: 'Delay flow', inputs: 1, outputs: 1 },
  'split': { icon: '✂️', name: 'Split', category: 'Sequence', color: '#f59e0b', desc: 'Split parts', inputs: 1, outputs: 1 },
  'join': { icon: '🔗', name: 'Join', category: 'Sequence', color: '#f59e0b', desc: 'Join parts', inputs: 1, outputs: 1 },
  'context': { icon: '💾', name: 'Context', category: 'Storage', color: '#6366f1', desc: 'Storage', inputs: 1, outputs: 1 },
  'catch': { icon: '⚠️', name: 'Catch', category: 'Input', color: '#6366f1', desc: 'Error handler', inputs: 0, outputs: 1 }
};

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  loadFlows();
  renderNodePalette();
});

// Load Flows
async function loadFlows() {
  try {
    const response = await fetch(`${API_BASE}/admin/flows`);
    const data = await response.json();
    flows = data.flows || [];
    renderFlowsList();
  } catch (err) {
    console.error('Load error:', err);
    document.getElementById('flowsContainer').innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">⚠️</div>
        <h3>Failed to load flows</h3>
        <p style="margin-top: 0.5rem; font-size: 0.875rem;">${err.message}</p>
      </div>
    `;
  }
}

// Render Flows List
function renderFlowsList() {
  const container = document.getElementById('flowsContainer');
  
  if (flows.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📦</div>
        <h3>No flows yet</h3>
        <p style="margin-top: 0.5rem; font-size: 0.875rem;">Create your first flow to get started</p>
      </div>
    `;
    return;
  }

  container.innerHTML = flows.map(flow => {
    const config = typeof flow.config === 'string' ? JSON.parse(flow.config) : flow.config;
    const nodeCount = config?.nodes?.length || 0;
    
    return `
      <div class="flow-card">
        <div class="flow-header">
          <div class="flow-info">
            <div class="flow-name">
              <span>${flow.name}</span>
              <span class="badge ${flow.enabled ? 'badge-success' : 'badge-danger'}">
                ${flow.enabled ? '● Active' : '○ Disabled'}
              </span>
            </div>
            \( {flow.description ? `<div class="flow-desc"> \){flow.description}</div>` : ''}
            <div class="flow-meta">
              <span>🔷 ${nodeCount} nodes</span>
              <span>🆔 ${flow.id}</span>
            </div>
          </div>
        </div>
        <div class="flow-actions">
          <button class="action-btn primary" onclick="openFlowCanvas('${flow.id}')">
            <span>📊</span>
            <span>Open</span>
          </button>
          <button class="action-btn" onclick="duplicateFlow('${flow.id}')">
            <span>📋</span>
            <span>Copy</span>
          </button>
          <button class="action-btn \( {flow.enabled ? '' : 'primary'}" onclick="toggleFlowEnabled(' \){flow.id}', ${!flow.enabled})">
            <span>${flow.enabled ? '⏸' : '▶'}</span>
            <span>${flow.enabled ? 'Disable' : 'Enable'}</span>
          </button>
          <button class="action-btn danger" onclick="deleteFlow('${flow.id}')">
            <span>🗑</span>
            <span>Delete</span>
          </button>
        </div>
      </div>
    `;
  }).join('');
}

// Show Flows List
function showFlowsList() {
  document.getElementById('flowsView').classList.add('active');
  document.getElementById('canvasView').classList.remove('active');
  document.getElementById('backBtn').style.display = 'none';
  document.getElementById('flowTitle').textContent = '';
  document.getElementById('headerActions').innerHTML = `
    <button class="btn btn-primary" onclick="showNewFlowModal()">
      <span>+</span>
      <span class="btn-text">New</span>
    </button>
  `;
  closeProperties();
  closeNodePalette();
  currentFlow = null;
}

// Open Flow Canvas
async function openFlowCanvas(flowId) {
  try {
    const response = await fetch(`\( {API_BASE}/admin/flows/ \){flowId}`);
    const data = await response.json();
    
    currentFlow = data;
    document.getElementById('flowsView').classList.remove('active');
    document.getElementById('canvasView').classList.add('active');
    document.getElementById('backBtn').style.display = 'flex';
    document.getElementById('flowTitle').textContent = data.name;
    document.getElementById('headerActions').innerHTML = `
      <button class="btn btn-success" onclick="saveFlow()">
        <span>💾</span>
        <span class="btn-text">Save</span>
      </button>
    `;
    
    if (!editor) {
      initDrawflow();
    }
    
    importFlow(data);
  } catch (err) {
    console.error('Load flow error:', err);
    showToast('Failed to load flow', 'error');
  }
}

// Initialize Drawflow
function initDrawflow() {
  const container = document.getElementById('drawflow');
  editor = new Drawflow(container);
  editor.reroute = true;
  editor.start();

  editor.on('nodeSelected', (id) => {
    showNodeProperties(id);
  });

  editor.on('nodeUnselected', () => {
    closeProperties();
  });
}

// Render Node Palette
function renderNodePalette() {
  const palette = document.getElementById('nodePaletteContent');
  const categories = {};

  for (const [type, template] of Object.entries(nodeTemplates)) {
    if (!categories[template.category]) {
      categories[template.category] = [];
    }
    categories[template.category].push({ type, ...template });
  }

  let html = '';
  for (const [category, nodes] of Object.entries(categories)) {
    html += `<div class="node-category">`;
    html += `<div class="category-title">${category}</div>`;
    html += `<div class="node-grid">`;
    for (const node of nodes) {
      html += `
        <div class="node-item" onclick="addNodeToCanvas('${node.type}')">
          <div class="node-item-icon" style="background: \( {node.color}"> \){node.icon}</div>
          <div class="node-item-name">${node.name}</div>
          <div class="node-item-desc">${node.desc}</div>
        </div>
      `;
    }
    html += `</div></div>`;
  }

  palette.innerHTML = html;
}

// Show/Hide Node Palette
function showNodePalette() {
  document.getElementById('nodePalette').classList.add('active');
}

function closeNodePalette() {
  document.getElementById('nodePalette').classList.remove('active');
}

// Get Node HTML
function getNodeHTML(type, data) {
  const template = nodeTemplates[type];
  if (!template) return '';

  return `
    <div class="node-bubble" style="background: ${template.color}">
      <div class="node-icon">${template.icon}</div>
    </div>
    <div class="node-name">${data.name || template.name}</div>
  `;
}

// Add Node to Canvas
function addNodeToCanvas(type) {
  const template = nodeTemplates[type];
  if (!template) return;

  const data = {
    type,
    name: template.name,
    config: getDefaultConfig(type)
  };

  const html = getNodeHTML(type, data);

  const pos_x = 150 + (nodeIdCounter * 20);
  const pos_y = 100 + (nodeIdCounter * 20);

  const nodeId = `\( {type}- \){nodeIdCounter}`;
  editor.addNode(nodeId, template.inputs, template.outputs, pos_x, pos_y, '', data, html);
  nodeIdCounter++;
  
  closeNodePalette();
  showToast(`${template.name} added`, 'success');
}

// Default Config
function getDefaultConfig(type) {
  const configs = {
    'http-in': { method: 'post', url: '/endpoint' },
    'http-request': { method: 'GET', url: '', timeout: 30000 },
    'function': { func: 'return msg;', outputs: 1 },
    'delay': { timeout: 1000, timeoutUnits: 'milliseconds' },
    'inject': { payload: '', payloadType: 'date' },
    'template': { template: '', syntax: 'mustache' },
    'switch': { property: 'payload', rules: [] },
    'change': { rules: [] },
    'context': { operation: 'get', scope: 'flow', key: '' }
  };
  return configs[type] || {};
}

// Show Node Properties
function showNodeProperties(id) {
  const panel = document.getElementById('propertiesPanel');
  const content = document.getElementById('propertiesContent');
  
  const node = editor.getNodeFromId(id);
  if (!node) return;

  panel.classList.add('active');
  
  let html = `
    <div class="form-group">
      <label class="form-label">Node Name</label>
      <input type="text" class="form-input" id="nodeName" value="\( {node.data.name || ''}" onchange="updateNodeProperty(' \){id}', 'name', this.value)">
    </div>
  `;

  html += renderNodeFields(node.data.type, node.data.config || {}, id);
  
  html += `
    <div style="margin-top: 1.5rem; padding-top: 1.5rem; border-top: 1px solid var(--border);">
      <button class="btn btn-danger" style="width: 100%;" onclick="deleteNode('${id}')">
        🗑 Delete Node
      </button>
    </div>
  `;

  content.innerHTML = html;
}

function renderNodeFields(type, config, nodeId) {
  switch (type) {
    case 'http-in':
      return `
        <div class="form-group">
          <label class="form-label">URL Path</label>
          <input type="text" class="form-input" value="\( {config.url || ''}" onchange="updateNodeConfig(' \){nodeId}', 'url', this.value)">
        </div>
        <div class="form-group">
          <label class="form-label">Method</label>
          <select class="form-select" onchange="updateNodeConfig('${nodeId}', 'method', this.value)">
            <option value="get" ${config.method === 'get' ? 'selected' : ''}>GET</option>
            <option value="post" ${config.method === 'post' ? 'selected' : ''}>POST</option>
            <option value="put" ${config.method === 'put' ? 'selected' : ''}>PUT</option>
            <option value="delete" ${config.method === 'delete' ? 'selected' : ''}>DELETE</option>
          </select>
        </div>
      `;
    case 'http-request':
      return `
        <div class="form-group">
          <label class="form-label">URL</label>
          <input type="text" class="form-input" value="\( {config.url || ''}" onchange="updateNodeConfig(' \){nodeId}', 'url', this.value)">
        </div>
        <div class="form-group">
          <label class="form-label">Method</label>
          <select class="form-select" onchange="updateNodeConfig('${nodeId}', 'method', this.value)">
            <option value="GET" ${config.method === 'GET' ? 'selected' : ''}>GET</option>
            <option value="POST" ${config.method === 'POST' ? 'selected' : ''}>POST</option>
            <option value="PUT" ${config.method === 'PUT' ? 'selected' : ''}>PUT</option>
            <option value="DELETE" ${config.method === 'DELETE' ? 'selected' : ''}>DELETE</option>
          </select>
        </div>
      `;
    case 'function':
      return `
        <div class="form-group">
          <label class="form-label">Function Code</label>
          <textarea class="form-textarea" style="min-height: 200px;" onchange="updateNodeConfig('\( {nodeId}', 'func', this.value)"> \){config.func || 'return msg;'}</textarea>
        </div>
      `;
    case 'delay':
      return `
        <div class="form-group">
          <label class="form-label">Delay</label>
          <input type="number" class="form-input" value="\( {config.timeout || 1000}" onchange="updateNodeConfig(' \){nodeId}', 'timeout', parseInt(this.value))">
        </div>
        <div class="form-group">
          <label class="form-label">Units</label>
          <select class="form-select" onchange="updateNodeConfig('${nodeId}', 'timeoutUnits', this.value)">
            <option value="milliseconds" ${config.timeoutUnits === 'milliseconds' ? 'selected' : ''}>Milliseconds</option>
            <option value="seconds" ${config.timeoutUnits === 'seconds' ? 'selected' : ''}>Seconds</option>
            <option value="minutes" ${config.timeoutUnits === 'minutes' ? 'selected' : ''}>Minutes</option>
          </select>
        </div>
      `;
    case 'template':
      return `
        <div class="form-group">
          <label class="form-label">Template</label>
          <textarea class="form-textarea" onchange="updateNodeConfig('\( {nodeId}', 'template', this.value)"> \){config.template || ''}</textarea>
        </div>
      `;
    case 'inject':
      return `
        <div class="form-group">
          <label class="form-label">Payload Type</label>
          <select class="form-select" onchange="updateNodeConfig('${nodeId}', 'payloadType', this.value)">
            <option value="date" ${config.payloadType === 'date' ? 'selected' : ''}>Timestamp</option>
            <option value="str" ${config.payloadType === 'str' ? 'selected' : ''}>String</option>
            <option value="num" ${config.payloadType === 'num' ? 'selected' : ''}>Number</option>
            <option value="json" ${config.payloadType === 'json' ? 'selected' : ''}>JSON</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Payload</label>
          <input type="text" class="form-input" value="\( {config.payload || ''}" onchange="updateNodeConfig(' \){nodeId}', 'payload', this.value)">
        </div>
      `;
    case 'context':
      return `
        <div class="form-group">
          <label class="form-label">Operation</label>
          <select class="form-select" onchange="updateNodeConfig('${nodeId}', 'operation', this.value)">
            <option value="get" ${config.operation === 'get' ? 'selected' : ''}>Get</option>
            <option value="set" ${config.operation === 'set' ? 'selected' : ''}>Set</option>
            <option value="keys" ${config.operation === 'keys' ? 'selected' : ''}>List Keys</option>
            <option value="delete" ${config.operation === 'delete' ? 'selected' : ''}>Delete</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Scope</label>
          <select class="form-select" onchange="updateNodeConfig('${nodeId}', 'scope', this.value)">
            <option value="flow" ${config.scope === 'flow' ? 'selected' : ''}>Flow</option>
            <option value="global" ${config.scope === 'global' ? 'selected' : ''}>Global</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Key</label>
          <input type="text" class="form-input" value="\( {config.key || ''}" onchange="updateNodeConfig(' \){nodeId}', 'key', this.value)">
        </div>
      `;
    default:
      return '<p style="color: var(--text-muted); text-align: center; padding: 1rem;">No additional properties</p>';
  }
}

function closeProperties() {
  document.getElementById('propertiesPanel').classList.remove('active');
}

// Update Node Property
function updateNodeProperty(id, key, value) {
  const node = editor.getNodeFromId(id);
  if (!node) return;
  
  node.data[key] = value;
  editor.updateNodeDataFromId(id, node.data);
  updateNodeUI(id);
}

// Update Node Config
function updateNodeConfig(id, key, value) {
  const node = editor.getNodeFromId(id);
  if (!node) return;
  
  if (!node.data.config) node.data.config = {};
  node.data.config[key] = value;
  editor.updateNodeDataFromId(id, node.data);
  // Optionally update UI if config affects display
}

// Update Node UI
function updateNodeUI(id) {
  const nodeInfo = editor.drawflow.drawflow.Home.data[id];
  if (!nodeInfo) return;

  const pos_x = nodeInfo.pos.x;
  const pos_y = nodeInfo.pos.y;
  const data = nodeInfo.data;
  const type = data.type;
  const html = getNodeHTML(type, data);
  const inputsNumber = Object.keys(nodeInfo.inputs).length;
  const outputsNumber = Object.keys(nodeInfo.outputs).length;
  const className = nodeInfo.class;

  // Collect output connections
  const outputConnections = [];
  for (const outKey in nodeInfo.outputs) {
    nodeInfo.outputs[outKey].connections.forEach(conn => {
      outputConnections.push({
        fromOut: outKey,
        to: conn.node,
        toIn: conn.input
      });
    });
  }

  // Collect input connections
  const inputConnections = [];
  for (const inKey in nodeInfo.inputs) {
    nodeInfo.inputs[inKey].connections.forEach(conn => {
      inputConnections.push({
        from: conn.node,
        fromOut: conn.output,
        toIn: inKey
      });
    });
  }

  // Remove node
  editor.removeNodeId(id);

  // Add node back
  editor.addNode(id, inputsNumber, outputsNumber, pos_x, pos_y, className, data, html);

  // Re-add output connections
  outputConnections.forEach(conn => {
    editor.addConnection(id, conn.to, conn.fromOut, conn.toIn);
  });

  // Re-add input connections
  inputConnections.forEach(conn => {
    editor.addConnection(conn.from, id, conn.fromOut, conn.toIn);
  });
}

function deleteNode(id) {
  if (!confirm('Delete this node?')) return;
  editor.removeNodeId(id);
  closeProperties();
  showToast('Node deleted', 'success');
}

// Export Flow
function exportFlow() {
  const drawflowData = editor.export();
  const nodes = [];

  for (const [id, node] of Object.entries(drawflowData.drawflow.Home.data)) {
    const nodeData = {
      id: id,
      type: node.data.type,
      name: node.data.name || nodeTemplates[node.data.type]?.name,
      ...node.data.config,
      x: node.pos.x,
      y: node.pos.y,
      wires: []
    };

    const outputs = [];
    for (let i = 0; i < Object.keys(node.outputs || {}).length; i++) {
      outputs.push([]);
    }

    for (const [outputKey, output] of Object.entries(node.outputs || {})) {
      const index = parseInt(outputKey.split('_')[1]) - 1;
      outputs[index] = output.connections.map(conn => conn.node);
    }

    nodeData.wires = outputs;

    nodes.push(nodeData);
  }

  return {
    id: currentFlow?.id || document.getElementById('flowId').value || 'new-flow',
    name: currentFlow?.name || document.getElementById('flowName').value || 'New Flow',
    description: currentFlow?.description || document.getElementById('flowDesc').value || '',
    version: '1.0.0',
    nodes
  };
}

// Import Flow
function importFlow(flow) {
  if (!editor) return;
  
  editor.clear();

  const config = typeof flow.config === 'string' ? JSON.parse(flow.config) : flow.config;

  config.nodes.forEach(node => {
    const template = nodeTemplates[node.type];
    if (!template) return;

    const data = {
      type: node.type,
      name: node.name,
      config: { ...node }
    };

    const html = getNodeHTML(node.type, data);

    const inputs = template.inputs;
    const outputs = template.outputs;

    editor.addNode(node.id, inputs, outputs, node.x || 100, node.y || 100, '', data, html);
  });

  config.nodes.forEach(node => {
    node.wires.forEach((wireGroup, index) => {
      wireGroup.forEach(targetId => {
        editor.addConnection(node.id, targetId, `output_${index + 1}`, 'input_1');
      });
    });
  });

  showToast(`Flow loaded`, 'success');
}

// Save Flow
async function saveFlow() {
  const flowData = exportFlow();

  if (!flowData.id || !flowData.name) {
    showSettings();
    showToast('Set flow ID and name first', 'error');
    return;
  }

  try {
    const method = currentFlow ? 'PUT' : 'POST';
    const url = currentFlow 
      ? `\( {API_BASE}/admin/flows/ \){currentFlow.id}`
      : `${API_BASE}/admin/flows`;

    const response = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(flowData)
    });

    const data = await response.json();

    if (data.success) {
      currentFlow = flowData;
      showToast('Flow saved', 'success');
      
      if (data.endpoints && data.endpoints.length > 0) {
        console.log('Endpoints:', data.endpoints);
      }
    } else {
      showToast(data.error || 'Save failed', 'error');
    }
  } catch (err) {
    console.error('Save error:', err);
    showToast('Error saving flow', 'error');
  }
}

// Validate Flow
function validateFlow() {
  const flowData = exportFlow();
  const issues = [];

  if (flowData.nodes.length === 0) {
    issues.push('No nodes');
  }

  const httpInNodes = flowData.nodes.filter(n => n.type === 'http-in');
  if (httpInNodes.length === 0) {
    issues.push('No HTTP triggers');
  }

  if (issues.length === 0) {
    showToast('✓ Flow is valid', 'success');
  } else {
    showToast(`Issues: ${issues.join(', ')}`, 'error');
  }
}

// Flow Operations
function showNewFlowModal() {
  document.getElementById('newFlowModal').classList.add('active');
}

async function createNewFlow() {
  const id = document.getElementById('newFlowId').value.trim();
  const name = document.getElementById('newFlowName').value.trim();
  const description = document.getElementById('newFlowDesc').value.trim();
  
  if (!id || !name) {
    showToast('ID and Name required', 'error');
    return;
  }
  
  const flowConfig = { id, name, description, nodes: [] };
  
  try {
    const response = await fetch(`${API_BASE}/admin/flows`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(flowConfig)
    });
    
    const data = await response.json();
    
    if (data.success) {
      closeModal('newFlowModal');
      showToast('Flow created', 'success');
      await loadFlows();
      openFlowCanvas(id);
    } else {
      showToast(data.error || 'Failed', 'error');
    }
  } catch (err) {
    showToast('Error creating flow', 'error');
  }
}

async function duplicateFlow(flowId) {
  const flow = flows.find(f => f.id === flowId);
  if (!flow) return;
  
  try {
    const response = await fetch(`\( {API_BASE}/admin/flows/ \){flowId}`);
    const data = await response.json();
    
    const newId = flow.id + '-copy-' + Date.now();
    const newFlow = {
      ...data,
      id: newId,
      name: flow.name + ' (Copy)'
    };
    
    const createResponse = await fetch(`${API_BASE}/admin/flows`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newFlow)
    });
    
    if (createResponse.ok) {
      showToast('Flow duplicated', 'success');
      loadFlows();
    }
  } catch (err) {
    showToast('Duplication failed', 'error');
  }
}

async function toggleFlowEnabled(flowId, enable) {
  try {
    const action = enable ? 'enable' : 'disable';
    const response = await fetch(`\( {API_BASE}/admin/flows/ \){flowId}/${action}`, {
      method: 'POST'
    });
    
    if (response.ok) {
      showToast(`Flow ${action}d`, 'success');
      loadFlows();
    }
  } catch (err) {
    showToast('Toggle failed', 'error');
  }
}

async function deleteFlow(flowId) {
  const flow = flows.find(f => f.id === flowId);
  if (!confirm(`Delete "${flow?.name}"?`)) return;
  
  try {
    const response = await fetch(`\( {API_BASE}/admin/flows/ \){flowId}`, {
      method: 'DELETE'
    });
    
    if (response.ok) {
      showToast('Flow deleted', 'success');
      loadFlows();
    }
  } catch (err) {
    showToast('Delete failed', 'error');
  }
}

// Settings
function showSettings() {
  const modal = document.getElementById('settingsModal');
  
  if (currentFlow) {
    document.getElementById('flowId').value = currentFlow.id;
    document.getElementById('flowName').value = currentFlow.name;
    document.getElementById('flowDesc').value = currentFlow.description || '';
  }
  
  modal.classList.add('active');
}

function saveSettings() {
  const id = document.getElementById('flowId').value;
  const name = document.getElementById('flowName').value;
  const description = document.getElementById('flowDesc').value;

  if (!id || !name) {
    showToast('ID and Name required', 'error');
    return;
  }

  if (!currentFlow) {
    currentFlow = { id, name, description };
  } else {
    currentFlow.id = id;
    currentFlow.name = name;
    currentFlow.description = description;
  }

  document.getElementById('flowTitle').textContent = name;
  closeModal('settingsModal');
  showToast('Settings updated', 'success');
}

// Modal
function closeModal(id) {
  document.getElementById(id).classList.remove('active');
}

// Toast
function showToast(message, type = 'info') {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();

  const icons = { success: '✓', error: '✕', info: 'ℹ' };

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <div class="toast-icon">${icons[type] || 'ℹ'}</div>
    <div class="toast-message">${message}</div>
  `;

  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 's' && currentFlow) {
    e.preventDefault();
    saveFlow();
  }
});

// Prevent zoom on mobile
document.addEventListener('gesturestart', e => e.preventDefault());
document.addEventListener('gesturechange', e => e.preventDefault());
