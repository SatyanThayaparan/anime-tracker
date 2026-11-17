import { formatTime, getTodayData } from '../utils/storage.js';

async function initPopup() {
  try {
    setupEventListeners();
    await refresh();
    setInterval(refresh, 2000);
  } catch (error) {
    console.error('Error initializing popup:', error);
    showError();
  }
}

async function refresh() {
  await Promise.all([loadCurrentWatching(), loadTodaySummary()]);
}

function loadCurrentWatching() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'GET_TRACKING_STATE' }, (response) => {
      if (chrome.runtime.lastError) {
        console.error(chrome.runtime.lastError);
        showError();
        resolve();
        return;
      }

      displayCurrentWatching(response?.tracking);
      displayDebug(response?.debug, response?.tracking);
      resolve();
    });
  });
}

async function loadTodaySummary() {
  const el = document.getElementById('todaySummary');
  if (!el) return;

  try {
    const today = await getTodayData();
    const total = today?.dailyStats?.totalTime || 0;
    const shows = Object.keys(today?.shows || {}).length;
    el.textContent = `Today · ${formatTime(total, true)} · ${shows} title${shows === 1 ? '' : 's'}`;
  } catch {
    el.textContent = 'Today · —';
  }
}

function formatTimeFromSeconds(seconds) {
  if (!seconds || seconds < 0) return '0:00';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${minutes}:${String(secs).padStart(2, '0')}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function displayCurrentWatching(tracking) {
  const container = document.getElementById('currentWatching');

  if (!tracking?.showName) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">📺</div>
        <div class="empty-state-title">Not watching anything</div>
        <div class="empty-state-subtitle">Open Netflix, YouTube, or Disney+ to start tracking</div>
      </div>
    `;
    return;
  }

  const episodeInfo = tracking.episodeLabel
    ? `<div class="episode-info">${escapeHtml(tracking.episodeLabel)}</div>`
    : tracking.episodeNumber != null
      ? `<div class="episode-info">Episode ${escapeHtml(tracking.episodeNumber)}</div>`
      : '';

  const site = tracking.platform || tracking.hostname || 'streaming site';
  const paused = tracking.videoProgress?.paused;
  const inactive = tracking.isActive === false;

  let progressHTML = '';
  const vp = tracking.videoProgress;
  if (vp?.duration > 0) {
    const progressPercent = Math.round((vp.progress || 0) * 100);
    progressHTML = `
      <div class="video-progress">
        <div class="progress-bar-container">
          <div class="progress-bar" style="width: ${progressPercent}%"></div>
        </div>
        <div class="progress-info">
          <span class="progress-time">${formatTimeFromSeconds(vp.currentTime)} / ${formatTimeFromSeconds(vp.duration)}</span>
          <span class="progress-percent">${progressPercent}%</span>
        </div>
        <div class="playback-status">${paused || inactive ? '⏸ Paused' : '▶ Playing'}</div>
      </div>
    `;
  } else {
    progressHTML = `<div class="no-progress">${inactive ? 'Idle — not counting' : 'Tracking time (player progress unavailable)'}</div>`;
  }

  container.innerHTML = `
    <div class="current-show-card">
      <div class="show-header">
        <div class="show-name">${escapeHtml(tracking.showName)}</div>
        ${episodeInfo}
        <div class="show-site">on ${escapeHtml(site)}</div>
      </div>
      ${progressHTML}
    </div>
  `;
}

function displayDebug(debug, tracking) {
  const el = document.getElementById('debugStrip');
  if (!el) return;

  const heartbeatAge =
    debug?.lastHeartbeatAt != null
      ? `${Math.max(0, Math.round((Date.now() - debug.lastHeartbeatAt) / 1000))}s ago`
      : 'none';

  el.textContent = [
    tracking?.hostname ? `site ${tracking.hostname}` : 'site —',
    tracking?.isActive ? 'active' : 'idle',
    `hb ${heartbeatAge}`,
  ].join(' · ');
}

function setupEventListeners() {
  document.getElementById('openDashboard').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('dashboard/dashboard.html') });
    window.close();
  });
}

function showError() {
  document.getElementById('currentWatching').innerHTML = `
    <div class="empty-state">
      <div class="empty-state-icon">⚠️</div>
      <div>Error loading data</div>
    </div>
  `;
}

document.addEventListener('DOMContentLoaded', initPopup);
