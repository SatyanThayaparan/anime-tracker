import { 
  getAggregatedData, 
  getDataForDate,
  getDataForDates,
  getDateKey,
  getDateKeysBetween,
  getDateRange,
  getMonthDateKeys,
  getYearDateKeys,
  getTotalTime, 
  formatTime,
  exportData,
  importData,
  clearAllData,
  getCompletedEpisodes,
  getShowTags,
  setShowTags,
  getSettings,
  saveSettings,
  listStoredDateKeys,
} from '../utils/storage.js';
import {
  SUGGESTED_TAGS,
  buildWrappedRecap,
  computeInsights,
  countFinishedEpisodes,
  dailyTotalsFromRaw,
  getContinueWatching,
} from '../utils/metrics.js';
import {
  backfillMissingPosters,
  catalogKey,
  getAnimeCatalog,
  getCatalogEntry,
  getPosterUrl,
  isConfidentAnimeMatch,
  verifyAnimeTitle,
} from '../utils/anilist.js';

// State
/** @type {{ mode: 'days'|'all'|'custom', days?: number, from?: string, to?: string }} */
let rangeSpec = { mode: 'days', days: 1 };
let currentData = null;
let longRangeData = null;
let heatmapDaily = {};
let currentInsights = null;
let showTags = {};
let animeCatalog = {};
let activeDetailShow = null;
let showChart = null;
let hourlyChart = null;
let dailyChart = null;
let platformChart = null;
let insightPrimeChart = null;
let openInsightKey = null;
let wrapMode = 'month';
let wrapYear = new Date().getFullYear();
let wrapMonth = new Date().getMonth() + 1;

const CONTINUE_RANGE_DAYS = 90;
const HEATMAP_DAYS = 371;

async function resolveRangeDateKeys(spec = rangeSpec) {
  if (spec.mode === 'all') return listStoredDateKeys();
  if (spec.mode === 'custom' && spec.from && spec.to) {
    return getDateKeysBetween(spec.from, spec.to);
  }
  return getDateRange(spec.days || 1);
}

function isMultiDayRange(dateKeys = currentData?.dateKeys) {
  return (dateKeys?.length || 0) > 1;
}

/**
 * Initialize dashboard
 */
async function initDashboard() {
  setupEventListeners();
  initWrappedPickers();
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

  // Time range selector (header only — not Wrapped toggles)
  document.querySelectorAll('#timeRangeSelector .time-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#timeRangeSelector .time-btn').forEach((b) =>
        b.classList.remove('active')
      );
      btn.classList.add('active');

      const value = btn.dataset.range;
      const customPanel = document.getElementById('customRangePanel');

      if (value === 'custom') {
        customPanel.hidden = false;
        const today = getDateKey();
        const fromEl = document.getElementById('rangeFrom');
        const toEl = document.getElementById('rangeTo');
        if (fromEl && !fromEl.value) {
          const monthAgo = new Date();
          monthAgo.setDate(monthAgo.getDate() - 29);
          fromEl.value = getDateKey(monthAgo);
        }
        if (toEl && !toEl.value) toEl.value = today;
        rangeSpec = {
          mode: 'custom',
          from: fromEl?.value || today,
          to: toEl?.value || today,
        };
        return;
      }

      if (customPanel) customPanel.hidden = true;

      if (value === 'all') {
        rangeSpec = { mode: 'all' };
      } else {
        rangeSpec = { mode: 'days', days: parseInt(value, 10) || 1 };
      }
      loadData();
    });
  });

  document.getElementById('applyCustomRange')?.addEventListener('click', () => {
    const from = document.getElementById('rangeFrom')?.value;
    const to = document.getElementById('rangeTo')?.value;
    if (!from || !to) {
      alert('Pick both a start and end date.');
      return;
    }
    rangeSpec = { mode: 'custom', from, to };
    loadData();
  });

  // Show search
  const showSearchEl = document.getElementById('showSearch');
  if (showSearchEl) {
    showSearchEl.addEventListener('input', (e) => {
      filterShows(e.target.value);
    });
  }

  // Export / import / clear
  document.getElementById('exportDataBtn').addEventListener('click', handleExportData);
  document.getElementById('importDataBtn')?.addEventListener('click', () => {
    document.getElementById('importDataInput')?.click();
  });
  document.getElementById('importDataInput')?.addEventListener('change', handleImportData);
  document.getElementById('clearDataBtn').addEventListener('click', handleClearData);

  document.querySelectorAll('.wrapped-mode .time-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.wrapped-mode .time-btn').forEach((b) =>
        b.classList.remove('active')
      );
      btn.classList.add('active');
      wrapMode = btn.dataset.wrap === 'year' ? 'year' : 'month';
      const monthField = document.getElementById('wrappedMonthField');
      if (monthField) monthField.hidden = wrapMode === 'year';
      renderWrapped();
    });
  });

  document.getElementById('wrappedMonth')?.addEventListener('change', (e) => {
    wrapMonth = Number(e.target.value) || wrapMonth;
    renderWrapped();
  });
  document.getElementById('wrappedYear')?.addEventListener('change', (e) => {
    wrapYear = Number(e.target.value) || wrapYear;
    renderWrapped();
  });

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

  const versionEl = document.getElementById('settingsVersion');
  if (versionEl) {
    const manifest = chrome.runtime.getManifest();
    versionEl.textContent = `v${manifest.version}`;
  }
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
    wrapped: 'Wrapped',
    settings: 'Settings',
  };
  document.getElementById('pageTitle').textContent = titles[tabId] || 'Dashboard';

  const headerRight = document.querySelector('.header-right');
  if (headerRight) {
    headerRight.hidden = tabId === 'wrapped' || tabId === 'settings';
  }

  if (tabId === 'insights') renderInsights();
  if (tabId === 'wrapped') renderWrapped();
}

