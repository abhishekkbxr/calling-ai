// Global variables
let socket;
let charts = {};
let campaigns = [];
let calls = [];

// Initialize the application
document.addEventListener('DOMContentLoaded', function() {
    initializeSocket();
    loadDashboardData();
    setupEventListeners();
    setupCharts();
    
    // Load data every 30 seconds
    setInterval(loadDashboardData, 30000);
});

// Socket.IO connection
function initializeSocket() {
    socket = io();
    
    socket.on('connect', function() {
        updateConnectionStatus(true);
        showToast('Connected to server', 'success');
    });
    
    socket.on('disconnect', function() {
        updateConnectionStatus(false);
        showToast('Disconnected from server', 'warning');
    });
    
    // Real-time event handlers
    socket.on('callInitiated', handleCallInitiated);
    socket.on('callStatusUpdate', handleCallStatusUpdate);
    socket.on('callHungUp', handleCallHungUp);
    socket.on('campaignStarted', handleCampaignStarted);
    socket.on('campaignStopped', handleCampaignStopped);
    socket.on('recordingReady', handleRecordingReady);
}

// Update connection status indicator
function updateConnectionStatus(connected) {
    const statusElement = document.getElementById('connection-status');
    const iconElement = statusElement.previousElementSibling;
    
    if (connected) {
        statusElement.textContent = 'Connected';
        iconElement.className = 'fas fa-circle text-success me-1';
    } else {
        statusElement.textContent = 'Disconnected';
        iconElement.className = 'fas fa-circle text-danger me-1';
    }
}

// Event listeners
function setupEventListeners() {
    // Tab switching
    document.querySelectorAll('[data-bs-toggle="tab"]').forEach(tab => {
        tab.addEventListener('shown.bs.tab', function(e) {
            const targetId = e.target.getAttribute('data-bs-target').substring(1);
            switch(targetId) {
                case 'campaigns':
                    loadCampaigns();
                    break;
                case 'calls':
                    loadCalls();
                    break;
                case 'analytics':
                    loadAnalytics();
                    break;
                case 'live':
                    loadLiveMonitor();
                    break;
            }
        });
    });
    
    // Filter changes
    document.getElementById('calls-filter').addEventListener('change', loadCalls);
}

// Load dashboard overview data
async function loadDashboardData() {
    try {
        // Load summary statistics
        const response = await fetch('/api/calls/analytics/summary');
        const data = await response.json();
        
        if (response.ok) {
            updateDashboardStats(data.summary);
        }
        
        // Update active calls count
        const activeResponse = await fetch('/api/calls/active/conversations');
        const activeData = await activeResponse.json();
        
        if (activeResponse.ok) {
            document.getElementById('active-calls-count').textContent = activeData.activeConversations;
        }
        
    } catch (error) {
        console.error('Error loading dashboard data:', error);
    }
}

// Update dashboard statistics cards
function updateDashboardStats(stats) {
    document.getElementById('total-calls').textContent = stats.totalCalls || 0;
    document.getElementById('conversion-rate').textContent = `${stats.conversionRate || 0}%`;
    document.getElementById('avg-duration').textContent = `${stats.avgDuration || 0}s`;
    
    // Update campaigns count separately
    loadCampaignsCount();
}

// Load campaigns count
async function loadCampaignsCount() {
    try {
        const response = await fetch('/api/campaigns?limit=1');
        const data = await response.json();
        
        if (response.ok) {
            document.getElementById('total-campaigns').textContent = data.pagination.total;
        }
    } catch (error) {
        console.error('Error loading campaigns count:', error);
    }
}

// Load campaigns
async function loadCampaigns() {
    try {
        const response = await fetch('/api/campaigns');
        const data = await response.json();
        
        if (response.ok) {
            campaigns = data.campaigns;
            renderCampaignsTable(campaigns);
            updateCampaignSelect();
        } else {
            showToast('Failed to load campaigns', 'error');
        }
    } catch (error) {
        console.error('Error loading campaigns:', error);
        showToast('Error loading campaigns', 'error');
    }
}

