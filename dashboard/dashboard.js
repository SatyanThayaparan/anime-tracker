import { 
  getAggregatedData, 
  getDataForDate,
  getDataForDates,
  getDateRange,
  getTopShows, 
  getTotalTime, 
  formatTime,
  exportData,
  clearAllData,
  getCompletedEpisodes,
  getShowTags,
  setShowTags,
  getSettings,
  saveSettings,
} from '../utils/storage.js';
import {
  SUGGESTED_TAGS,
  computeInsights,
  dailyTotalsFromRaw,
} from '../utils/metrics.js';
import { getCatalogEntry, verifyAnimeTitle } from '../utils/anilist.js';

// State
let currentRange = 1;
let currentData = null;
let currentInsights = null;
let showTags = {};
let activeDetailShow = null;
let showChart = null;
let hourlyChart = null;
let dailyChart = null;
let platformChart = null;

/**
 * Initialize dashboard
 */
async function initDashboard() {
  setupEventListeners();
  window.addEventListener('resize', resizeVisibleCharts);
  await loadSettingsUi();
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

  document.getElementById('detailClose')?.addEventListener('click', closeShowDetail);
  document.getElementById('detailOverlay')?.addEventListener('click', closeShowDetail);
  document.getElementById('peekClose')?.addEventListener('click', closePeek);

  document.querySelectorAll('.stat-card[data-stat]').forEach((card) => {
    const open = () => openStatPeek(card.dataset.stat);
    card.addEventListener('click', open);
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        open();
      }
    });
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeShowDetail();
      closePeek();
      closeInsightsDetail();
    }
  });

  document.getElementById('insightsDetailClose')?.addEventListener('click', closeInsightsDetail);

  document.getElementById('detailTagForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = document.getElementById('detailTagInput');
    const value = input?.value?.trim();
    if (!value || !activeDetailShow) return;
    const next = [...(showTags[activeDetailShow] || []), value];
    showTags = await setShowTags(activeDetailShow, next);
    input.value = '';
    renderDetailTags(activeDetailShow);
    renderInsights();
  });

  const datalist = document.getElementById('tagSuggestions');
  if (datalist) {
    datalist.innerHTML = SUGGESTED_TAGS.map((tag) => `<option value="${tag}"></option>`).join('');
  }

  document.getElementById('settingAnimeOnly')?.addEventListener('change', async (e) => {
    const settings = await getSettings();
    settings.animeOnlyTracking = Boolean(e.target.checked);
    await saveSettings(settings);
  });
  document.getElementById('settingAutoTag')?.addEventListener('change', async (e) => {
    const settings = await getSettings();
    settings.autoTagFromAniList = Boolean(e.target.checked);
    await saveSettings(settings);
  });
}

async function loadSettingsUi() {
  const settings = await getSettings();
  const animeOnly = document.getElementById('settingAnimeOnly');
  const autoTag = document.getElementById('settingAutoTag');
  if (animeOnly) animeOnly.checked = Boolean(settings.animeOnlyTracking);
  if (autoTag) autoTag.checked = settings.autoTagFromAniList !== false;
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
    insights: 'Insights',
    shows: 'All Shows',
    settings: 'Settings'
  };
  document.getElementById('pageTitle').textContent = titles[tabId] || 'Dashboard';
  if (tabId === 'insights') renderInsights();
}

/**
 * Load data based on current range
 */