/**
 * Load data based on current range
 */
async function ensureShowCatalog(shows = {}) {
  const names = Object.keys(shows);
  for (const name of names.slice(0, 12)) {
    const key = catalogKey(name);
    const existing = animeCatalog[key];
    if (existing && (existing.status === 'rejected' || isConfidentAnimeMatch(existing))) {
      if (isConfidentAnimeMatch(existing) && !getPosterUrl(existing)) {
        // fall through to verify for poster backfill
      } else {
        continue;
      }
    }
    try {
      // Sequential to respect AniList rate limits
      // eslint-disable-next-line no-await-in-loop
      await verifyAnimeTitle(name);
    } catch {
      /* ignore */
    }
  }
  animeCatalog = await getAnimeCatalog();
}

function posterForShow(showName) {
  const entry = animeCatalog[catalogKey(showName)];
  if (!isConfidentAnimeMatch(entry)) return null;
  return getPosterUrl(entry);
}

function renderShowPoster(showName) {
  const poster = posterForShow(showName);
  if (!poster) {
    return `<span class="show-poster-thumb placeholder" aria-hidden="true">📺</span>`;
  }
  return `<img class="show-poster-thumb" src="${escapeHtml(poster)}" alt="" width="36" height="50" loading="lazy" referrerpolicy="no-referrer">`;
}

function anilistTotalFor(showName) {
  const entry = animeCatalog[catalogKey(showName)];
  if (!isConfidentAnimeMatch(entry)) return null;
  const total = entry?.match?.episodes;
  return total > 0 ? Number(total) : null;
}

function progressForShow(showName, show) {
  const source =
    longRangeData?.shows?.[showName] ||
    currentData?.shows?.[showName] ||
    show;
  const finished = countFinishedEpisodes(source?.episodes || {});
  const total = anilistTotalFor(showName);
  return { finished, total };
}

function formatProgressLabel({ finished, total }) {
  if (total != null) return `${finished} / ${total}`;
  return `${finished} ep${finished === 1 ? '' : 's'}`;
}

