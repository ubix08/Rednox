
// ===================================================================
// RedNox Admin UI - Main Application
// ===================================================================

const API_BASE = window.location.origin;

// State
const state = {
    flows: [],
    routes: [],
    nodes: [],
    categories: [],
    currentFlow: null,
    editor: null,
    selectedNode: null
};

// ===================================================================
// Initialization
// ===================================================================

document.addEventListener('DOMContentLoaded', async () => {
    console.log('RedNox Admin UI initializing...');
    
    // Setup navigation
    setupNavigation();
    
    // Setup event listeners
    setupEventListeners();
    
    // Initialize database
    await initializeDatabase();
    
    // Load initial data
    await loadFlows();
    await loadNodes();
    
    // Setup Drawflow
    setupDrawflow();
});

// ===================================================================
// Navigation
// ===================================================================

function setupNavigation() {
    const navBtns = document.querySelectorAll('.nav-btn');
    const views = document.querySelectorAll('.view');
    
    navBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const viewId = btn.dataset.view + 'View';
            
            // Update nav buttons
            navBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            
            // Update views
            views.forEach(v => v.classList.remove('active'));
            document.getElementById(viewId)?.classList.add('active');
            
            // Load data for view
            if (btn.dataset.view === 'routes') {
                loadRoutes();
            }
        });
    });
}

// ===================================================================
// Event Listeners
// ===================================================================

function setupEventListeners() {
    // New flow button
    document.getElementById('newFlowBtn').addEventListener('click', () => {
        openFlowEditor(null);
    });
    
    // Refresh button
    document.getElementById('refreshBtn').addEventListener('click', async () => {
        await loadFlows();
        showToast('Data refreshed', 'success');
    });
    
    // Editor close button
    document.getElementById('closeEditorBtn').addEventListener('click', () => {
        closeFlowEditor();
    });
    
    // Save flow button
    document.getElementById('saveFlowBtn').addEventListener('click', async () => {
        await saveCurrentFlow();
    });
    
    // Validate button
    document.getElementById('validateBtn').addEventListener('click', () => {
        validateCurrentFlow();
    });
    
    // Confirm modal
    document.getElementById('confirmCancelBtn').addEventListener('click', () => {
        closeConfirmModal();
    });
}

// ===================================================================
// Database Initialization
// ===================================================================

async function initializeDatabase() {
    try {
        // Check if database is initialized by trying to fetch flows
        const response = await fetch(`${API_BASE}/admin/flows`);
        
        if (!response.ok) {
            // Database might not be initialized, try to initialize
            console.log('Database not initialized, attempting initialization...');
            
            const initResponse = await fetch(`${API_BASE}/admin/init`, {
                method: 'POST'
            });
            
            if (initResponse.ok) {
                showToast('Database initialized successfully', 'success');
            } else {
                const error = await initResponse.json();
                showToast(`Database initialization failed: ${error.error}`, 'error');
            }
        }
    } catch (error) {
        console.error('Error checking database:', error);
        showToast('Error connecting to server', 'error');
    }
}

// ===================================================================
// Data Loading
// ===================================================================

async function loadFlows() {
    try {
        const response = await fetch(`${API_BASE}/admin/flows`);
        const data = await response.json();
        
        state.flows = data.flows || [];
        renderFlows();
        updateStats();
    } catch (error) {
        console.error('Error loading flows:', error);
        showToast('Error loading flows', 'error');
    }
}

async function loadRoutes() {
    try {
        const response = await fetch(`${API_BASE}/admin/routes`);
        const data = await response.json();
        
        state.routes = data.routes || [];
        renderRoutes();
    } catch (error) {
        console.error('Error loading routes:', error);
        showToast('Error loading routes', 'error');
    }
}

async function loadNodes() {
    try {
        const response = await fetch(`${API_BASE}/admin/nodes/categories`);
        const data = await response.json();
        
        state.categories = data.categories || [];
        renderNodes();
        renderNodePalette();
    } catch (error) {
        console.error('Error loading nodes:', error);
        showToast('Error loading nodes', 'error');
    }
}

// ===================================================================
// Rendering
// ===================================================================

