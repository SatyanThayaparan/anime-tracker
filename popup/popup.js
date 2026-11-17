/** Keep in sync with utils/anilist.js MIN_CONFIDENT */
const MIN_CONFIDENT = 0.8;

function formatTimeShort(ms) {
  if (!ms || ms < 1000) return '0s';
  const minutes = Math.floor(ms / 60000);
  const hours = Math.floor(minutes / 60);
  if (hours > 0) {
    const rem = minutes % 60;
    return rem > 0 ? `${hours}h ${rem}m` : `${hours}h`;
  }
  return `${Math.max(1, minutes)}m`;
}

async function initPopup() {
  try {
    // Dashboard button is also bound in popup-boot.js
    setupEventListeners();
    await refresh();
    setInterval(() => {
      void refresh();
    }, 2000);
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
    let settled = false;
    const finish = (fn) => {
      if (settled) return;
      settled = true;
      try {
        fn();
      } catch (error) {
        console.error(error);
        showError();
      }
      resolve();
    };

    const timer = setTimeout(() => {
      finish(() => {
        document.getElementById('currentWatching').innerHTML = `
          <div class="empty-state">
            <div class="empty-state-icon">⏳</div>
            <div class="empty-state-title">Extension waking up</div>
            <div class="empty-state-subtitle">Open a supported streaming tab, then reopen this popup</div>
          </div>
        `;
      });
    }, 2500);

    try {
      chrome.runtime.sendMessage({ type: 'GET_TRACKING_STATE' }, (response) => {
        clearTimeout(timer);
        if (chrome.runtime.lastError) {
          console.error(chrome.runtime.lastError);
          finish(() => showError());
          return;
        }
        finish(() => {
          displayCurrentWatching(response?.tracking);
          displayDebug(response?.debug, response?.tracking);
        });
      });
    } catch (error) {
      clearTimeout(timer);
      console.error(error);
      finish(() => showError());
    }
  });
}