async function loadData() {
  try {
    const dateKeys = await resolveRangeDateKeys(rangeSpec);
    currentData = await getAggregatedData({ dateKeys });
    longRangeData = await getAggregatedData(CONTINUE_RANGE_DAYS);
    showTags = await getShowTags();
    animeCatalog = await getAnimeCatalog();
    await backfillMissingPosters({ limit: 6 });
    await ensureShowCatalog({
      ...(longRangeData.shows || {}),
      ...(currentData.shows || {}),
    });
    animeCatalog = await getAnimeCatalog();

    const historyRaw = await getDataForDates(getDateRange(HEATMAP_DAYS));
    heatmapDaily = dailyTotalsFromRaw(historyRaw, HEATMAP_DAYS);
    currentInsights = computeInsights(currentData, {
      showTags,
      streakDaily: dailyTotalsFromRaw(historyRaw, 90),
    });

    updateStats();
    updateCharts();
    updateContinueWatching();
    updateAllShowsTable();
    renderInsights();
    if (document.getElementById('wrappedTab')?.classList.contains('active')) {
      renderWrapped();
    }

    // Same chart slot: hourly for single day, daily trend for multi-day.
    const title = document.getElementById('activityChartTitle');
    const hourlyWrap = document.getElementById('hourlyChartWrap');
    const dailyWrap = document.getElementById('dailyChartWrap');
    const activityHint = document.getElementById('activityChartHint');
    if (isMultiDayRange(dateKeys)) {
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
  if (isMultiDayRange()) updateDailyChart();
  else updateHourlyChart();
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
    try {
      if (document.getElementById('insightsTab')?.classList.contains('active')) {
        insightPrimeChart?.resize();
        platformChart?.resize();
      }
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
function updateContinueWatching() {
  const rail = document.getElementById('continueRail');
  if (!rail) return;

  const items = getContinueWatching(longRangeData?.shows || {}, {
    anilistTotalFor,
  }).slice(0, 10);

  if (!items.length) {
    rail.innerHTML = `
      <div class="continue-empty">
        <p>Nothing unfinished in the last 90 days — you're caught up.</p>
      </div>
    `;
    return;
  }

  rail.innerHTML = items
    .map((item) => {
      const safeName = escapeHtml(item.showName);
      const progress = formatProgressLabel({
        finished: item.finished,
        total: item.total,
      });
      const pct =
        item.total != null && item.total > 0
          ? Math.min(100, Math.round((item.finished / item.total) * 100))
          : item.nextProgress != null
            ? item.nextProgress
            : Math.min(100, item.finished * 8);
      const when = item.lastWatched
        ? new Date(item.lastWatched).toLocaleDateString(undefined, {
            month: 'short',
            day: 'numeric',
          })
        : '';
      const nextBit = item.nextLabel
        ? escapeHtml(item.nextLabel)
        : 'Pick up where you left off';

      return `
      <button type="button" class="continue-card" data-showname="${safeName}" aria-label="Continue ${safeName}">
        ${renderShowPoster(item.showName)}
        <span class="continue-card-copy">
          <span class="continue-card-title">${safeName}</span>
          <span class="continue-card-meta">${nextBit}</span>
          <span class="continue-card-foot">
            <span class="category-badge">${escapeHtml(platformDisplayName(item))}</span>
            <span>${progress}${when ? ` · ${when}` : ''}</span>
          </span>
          <span class="continue-card-bar" aria-hidden="true"><i style="width:${pct}%"></i></span>
        </span>
      </button>`;
    })
    .join('');

  bindShowRowClicks(rail);
}

function platformDisplayName(show) {
  const raw = String(show.platform || show.site || '').toLowerCase();
  if (raw.includes('netflix')) return 'Netflix';
  if (raw.includes('disney')) return 'Disney+';
  if (raw.includes('crunchyroll')) return 'Crunchyroll';
  if (raw.includes('prime') || raw.includes('amazon')) return 'Prime Video';
  if (raw.includes('hidive')) return 'HIDIVE';
  if (raw.includes('hulu')) return 'Hulu';
  return show.site || show.platform || 'Unknown';
}

/**
 * Update All Shows library list
 */
function updateAllShowsTable() {
  const list = document.getElementById('allShowsList');
  const summary = document.getElementById('showsSummary');
  if (!list) return;

  const shows = Object.entries(currentData.shows || {})
    .map(([showName, data]) => ({ showName, ...data }))
    .sort((a, b) => b.totalTime - a.totalTime);

  const totalTime = shows.reduce((sum, show) => sum + (show.totalTime || 0), 0);
  const totalSessions = shows.reduce((sum, show) => sum + (show.sessions || 0), 0);
  const platforms = new Set(shows.map((show) => platformDisplayName(show)));

  if (summary) {
    summary.innerHTML =
      shows.length === 0
        ? `<p class="shows-summary-empty">No shows in this range yet</p>`
        : `
      <div class="shows-stat"><span>Shows</span><strong>${shows.length}</strong></div>
      <div class="shows-stat"><span>Total time</span><strong>${formatTime(totalTime, true)}</strong></div>
      <div class="shows-stat"><span>Sessions</span><strong>${totalSessions}</strong></div>
      <div class="shows-stat"><span>Platforms</span><strong>${platforms.size}</strong></div>
    `;
  }

  if (shows.length === 0) {
    list.innerHTML = `
      <div class="empty-state shows-empty">
        <div class="empty-state-icon">📺</div>
        <p>No shows watched in this period</p>
      </div>
    `;
    return;
  }

  const maxTime = Math.max(1, ...shows.map((show) => show.totalTime || 0));

  list.innerHTML = shows
    .map((show) => {
      const progress = progressForShow(show.showName, show);
      const progressLabel = formatProgressLabel(progress);
      const safeName = escapeHtml(show.showName);
      const pct =
        progress.total != null && progress.total > 0
          ? Math.max(4, Math.min(100, Math.round((progress.finished / progress.total) * 100)))
          : Math.max(4, Math.round(((show.totalTime || 0) / maxTime) * 100));
      const platform = escapeHtml(platformDisplayName(show));

      return `
      <button type="button" class="show-row" data-showname="${safeName}" aria-label="Open details for ${safeName}">
        <div class="show-row-main">
          ${renderShowPoster(show.showName)}
          <div class="show-row-copy">
            <span class="show-row-title">${safeName}</span>
            <span class="show-row-meta">
              <span class="category-badge">${platform}</span>
              <span class="show-row-progress">${progressLabel}${
                progress.total != null ? ' eps' : ''
              }</span>
              <span>${show.sessions || 0} session${(show.sessions || 0) === 1 ? '' : 's'}</span>
            </span>
          </div>
          <strong class="show-row-time">${formatTime(show.totalTime, true)}</strong>
        </div>
        <div class="show-row-bar" aria-hidden="true"><i style="width:${pct}%"></i></div>
      </button>`;
    })
    .join('');

  bindShowRowClicks(list);

  const search = document.getElementById('showSearch');
  if (search?.value) filterShows(search.value);
}

/**
 * Filter library rows by search term
 */
function filterShows(searchTerm) {
  const rows = document.querySelectorAll('#allShowsList .show-row[data-showname]');
  const term = searchTerm.toLowerCase().trim();

  rows.forEach((row) => {
    const showName = row.dataset.showname.toLowerCase();
    row.hidden = Boolean(term) && !showName.includes(term);
  });
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function bindShowRowClicks(root) {
  root.querySelectorAll('[data-showname]').forEach((row) => {
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

function insightSupportButton(section, key, title, metric) {
  return `
    <button type="button" class="insight-support-btn" data-section="${section}" data-insight="${key}">
      <span class="insight-label">${title}</span>
      <span class="insight-value">${escapeHtml(metric?.label || '—')}</span>
      <span class="insight-detail">${escapeHtml(metric?.detail || '')}</span>
    </button>
  `;
}

function renderGenreBars(items = [], limit = 8) {
  if (!items.length) {
    return `<p class="empty-state">Open a show and add tags to build your taste map.</p>`;
  }
  const top = items.slice(0, limit);
  const maxMs = top[0].ms || 1;
  return `
    <div class="insight-bars insight-bars-featured">
      ${top
        .map(
          (item) => `
        <div class="insight-bar-row">
          <span>${escapeHtml(item.tag)}</span>
          <div class="insight-bar-track"><i style="width:${Math.max(8, Math.round((item.ms / maxMs) * 100))}%"></i></div>
          <strong>${item.shows} · ${formatTime(item.ms, true)}</strong>
        </div>`
        )
        .join('')}
    </div>
  `;
}

function renderInsights() {
  const root = document.getElementById('insightsStory');
  if (!root || !currentInsights) return;

  const i = currentInsights;
  const completionPct = i.completionRate?.value || 0;

  root.innerHTML = `
    <section class="insight-section" data-section="rhythm">
      <header class="insight-section-head">
        <h3>Your rhythm</h3>
        <p>When and how steadily you watch</p>
      </header>
      <div class="insight-section-body">
        <div class="insight-featured">
          <div class="insight-featured-copy">
            <span class="insight-label">Prime hours</span>
            <span class="insight-value insight-anim">${escapeHtml(i.primeHours.label)}</span>
            <span class="insight-detail">${escapeHtml(i.primeHours.detail)}</span>
          </div>
          <div class="insight-featured-viz">
            <canvas id="insightPrimeChart" aria-label="Hourly watch activity"></canvas>
          </div>
        </div>
        <div class="insight-support">
          ${insightSupportButton('rhythm', 'streaks', 'Streaks', i.streaks)}
          ${insightSupportButton('rhythm', 'focusRatio', 'Focus ratio', i.focusRatio)}
        </div>
        <div class="watch-heatmap-wrap">
          <div class="watch-heatmap-head">
            <span class="insight-label">Watch calendar</span>
            <span class="watch-heatmap-legend" aria-hidden="true">
              Less <i data-level="0"></i><i data-level="1"></i><i data-level="2"></i><i data-level="3"></i><i data-level="4"></i> More
            </span>
          </div>
          <div class="watch-heatmap" id="watchHeatmap" role="img" aria-label="Watch activity over the past year"></div>
        </div>
        <div class="insight-expand" id="expand-rhythm" hidden></div>
      </div>
    </section>

    <section class="insight-section" data-section="shows">
      <header class="insight-section-head">
        <h3>Your shows</h3>
        <p>How you finish — or leave hanging</p>
      </header>
      <div class="insight-section-body">
        <div class="insight-featured insight-featured-completion">
          <div class="insight-featured-copy">
            <span class="insight-label">Completion rate</span>
            <span class="insight-value insight-anim">${escapeHtml(i.completionRate.label)}</span>
            <span class="insight-detail">${escapeHtml(i.completionRate.detail)}</span>
          </div>
          <div class="insight-featured-viz">
            <div class="completion-ring" style="--pct:${completionPct}" role="img" aria-label="${completionPct}% complete">
              <strong>${completionPct}%</strong>
              <span>${i.completionRate.completed}/${i.completionRate.started}</span>
            </div>
          </div>
        </div>
        <div class="insight-support">
          ${insightSupportButton('shows', 'resumeDebt', 'Resume debt', i.resumeDebt)}
          ${insightSupportButton('shows', 'bingeScore', 'Binge score', i.bingeScore)}
          ${insightSupportButton('shows', 'pace', 'Pace vs runtime', i.pace)}
        </div>
        <div class="insight-expand" id="expand-shows" hidden></div>
      </div>
    </section>

    <section class="insight-section" data-section="taste">
      <header class="insight-section-head">
        <h3>Your taste</h3>
        <p>What you reach for most</p>
      </header>
      <div class="insight-section-body">
        <div class="insight-featured insight-featured-taste">
          <div class="insight-featured-copy">
            <span class="insight-label">Genre / tags</span>
            <span class="insight-value insight-anim">${escapeHtml(i.genreTags.label)}</span>
            <span class="insight-detail">${escapeHtml(i.genreTags.detail)}</span>
          </div>
          <div class="insight-featured-viz insight-featured-viz-bars">
            ${renderGenreBars(i.genreTags.items || [], 6)}
          </div>
        </div>
        <div class="insight-support">
          ${insightSupportButton('taste', 'platformSplit', 'Platform split', i.platformSplit)}
          ${insightSupportButton('taste', 'rewatch', 'Rewatches', i.rewatch)}
        </div>
        <div class="insight-expand" id="expand-taste" hidden></div>
      </div>
    </section>
  `;

  root.querySelectorAll('.insight-support-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      toggleInsightExpand(btn.dataset.section, btn.dataset.insight);
    });
  });

  // Restore open expander after re-render (range change).
  if (openInsightKey) {
    const btn = root.querySelector(`.insight-support-btn[data-insight="${openInsightKey}"]`);
    if (btn) toggleInsightExpand(btn.dataset.section, openInsightKey, true);
    else openInsightKey = null;
  }

  renderWatchHeatmap();

  requestAnimationFrame(() => {
    renderInsightPrimeChart(i.primeHours?.hours || []);
    // Animate bars after paint
    root.querySelectorAll('.insight-bar-track > i').forEach((bar) => {
      const width = bar.style.width;
      bar.style.width = '0%';
      requestAnimationFrame(() => {
        bar.style.width = width;
      });
    });
  });
}

function heatmapLevel(ms, maxMs) {
  if (!ms || ms <= 0) return 0;
  if (!maxMs || maxMs <= 0) return 1;
  const ratio = ms / maxMs;
  if (ratio < 0.15) return 1;
  if (ratio < 0.35) return 2;
  if (ratio < 0.65) return 3;
  return 4;
}

function renderWatchHeatmap() {
  const root = document.getElementById('watchHeatmap');
  if (!root) return;

  const keys = getDateRange(HEATMAP_DAYS).slice().reverse();
  const values = keys.map((key) => heatmapDaily[key] || 0);
  const maxMs = Math.max(0, ...values);
  const activeDays = values.filter((ms) => ms > 0).length;

  // Pad so the first column starts on Sunday (matches common heatmaps).
  const first = new Date(`${keys[0]}T12:00:00`);
  const pad = first.getDay(); // 0 = Sun
  const cells = [];
  for (let i = 0; i < pad; i += 1) {
    cells.push(`<span class="heat-cell heat-pad" aria-hidden="true"></span>`);
  }

  keys.forEach((key, index) => {
    const ms = values[index];
    const level = heatmapLevel(ms, maxMs);
    const label = `${key}: ${ms > 0 ? formatTime(ms, true) : 'no watch time'}`;
    cells.push(
      `<span class="heat-cell" data-level="${level}" title="${escapeHtml(label)}"></span>`
    );
  });

  root.innerHTML = `
    <div class="heat-grid">${cells.join('')}</div>
    <p class="heat-summary">${activeDays} active day${activeDays === 1 ? '' : 's'} in the last year</p>
  `;
}

function closeInsightsDetail() {
  openInsightKey = null;
  document.querySelectorAll('.insight-support-btn.active').forEach((btn) => {
    btn.classList.remove('active');
  });
  document.querySelectorAll('.insight-expand').forEach((panel) => {
    panel.hidden = true;
    panel.innerHTML = '';
  });
}

function toggleInsightExpand(section, key, forceOpen = false) {
  const panel = document.getElementById(`expand-${section}`);
  if (!panel || !currentInsights?.[key]) return;

  const sameOpen = openInsightKey === key && !panel.hidden;
  if (sameOpen && !forceOpen) {
    closeInsightsDetail();
    return;
  }

  // Only one expander open across all sections.
  document.querySelectorAll('.insight-expand').forEach((el) => {
    if (el !== panel) {
      el.hidden = true;
      el.innerHTML = '';
    }
  });
  document.querySelectorAll('.insight-support-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.insight === key);
  });

  openInsightKey = key;
  panel.hidden = false;
  panel.innerHTML = buildInsightExpandHtml(key);
  panel.querySelectorAll('button[data-show]').forEach((btn) => {
    btn.addEventListener('click', () => openShowDetail(btn.dataset.show));
  });

  if (key === 'platformSplit') {
    requestAnimationFrame(() =>
      renderPlatformChart(currentInsights.platformSplit.items || [], 'insightPlatformChart')
    );
  }
}

function buildInsightExpandHtml(key) {
  const metric = currentInsights?.[key];
  if (!metric) return '';

  if (key === 'platformSplit') {
    return `
      <div class="insight-expand-inner">
        <div class="chart-container insight-expand-chart">
          <canvas id="insightPlatformChart"></canvas>
        </div>
        <div class="insight-bars">
          ${(metric.items || [])
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
      </div>`;
  }

  if (key === 'resumeDebt') {
    return metric.items?.length
      ? `<div class="insight-expand-inner detail-list">${metric.items
          .map(
            (item) => `
        <div class="detail-episode">
          <button type="button" class="ep-name linkish" data-show="${escapeHtml(item.showName)}">${escapeHtml(item.showName)} · ${escapeHtml(item.label)}</button>
          <span class="ep-time">${item.progress}%</span>
          <span class="ep-sub">${formatTime(item.time, true)} watched${item.remainingMs ? ` · ~${formatTime(item.remainingMs, true)} left` : ''}</span>
          <div class="ep-bar"><i style="width:${item.progress}%"></i></div>
        </div>`
          )
          .join('')}</div>`
      : `<div class="insight-expand-inner"><p class="empty-state">You're caught up — no unfinished episodes in this range.</p></div>`;
  }

  if (key === 'rewatch') {
    return metric.items?.length
      ? `<div class="insight-expand-inner detail-list">${metric.items
          .map(
            (item) => `
        <div class="detail-episode">
          <button type="button" class="ep-name linkish" data-show="${escapeHtml(item.showName)}">${escapeHtml(item.showName)} · ${escapeHtml(item.label)}</button>
          <span class="ep-time">${item.rewatches || 0} rewatch</span>
          <span class="ep-sub">${item.sessions} sessions on this episode</span>
        </div>`
          )
          .join('')}</div>`
      : `<div class="insight-expand-inner"><p class="empty-state">No rewatches logged yet.</p></div>`;
  }

  if (key === 'streaks') {
    return `
      <div class="insight-expand-inner">
        <div class="detail-stats">
          <div class="detail-stat"><span>Current streak</span><strong>${metric.current}</strong></div>
          <div class="detail-stat"><span>Best streak</span><strong>${metric.best}</strong></div>
          <div class="detail-stat"><span>Last active</span><strong>${escapeHtml(metric.lastActive || '—')}</strong></div>
        </div>
        <p class="insight-expand-note">Streaks use any day with watch time in the last 90 days.</p>
      </div>`;
  }

  if (key === 'bingeScore') {
    return `
      <div class="insight-expand-inner">
        <div class="detail-stats">
          <div class="detail-stat"><span>Minutes / session</span><strong>${metric.minutesPerSession}</strong></div>
          <div class="detail-stat"><span>Finished eps / session</span><strong>${metric.episodesPerSession}</strong></div>
        </div>
        <p class="insight-expand-note">${escapeHtml(metric.detail)}</p>
      </div>`;
  }

  if (key === 'pace') {
    return `
      <div class="insight-expand-inner">
        <div class="detail-stats">
          <div class="detail-stat"><span>Pace</span><strong>${metric.pct != null ? `${metric.pct}%` : '—'}</strong></div>
          <div class="detail-stat"><span>Watched</span><strong>${formatTime(metric.watchedMs, true)}</strong></div>
          <div class="detail-stat"><span>Runtime</span><strong>${formatTime(metric.runtimeMs, true)}</strong></div>
        </div>
        <p class="insight-expand-note">${escapeHtml(metric.detail)}</p>
      </div>`;
  }

  if (key === 'focusRatio') {
    return `
      <div class="insight-expand-inner">
        <div class="detail-stats">
          <div class="detail-stat"><span>Focus</span><strong>${metric.pct != null ? `${metric.pct}%` : '—'}</strong></div>
          <div class="detail-stat"><span>Playing</span><strong>${formatTime(metric.activeTime, true)}</strong></div>
          <div class="detail-stat"><span>Paused</span><strong>${formatTime(metric.pausedTime, true)}</strong></div>
        </div>
        <p class="insight-expand-note">${escapeHtml(metric.detail)}</p>
      </div>`;
  }

  return `<div class="insight-expand-inner"><p class="insight-expand-note">${escapeHtml(metric.detail || '')}</p></div>`;
}

function renderInsightPrimeChart(hours = []) {
  const canvas = document.getElementById('insightPrimeChart');
  if (!canvas || typeof Chart === 'undefined') return;
  if (insightPrimeChart) insightPrimeChart.destroy();

  const labels = hours.map((row) => `${row.hour}`);
  const data = hours.map((row) => (row.ms || 0) / 60000);

  insightPrimeChart = new Chart(canvas.getContext('2d'), {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          data,
          backgroundColor: hours.map((row) =>
            row.hour === currentInsights?.primeHours?.peakHour
              ? '#c04028'
              : 'rgba(63, 95, 78, 0.45)'
          ),
          borderRadius: 3,
          borderSkipped: false,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 650, easing: 'easeOutQuart' },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: (items) => `${items[0]?.label || ''}:00`,
            label: (ctx) => `${Math.round(ctx.raw || 0)}m`,
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: {
            maxRotation: 0,
            autoSkip: true,
            maxTicksLimit: 8,
            color: '#6b7c72',
            font: { size: 10 },
          },
        },
        y: {
          beginAtZero: true,
          grid: { color: 'rgba(63, 95, 78, 0.08)' },
          ticks: {
            color: '#6b7c72',
            font: { size: 10 },
            callback: (v) => `${v}m`,
          },
        },
      },
    },
  });
}

