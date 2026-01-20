// ===================================================================
// RedNox Admin UI - Main Application
// Professional Node-RED-like Flow Editor with LiteGraph.js
// ===================================================================

(function() {
  'use strict';

  // ===== Configuration =====
  const CONFIG = {
    apiUrl: '/admin',
    autoSave: false,
    showGrid: true,
    theme: 'dark'
  };

  // ===== State Management =====
  const STATE = {
    flows: [],
    currentFlow: null,
    currentFlowId: null,
    nodes: {},
    graph: null,
    selectedNode: null,
    modified: false,
    settings: { ...CONFIG }
  };

  // ===== API Service =====
  const API = {
    async request(endpoint, options = {}) {
      const url = `${CONFIG.apiUrl}${endpoint}`;
      try {
        const response = await fetch(url, {
          ...options,
          headers: {
            'Content-Type': 'application/json',
            ...options.headers
          }
        });
        
        if (!response.ok) {
          const error = await response.json().catch(() => ({}));
          throw new Error(error.error || `HTTP ${response.status}`);
        }
        
        return await response.json();
      } catch (error) {
        console.error('API Error:', error);
        throw error;
      }
    },

    init() {
      return this.request('/init', { method: 'POST' });
    },

    getFlows() {
      return this.request('/flows');
    },

    getFlow(id) {
      return this.request(`/flows/${id}`);
    },

    createFlow(data) {
      return this.request('/flows', {
        method: 'POST',
        body: JSON.stringify(data)
      });
    },

    updateFlow(id, data) {
      return this.request(`/flows/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data)
      });
    },

    deleteFlow(id) {
      return this.request(`/flows/${id}`, { method: 'DELETE' });
    },

    getNodes() {
      return this.request('/nodes');
    },

    debugExecute(flowId, nodeId, payload = {}) {
      return this.request(`/flows/${flowId}/debug-execute`, {
        method: 'POST',
        body: JSON.stringify({ nodeId, payload })
      });
    },

    exportFlow(id) {
      return this.request(`/flows/${id}/export`);
    },

    importFlow(data) {
      return this.request('/flows/import', {
        method: 'POST',
        body: JSON.stringify(data)
      });
    }
  };

  // ===== UI Utilities =====
  const UI = {
    showLoading() {
      document.getElementById('loading-screen').style.display = 'flex';
      document.getElementById('app').style.display = 'none';
    },

    hideLoading() {
      document.getElementById('loading-screen').style.display = 'none';
      document.getElementById('app').style.display = 'flex';
    },

    showToast(message, type = 'info', duration = 3000) {
      const container = document.getElementById('toastContainer');
      const toast = document.createElement('div');
      toast.className = `toast ${type}`;
      
      const icons = {
        info: 'ℹ️',
        success: '✅',
        warning: '⚠️',
        error: '❌'
      };
      
      toast.innerHTML = `
        <div class="toast-icon">${icons[type]}</div>
        <div class="toast-content">
          <div class="toast-message">${message}</div>
        </div>
      `;
      
      container.appendChild(toast);
      
      setTimeout(() => {
        toast.style.animation = 'slideIn 0.3s ease reverse';
        setTimeout(() => toast.remove(), 300);
      }, duration);
    },

    openModal(modalId) {
      const modal = document.getElementById(modalId);
      if (modal) {
        modal.classList.add('active');
      }
    },

    closeModal(modalId) {
      const modal = document.getElementById(modalId);
      if (modal) {
        modal.classList.remove('active');
      }
    },

    toggleSidebar() {
      document.getElementById('sidebar').classList.toggle('open');
    },

    togglePalette() {
      document.getElementById('nodePalette').classList.toggle('hidden');
    },

    toggleProperties() {
      document.getElementById('propertiesPanel').classList.toggle('hidden');
    },

    setFlowStatus(status) {
      const statusEl = document.getElementById('flowStatus');
      statusEl.className = `flow-status ${status}`;
    },

    setModified(modified) {
      STATE.modified = modified;
      this.setFlowStatus(modified ? 'modified' : 'active');
      document.getElementById('saveBtn').disabled = !modified;
    },

    updateFlowInfo(flow) {
      if (flow) {
        document.getElementById('currentFlowName').textContent = flow.name;
        this.setFlowStatus('active');
        document.getElementById('saveBtn').disabled = false;
        document.getElementById('deployBtn').disabled = false;
      } else {
        document.getElementById('currentFlowName').textContent = 'No Flow Selected';
        this.setFlowStatus('');
        document.getElementById('saveBtn').disabled = true;
        document.getElementById('deployBtn').disabled = true;
      }
    },

    renderFlowList(flows) {
      const container = document.getElementById('flowList');
      
      if (!flows || flows.length === 0) {
        container.innerHTML = `
          <div class="empty-state">
            <p>No flows yet</p>
            <small>Click "New" to create your first flow</small>
          </div>
        `;
        return;
      }
      
      container.innerHTML = flows.map(flow => `
        <div class="flow-item ${STATE.currentFlowId === flow.id ? 'active' : ''}" 
             data-flow-id="${flow.id}">
          <div class="flow-item-header">
            <div class="flow-item-name">${flow.name}</div>
            <div class="flow-item-actions">
              <button class="btn btn-sm btn-icon" data-action="export" title="Export">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                  <polyline points="17 8 12 3 7 8"></polyline>
                  <line x1="12" y1="3" x2="12" y2="15"></line>
                </svg>
              </button>
              <button class="btn btn-sm btn-icon" data-action="delete" title="Delete">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="3 6 5 6 21 6"></polyline>
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                </svg>
              </button>
            </div>
          </div>
          ${flow.description ? `<div class="flow-item-description">${flow.description}</div>` : ''}
          <div class="flow-item-meta">
            <span class="flow-item-badge ${flow.enabled ? 'enabled' : 'disabled'}">
              ${flow.enabled ? '● Enabled' : '○ Disabled'}
            </span>
            <span>${new Date(flow.updated_at).toLocaleDateString()}</span>
          </div>
        </div>
      `).join('');
      
      // Add click handlers
      container.querySelectorAll('.flow-item').forEach(item => {
        const flowId = item.dataset.flowId;
        
        item.addEventListener('click', (e) => {
          if (!e.target.closest('[data-action]')) {
            FlowManager.loadFlow(flowId);
          }
        });
        
        item.querySelector('[data-action="export"]')?.addEventListener('click', (e) => {
          e.stopPropagation();
          FlowManager.exportFlow(flowId);
        });
        
        item.querySelector('[data-action="delete"]')?.addEventListener('click', (e) => {
          e.stopPropagation();
          if (confirm('Are you sure you want to delete this flow?')) {
            FlowManager.deleteFlow(flowId);
          }
        });
      });
    },

    renderNodePalette(nodes) {
      const container = document.getElementById('paletteContent');
      
      if (!nodes || nodes.length === 0) {
        container.innerHTML = '<div class="palette-loading">No nodes available</div>';
        return;
      }
      
      // Group by category
      const categories = {};
      nodes.forEach(node => {
        if (!categories[node.category]) {
          categories[node.category] = [];
        }
        categories[node.category].push(node);
      });
      
      container.innerHTML = Object.entries(categories).map(([category, categoryNodes]) => `
        <div class="palette-category">
          <div class="palette-category-header">${category}</div>
          ${categoryNodes.map(node => `
            <div class="palette-node" data-node-type="${node.type}" draggable="true">
              <div class="palette-node-icon">${node.ui.icon}</div>
              <div class="palette-node-label">${node.ui.paletteLabel || node.type}</div>
            </div>
          `).join('')}
        </div>
      `).join('');
      
      // Add drag handlers
      container.querySelectorAll('.palette-node').forEach(node => {
        node.addEventListener('dragstart', (e) => {
          e.dataTransfer.setData('nodeType', node.dataset.nodeType);
        });
      });
    }
  };

  // ===== Flow Manager =====
  const FlowManager = {
    async loadFlows() {
      try {
        const data = await API.getFlows();
        STATE.flows = data.flows || [];
        UI.renderFlowList(STATE.flows);
      } catch (error) {
        UI.showToast('Failed to load flows: ' + error.message, 'error');
      }
    },

    async loadFlow(id) {
      try {
        UI.showLoading();
        const data = await API.getFlow(id);
        STATE.currentFlow = data;
        STATE.currentFlowId = id;
        
        // Parse config
        const config = typeof data.config === 'string' ? JSON.parse(data.config) : data.config;
        
        // Load into graph
        GraphManager.loadFlowConfig(config);
        
        UI.updateFlowInfo(data);
        UI.setModified(false);
        UI.renderFlowList(STATE.flows);
        
        // Close sidebar on mobile
        if (window.innerWidth < 768) {
          UI.toggleSidebar();
        }
      } catch (error) {
        UI.showToast('Failed to load flow: ' + error.message, 'error');
      } finally {
        UI.hideLoading();
      }
    },

    async createFlow(name, description) {
      try {
        const data = await API.createFlow({
          name,
          description,
          nodes: []
        });
        
        UI.showToast('Flow created successfully', 'success');
        await this.loadFlows();
        
        // Load the new flow
        if (data.flowId) {
          await this.loadFlow(data.flowId);
        }
      } catch (error) {
        UI.showToast('Failed to create flow: ' + error.message, 'error');
      }
    },

    async saveFlow() {
      if (!STATE.currentFlowId) {
        UI.showToast('No flow loaded', 'warning');
        return;
      }
      
      try {
        const flowConfig = GraphManager.exportFlowConfig();
        
        await API.updateFlow(STATE.currentFlowId, {
          name: STATE.currentFlow.name,
          description: STATE.currentFlow.description,
          nodes: flowConfig.nodes
        });
        
        UI.showToast('Flow saved successfully', 'success');
        UI.setModified(false);
        await this.loadFlows();
      } catch (error) {
        UI.showToast('Failed to save flow: ' + error.message, 'error');
      }
    },

    async deleteFlow(id) {
      try {
        await API.deleteFlow(id);
        UI.showToast('Flow deleted successfully', 'success');
        
        if (STATE.currentFlowId === id) {
          STATE.currentFlowId = null;
          STATE.currentFlow = null;
          GraphManager.clearGraph();
          UI.updateFlowInfo(null);
        }
        
        await this.loadFlows();
      } catch (error) {
        UI.showToast('Failed to delete flow: ' + error.message, 'error');
      }
    },

    async exportFlow(id) {
      try {
        const data = await API.exportFlow(id);
        const json = JSON.stringify(data, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${data.name || 'flow'}.json`;
        a.click();
        URL.revokeObjectURL(url);
        
        UI.showToast('Flow exported successfully', 'success');
      } catch (error) {
        UI.showToast('Failed to export flow: ' + error.message, 'error');
      }
    },

    async importFlow(json) {
      try {
        const data = JSON.parse(json);
        await API.importFlow(data);
        UI.showToast('Flow imported successfully', 'success');
        await this.loadFlows();
      } catch (error) {
        UI.showToast('Failed to import flow: ' + error.message, 'error');
      }
    },

    async debugExecute() {
      if (!STATE.currentFlowId) {
        UI.showToast('No flow loaded', 'warning');
        return;
      }
      
      // Find an http-in or inject node
      const flowConfig = GraphManager.exportFlowConfig();
      const entryNode = flowConfig.nodes.find(n => n.type === 'http-in' || n.type === 'inject');
      
      if (!entryNode) {
        UI.showToast('No entry node (http-in or inject) found', 'warning');
        return;
      }
      
      try {
        UI.showToast('Executing flow...', 'info');
        
        const result = await API.debugExecute(STATE.currentFlowId, entryNode.id, {
          test: true,
          timestamp: Date.now()
        });
        
        // Display results
        DebugManager.showExecutionTrace(result);
        UI.showToast('Flow executed successfully', 'success');
      } catch (error) {
        UI.showToast('Failed to execute flow: ' + error.message, 'error');
      }
    }
  };

  // ===== Graph Manager =====
  const GraphManager = {
    init() {
      const canvas = document.getElementById('flowCanvas');
      STATE.graph = new LGraph();
      
      const lgraphCanvas = new LGraphCanvas(canvas, STATE.graph);
      lgraphCanvas.background_image = null;
      
      // Configure
      lgraphCanvas.render_connections_shadows = false;
      lgraphCanvas.render_connections_border = false;
      
      // Handle changes
      STATE.graph.onAfterExecute = () => {
        UI.setModified(true);
      };
      
      STATE.graph.onNodeAdded = () => {
        UI.setModified(true);
      };
      
      STATE.graph.onNodeRemoved = () => {
        UI.setModified(true);
      };
      
      // Start
      STATE.graph.start();
      
      // Handle canvas drop
      canvas.addEventListener('dragover', (e) => {
        e.preventDefault();
      });
      
      canvas.addEventListener('drop', (e) => {
        e.preventDefault();
        const nodeType = e.dataTransfer.getData('nodeType');
        if (nodeType && STATE.nodes[nodeType]) {
          this.addNodeFromPalette(nodeType, e.clientX, e.clientY);
        }
      });
      
      return lgraphCanvas;
    },

    addNodeFromPalette(nodeType, x, y) {
      const nodeData = STATE.nodes[nodeType];
      if (!nodeData) return;
      
      const node = LiteGraph.createNode(nodeType);
      if (node) {
        const canvas = document.getElementById('flowCanvas');
        const rect = canvas.getBoundingClientRect();
        node.pos = [x - rect.left - 100, y - rect.top - 50];
        STATE.graph.add(node);
        UI.setModified(true);
      }
    },

    registerNodes(nodes) {
      nodes.forEach(nodeData => {
        const NodeClass = function() {
          this.title = nodeData.ui.paletteLabel || nodeData.type;
          this.size = [180, 60];
          
          // Add inputs
          for (let i = 0; i < nodeData.inputs; i++) {
            this.addInput(`in${i}`, 'flow');
          }
          
          // Add outputs
          for (let i = 0; i < nodeData.outputs; i++) {
            this.addOutput(`out${i}`, 'flow');
          }
          
          // Store config
          this.properties = { ...nodeData.defaults };
          this.nodeData = nodeData;
        };
        
        NodeClass.title = nodeData.ui.paletteLabel || nodeData.type;
        NodeClass.desc = nodeData.ui.info || '';
        
        LiteGraph.registerNodeType(nodeData.type, NodeClass);
        STATE.nodes[nodeData.type] = nodeData;
      });
    },

    loadFlowConfig(config) {
      STATE.graph.clear();
      
      if (!config || !config.nodes) return;
      
      const nodeMap = new Map();
      
      // Create nodes
      config.nodes.forEach(nodeConfig => {
        const node = LiteGraph.createNode(nodeConfig.type);
        if (node) {
          node.id = nodeConfig.id;
          node.title = nodeConfig.name || node.title;
          node.pos = nodeConfig.pos || [100, 100];
          node.size = nodeConfig.size || node.size;
          node.properties = { ...node.properties, ...nodeConfig };
          
          STATE.graph.add(node);
          nodeMap.set(nodeConfig.id, node);
        }
      });
      
      // Create connections
      config.nodes.forEach(nodeConfig => {
        const sourceNode = nodeMap.get(nodeConfig.id);
        if (!sourceNode || !nodeConfig.wires) return;
        
        nodeConfig.wires.forEach((outputWires, outputIndex) => {
          outputWires.forEach(targetNodeId => {
            const targetNode = nodeMap.get(targetNodeId);
            if (targetNode) {
              sourceNode.connect(outputIndex, targetNode, 0);
            }
          });
        });
      });
      
      STATE.graph.setDirtyCanvas(true, true);
    },

    exportFlowConfig() {
      const nodes = [];
      
      STATE.graph._nodes.forEach(node => {
        const wires = [];
        
        // Get connections for each output
        if (node.outputs) {
          node.outputs.forEach((output, i) => {
            const outputWires = [];
            if (output.links) {
              output.links.forEach(linkId => {
                const link = STATE.graph.links[linkId];
                if (link) {
                  outputWires.push(link.target_id);
                }
              });
            }
            wires.push(outputWires);
          });
        }
        
        nodes.push({
          id: node.id.toString(),
          type: node.type,
          name: node.title,
          pos: node.pos,
          size: node.size,
          wires,
          ...node.properties
        });
      });
      
      return { nodes };
    },

    clearGraph() {
      STATE.graph.clear();
    }
  };

  // ===== Debug Manager =====
  const DebugManager = {
    showExecutionTrace(result) {
      const traceViewer = document.getElementById('traceViewer');
      
      if (!result || !result.trace) {
        traceViewer.innerHTML = '<div class="empty-state"><p>No trace data</p></div>';
        return;
      }
      
      traceViewer.innerHTML = `
        <div style="padding: 16px;">
          <h4 style="margin-bottom: 12px;">Execution Summary</h4>
          <div style="margin-bottom: 16px; padding: 12px; background: var(--bg-tertiary); border-radius: 6px;">
            <div><strong>Flow:</strong> ${result.flowName}</div>
            <div><strong>Duration:</strong> ${result.duration}ms</div>
            <div><strong>Nodes Executed:</strong> ${result.metadata.executedNodes}/${result.metadata.totalNodes}</div>
            <div><strong>Errors:</strong> ${result.errors.length}</div>
          </div>
          
          <h4 style="margin-bottom: 12px;">Execution Trace</h4>
          ${result.trace.map((trace, i) => `
            <div style="margin-bottom: 8px; padding: 12px; background: var(--bg-tertiary); border-radius: 6px; border-left: 3px solid ${trace.status === 'error' ? 'var(--error)' : 'var(--success)'}">
              <div style="font-weight: 600; margin-bottom: 4px;">
                ${i + 1}. ${trace.nodeName || trace.nodeType} (${trace.duration}ms)
              </div>
              <div style="font-size: 12px; color: var(--text-secondary);">
                ${trace.nodeType} - ${trace.status}
              </div>
              ${trace.error ? `<div style="color: var(--error); font-size: 12px; margin-top: 4px;">${trace.error}</div>` : ''}
            </div>
          `).join('')}
        </div>
      `;
      
      // Switch to trace tab
      document.querySelector('[data-tab="trace"]').click();
    },

    log(message, type = 'info') {
      const container = document.getElementById('debugMessages');
      const msg = document.createElement('div');
      msg.className = `debug-message ${type}`;
      msg.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
      container.appendChild(msg);
      container.scrollTop = container.scrollHeight;
    },

    clear() {
      document.getElementById('debugMessages').innerHTML = '';
      document.getElementById('traceViewer').innerHTML = '';
      document.getElementById('outputViewer').innerHTML = '';
    }
  };

  // ===== Event Handlers =====
  function setupEventHandlers() {
    // Menu toggle
    document.getElementById('menuToggle').addEventListener('click', UI.toggleSidebar);
    
    // New flow
    document.getElementById('newFlowBtn').addEventListener('click', () => {
      UI.openModal('newFlowModal');
    });
    
    document.getElementById('createFlowBtn').addEventListener('click', () => {
      const name = document.getElementById('newFlowName').value.trim();
      const description = document.getElementById('newFlowDescription').value.trim();
      
      if (!name) {
        UI.showToast('Please enter a flow name', 'warning');
        return;
      }
      
      FlowManager.createFlow(name, description);
      UI.closeModal('newFlowModal');
      
      // Clear form
      document.getElementById('newFlowName').value = '';
      document.getElementById('newFlowDescription').value = '';
    });
    
    // Save flow
    document.getElementById('saveBtn').addEventListener('click', () => {
      FlowManager.saveFlow();
    });
    
    // Deploy (same as save for now)
    document.getElementById('deployBtn').addEventListener('click', () => {
      FlowManager.saveFlow();
    });
    
    // Debug execute
    document.getElementById('debugBtn').addEventListener('click', () => {
      FlowManager.debugExecute();
    });
    
    // Import flow
    document.getElementById('importBtn').addEventListener('click', () => {
      UI.openModal('importFlowModal');
    });
    
    document.querySelectorAll('input[name="importType"]').forEach(radio => {
      radio.addEventListener('change', (e) => {
        if (e.target.value === 'json') {
          document.getElementById('importJsonGroup').style.display = 'block';
          document.getElementById('importFileGroup').style.display = 'none';
        } else {
          document.getElementById('importJsonGroup').style.display = 'none';
          document.getElementById('importFileGroup').style.display = 'block';
        }
      });
    });
    
    document.getElementById('importFlowBtn').addEventListener('click', async () => {
      const type = document.querySelector('input[name="importType"]:checked').value;
      
      if (type === 'json') {
        const json = document.getElementById('importJson').value.trim();
        if (!json) {
          UI.showToast('Please enter flow JSON', 'warning');
          return;
        }
        await FlowManager.importFlow(json);
      } else {
        const file = document.getElementById('importFile').files[0];
        if (!file) {
          UI.showToast('Please select a file', 'warning');
          return;
        }
        const json = await file.text();
        await FlowManager.importFlow(json);
      }
      
      UI.closeModal('importFlowModal');
    });
    
    // Settings
    document.getElementById('settingsBtn').addEventListener('click', () => {
      UI.openModal('settingsModal');
    });
    
    // Toggle palette
    document.getElementById('togglePaletteBtn').addEventListener('click', UI.togglePalette);
    
    // Debug panel
    document.getElementById('clearDebugBtn').addEventListener('click', DebugManager.clear);
    
    document.getElementById('toggleDebugBtn').addEventListener('click', () => {
      document.getElementById('debugPanel').classList.toggle('minimized');
    });
    
    // Debug tabs
    document.querySelectorAll('.debug-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.debug-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.debug-tab-content').forEach(c => c.classList.remove('active'));
        
        tab.classList.add('active');
        document.querySelector(`.debug-tab-content[data-tab="${tab.dataset.tab}"]`).classList.add('active');
      });
    });
    
    // Modal close buttons
    document.querySelectorAll('.modal-close, [data-modal]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const modalId = btn.dataset.modal || btn.closest('.modal').id;
        if (modalId) {
          UI.closeModal(modalId);
        }
      });
    });
    
    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey || e.metaKey) {
        if (e.key === 's') {
          e.preventDefault();
          FlowManager.saveFlow();
        }
      }
    });
    
    // Palette search
    document.getElementById('paletteSearch').addEventListener('input', (e) => {
      const search = e.target.value.toLowerCase();
      document.querySelectorAll('.palette-node').forEach(node => {
        const label = node.querySelector('.palette-node-label').textContent.toLowerCase();
        node.style.display = label.includes(search) ? 'flex' : 'none';
      });
    });
  }

  // ===== Initialization =====
  async function init() {
    try {
      UI.showLoading();
      
      // Initialize database
      try {
        await API.init();
      } catch (error) {
        console.log('Database already initialized or error:', error.message);
      }
      
      // Load nodes
      const nodesData = await API.getNodes();
      GraphManager.registerNodes(nodesData.nodes || []);
      UI.renderNodePalette(nodesData.nodes || []);
      
      // Initialize graph
      GraphManager.init();
      
      // Load flows
      await FlowManager.loadFlows();
      
      // Setup event handlers
      setupEventHandlers();
      
      UI.hideLoading();
      UI.showToast('RedNox loaded successfully', 'success');
    } catch (error) {
      console.error('Initialization error:', error);
      UI.hideLoading();
      UI.showToast('Failed to initialize: ' + error.message, 'error');
    }
  }

  // Start application
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