// Render campaigns table
function renderCampaignsTable(campaigns) {
    const tbody = document.querySelector('#campaigns-table tbody');
    tbody.innerHTML = '';
    
    campaigns.forEach(campaign => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${campaign.name}</td>
            <td><span class="badge bg-${getStatusColor(campaign.status)}">${campaign.status}</span></td>
            <td>${campaign.stats?.totalLeads || 0}</td>
            <td>${campaign.stats?.totalCalls || 0}</td>
            <td>${campaign.stats?.conversionRate || 0}%</td>
            <td>${formatDate(campaign.createdAt)}</td>
            <td>
                <div class="btn-group btn-group-sm" role="group">
                    ${campaign.status === 'running' 
                        ? `<button class="btn btn-warning" onclick="stopCampaign('${campaign._id}')">
                             <i class="fas fa-pause"></i>
                           </button>`
                        : `<button class="btn btn-success" onclick="startCampaign('${campaign._id}')">
                             <i class="fas fa-play"></i>
                           </button>`
                    }
                    <button class="btn btn-info" onclick="viewCampaign('${campaign._id}')">
                        <i class="fas fa-eye"></i>
                    </button>
                    <button class="btn btn-danger" onclick="deleteCampaign('${campaign._id}')">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </td>
        `;
        tbody.appendChild(row);
    });
}

// Load calls
async function loadCalls() {
    try {
        const filter = document.getElementById('calls-filter').value;
        const url = filter ? `/api/calls?status=${filter}` : '/api/calls';
        
        const response = await fetch(url);
        const data = await response.json();
        
        if (response.ok) {
            calls = data.calls;
            renderCallsTable(calls);
        } else {
            showToast('Failed to load calls', 'error');
        }
    } catch (error) {
        console.error('Error loading calls:', error);
        showToast('Error loading calls', 'error');
    }
}

// Render calls table
function renderCallsTable(calls) {
    const tbody = document.querySelector('#calls-table tbody');
    tbody.innerHTML = '';
    
    calls.forEach(call => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${call.leadId?.firstName || 'Unknown'} ${call.leadId?.lastName || ''}</td>
            <td>${call.phoneNumber}</td>
            <td>${call.campaignId?.name || 'Unknown'}</td>
            <td><span class="badge bg-${getStatusColor(call.status)}">${call.status}</span></td>
            <td><span class="badge bg-${getOutcomeColor(call.outcome)}">${call.outcome || 'N/A'}</span></td>
            <td>${call.duration ? formatDuration(call.duration) : 'N/A'}</td>
            <td>${formatDate(call.startedAt)}</td>
            <td>
                <div class="btn-group btn-group-sm" role="group">
                    <button class="btn btn-info" onclick="viewCall('${call._id}')">
                        <i class="fas fa-eye"></i>
                    </button>
                    ${call.status === 'in-progress' 
                        ? `<button class="btn btn-danger" onclick="hangupCall('${call._id}')">
                             <i class="fas fa-phone-slash"></i>
                           </button>`
                        : ''
                    }
                </div>
            </td>
        `;
        tbody.appendChild(row);
    });
}

// Load analytics
async function loadAnalytics() {
    try {
        const response = await fetch('/api/calls/analytics/summary');
        const data = await response.json();
        
        if (response.ok) {
            updateCharts(data);
        } else {
            showToast('Failed to load analytics', 'error');
        }
    } catch (error) {
        console.error('Error loading analytics:', error);
        showToast('Error loading analytics', 'error');
    }
}

// Load live monitor
async function loadLiveMonitor() {
    try {
        const response = await fetch('/api/calls/active/conversations');
        const data = await response.json();
        
        if (response.ok) {
            updateLiveMonitor(data);
        } else {
            showToast('Failed to load live monitor', 'error');
        }
    } catch (error) {
        console.error('Error loading live monitor:', error);
        showToast('Error loading live monitor', 'error');
    }
}