function renderPlatformChart(items = [], canvasId = 'platformChart') {
  const canvas = document.getElementById(canvasId);
  if (!canvas || typeof Chart === 'undefined') return;
  if (platformChart) platformChart.destroy();
  platformChart = new Chart(canvas.getContext('2d'), {
    type: 'doughnut',
    data: {
      labels: items.map((i) => i.label),
      datasets: [
        {
          data: items.map((i) => i.ms),
          backgroundColor: ['#c04028', '#3f5f4e', '#8b6f55', '#5a8f9c', '#a98467'],
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
  const show =
    currentData?.shows?.[showName] || longRangeData?.shows?.[showName];
  if (!show) return;

  activeDetailShow = showName;

  document.querySelectorAll('[data-showname]').forEach((row) => {
    row.classList.toggle('selected', row.dataset.showname === showName);
  });

  const overlay = document.getElementById('detailOverlay');
  const drawer = document.getElementById('detailDrawer');
  document.getElementById('detailTitle').textContent = showName;

  const site = show.site || show.platform || 'Unknown';
  const progress = progressForShow(showName, show);
  const progressLabel =
    progress.total != null
      ? `${progress.finished} / ${progress.total} episodes`
      : `${progress.finished} episode${progress.finished === 1 ? '' : 's'} done`;
  const poster = posterForShow(showName);
  document.getElementById('detailMeta').innerHTML = `
    ${
      poster
        ? `<img class="detail-poster" src="${escapeHtml(poster)}" alt="" width="72" height="102" referrerpolicy="no-referrer">`
        : ''
    }
    <div class="detail-meta-chips">
      <span class="detail-chip">${escapeHtml(site)}</span>
      <span class="detail-chip accent">${escapeHtml(progressLabel)}</span>
    </div>
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
          animeCatalog = await getAnimeCatalog();
          await renderDetailAnime(showName);
          showTags = await getShowTags();
          renderDetailTags(showName);
          updateTopShowsTable();
          updateAllShowsTable();
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
          animeCatalog = await getAnimeCatalog();
          await renderDetailAnime(showName);
          showTags = await getShowTags();
          renderDetailTags(showName);
          updateTopShowsTable();
          updateAllShowsTable();
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
    a.download = `shiori-export-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (error) {
    console.error('Error exporting data:', error);
    alert('Failed to export data');
  }
}

function setImportStatus(message, isError = false) {
  const el = document.getElementById('importStatus');
  if (!el) return;
  el.hidden = !message;
  el.textContent = message || '';
  el.classList.toggle('is-error', Boolean(isError));
}

async function handleImportData(event) {
  const file = event.target?.files?.[0];
  event.target.value = '';
  if (!file) return;

  if (
    !confirm(
      'Import replaces all Shiori data on this device with the file contents. Continue?'
    )
  ) {
    return;
  }

  try {
    const text = await file.text();
    const payload = JSON.parse(text);
    const result = await importData(payload);
    setImportStatus(
      `Imported ${result.importedDays} day${result.importedDays === 1 ? '' : 's'} of history.`
    );
    await loadSettingsUi();
    await loadData();
    renderWrapped();
  } catch (error) {
    console.error('Error importing data:', error);
    setImportStatus(error?.message || 'Failed to import data', true);
    alert(error?.message || 'Failed to import data');
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
      renderWrapped();
      alert('All data has been cleared');
    } catch (error) {
      console.error('Error clearing data:', error);
      alert('Failed to clear data');
    }
  }
}

function initWrappedPickers() {
  const monthEl = document.getElementById('wrappedMonth');
  const yearEl = document.getElementById('wrappedYear');
  if (!monthEl || !yearEl) return;

  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];
  monthEl.innerHTML = monthNames
    .map(
      (name, index) =>
        `<option value="${index + 1}" ${index + 1 === wrapMonth ? 'selected' : ''}>${name}</option>`
    )
    .join('');

  const thisYear = new Date().getFullYear();
  const years = [];
  for (let y = thisYear; y >= thisYear - 6; y -= 1) years.push(y);
  yearEl.innerHTML = years
    .map((y) => `<option value="${y}" ${y === wrapYear ? 'selected' : ''}>${y}</option>`)
    .join('');

  const monthField = document.getElementById('wrappedMonthField');
  if (monthField) monthField.hidden = wrapMode === 'year';
}

async function renderWrapped() {
  const card = document.getElementById('wrappedCard');
  if (!card) return;

  const dateKeys =
    wrapMode === 'year'
      ? getYearDateKeys(wrapYear)
      : getMonthDateKeys(wrapYear, wrapMonth);

  const label =
    wrapMode === 'year'
      ? String(wrapYear)
      : new Date(wrapYear, wrapMonth - 1, 1).toLocaleString(undefined, {
          month: 'long',
          year: 'numeric',
        });

  try {
    const aggregated = await getAggregatedData({ dateKeys });
    const insights = computeInsights(aggregated, { showTags });
    const recap = buildWrappedRecap(aggregated, insights, { label });

    if (!recap.totalTime && !recap.showCount) {
      card.innerHTML = `
        <div class="wrapped-empty">
          <p class="wrapped-kicker">Shiori Wrapped</p>
          <h2>${escapeHtml(label)}</h2>
          <p>No watch time in this period yet.</p>
        </div>
      `;
      return;
    }

    const topList = recap.topShows
      .map(
        (show, index) => `
        <li>
          <span class="wrapped-rank">${index + 1}</span>
          <span class="wrapped-show-name">${escapeHtml(show.showName)}</span>
          <span class="wrapped-show-time">${formatTime(show.totalTime, true)}</span>
        </li>`
      )
      .join('');

    card.innerHTML = `
      <div class="wrapped-hero">
        <p class="wrapped-kicker">Shiori Wrapped</p>
        <h2>${escapeHtml(label)}</h2>
        <p class="wrapped-lede">A bookmark of what you watched</p>
      </div>
      <div class="wrapped-stats">
        <div><span>Time</span><strong>${formatTime(recap.totalTime, true)}</strong></div>
        <div><span>Episodes</span><strong>${recap.episodes}</strong></div>
        <div><span>Shows</span><strong>${recap.showCount}</strong></div>
        <div><span>Active days</span><strong>${recap.activeDays}</strong></div>
      </div>
      <div class="wrapped-highlights">
        <div>
          <span class="wrapped-label">Best streak</span>
          <strong>${recap.streakBest} day${recap.streakBest === 1 ? '' : 's'}</strong>
        </div>
        <div>
          <span class="wrapped-label">Prime hours</span>
          <strong>${escapeHtml(recap.primeLabel)}</strong>
        </div>
        <div>
          <span class="wrapped-label">Top platform</span>
          <strong>${escapeHtml(recap.topPlatform || '—')}</strong>
        </div>
        <div>
          <span class="wrapped-label">Top genre</span>
          <strong>${escapeHtml(recap.topGenre || 'Add tags')}</strong>
        </div>
      </div>
      <div class="wrapped-tops">
        <h3>Top shows</h3>
        <ol class="wrapped-top-list">${topList || '<li>No shows yet</li>'}</ol>
      </div>
    `;
  } catch (error) {
    console.error('Wrapped render failed:', error);
    card.innerHTML = `<p class="empty-state">Could not build this wrapped card.</p>`;
  }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', initDashboard);