async function loadData() {
  try {
    currentData = await getAggregatedData(currentRange);
    showTags = await getShowTags();
    const streakRaw = await getDataForDates(getDateRange(90));
    currentInsights = computeInsights(currentData, {
      showTags,
      streakDaily: dailyTotalsFromRaw(streakRaw, 90),
    });

    updateStats();
    updateCharts();
    updateTopShowsTable();
    updateAllShowsTable();
    renderInsights();
    
    // Same chart slot: hourly for today, daily trend for multi-day (keeps one page).
    const title = document.getElementById('activityChartTitle');
    const hourlyWrap = document.getElementById('hourlyChartWrap');
    const dailyWrap = document.getElementById('dailyChartWrap');
    const activityHint = document.getElementById('activityChartHint');
    if (currentRange > 1) {
      if (title) title.textContent = 'Daily Trend';
      if (activityHint) activityHint.textContent = 'Click a day to see shows watched';
      if (hourlyWrap) hourlyWrap.hidden = true;
      if (dailyWrap) dailyWrap.hidden = false;
      updateDailyChart();
    } else {
      if (title) title.textContent = 'Hourly Activity';
      if (activityHint) activityHint.textContent = 'Click a bar to see what you watched';
      if (hourlyWrap) hourlyWrap.hidden = false;
      if (dailyWrap) dailyWrap.hidden = true;
    }
    resizeVisibleCharts();
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
  if (currentRange <= 1) updateHourlyChart();
}

function resizeVisibleCharts() {
  requestAnimationFrame(() => {
    try {
      showChart?.resize();
    } catch {
      /* ignore */
    }
    try {
      if (!document.getElementById('hourlyChartWrap')?.hidden) hourlyChart?.resize();
    } catch {
      /* ignore */
    }
    try {
      if (!document.getElementById('dailyChartWrap')?.hidden) dailyChart?.resize();
    } catch {
      /* ignore */
    }
  });
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
    '#c04028', '#3f5f4e', '#8b6f55', '#5a8f9c', '#d9783a',
    '#3f7a5c', '#a67c52', '#6b8f71', '#c49a6c', '#7aa0ad'
  ];

  if (showChart) {
    showChart.destroy();
  }

  const empty = shows.length === 0;

  showChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: empty ? ['No data'] : labels,
      datasets: [{
        data: empty ? [1] : data,
        backgroundColor: empty ? ['rgba(63, 95, 78, 0.12)'] : colors.slice(0, shows.length),
        borderWidth: 0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      onClick: (_event, elements) => {
        if (empty || !elements?.length) return;
        const idx = elements[0].index;
        const name = labels[idx];
        if (name) openShowDetail(name);
      },
      plugins: {
        legend: {
          display: !empty,
          position: 'right',
          labels: {
            padding: 12,
            usePointStyle: true,
            pointStyle: 'circle',
            color: '#5a6b61',
            font: { size: 11 }
          },
          onClick: (_e, legendItem) => {
            if (empty) return;
            const name = labels[legendItem.index];
            if (name) openShowDetail(name);
          }
        },
        tooltip: {
          enabled: !empty,
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
        backgroundColor: 'rgba(63, 95, 78, 0.88)',
        borderRadius: 5
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      onClick: (_event, elements) => {
        if (!elements?.length) return;
        openHourPeek(elements[0].index);
      },
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
          },
          ticks: { color: '#7a8a80' }
        },
        y: {
          beginAtZero: true,
          grid: { color: 'rgba(79, 107, 92, 0.1)' },
          ticks: {
            color: '#7a8a80',
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
        borderColor: '#c04028',
        backgroundColor: 'rgba(63, 95, 78, 0.14)',
        fill: true,
        tension: 0.4,
        pointBackgroundColor: '#c04028',
        pointBorderColor: '#fffcf7',
        pointRadius: 3
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      onClick: (_event, elements) => {
        if (!elements?.length) return;
        openDayPeek(sortedDays[elements[0].index]);
      },
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
          },
          ticks: { color: '#7a8a80' }
        },
        y: {
          beginAtZero: true,
          grid: { color: 'rgba(79, 107, 92, 0.1)' },
          ticks: {
            color: '#7a8a80',
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
    const safeName = escapeHtml(show.showName);

    return `
      <tr data-showname="${safeName}" tabindex="0" role="button" aria-label="Open details for ${safeName}">
        <td>${index + 1}</td>
        <td>
          <div class="site-cell">
            <span class="site-name">${safeName}</span>
          </div>
        </td>
        <td>
          <span class="category-badge">
            ${escapeHtml(show.site || show.platform || 'Unknown')}
          </span>
        </td>
        <td>${formatTime(show.totalTime, true)}</td>
        <td>${episodesCompleted}</td>
        <td>${show.sessions || 0}</td>
      </tr>
    `;
  }).join('');

  bindShowRowClicks(tbody);
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
    const safeName = escapeHtml(show.showName);

    return `
      <tr data-showname="${safeName}" tabindex="0" role="button" aria-label="Open details for ${safeName}">
        <td>
          <div class="site-cell">
            <span class="site-name">${safeName}</span>
          </div>
        </td>
        <td>
          <span class="category-badge">
            ${escapeHtml(show.site || show.platform || 'Unknown')}
          </span>
        </td>
        <td>${formatTime(show.totalTime, true)}</td>
        <td>${episodesCompleted}</td>
        <td>${show.sessions || 0}</td>
      </tr>
    `;
  }).join('');

  bindShowRowClicks(tbody);
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

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function bindShowRowClicks(tbody) {
  tbody.querySelectorAll('tr[data-showname]').forEach((row) => {
    const open = () => openShowDetail(row.dataset.showname);
    row.addEventListener('click', open);
    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        open();
      }
    });
  });
}