async function loadTodaySummary() {
  const el = document.getElementById('todaySummary');
  if (!el) return;

  try {
    const date = new Date();
    const dateKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    const data = await chrome.storage.local.get([dateKey]);
    const today = data[dateKey] || { shows: {}, dailyStats: {} };
    const total = today?.dailyStats?.totalTime || 0;
    const shows = Object.keys(today?.shows || {}).length;
    el.textContent = `Today · ${formatTimeShort(total)} · ${shows} title${shows === 1 ? '' : 's'}`;
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
        <div class="empty-state-subtitle">Open Netflix, YouTube, Disney+, Crunchyroll, or Prime Video to start tracking</div>
      </div>
    `;
    return;
  }

  const seasonNum =
    tracking.seasonNumber != null
      ? Number(tracking.seasonNumber)
      : tracking.seasonProgress?.season != null
        ? Number(tracking.seasonProgress.season)
        : null;
  const episodeLine =
    tracking.episodeNumber != null
      ? seasonNum != null
        ? `Season ${seasonNum} · Episode ${escapeHtml(tracking.episodeNumber)}`
        : `Episode ${escapeHtml(tracking.episodeNumber)}`
      : tracking.episodeLabel
        ? escapeHtml(tracking.episodeLabel)
        : seasonNum != null
          ? `Season ${seasonNum}`
          : 'Episode in progress';

  const site =
    (
      {
        netflix: 'Netflix',
        youtube: 'YouTube',
        disneyplus: 'Disney+',
        crunchyroll: 'Crunchyroll',
        primevideo: 'Prime Video',
      }[tracking.platform] ||
      tracking.platform ||
      tracking.hostname ||
      'streaming site'
    );
  const paused = tracking.videoProgress?.paused;
  const inactive = tracking.isActive === false;
  const anime = tracking.animeMatch;
  const posterUrl = anime?.match?.coverImage;
  const confidence = anime?.confidence || 0;
  const confident =
    anime?.status === 'confirmed' ||
    (anime?.match && confidence >= MIN_CONFIDENT);

  const seasonProgressHtml = renderSeasonProgress(tracking.seasonProgress, seasonNum);
  const animeBlock = renderAnimeBlock(anime, confident);

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
      <div class="show-layout">
        ${
          posterUrl
            ? `<img class="show-poster" src="${escapeHtml(posterUrl)}" alt="" width="72" height="102" referrerpolicy="no-referrer">`
            : `<div class="show-poster placeholder" aria-hidden="true">📺</div>`
        }
        <div class="show-header">
          <div class="show-name">${escapeHtml(tracking.showName)}</div>
          <div class="episode-info">${episodeLine}</div>
          <div class="show-site">on ${escapeHtml(site)}</div>
          ${seasonProgressHtml}
          ${animeBlock}
        </div>
      </div>
      ${progressHTML}
      <div id="wrongAnimePanel" class="wrong-anime-panel" hidden></div>
    </div>
  `;

  bindAnimeActions(container, tracking.showName, anime);

  // If we have a confident match but no poster yet, force a refresh once.
  if (confident && anime?.match && !posterUrl) {
    chrome.runtime.sendMessage(
      { type: 'VERIFY_ANIME', showName: tracking.showName, force: true },
      () => {
        void chrome.runtime.lastError;
      }
    );
  }

  const posterImg = container.querySelector('img.show-poster');
  if (posterImg) {
    posterImg.addEventListener('error', () => {
      posterImg.replaceWith(
        Object.assign(document.createElement('div'), {
          className: 'show-poster placeholder',
          textContent: '📺',
        })
      );
    });
  }
}

function renderSeasonProgress(progress, seasonNum) {
  if (!progress) {
    if (seasonNum == null) {
      return `<div class="season-progress muted">Season · open Netflix episode list once to detect</div>`;
    }
    return `<div class="season-progress muted">Season ${seasonNum} · tracking…</div>`;
  }
  const totalLabel =
    progress.total != null
      ? `${progress.completed}/${progress.total} eps`
      : `${progress.completed} ep${progress.completed === 1 ? '' : 's'} done`;
  const pct = progress.percent != null ? progress.percent : null;
  return `
    <div class="season-progress">
      <div class="season-progress-top">
        <span>Season ${progress.season}</span>
        <span>${totalLabel}${pct != null ? ` · ${pct}%` : ''}</span>
      </div>
      <div class="season-progress-bar">
        <i style="width:${pct != null ? pct : Math.min(100, progress.completed * 8)}%"></i>
      </div>
    </div>
  `;
}

function renderAnimeBlock(anime, confident) {
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

  if (confident || anime.status === 'confirmed') {
    const title =
      anime.match?.title?.english ||
      anime.match?.title?.romaji ||
      anime.match?.title?.userPreferred ||
      'Matched';
    const pct = Math.round((anime.confidence || 1) * 100);
    return `
      <div class="anime-badge ok">Anime · ${escapeHtml(title)}</div>
      <button type="button" class="wrong-anime-link" data-anime-action="wrong">Wrong anime?</button>
    `;
  }

  if (anime.match && (anime.status === 'likely' || (anime.confidence || 0) > 0)) {
    const title =
      anime.match?.title?.english ||
      anime.match?.title?.romaji ||
      anime.match?.title?.userPreferred ||
      'Possible match';
    const pct = Math.round((anime.confidence || 0) * 100);
    return `
      <div class="anime-badge warn">Possible · ${escapeHtml(title)} (${pct}%)</div>
      <div class="anime-actions">
        <button type="button" class="anime-btn" data-anime-action="confirm">This is anime</button>
        <button type="button" class="wrong-anime-link" data-anime-action="wrong">Wrong anime?</button>
      </div>
    `;
  }

  return `
    <div class="anime-badge warn">Not found as anime</div>
    <div class="anime-actions">
      <button type="button" class="anime-btn" data-anime-action="confirm">This is anime</button>
      <button type="button" class="anime-btn ghost" data-anime-action="retry">Search again</button>
    </div>
  `;
}

function showWrongAnimePanel(container, showName, anime) {
  const panel = container.querySelector('#wrongAnimePanel');
  if (!panel) return;
  const candidates = anime?.candidates || [];
  panel.hidden = false;
  panel.innerHTML = `
    <p class="wrong-anime-title">Pick the right title</p>
    <div class="wrong-anime-list">
      ${
        candidates.length
          ? candidates
              .map((c) => {
                const label = c.title?.english || c.title?.romaji || c.title?.userPreferred || 'Candidate';
                return `
                <button type="button" class="wrong-anime-option" data-anime-pick="${c.id}">
                  ${
                    c.coverImage
                      ? `<img src="${escapeHtml(c.coverImage)}" alt="" width="28" height="40">`
                      : ''
                  }
                  <span>
                    <strong>${escapeHtml(label)}</strong>
                    <small>${Math.round((c.confidence || 0) * 100)}% · ${escapeHtml(
                      (c.format || 'ANIME').replaceAll('_', ' ')
                    )}</small>
                  </span>
                </button>`;
              })
              .join('')
          : `<p class="empty-state">No alternate matches. Mark as not anime or search again.</p>`
      }
    </div>
    <div class="anime-actions">
      <button type="button" class="anime-btn ghost" data-anime-action="reject">Not anime</button>
      <button type="button" class="anime-btn ghost" data-anime-action="retry">Search again</button>
      <button type="button" class="anime-btn ghost" data-anime-action="close-wrong">Cancel</button>
    </div>
  `;

  panel.querySelectorAll('[data-anime-pick]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const pick = candidates.find((c) => String(c.id) === String(btn.dataset.animePick));
      chrome.runtime.sendMessage(
        {
          type: 'SET_ANIME_OVERRIDE',
          showName,
          status: 'confirmed',
          match: pick || null,
        },
        () => {
          void chrome.runtime.lastError;
          void loadCurrentWatching();
        }
      );
    });
  });

  bindAnimeActions(panel, showName, anime);
}

function bindAnimeActions(container, showName, anime) {
  container.querySelectorAll('[data-anime-action]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.animeAction;
      if (action === 'wrong') {
        showWrongAnimePanel(container.closest('.current-show-card') || container, showName, anime);
        return;
      }
      if (action === 'close-wrong') {
        const panel = document.getElementById('wrongAnimePanel');
        if (panel) panel.hidden = true;
        return;
      }
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

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    void initPopup();
  });
} else {
  void initPopup();
}