// Update live monitor
function updateLiveMonitor(data) {
    document.getElementById('live-active-count').textContent = data.activeConversations;
    
    const activeCallsList = document.getElementById('active-calls-list');
    
    if (data.activeCalls.length === 0) {
        activeCallsList.innerHTML = '<p class="text-muted">No active calls</p>';
    } else {
        activeCallsList.innerHTML = data.activeCalls.map(call => `
            <div class="card mb-2">
                <div class="card-body p-3">
                    <div class="d-flex justify-content-between align-items-center">
                        <div>
                            <h6 class="mb-1">${call.lead?.firstName || 'Unknown'} ${call.lead?.lastName || ''}</h6>
                            <small class="text-muted">${call.campaign?.name || 'Unknown Campaign'}</small>
                        </div>
                        <div class="text-end">
                            <span class="badge bg-${getStatusColor(call.status)}">${call.status}</span>
                            <br>
                            <small class="text-muted">${formatDuration(call.duration)}</small>
                        </div>
                    </div>
                </div>
            </div>
        `).join('');
    }
}

// Setup charts
function setupCharts() {
    const ctx1 = document.getElementById('outcome-chart').getContext('2d');
    charts.outcome = new Chart(ctx1, {
        type: 'pie',
        data: {
            labels: [],
            datasets: [{
                data: [],
                backgroundColor: [
                    '#28a745', '#17a2b8', '#ffc107', '#dc3545', '#6f42c1'
                ]
            }]
        },
        options: {
            responsive: true,
            plugins: {
                legend: {
                    position: 'bottom'
                }
            }
        }
    });
    
    const ctx2 = document.getElementById('sentiment-chart').getContext('2d');
    charts.sentiment = new Chart(ctx2, {
        type: 'doughnut',
        data: {
            labels: ['Positive', 'Neutral', 'Negative'],
            datasets: [{
                data: [0, 0, 0],
                backgroundColor: ['#28a745', '#ffc107', '#dc3545']
            }]
        },
        options: {
            responsive: true,
            plugins: {
                legend: {
                    position: 'bottom'
                }
            }
        }
    });
    
    const ctx3 = document.getElementById('performance-chart').getContext('2d');
    charts.performance = new Chart(ctx3, {
        type: 'line',
        data: {
            labels: [],
            datasets: [{
                label: 'Calls',
                data: [],
                borderColor: '#007bff',
                backgroundColor: 'rgba(0, 123, 255, 0.1)',
                tension: 0.4
            }, {
                label: 'Conversions',
                data: [],
                borderColor: '#28a745',
                backgroundColor: 'rgba(40, 167, 69, 0.1)',
                tension: 0.4
            }]
        },
        options: {
            responsive: true,
            scales: {
                y: {
                    beginAtZero: true
                }
            }
        }
    });
}

// Update charts with new data
function updateCharts(data) {
    // Update outcome chart
    if (data.outcomeBreakdown) {
        const outcomes = Object.keys(data.outcomeBreakdown);
        const values = Object.values(data.outcomeBreakdown);
        
        charts.outcome.data.labels = outcomes;
        charts.outcome.data.datasets[0].data = values;
        charts.outcome.update();
    }
    
    // Update sentiment chart
    if (data.sentimentBreakdown) {
        const sentiments = ['positive', 'neutral', 'negative'];
        const values = sentiments.map(s => data.sentimentBreakdown[s] || 0);
        
        charts.sentiment.data.datasets[0].data = values;
        charts.sentiment.update();
    }
}

// Campaign actions
async function startCampaign(campaignId) {
    try {
        const response = await fetch(`/api/campaigns/${campaignId}/start`, {
            method: 'POST'
        });
        
        if (response.ok) {
            showToast('Campaign started successfully', 'success');
            loadCampaigns();
        } else {
            const data = await response.json();
            showToast(data.error || 'Failed to start campaign', 'error');
        }
    } catch (error) {
        console.error('Error starting campaign:', error);
        showToast('Error starting campaign', 'error');
    }
}

async function stopCampaign(campaignId) {
    try {
        const response = await fetch(`/api/campaigns/${campaignId}/stop`, {
            method: 'POST'
        });
        
        if (response.ok) {
            showToast('Campaign stopped successfully', 'success');
            loadCampaigns();
        } else {
            const data = await response.json();
            showToast(data.error || 'Failed to stop campaign', 'error');
        }
    } catch (error) {
        console.error('Error stopping campaign:', error);
        showToast('Error stopping campaign', 'error');
    }
}

