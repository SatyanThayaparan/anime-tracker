import { 
  getAggregatedData, 
  getTodayData, 
  getTopShows, 
  getTotalTime, 
  formatTime,
  getSettings,
  saveSettings,
  exportData,
  clearAllData,
  calculatePercentage,
  getCompletedEpisodes
} from '../utils/storage.js';

// State
let currentRange = 1;
let currentData = null;
let showChart = null;
let hourlyChart = null;
let dailyChart = null;

/**
 * Initialize dashboard
 */
async function initDashboard() {
  setupEventListeners();
  await loadData();
}

/**
 * Setup event listeners
 */
function setupEventListeners() {
  // Tab navigation
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      switchTab(item.dataset.tab);
    });
  });

  // Time range selector
  document.querySelectorAll('.time-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.time-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentRange = parseInt(btn.dataset.range);
      loadData();
    });
  });

  // Show search
  const showSearchEl = document.getElementById('showSearch');
  if (showSearchEl) {
    showSearchEl.addEventListener('input', (e) => {
      filterShows(e.target.value);
    });
  }

  // Export data button
  document.getElementById('exportDataBtn').addEventListener('click', handleExportData);

  // Clear data button
  document.getElementById('clearDataBtn').addEventListener('click', handleClearData);
}

/**
 * Switch between tabs
 */
function switchTab(tabId) {
  // Update navigation
  document.querySelectorAll('.nav-item').forEach(item => {
    item.classList.toggle('active', item.dataset.tab === tabId);
  });

  // Update tab content
  document.querySelectorAll('.tab-content').forEach(tab => {
    tab.classList.remove('active');
  });
  document.getElementById(`${tabId}Tab`).classList.add('active');

  // Update page title
  const titles = {
    overview: 'Overview',
    shows: 'All Shows',
    settings: 'Settings'
  };
  document.getElementById('pageTitle').textContent = titles[tabId] || 'Dashboard';
}

/**
 * Load data based on current range
 */
async function loadData() {
  try {
    currentData = await getAggregatedData(currentRange);
    updateStats();
    updateCharts();
    updateTopShowsTable();
    updateAllShowsTable();
    
    // Show/hide daily trend chart based on range
    const dailyCard = document.getElementById('dailyTrendCard');
    if (dailyCard) {
      if (currentRange > 1) {
        dailyCard.style.display = 'block';
        updateDailyChart();
      } else {
        dailyCard.style.display = 'none';
      }
    }
  } catch (error) {
    console.error('Error loading data:', error);
  }
}

/**
 * Update stats cards
 */
function updateStats() {
  const totalTime = currentData.stats?.totalTime || getTotalTime(currentData.shows || {});
  const episodesWatched = currentData.stats?.episodesWatched || 0;
  const showsCount = currentData.stats?.showsActive || Object.keys(currentData.shows || {}).length;
  const sessionsCount = Object.values(currentData.shows || {})
    .reduce((sum, show) => sum + (show.sessions || 0), 0);

  document.getElementById('statTotalTime').textContent = formatTime(totalTime, true);
  document.getElementById('statEpisodesWatched').textContent = episodesWatched.toString();
  document.getElementById('statShowsCount').textContent = showsCount.toString();
  document.getElementById('statSessionsCount').textContent = sessionsCount.toString();
}

/**
 * Update all charts
 */
function updateCharts() {
  updateShowChart();
  updateHourlyChart();
}

/**
 * Update show pie chart
 */