function renderInsights() {
  const grid = document.getElementById('insightsGrid');
  if (!grid || !currentInsights) return;

  const cards = [
    { key: 'completionRate', title: 'Completion rate' },
    { key: 'bingeScore', title: 'Binge score' },
    { key: 'streaks', title: 'Streaks' },
    { key: 'platformSplit', title: 'Platform split' },
    { key: 'primeHours', title: 'Prime hours' },
    { key: 'resumeDebt', title: 'Resume debt' },
    { key: 'pace', title: 'Pace vs runtime' },
    { key: 'genreTags', title: 'Genre / tags' },
    { key: 'rewatch', title: 'Rewatches' },
    { key: 'focusRatio', title: 'Focus ratio' },
  ];

  grid.innerHTML = cards
    .map(({ key, title }) => {
      const metric = currentInsights[key];
      return `
        <button type="button" class="insight-card" data-insight="${key}">
          <span class="insight-label">${title}</span>
          <span class="insight-value">${escapeHtml(metric.label)}</span>
          <span class="insight-detail">${escapeHtml(metric.detail)}</span>
        </button>
      `;
    })
    .join('');

  grid.querySelectorAll('.insight-card').forEach((card) => {
    card.addEventListener('click', () => openInsightDetail(card.dataset.insight));
  });
}

function closeInsightsDetail() {
  const panel = document.getElementById('insightsDetail');
  if (panel) panel.hidden = true;
  document.querySelectorAll('.insight-card.active').forEach((c) => c.classList.remove('active'));
}