async function deleteCampaign(campaignId) {
    if (!confirm('Are you sure you want to delete this campaign?')) {
        return;
    }
    
    try {
        const response = await fetch(`/api/campaigns/${campaignId}`, {
            method: 'DELETE'
        });
        
        if (response.ok) {
            showToast('Campaign deleted successfully', 'success');
            loadCampaigns();
        } else {
            const data = await response.json();
            showToast(data.error || 'Failed to delete campaign', 'error');
        }
    } catch (error) {
        console.error('Error deleting campaign:', error);
        showToast('Error deleting campaign', 'error');
    }
}

function viewCampaign(campaignId) {
    // TODO: Implement campaign detail view
    showToast('Campaign details view coming soon', 'info');
}

// Call actions
function viewCall(callId) {
    // TODO: Implement call detail view
    showToast('Call details view coming soon', 'info');
}

async function hangupCall(callId) {
    if (!confirm('Are you sure you want to hang up this call?')) {
        return;
    }
    
    try {
        const response = await fetch(`/api/calls/${callId}/hangup`, {
            method: 'POST'
        });
        
        if (response.ok) {
            showToast('Call hung up successfully', 'success');
            loadCalls();
        } else {
            const data = await response.json();
            showToast(data.error || 'Failed to hang up call', 'error');
        }
    } catch (error) {
        console.error('Error hanging up call:', error);
        showToast('Error hanging up call', 'error');
    }
}

// Modal functions
function showCreateCampaignModal() {
    const modal = new bootstrap.Modal(document.getElementById('createCampaignModal'));
    modal.show();
}

function showInitiateCallModal() {
    updateCampaignSelect();
    const modal = new bootstrap.Modal(document.getElementById('initiateCallModal'));
    modal.show();
}

async function createCampaign() {
    const form = document.getElementById('create-campaign-form');
    const formData = new FormData(form);
    
    const campaignData = {
        name: document.getElementById('campaign-name').value,
        description: document.getElementById('campaign-description').value,
        script: {
            opening: document.getElementById('campaign-script').value || undefined
        },
        voiceSettings: {
            voice: document.getElementById('campaign-voice').value,
            language: document.getElementById('campaign-language').value
        }
    };
    
    try {
        const response = await fetch('/api/campaigns', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(campaignData)
        });
        
        if (response.ok) {
            showToast('Campaign created successfully', 'success');
            bootstrap.Modal.getInstance(document.getElementById('createCampaignModal')).hide();
            form.reset();
            loadCampaigns();
        } else {
            const data = await response.json();
            showToast(data.error || 'Failed to create campaign', 'error');
        }
    } catch (error) {
        console.error('Error creating campaign:', error);
        showToast('Error creating campaign', 'error');
    }
}

async function initiateCall() {
    const campaignId = document.getElementById('call-campaign').value;
    const phoneNumber = document.getElementById('call-phone').value;
    const name = document.getElementById('call-name').value;
    
    if (!campaignId || !phoneNumber || !name) {
        showToast('Please fill in all required fields', 'warning');
        return;
    }
    
    // TODO: Create lead first, then initiate call
    // For now, show a message
    showToast('Manual call initiation coming soon', 'info');
    
    bootstrap.Modal.getInstance(document.getElementById('initiateCallModal')).hide();
    document.getElementById('initiate-call-form').reset();
}

// Update campaign select options
function updateCampaignSelect() {
    const select = document.getElementById('call-campaign');
    select.innerHTML = '<option value="">Select a campaign...</option>';
    
    campaigns.filter(c => c.status !== 'cancelled').forEach(campaign => {
        const option = document.createElement('option');
        option.value = campaign._id;
        option.textContent = campaign.name;
        select.appendChild(option);
    });
}

// Real-time event handlers
function handleCallInitiated(data) {
    showToast(`Call initiated to ${data.leadName}`, 'info');
    addActivityFeedItem(`Call started with ${data.leadName}`, 'info');
    loadDashboardData();
}