function renderFlows() {
    const grid = document.getElementById('flowsGrid');
    
    if (state.flows.length === 0) {
        grid.innerHTML = '<div class="loading">No flows yet. Create your first flow!</div>';
        return;
    }
    
    grid.innerHTML = state.flows.map(flow => `
        <div class="flow-card" onclick="openFlowEditor('${flow.id}')">
            <div class="flow-card-header">
                <div>
                    <div class="flow-card-title">${escapeHtml(flow.name)}</div>
                    <div class="flow-card-description">${escapeHtml(flow.description || 'No description')}</div>
                </div>
                <span class="flow-badge ${flow.enabled ? 'enabled' : 'disabled'}">
                    ${flow.enabled ? 'Active' : 'Inactive'}
                </span>
            </div>
            <div class="flow-card-meta">
                <span>Created: ${formatDate(flow.created_at)}</span>
            </div>
            <div class="flow-card-actions" onclick="event.stopPropagation()">
                <button class="btn-secondary" onclick="toggleFlow('${flow.id}', ${!flow.enabled})">
                    ${flow.enabled ? 'Disable' : 'Enable'}
                </button>
                <button class="btn-secondary" onclick="duplicateFlow('${flow.id}')">Duplicate</button>
                <button class="btn-danger" onclick="confirmDeleteFlow('${flow.id}')">Delete</button>
            </div>
        </div>
    `).join('');
}

function renderRoutes() {
    const list = document.getElementById('routesList');
    
    if (state.routes.length === 0) {
        list.innerHTML = '<div class="loading">No routes configured</div>';
        return;
    }
    
    list.innerHTML = state.routes.map(route => `
        <div class="route-card">
            <div class="route-header">
                <span class="route-method ${route.method}">${route.method}</span>
                <code class="route-path">${escapeHtml(route.fullUrl)}</code>
            </div>
            <div class="route-flow">Flow: ${escapeHtml(route.flow_name)}</div>
        </div>
    `).join('');
}

function renderNodes() {
    const container = document.getElementById('nodesCategories');
    
    if (state.categories.length === 0) {
        container.innerHTML = '<div class="loading">No nodes available</div>';
        return;
    }
    
    container.innerHTML = state.categories.map(category => `
        <div class="node-category">
            <div class="node-category-title">
                ${escapeHtml(category.name)}
                <span class="node-count">${category.count}</span>
            </div>
            <div class="nodes-grid">
                ${category.nodes.map(node => `
                    <div class="node-item">
                        <div class="node-icon">${node.icon || '📦'}</div>
                        <div class="node-label">${escapeHtml(node.label)}</div>
                    </div>
                `).join('')}
            </div>
        </div>
    `).join('');
}

function renderNodePalette() {
    const palette = document.getElementById('paletteNodes');
    
    palette.innerHTML = state.categories.map(category => `
        <div class="palette-category">
            <div class="palette-category-title">${escapeHtml(category.name)}</div>
            ${category.nodes.map(node => `
                <div class="palette-node" draggable="true" data-node-type="${node.type}">
                    ${node.icon || '📦'} ${escapeHtml(node.label)}
                </div>
            `).join('')}
        </div>
    `).join('');
    
    // Add drag event listeners
    document.querySelectorAll('.palette-node').forEach(node => {
        node.addEventListener('dragstart', handleDragStart);
    });
}

function updateStats() {
    const total = state.flows.length;
    const active = state.flows.filter(f => f.enabled).length;
    
    const stats = document.getElementById('flowStats');
    const statValues = stats.querySelectorAll('.stat-value');
    statValues[0].textContent = total;
    statValues[1].textContent = active;
}

// ===================================================================
// Flow Editor
// ===================================================================

function setupDrawflow() {
    const container = document.getElementById('drawflow');
    state.editor = new Drawflow(container);
    state.editor.reroute = true;
    state.editor.start();
    
    // Editor events
    state.editor.on('nodeSelected', (nodeId) => {
        state.selectedNode = nodeId;
        showNodeProperties(nodeId);
    });
    
    state.editor.on('nodeUnselected', () => {
        state.selectedNode = null;
        clearNodeProperties();
    });
}