function openInsightDetail(key) {
  const metric = currentInsights?.[key];
  const panel = document.getElementById('insightsDetail');
  const title = document.getElementById('insightsDetailTitle');
  const body = document.getElementById('insightsDetailBody');
  if (!metric || !panel || !body) return;

  document.querySelectorAll('.insight-card').forEach((card) => {
    card.classList.toggle('active', card.dataset.insight === key);
  });

  const titles = {
    completionRate: 'Completion rate',
    bingeScore: 'Binge score',
    streaks: 'Watch streaks',
    platformSplit: 'Platform split',
    primeHours: 'Prime hours',
    resumeDebt: 'Resume debt',
    pace: 'Pace vs runtime',
    genreTags: 'Genre / tags',
    rewatch: 'Rewatches',
    focusRatio: 'Focus ratio',
  };
  title.textContent = titles[key] || 'Insight';

  if (key === 'platformSplit') {
    body.innerHTML = `
      <div class="chart-container" style="height:220px;margin-bottom:12px">
        <canvas id="platformChart"></canvas>
      </div>
      <div class="insight-bars">
        ${metric.items
          .map(
            (item) => `
          <div class="insight-bar-row">
            <span>${escapeHtml(item.label)}</span>
            <div class="insight-bar-track"><i style="width:${item.pct}%"></i></div>
            <strong>${item.pct}% · ${formatTime(item.ms, true)}</strong>
          </div>`
          )
          .join('')}
      </div>
    `;
    requestAnimationFrame(() => renderPlatformChart(metric.items));
  } else if (key === 'resumeDebt') {
    body.innerHTML = metric.items?.length
      ? `<div class="detail-list">${metric.items
          .map(
            (item) => `
        <div class="detail-episode">
          <button type="button" class="ep-name" data-show="${escapeHtml(item.showName)}" style="border:none;background:none;padding:0;cursor:pointer;text-align:left;font:inherit;font-weight:700;color:var(--forest)">${escapeHtml(item.showName)} · ${escapeHtml(item.label)}</button>
          <span class="ep-time">${item.progress}%</span>
          <span class="ep-sub">${formatTime(item.time, true)} watched${item.remainingMs ? ` · ~${formatTime(item.remainingMs, true)} left` : ''}</span>
          <div class="ep-bar"><i style="width:${item.progress}%"></i></div>
        </div>`
          )
          .join('')}</div>`
      : `<p class="empty-state">You're caught up — no unfinished episodes in this range.</p>`;
  } else if (key === 'rewatch') {
    body.innerHTML = metric.items?.length
      ? `<div class="detail-list">${metric.items
          .map(
            (item) => `
        <div class="detail-episode">
          <button type="button" class="ep-name" data-show="${escapeHtml(item.showName)}" style="border:none;background:none;padding:0;cursor:pointer;text-align:left;font:inherit;font-weight:700;color:var(--forest)">${escapeHtml(item.showName)} · ${escapeHtml(item.label)}</button>
          <span class="ep-time">${item.rewatches || 0} rewatch</span>
          <span class="ep-sub">${item.sessions} sessions on this episode</span>
        </div>`
          )
          .join('')}</div>`
      : `<p class="empty-state">No rewatches logged yet.</p>`;
  } else if (key === 'genreTags') {
    body.innerHTML = `
      <p style="margin-bottom:10px;color:var(--text-secondary)">${escapeHtml(metric.detail)}</p>
      <div class="insight-bars">
        ${
          metric.items?.length
            ? metric.items
                .map(
                  (item) => `
          <div class="insight-bar-row">
            <span>${escapeHtml(item.tag)}</span>
            <div class="insight-bar-track"><i style="width:${Math.max(8, Math.round((item.ms / (metric.items[0].ms || 1)) * 100))}%"></i></div>
            <strong>${item.shows} shows · ${formatTime(item.ms, true)}</strong>
          </div>`
                )
                .join('')
            : `<p class="empty-state">Open a show and add tags to build your taste map.</p>`
        }
      </div>
    `;
  } else if (key === 'primeHours') {
    body.innerHTML = `
      <div class="detail-stats">
        <div class="detail-stat"><span>Peak hour</span><strong>${escapeHtml(metric.peakLabel)}</strong></div>
        <div class="detail-stat"><span>Peak time</span><strong>${formatTime(metric.peakMs, true)}</strong></div>
        <div class="detail-stat"><span>Best 3h window</span><strong>${escapeHtml(metric.windowLabel)}</strong></div>
        <div class="detail-stat"><span>Window time</span><strong>${formatTime(metric.windowMs, true)}</strong></div>
      </div>
      <p style="color:var(--text-secondary)">${escapeHtml(metric.detail)}</p>
    `;
  } else if (key === 'streaks') {
    body.innerHTML = `
      <div class="detail-stats">
        <div class="detail-stat"><span>Current streak</span><strong>${metric.current}</strong></div>
        <div class="detail-stat"><span>Best streak</span><strong>${metric.best}</strong></div>
        <div class="detail-stat"><span>Last active</span><strong>${escapeHtml(metric.lastActive || '—')}</strong></div>
      </div>
      <p style="color:var(--text-secondary)">Streaks use any day with watch time in the last 90 days.</p>
    `;
  } else if (key === 'bingeScore') {
    body.innerHTML = `
      <div class="detail-stats">
        <div class="detail-stat"><span>Minutes / session</span><strong>${metric.minutesPerSession}</strong></div>
        <div class="detail-stat"><span>Finished eps / session</span><strong>${metric.episodesPerSession}</strong></div>
      </div>
      <p style="color:var(--text-secondary)">${escapeHtml(metric.detail)}</p>
    `;
  } else if (key === 'completionRate') {
    body.innerHTML = `
      <div class="detail-stats">
        <div class="detail-stat"><span>Completion</span><strong>${metric.value}%</strong></div>
        <div class="detail-stat"><span>Finished</span><strong>${metric.completed}</strong></div>
        <div class="detail-stat"><span>Started</span><strong>${metric.started}</strong></div>
      </div>
      <p style="color:var(--text-secondary)">Finished means ≥80% progress or marked complete.</p>
    `;
  } else if (key === 'pace') {
    body.innerHTML = `
      <div class="detail-stats">
        <div class="detail-stat"><span>Pace</span><strong>${metric.pct != null ? `${metric.pct}%` : '—'}</strong></div>
        <div class="detail-stat"><span>Watched</span><strong>${formatTime(metric.watchedMs, true)}</strong></div>
        <div class="detail-stat"><span>Runtime</span><strong>${formatTime(metric.runtimeMs, true)}</strong></div>
      </div>
      <p style="color:var(--text-secondary)">${escapeHtml(metric.detail)}</p>
    `;
  } else if (key === 'focusRatio') {
    body.innerHTML = `
      <div class="detail-stats">
        <div class="detail-stat"><span>Focus</span><strong>${metric.pct != null ? `${metric.pct}%` : '—'}</strong></div>
        <div class="detail-stat"><span>Playing</span><strong>${formatTime(metric.activeTime, true)}</strong></div>
        <div class="detail-stat"><span>Paused</span><strong>${formatTime(metric.pausedTime, true)}</strong></div>
      </div>
      <p style="color:var(--text-secondary)">${escapeHtml(metric.detail)}</p>
    `;
  } else {
    body.innerHTML = `<p>${escapeHtml(metric.detail)}</p>`;
  }

  body.querySelectorAll('button[data-show]').forEach((btn) => {
    btn.addEventListener('click', () => openShowDetail(btn.dataset.show));
  });

  panel.hidden = false;
}