function updateShowChart() {
  const ctx = document.getElementById('showChart').getContext('2d');
  
  const shows = Object.entries(currentData.shows || {})
    .filter(([_, data]) => data.totalTime > 0)
    .sort((a, b) => b[1].totalTime - a[1].totalTime)
    .slice(0, 10); // Top 10 shows

  const labels = shows.map(([showName]) => showName);
  const data = shows.map(([_, showData]) => showData.totalTime);
  
  // Generate colors for shows
  const colors = [
    '#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#8b5cf6',
    '#06b6d4', '#ec4899', '#84cc16', '#f97316', '#6366f1'
  ];

  if (showChart) {
    showChart.destroy();
  }

  if (shows.length === 0) {
    ctx.canvas.parentElement.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">📺</div>
        <p>No shows watched in this period</p>
      </div>
    `;
    return;
  }

  showChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: colors.slice(0, shows.length),
        borderWidth: 0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'right',
          labels: {
            padding: 16,
            usePointStyle: true,
            pointStyle: 'circle'
          }
        },
        tooltip: {
          callbacks: {
            label: (context) => {
              const time = formatTime(context.raw, true);
              const total = context.dataset.data.reduce((a, b) => a + b, 0);
              const percentage = Math.round((context.raw / total) * 100);
              return `${context.label}: ${time} (${percentage}%)`;
            }
          }
        }
      }
    }
  });
}

/**
 * Update hourly activity bar chart
 */
function updateHourlyChart() {
  const ctx = document.getElementById('hourlyChart').getContext('2d');
  
  const hours = [];
  const data = [];
  
  for (let i = 0; i < 24; i++) {
    const hour = i.toString().padStart(2, '0');
    hours.push(`${i}:00`);
    data.push((currentData.hourly[hour] || 0) / 1000 / 60); // Convert to minutes
  }

  if (hourlyChart) {
    hourlyChart.destroy();
  }

  hourlyChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: hours,
      datasets: [{
        label: 'Minutes',
        data,
        backgroundColor: '#3b82f6',
        borderRadius: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: false
        },
        tooltip: {
          callbacks: {
            label: (context) => {
              const minutes = Math.round(context.raw);
              if (minutes >= 60) {
                return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
              }
              return `${minutes} minutes`;
            }
          }
        }
      },
      scales: {
        x: {
          grid: {
            display: false
          }
        },
        y: {
          beginAtZero: true,
          ticks: {
            callback: (value) => {
              if (value >= 60) {
                return `${Math.floor(value / 60)}h`;
              }
              return `${value}m`;
            }
          }
        }
      }
    }
  });
}

/**
 * Update daily trend line chart
 */
function updateDailyChart() {
  const ctx = document.getElementById('dailyChart').getContext('2d');
  
  const sortedDays = Object.keys(currentData.daily).sort();
  const labels = sortedDays.map(date => {
    const d = new Date(date);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  });
  const data = sortedDays.map(date => (currentData.daily[date] || 0) / 1000 / 60 / 60); // Hours

  if (dailyChart) {
    dailyChart.destroy();
  }

  dailyChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Hours',
        data,
        borderColor: '#3b82f6',
        backgroundColor: 'rgba(59, 130, 246, 0.1)',
        fill: true,
        tension: 0.4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: false
        },
        tooltip: {
          callbacks: {
            label: (context) => {
              const hours = context.raw;
              const h = Math.floor(hours);
              const m = Math.round((hours - h) * 60);
              return `${h}h ${m}m`;
            }
          }
        }
      },
      scales: {
        x: {
          grid: {
            display: false
          }
        },
        y: {
          beginAtZero: true,
          ticks: {
            callback: (value) => `${value}h`
          }
        }
      }
    }
  });
}

/**
 * Update top shows table
 */
function updateTopShowsTable() {
  const tbody = document.getElementById('topShowsTable');
  const topShows = getTopShows(currentData.shows || {}, 10);

  if (topShows.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" class="empty-state">
          <div class="empty-state-icon">📺</div>
          <p>No shows watched in this period</p>
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = topShows.map((show, index) => {
    const episodesCompleted = getCompletedEpisodes(show.episodes);

    return `
      <tr>
        <td>${index + 1}</td>
        <td>
          <div class="site-cell">
            <span class="site-name">${show.showName}</span>
          </div>
        </td>
        <td>
          <span class="category-badge">
            ${show.site || 'Unknown'}
          </span>
        </td>
        <td>${formatTime(show.totalTime, true)}</td>
        <td>${episodesCompleted}</td>
        <td>${show.sessions || 0}</td>
      </tr>
    `;
  }).join('');
}

/**
 * Update all shows table
 */
function updateAllShowsTable() {
  const tbody = document.getElementById('allShowsTable');
  const shows = Object.entries(currentData.shows || {})
    .map(([showName, data]) => ({ showName, ...data }))
    .sort((a, b) => b.totalTime - a.totalTime);

  if (shows.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="5" class="empty-state">
          <div class="empty-state-icon">📺</div>
          <p>No shows watched in this period</p>
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = shows.map(show => {
    const episodesCompleted = getCompletedEpisodes(show.episodes);

    return `
      <tr data-showname="${show.showName}">
        <td>
          <div class="site-cell">
            <span class="site-name">${show.showName}</span>
          </div>
        </td>
        <td>
          <span class="category-badge">
            ${show.site || 'Unknown'}
          </span>
        </td>
        <td>${formatTime(show.totalTime, true)}</td>
        <td>${episodesCompleted}</td>
        <td>${show.sessions || 0}</td>
      </tr>
    `;
  }).join('');
}

/**
 * Filter shows table by search term
 */
function filterShows(searchTerm) {
  const rows = document.querySelectorAll('#allShowsTable tr[data-showname]');
  const term = searchTerm.toLowerCase();

  rows.forEach(row => {
    const showName = row.dataset.showname.toLowerCase();
    row.style.display = showName.includes(term) ? '' : 'none';
  });
}


/**
 * Handle export data
 */
async function handleExportData() {
  try {
    const data = await exportData();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = `website-usage-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (error) {
    console.error('Error exporting data:', error);
    alert('Failed to export data');
  }
}

/**
 * Handle clear data
 */
async function handleClearData() {
  if (confirm('Are you sure you want to clear all usage data? This cannot be undone.')) {
    try {
      await clearAllData();
      await loadData();
      alert('All data has been cleared');
    } catch (error) {
      console.error('Error clearing data:', error);
      alert('Failed to clear data');
    }
  }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', initDashboard);