async function openFlowEditor(flowId) {
    const modal = document.getElementById('editorModal');
    modal.classList.add('active');
    
    if (flowId) {
        // Load existing flow
        try {
            const response = await fetch(`${API_BASE}/admin/flows/${flowId}`);
            const flow = await response.json();
            
            state.currentFlow = flow;
            document.getElementById('flowName').value = flow.name;
            
            // Load flow into editor
            if (flow.config && flow.config.nodes) {
                loadFlowIntoEditor(flow.config);
            }
        } catch (error) {
            console.error('Error loading flow:', error);
            showToast('Error loading flow', 'error');
        }
    } else {
        // New flow
        state.currentFlow = {
            id: generateId(),
            name: 'New Flow',
            nodes: []
        };
        document.getElementById('flowName').value = state.currentFlow.name;
        state.editor.clear();
    }
}

function closeFlowEditor() {
    const modal = document.getElementById('editorModal');
    modal.classList.remove('active');
    state.currentFlow = null;
    state.editor.clear();
}

function loadFlowIntoEditor(config) {
    state.editor.clear();
    
    if (!config.nodes || config.nodes.length === 0) {
        return;
    }
    
    // Add nodes to editor
    config.nodes.forEach(node => {
        const html = createNodeHTML(node);
        const inputs = node.inputs || 1;
        const outputs = node.outputs || 1;
        const x = node.x || 100;
        const y = node.y || 100;
        
        state.editor.addNode(
            node.type,
            inputs,
            outputs,
            x,
            y,
            node.type,
            node,
            html
        );
    });
}

function createNodeHTML(node) {
    return `
        <div class="node-content">
            <div class="node-header">${escapeHtml(node.type)}</div>
            <div class="node-body">
                ${node.name ? `<div>${escapeHtml(node.name)}</div>` : ''}
            </div>
        </div>
    `;
}

async function saveCurrentFlow() {
    if (!state.currentFlow) return;
    
    const flowName = document.getElementById('flowName').value;
    const exportData = state.editor.export();
    
    const flowData = {
        id: state.currentFlow.id,
        name: flowName,
        description: state.currentFlow.description || '',
        nodes: Object.values(exportData.drawflow.Home.data).map(node => ({
            id: node.id,
            type: node.name,
            x: node.pos_x,
            y: node.pos_y,
            ...node.data
        }))
    };
    
    try {
        const url = state.currentFlow.created_at
            ? `${API_BASE}/admin/flows/${state.currentFlow.id}`
            : `${API_BASE}/admin/flows`;
        
        const method = state.currentFlow.created_at ? 'PUT' : 'POST';
        
        const response = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(flowData)
        });
        
        if (response.ok) {
            showToast('Flow saved successfully', 'success');
            await loadFlows();
            closeFlowEditor();
        } else {
            const error = await response.json();
            showToast(`Error: ${error.error}`, 'error');
        }
    } catch (error) {
        console.error('Error saving flow:', error);
        showToast('Error saving flow', 'error');
    }
}

function validateCurrentFlow() {
    const exportData = state.editor.export();
    const nodeCount = Object.keys(exportData.drawflow.Home.data).length;
    
    if (nodeCount === 0) {
        showToast('Flow is empty', 'warning');
        return;
    }
    
    showToast(`Flow is valid (${nodeCount} nodes)`, 'success');
}

// ===================================================================
// Node Properties
// ===================================================================

function showNodeProperties(nodeId) {
    const content = document.getElementById('propertiesContent');
    const nodeData = state.editor.getNodeFromId(nodeId);
    
    content.innerHTML = `
        <div class="property-group">
            <label class="property-label">Node ID</label>
            <input type="text" class="property-input" value="${nodeId}" readonly>
        </div>
        <div class="property-group">
            <label class="property-label">Node Type</label>
            <input type="text" class="property-input" value="${escapeHtml(nodeData.name)}" readonly>
        </div>
        <div class="property-group">
            <label class="property-label">Name</label>
            <input type="text" class="property-input" id="nodeName" value="${escapeHtml(nodeData.data.name || '')}">
        </div>
        <div class="property-group">
            <button class="btn-danger" onclick="deleteNode(${nodeId})">Delete Node</button>
        </div>
    `;
    
    // Add event listener for name change
    document.getElementById('nodeName')?.addEventListener('change', (e) => {
        updateNodeData(nodeId, { name: e.target.value });
    });
}