function renderPlatformChart(items = []) {
  const canvas = document.getElementById('platformChart');
  if (!canvas || typeof Chart === 'undefined') return;
  if (platformChart) platformChart.destroy();
  platformChart = new Chart(canvas.getContext('2d'), {
    type: 'doughnut',
    data: {
      labels: items.map((i) => i.label),
      datasets: [
        {
          data: items.map((i) => i.ms),
          backgroundColor: ['#c04028', '#3f5f4e', '#8b6f55', '#5a8f9c'],
          borderWidth: 0,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'right',
          labels: { color: '#5a6b61', usePointStyle: true, pointStyle: 'circle' },
        },
      },
    },
  });
}

function renderDetailTags(showName) {
  const wrap = document.getElementById('detailTags');
  if (!wrap) return;
  const tags = showTags[showName] || [];
  wrap.innerHTML = tags.length
    ? tags
        .map(
          (tag) => `
      <span class="tag-chip">
        ${escapeHtml(tag)}
        <button type="button" data-remove-tag="${escapeHtml(tag)}" aria-label="Remove ${escapeHtml(tag)}">×</button>
      </span>`
        )
        .join('')
    : `<span style="color:var(--text-secondary);font-size:12px">No tags yet</span>`;

  wrap.querySelectorAll('button[data-remove-tag]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const next = (showTags[showName] || []).filter((tag) => tag !== btn.dataset.removeTag);
      showTags = await setShowTags(showName, next);
      renderDetailTags(showName);
      renderInsights();
    });
  });

  const suggestions = document.createElement('div');
  suggestions.className = 'tag-suggestions';
  suggestions.innerHTML = SUGGESTED_TAGS.filter((tag) => !tags.includes(tag))
    .slice(0, 6)
    .map((tag) => `<button type="button" data-add-tag="${tag}">${tag}</button>`)
    .join('');
  wrap.appendChild(suggestions);
  suggestions.querySelectorAll('button[data-add-tag]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const next = [...(showTags[showName] || []), btn.dataset.addTag];
      showTags = await setShowTags(showName, next);
      renderDetailTags(showName);
      renderInsights();
    });
  });
}

