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
  const anime = tracking.animeMatch;
  const animeBadge = renderAnimeBadge(anime);

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
        ${animeBadge}
      </div>
      ${progressHTML}
    </div>
  `;

  bindAnimeActions(container, tracking.showName, anime);
}

function renderAnimeBadge(anime) {
  if (!anime) {
    return `<div class="anime-badge checking">Checking AniList…</div>`;
  }
  if (anime.status === 'error') {
    return `
      <div class="anime-badge warn">AniList unavailable</div>
      <div class="anime-actions">
        <button type="button" class="anime-btn" data-anime-action="retry">Retry</button>
      </div>
    `;
  }
  if (anime.status === 'confirmed' || anime.status === 'likely') {
    const title =
      anime.match?.title?.english ||
      anime.match?.title?.romaji ||
      anime.match?.title?.userPreferred ||
      'Matched';
    const pct = Math.round((anime.confidence || 0) * 100);
    return `
      <div class="anime-badge ok">Anime · ${escapeHtml(title)} (${pct}%)</div>
      <div class="anime-actions">
        ${
          anime.status === 'likely'
            ? `<button type="button" class="anime-btn" data-anime-action="confirm">Confirm</button>`
            : ''
        }
        <button type="button" class="anime-btn ghost" data-anime-action="reject">Not anime</button>
      </div>
    `;
  }
  return `
    <div class="anime-badge warn">Not found as anime</div>
    <div class="anime-actions">
      <button type="button" class="anime-btn" data-anime-action="confirm">Mark as anime</button>
      <button type="button" class="anime-btn ghost" data-anime-action="retry">Search again</button>
    </div>
  `;
}

function bindAnimeActions(container, showName, anime) {
  container.querySelectorAll('[data-anime-action]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.animeAction;
      if (action === 'retry') {
        chrome.runtime.sendMessage(
          { type: 'VERIFY_ANIME', showName, force: true },
          () => {
            void chrome.runtime.lastError;
            void loadCurrentWatching();
          }
        );
        return;
      }
      if (action === 'confirm') {
        chrome.runtime.sendMessage(
          {
            type: 'SET_ANIME_OVERRIDE',
            showName,
            status: 'confirmed',
            match: anime?.match || null,
          },
          () => {
            void chrome.runtime.lastError;
            void loadCurrentWatching();
          }
        );
        return;
      }
      if (action === 'reject') {
        chrome.runtime.sendMessage(
          { type: 'SET_ANIME_OVERRIDE', showName, status: 'rejected', match: null },
          () => {
            void chrome.runtime.lastError;
            void loadCurrentWatching();
          }
        );
      }
    });
  });
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