function handleCallStatusUpdate(data) {
    addActivityFeedItem(`Call ${data.callSid} status: ${data.status}`, 'info');
    if (document.querySelector('#calls.active')) {
        loadCalls();
    }
    loadDashboardData();
}

function handleCallHungUp(data) {
    addActivityFeedItem(`Call ${data.callSid} ended`, 'warning');
    loadDashboardData();
}

function handleCampaignStarted(data) {
    showToast(`Campaign "${data.name}" started`, 'success');
    addActivityFeedItem(`Campaign "${data.name}" started`, 'success');
    if (document.querySelector('#campaigns.active')) {
        loadCampaigns();
    }
}

function handleCampaignStopped(data) {
    showToast(`Campaign "${data.name}" stopped`, 'warning');
    addActivityFeedItem(`Campaign "${data.name}" stopped`, 'warning');
    if (document.querySelector('#campaigns.active')) {
        loadCampaigns();
    }
}

function handleRecordingReady(data) {
    addActivityFeedItem(`Recording ready for call ${data.callSid}`, 'info');
}

// Add item to activity feed
function addActivityFeedItem(message, type) {
    const feed = document.getElementById('activity-feed');
    const item = document.createElement('div');
    item.className = `alert alert-${type === 'success' ? 'success' : type === 'warning' ? 'warning' : 'info'} alert-sm mb-2`;
    item.innerHTML = `
        <small>
            <i class="fas fa-${type === 'success' ? 'check' : type === 'warning' ? 'exclamation' : 'info'}-circle me-1"></i>
            ${message}
            <span class="float-end">${new Date().toLocaleTimeString()}</span>
        </small>
    `;
    
    feed.insertBefore(item, feed.firstChild);
    
    // Keep only last 20 items
    while (feed.children.length > 20) {
        feed.removeChild(feed.lastChild);
    }
}

// Utility functions
function getStatusColor(status) {
    const colors = {
        'draft': 'secondary',
        'scheduled': 'info',
        'running': 'success',
        'paused': 'warning',
        'completed': 'primary',
        'cancelled': 'danger',
        'queued': 'secondary',
        'ringing': 'warning',
        'in-progress': 'success',
        'failed': 'danger',
        'busy': 'warning',
        'no-answer': 'secondary'
    };
    return colors[status] || 'secondary';
}

function getOutcomeColor(outcome) {
    const colors = {
        'sale': 'success',
        'interested': 'info',
        'callback': 'warning',
        'not-interested': 'danger',
        'voicemail': 'secondary',
        'wrong-number': 'danger',
        'no-answer': 'secondary'
    };
    return colors[outcome] || 'secondary';
}

function formatDate(dateString) {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
}

function formatDuration(seconds) {
    if (!seconds) return '0s';
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return minutes > 0 ? `${minutes}m ${remainingSeconds}s` : `${remainingSeconds}s`;
}

// Toast notification system
function showToast(message, type = 'info') {
    const toastContainer = document.querySelector('.toast-container');
    const toastId = 'toast-' + Date.now();
    
    const toast = document.createElement('div');
    toast.id = toastId;
    toast.className = 'toast';
    toast.setAttribute('role', 'alert');
    toast.innerHTML = `
        <div class="toast-header">
            <i class="fas fa-${type === 'success' ? 'check' : type === 'error' ? 'exclamation' : 'info'}-circle text-${type === 'error' ? 'danger' : type} me-2"></i>
            <strong class="me-auto">AI Calling Agent</strong>
            <small>Now</small>
            <button type="button" class="btn-close" data-bs-dismiss="toast"></button>
        </div>
        <div class="toast-body">
            ${message}
        </div>
    `;
    
    toastContainer.appendChild(toast);
    
    const bsToast = new bootstrap.Toast(toast, {
        autohide: true,
        delay: type === 'error' ? 5000 : 3000
    });
    
    bsToast.show();
    
    // Remove toast element after it's hidden
    toast.addEventListener('hidden.bs.toast', function() {
        toast.remove();
    });
}