function openShowDetail(showName) {
  const show = currentData?.shows?.[showName];
  if (!show) return;

  activeDetailShow = showName;

  document.querySelectorAll('tr[data-showname]').forEach((row) => {
    row.classList.toggle('selected', row.dataset.showname === showName);
  });

  const overlay = document.getElementById('detailOverlay');
  const drawer = document.getElementById('detailDrawer');
  document.getElementById('detailTitle').textContent = showName;

  const site = show.site || show.platform || 'Unknown';
  const completed = getCompletedEpisodes(show.episodes);
  const episodeCount = Object.keys(show.episodes || {}).length;
  document.getElementById('detailMeta').innerHTML = `
    <span class="detail-chip">${escapeHtml(site)}</span>
    <span class="detail-chip accent">${completed}/${episodeCount || 0} episodes done</span>
  `;

  const avgSession =
    show.sessions > 0 ? show.totalTime / show.sessions : show.totalTime;
  document.getElementById('detailStats').innerHTML = `
    <div class="detail-stat"><span>Total time</span><strong>${formatTime(show.totalTime, true)}</strong></div>
    <div class="detail-stat"><span>Sessions</span><strong>${show.sessions || 0}</strong></div>
    <div class="detail-stat"><span>Avg session</span><strong>${formatTime(avgSession, true)}</strong></div>
    <div class="detail-stat"><span>Last watched</span><strong>${
      show.lastWatched
        ? new Date(show.lastWatched).toLocaleDateString(undefined, {
            month: 'short',
            day: 'numeric',
          })
        : '—'
    }</strong></div>
  `;

  const episodes = Object.entries(show.episodes || {})
    .map(([key, ep]) => ({ key, ...ep }))
    .sort((a, b) => (b.time || 0) - (a.time || 0));

  const epEl = document.getElementById('detailEpisodes');
  if (!episodes.length) {
    epEl.innerHTML = `<p class="empty-state">No episode breakdown yet — keep watching and it will fill in.</p>`;
  } else {
    epEl.innerHTML = episodes
      .map((ep) => {
        const progress = Math.min(100, Math.round((ep.progress || 0) * 100));
        const label = ep.label || `Episode ${ep.key}`;
        return `
          <div class="detail-episode">
            <span class="ep-name">${escapeHtml(label)}</span>
            <span class="ep-time">${formatTime(ep.time || 0, true)}</span>
            <span class="ep-sub">${progress}% watched · ${ep.sessions || 0} sessions${
              ep.completed ? ' · completed' : ''
            }</span>
            <div class="ep-bar"><i style="width:${progress}%"></i></div>
          </div>
        `;
      })
      .join('');
  }

  const hourly = show.hourly || {};
  const maxHour = Math.max(1, ...Object.values(hourly).map((v) => v || 0));
  const hoursEl = document.getElementById('detailHours');
  hoursEl.innerHTML = Array.from({ length: 24 }, (_, i) => {
    const key = String(i).padStart(2, '0');
    const ms = hourly[key] || 0;
    const pct = Math.max(ms > 0 ? 8 : 2, Math.round((ms / maxHour) * 100));
    return `
      <div class="detail-hour" title="${key}:00 · ${formatTime(ms, true)}">
        <div class="bar" style="height:${pct}%"></div>
        <span class="lbl">${i % 3 === 0 ? i : ''}</span>
      </div>
    `;
  }).join('');

  renderDetailTags(showName);
  void renderDetailAnime(showName);

  overlay.hidden = false;
  drawer.classList.add('open');
  drawer.setAttribute('aria-hidden', 'false');
  closePeek();
}