function clearNodeProperties() {
    const content = document.getElementById('propertiesContent');
    content.innerHTML = '<div class="properties-empty">Select a node to edit properties</div>';
}

function updateNodeData(nodeId, data) {
    const nodeData = state.editor.getNodeFromId(nodeId);
    state.editor.updateNodeDataFromId(nodeId, { ...nodeData.data, ...data });
}

function deleteNode(nodeId) {
    state.editor.removeNodeId(`node-${nodeId}`);
    clearNodeProperties();
}

// ===================================================================
// Flow Actions
// ===================================================================

async function toggleFlow(flowId, enable) {
    try {
        const action = enable ? 'enable' : 'disable';
        const response = await fetch(`${API_BASE}/admin/flows/${flowId}/${action}`, {
            method: 'POST'
        });
        
        if (response.ok) {
            showToast(`Flow ${action}d successfully`, 'success');
            await loadFlows();
        } else {
            showToast(`Error ${action}ing flow`, 'error');
        }
    } catch (error) {
        console.error('Error toggling flow:', error);
        showToast('Error toggling flow', 'error');
    }
}

async function duplicateFlow(flowId) {
    try {
        const response = await fetch(`${API_BASE}/admin/flows/${flowId}`);
        const flow = await response.json();
        
        const newFlow = {
            ...flow,
            id: generateId(),
            name: `${flow.name} (Copy)`,
            config: flow.config
        };
        
        delete newFlow.created_at;
        delete newFlow.updated_at;
        delete newFlow.enabled;
        delete newFlow.routes;
        
        const createResponse = await fetch(`${API_BASE}/admin/flows`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(newFlow)
        });
        
        if (createResponse.ok) {
            showToast('Flow duplicated successfully', 'success');
            await loadFlows();
        } else {
            showToast('Error duplicating flow', 'error');
        }
    } catch (error) {
        console.error('Error duplicating flow:', error);
        showToast('Error duplicating flow', 'error');
    }
}

function confirmDeleteFlow(flowId) {
    showConfirmModal(
        'Delete Flow',
        'Are you sure you want to delete this flow? This action cannot be undone.',
        () => deleteFlow(flowId)
    );
}

async function deleteFlow(flowId) {
    try {
        const response = await fetch(`${API_BASE}/admin/flows/${flowId}`, {
            method: 'DELETE'
        });
        
        if (response.ok) {
            showToast('Flow deleted successfully', 'success');
            await loadFlows();
        } else {
            showToast('Error deleting flow', 'error');
        }
    } catch (error) {
        console.error('Error deleting flow:', error);
        showToast('Error deleting flow', 'error');
    }
}

// ===================================================================
// Drag and Drop
// ===================================================================

function handleDragStart(e) {
    e.dataTransfer.setData('node-type', e.target.dataset.nodeType);
}

// ===================================================================
// UI Helpers
// ===================================================================

function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    
    container.appendChild(toast);
    
    setTimeout(() => {
        toast.remove();
    }, 3000);
}

function showConfirmModal(title, message, onConfirm) {
    const modal = document.getElementById('confirmModal');
    document.getElementById('confirmTitle').textContent = title;
    document.getElementById('confirmMessage').textContent = message;
    
    const okBtn = document.getElementById('confirmOkBtn');
    const newOkBtn = okBtn.cloneNode(true);
    okBtn.parentNode.replaceChild(newOkBtn, okBtn);
    
    newOkBtn.addEventListener('click', () => {
        onConfirm();
        closeConfirmModal();
    });
    
    modal.classList.add('active');
}

function closeConfirmModal() {
    document.getElementById('confirmModal').classList.remove('active');
}

// ===================================================================
// Utility Functions
// ===================================================================

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function formatDate(dateString) {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
}

function generateId() {
    return 'flow_' + Math.random().toString(36).substr(2, 9);
}

// ===================================================================
// Export for debugging
// ===================================================================

window.RedNoxAdmin = {
    state,
    loadFlows,
    loadRoutes,
    loadNodes
};