async function renderDetailAnime(showName) {
  const el = document.getElementById('detailAnime');
  if (!el) return;
  el.innerHTML = `<p class="empty-state">Checking AniList…</p>`;

  let entry = await getCatalogEntry(showName);
  if (!entry || entry.status === 'error') {
    entry = await verifyAnimeTitle(showName, { force: entry?.status === 'error' });
  }

  if (!entry || entry.status === 'error') {
    el.innerHTML = `
      <p class="empty-state">Could not reach AniList.</p>
      <button type="button" class="btn btn-secondary btn-sm" data-anime-action="retry">Retry</button>
    `;
  } else if (entry.status === 'confirmed' || entry.status === 'likely') {
    const title =
      entry.match?.title?.english ||
      entry.match?.title?.romaji ||
      entry.match?.title?.userPreferred ||
      'Matched anime';
    const pct = Math.round((entry.confidence || 0) * 100);
    el.innerHTML = `
      <div class="detail-anime-card">
        <span class="detail-chip accent">${entry.status === 'confirmed' ? 'Anime' : 'Likely anime'} · ${pct}%</span>
        <p class="detail-anime-title">${escapeHtml(title)}</p>
        <p class="detail-anime-meta">${escapeHtml((entry.match?.format || 'ANIME').replaceAll('_', ' '))}${
          entry.match?.episodes ? ` · ${entry.match.episodes} eps` : ''
        }${entry.match?.genres?.length ? ` · ${escapeHtml(entry.match.genres.slice(0, 4).join(', '))}` : ''}</p>
        <div class="anime-actions">
          ${
            entry.match?.siteUrl
              ? `<a class="btn btn-secondary btn-sm" href="${escapeHtml(entry.match.siteUrl)}" target="_blank" rel="noreferrer">Open AniList</a>`
              : ''
          }
          ${
            entry.status === 'likely'
              ? `<button type="button" class="btn btn-primary btn-sm" data-anime-action="confirm">Confirm</button>`
              : ''
          }
          <button type="button" class="btn btn-secondary btn-sm" data-anime-action="reject">Not anime</button>
        </div>
      </div>
    `;
  } else {
    const candidates = entry.candidates || [];
    el.innerHTML = `
      <p class="empty-state">No confident AniList match.</p>
      ${
        candidates.length
          ? `<div class="detail-list">${candidates
              .slice(0, 4)
              .map((c) => {
                const label = c.title?.english || c.title?.romaji || c.title?.userPreferred || 'Candidate';
                return `<div class="detail-episode">
                  <span class="ep-name">${escapeHtml(label)}</span>
                  <span class="ep-time">${Math.round((c.confidence || 0) * 100)}%</span>
                  <span class="ep-sub">${escapeHtml((c.format || '').replaceAll('_', ' '))}${
                    c.genres?.length ? ` · ${escapeHtml(c.genres.slice(0, 3).join(', '))}` : ''
                  }</span>
                  <button type="button" class="btn btn-secondary btn-sm" data-anime-pick="${c.id}">Use this</button>
                </div>`;
              })
              .join('')}</div>`
          : ''
      }
      <div class="anime-actions" style="margin-top:8px">
        <button type="button" class="btn btn-primary btn-sm" data-anime-action="confirm">Mark as anime</button>
        <button type="button" class="btn btn-secondary btn-sm" data-anime-action="retry">Search again</button>
      </div>
    `;
  }

  el.querySelectorAll('[data-anime-action]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const action = btn.dataset.animeAction;
      if (action === 'retry') {
        await verifyAnimeTitle(showName, { force: true });
        await renderDetailAnime(showName);
        return;
      }
      chrome.runtime.sendMessage(
        {
          type: 'SET_ANIME_OVERRIDE',
          showName,
          status: action === 'confirm' ? 'confirmed' : 'rejected',
          match: action === 'confirm' ? entry?.match || null : null,
        },
        async () => {
          void chrome.runtime.lastError;
          await renderDetailAnime(showName);
          showTags = await getShowTags();
          renderDetailTags(showName);
          renderInsights();
        }
      );
    });
  });

  el.querySelectorAll('[data-anime-pick]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const pick = (entry.candidates || []).find((c) => String(c.id) === String(btn.dataset.animePick));
      chrome.runtime.sendMessage(
        {
          type: 'SET_ANIME_OVERRIDE',
          showName,
          status: 'confirmed',
          match: pick || null,
        },
        async () => {
          void chrome.runtime.lastError;
          await renderDetailAnime(showName);
          showTags = await getShowTags();
          renderDetailTags(showName);
          renderInsights();
        }
      );
    });
  });
}

function closeShowDetail() {
  const overlay = document.getElementById('detailOverlay');
  const drawer = document.getElementById('detailDrawer');
  if (overlay) overlay.hidden = true;
  if (drawer) {
    drawer.classList.remove('open');
    drawer.setAttribute('aria-hidden', 'true');
  }
  activeDetailShow = null;
  document.querySelectorAll('tr[data-showname].selected').forEach((row) => {
    row.classList.remove('selected');
  });
}

function showPeek({ kicker, title, value, items }) {
  const card = document.getElementById('peekCard');
  document.getElementById('peekKicker').textContent = kicker;
  document.getElementById('peekTitle').textContent = title;
  document.getElementById('peekValue').textContent = value;
  const list = document.getElementById('peekList');
  list.innerHTML = (items || [])
    .map(
      (item) => `
      <li>
        ${
          item.showName
            ? `<button type="button" data-show="${escapeHtml(item.showName)}">${escapeHtml(
                item.label
              )}</button>`
            : `<span>${escapeHtml(item.label)}</span>`
        }
        <span>${escapeHtml(item.meta)}</span>
      </li>`
    )
    .join('') || `<li><span>No details for this slice</span><span></span></li>`;

  list.querySelectorAll('button[data-show]').forEach((btn) => {
    btn.addEventListener('click', () => openShowDetail(btn.dataset.show));
  });

  card.hidden = false;
}

function closePeek() {
  const card = document.getElementById('peekCard');
  if (card) card.hidden = true;
  document.querySelectorAll('.stat-card.active-filter').forEach((c) => {
    c.classList.remove('active-filter');
  });
}

function openHourPeek(hourIndex) {
  const hour = String(hourIndex).padStart(2, '0');
  const total = currentData?.hourly?.[hour] || 0;
  const items = Object.entries(currentData?.shows || {})
    .map(([name, show]) => ({
      showName: name,
      label: name,
      meta: formatTime(show.hourly?.[hour] || 0, true),
      ms: show.hourly?.[hour] || 0,
    }))
    .filter((item) => item.ms > 0)
    .sort((a, b) => b.ms - a.ms)
    .slice(0, 6);

  showPeek({
    kicker: 'Hourly slice',
    title: `${hourIndex}:00 – ${hourIndex}:59`,
    value: formatTime(total, true),
    items,
  });
}

async function openDayPeek(dateKey) {
  if (!dateKey) return;
  const day = await getDataForDate(dateKey);
  const shows = Object.entries(day.shows || {})
    .map(([name, show]) => ({
      showName: name,
      label: name,
      meta: formatTime(show.totalTime || 0, true),
      ms: show.totalTime || 0,
    }))
    .sort((a, b) => b.ms - a.ms)
    .slice(0, 8);

  const total = shows.reduce((sum, s) => sum + s.ms, 0);
  const label = new Date(`${dateKey}T12:00:00`).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });

  showPeek({
    kicker: 'Day slice',
    title: label,
    value: formatTime(total, true),
    items: shows,
  });
}

function openStatPeek(stat) {
  document.querySelectorAll('.stat-card[data-stat]').forEach((card) => {
    card.classList.toggle('active-filter', card.dataset.stat === stat);
  });

  const shows = Object.entries(currentData?.shows || {})
    .map(([name, show]) => ({ name, ...show }))
    .sort((a, b) => (b.totalTime || 0) - (a.totalTime || 0));

  if (stat === 'time') {
    showPeek({
      kicker: 'Total time',
      title: 'Where time went',
      value: formatTime(currentData?.stats?.totalTime || getTotalTime(currentData?.shows || {}), true),
      items: shows.slice(0, 6).map((s) => ({
        showName: s.name,
        label: s.name,
        meta: formatTime(s.totalTime || 0, true),
      })),
    });
    return;
  }

  if (stat === 'episodes') {
    const items = shows
      .map((s) => ({
        showName: s.name,
        label: s.name,
        meta: `${getCompletedEpisodes(s.episodes)} done`,
        count: getCompletedEpisodes(s.episodes),
      }))
      .filter((s) => s.count > 0)
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);
    showPeek({
      kicker: 'Episodes',
      title: 'Completed episodes',
      value: String(currentData?.stats?.episodesWatched || 0),
      items,
    });
    return;
  }

  if (stat === 'shows') {
    showPeek({
      kicker: 'Shows',
      title: 'Active in this range',
      value: String(shows.length),
      items: shows.slice(0, 8).map((s) => ({
        showName: s.name,
        label: s.name,
        meta: formatTime(s.totalTime || 0, true),
      })),
    });
    return;
  }

  if (stat === 'sessions') {
    const items = shows
      .map((s) => ({
        showName: s.name,
        label: s.name,
        meta: `${s.sessions || 0} sessions`,
        count: s.sessions || 0,
      }))
      .filter((s) => s.count > 0)
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);
    const total = shows.reduce((sum, s) => sum + (s.sessions || 0), 0);
    showPeek({
      kicker: 'Sessions',
      title: 'Viewing sessions',
      value: String(total),
      items,
    });
  }
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
