import {
  backfillMissingPosters,
  getCatalogEntry,
  isAnimeStatus,
  setCatalogOverride,
  verifyAnimeTitle,
} from './utils/anilist.js';
import { extractHostname } from './utils/categories.js';
import { isWatchSite } from './utils/shows.js';
import { episodeStorageKey } from './utils/normalize.js';
import {
  CURRENT_SCHEMA_VERSION,
  getDateKey,
  getSettings,
  getShowTags,
  getTodayData,
  migrateWatchData,
  setShowTags,
} from './utils/storage.js';

const SCHEMA_VERSION = CURRENT_SCHEMA_VERSION;
const ALARM_SAVE = 'anime-tracker-save';

const CONFIG = {
  IDLE_THRESHOLD: 60,
  SESSION_TIMEOUT: 30 * 60 * 1000,
  MIN_SAVE_MS: 1000,
};

let currentTracking = emptyTracking();
let lastHeartbeatAt = null;
let listenersBound = false;
/** Tabs where content.js has been injected in this service-worker lifetime. */
const contentReadyTabs = new Set();
/** In-flight AniList lookups keyed by catalog title. */
const animeVerifyInflight = new Map();

function emptyTracking() {
  return {
    tabId: null,
    url: null,
    hostname: null,
    platform: null,
    showName: null,
    seasonNumber: null,
    episodeNumber: null,
    episodeLabel: null,
    startTime: null,
    lastActivityTime: null,
    isActive: false,
    isPlaying: null,
    videoProgress: null,
    animeMatch: null,
    seasonProgress: null,
  };
}

function computeSeasonProgress(showData, seasonNumber, anilistEpisodes) {
  // Only default to 1 when we truly have no season signal.
  const season = seasonNumber != null && Number(seasonNumber) > 0 ? Number(seasonNumber) : 1;
  const episodes = Object.values(showData?.episodes || {});
  const inSeason = episodes.filter((ep) => Number(ep.seasonNumber || 1) === season);
  const completed = inSeason.filter(
    (ep) => ep.completed || (ep.progress || 0) >= 0.8
  ).length;
  const started = inSeason.length;
  const total = anilistEpisodes > 0 ? Number(anilistEpisodes) : null;
  const percent =
    total != null && total > 0 ? Math.min(100, Math.round((completed / total) * 100)) : null;
  return {
    season,
    completed,
    started,
    total,
    percent,
  };
}

async function buildSeasonProgress(showName, seasonNumber, animeMatch) {
  if (!showName) return null;
  try {
    const today = await getTodayData();
    const showData = today?.shows?.[showName];
    return computeSeasonProgress(
      showData,
      seasonNumber,
      animeMatch?.match?.episodes
    );
  } catch {
    return computeSeasonProgress(
      null,
      seasonNumber,
      animeMatch?.match?.episodes
    );
  }
}

async function maybeAutoTagFromAniList(showName, match) {
  if (!showName || !match?.genres?.length) return;
  const settings = await getSettings();
  if (!settings.autoTagFromAniList) return;
  const existing = await getShowTags();
  if ((existing[showName] || []).length) return;
  const tags = match.genres.map((g) => String(g).toLowerCase()).slice(0, 6);
  await setShowTags(showName, tags);
}

async function ensureAnimeVerification(showName, { force = false } = {}) {
  if (!showName) return null;
  const key = showName.toLowerCase();
  if (!force && animeVerifyInflight.has(key)) {
    return animeVerifyInflight.get(key);
  }

  const job = (async () => {
    const result = await verifyAnimeTitle(showName, { force });
    if (currentTracking.showName === showName) {
      currentTracking.animeMatch = result;
    }
    if (result?.isAnime && result.match) {
      await maybeAutoTagFromAniList(showName, result.match);
    }
    return result;
  })().finally(() => {
    animeVerifyInflight.delete(key);
  });

  animeVerifyInflight.set(key, job);
  return job;
}

async function initializeStorage() {
  const data = await chrome.storage.local.get(['settings', 'meta']);
  const patch = {};

  if (!data.settings) {
    patch.settings = {
      idleThreshold: CONFIG.IDLE_THRESHOLD,
      sessionTimeout: CONFIG.SESSION_TIMEOUT,
    };
  }

  if (Object.keys(patch).length) {
    await chrome.storage.local.set(patch);
  }

  // Keep history across updates. Repair runs when schema bumps OR fragmented keys remain.
  try {
    const result = await migrateWatchData(SCHEMA_VERSION);
    if (result.migrated) {
      console.log(
        `[Shiori] Migrated storage to v${SCHEMA_VERSION}; fixed ${result.fixedShows} show keys`
      );
    } else if (!data.meta) {
      await chrome.storage.local.set({
        meta: {
          schemaVersion: SCHEMA_VERSION,
          createdAt: new Date().toISOString(),
        },
      });
    }
  } catch (error) {
    console.error('[Shiori] migration failed', error);
  }
}

async function injectIntoTab(tabId) {
  // Tear down any dead content-script instance left after extension reload,
  // then inject a fresh content.js so tracking resumes without a tab reload.
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        try {
          if (typeof globalThis.__ANIME_TRACKER_STOP__ === 'function') {
            globalThis.__ANIME_TRACKER_STOP__();
          }
        } catch {
          /* ignore */
        }
        try {
          delete globalThis.__ANIME_TRACKER_CONTENT__;
        } catch {
          /* ignore */
        }
      },
    });
  } catch {
    /* tab may not allow scripting yet */
  }

  await chrome.scripting.executeScript({
    target: { tabId },
    files: ['content.js'],
  });
  contentReadyTabs.add(tabId);
}

async function injectIntoOpenWatchTabs() {
  try {
    const tabs = await chrome.tabs.query({
      url: [
        '*://*.netflix.com/*',
        '*://*.youtube.com/*',
        '*://youtu.be/*',
        '*://*.disneyplus.com/*',
      ],
    });

    await Promise.all(
      tabs.map(async (tab) => {
        if (tab.id == null) return;
        try {
          await injectIntoTab(tab.id);
        } catch (error) {
          console.debug('[Shiori] inject skipped', tab.id, error?.message);
        }
      })
    );
  } catch (error) {
    console.error('[Shiori] injectIntoOpenWatchTabs failed', error);
  }
}

function ensureListeners() {
  if (listenersBound) return;
  listenersBound = true;

  chrome.idle.setDetectionInterval(CONFIG.IDLE_THRESHOLD);
  chrome.idle.onStateChanged.addListener(handleIdleStateChange);
  chrome.tabs.onActivated.addListener(handleTabActivated);
  chrome.tabs.onUpdated.addListener(handleTabUpdated);
  chrome.tabs.onRemoved.addListener(handleTabRemoved);
  chrome.windows.onFocusChanged.addListener(handleWindowFocusChanged);
  chrome.runtime.onMessage.addListener(handleMessage);
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === ALARM_SAVE) {
      void saveCurrentSession();
    }
  });
}

async function startTracking() {
  ensureListeners();
  // Persist often so a Reload on chrome://extensions loses at most a few seconds.
  await chrome.alarms.create(ALARM_SAVE, { periodInMinutes: 0.5 });
  await getCurrentTab();
}

async function getCurrentTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id != null && tab.url) {
      await startTrackingTab(tab.id, tab.url);
    }
  } catch (error) {
    console.error('[Shiori] getCurrentTab failed', error);
  }
}

async function startTrackingTab(tabId, url) {
  await saveCurrentSession();

  const hostname = extractHostname(url);
  if (!hostname || !url || url.startsWith('chrome://') || url.startsWith('chrome-extension://')) {
    currentTracking = emptyTracking();
    return;
  }

  if (!isWatchSite(url)) {
    currentTracking = emptyTracking();
    return;
  }

  const now = Date.now();
  currentTracking = {
    tabId,
    url,
    hostname,
    platform: hostname.includes('netflix')
      ? 'netflix'
      : hostname.includes('disney')
        ? 'disneyplus'
        : 'youtube',
    showName: null,
    seasonNumber: null,
    episodeNumber: null,
    episodeLabel: null,
    startTime: now,
    lastActivityTime: now,
    isActive: true,
    isPlaying: null,
    videoProgress: null,
    animeMatch: null,
    seasonProgress: null,
  };
}

async function ensureContentOnWatchTab(tabId, url) {
  if (tabId == null || !url || !isWatchSite(url)) return;
  const hasRecentPulse =
    currentTracking.tabId === tabId &&
    lastHeartbeatAt &&
    Date.now() - lastHeartbeatAt < 12_000;
  if (contentReadyTabs.has(tabId) && hasRecentPulse) return;
  try {
    await injectIntoTab(tabId);
  } catch (error) {
    console.debug('[Shiori] ensureContent skipped', tabId, error?.message);
  }
}

async function handleTabActivated(activeInfo) {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    if (tab?.url) {
      await startTrackingTab(tab.id, tab.url);
      await ensureContentOnWatchTab(tab.id, tab.url);
    }
  } catch (error) {
    console.error('[Shiori] tab activate failed', error);
  }
}

function handleTabUpdated(tabId, changeInfo, tab) {
  if (changeInfo.url && tabId === currentTracking.tabId) {
    void startTrackingTab(tabId, changeInfo.url).then(() =>
      ensureContentOnWatchTab(tabId, changeInfo.url)
    );
  } else if (changeInfo.status === 'complete' && tab?.active && tab.url) {
    void startTrackingTab(tabId, tab.url).then(() => ensureContentOnWatchTab(tabId, tab.url));
  }
}

function handleTabRemoved(tabId) {
  contentReadyTabs.delete(tabId);
  if (tabId !== currentTracking.tabId) return;
  void saveCurrentSession().then(() => {
    currentTracking = emptyTracking();
  });
}

function isTrackedVideoPlaying() {
  const vp = currentTracking.videoProgress;
  return Boolean(vp && !vp.paused && !vp.ended);
}

async function handleWindowFocusChanged(windowId) {
  // Switching to another app must not pause watch time while video is playing.
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    if (isTrackedVideoPlaying()) {
      currentTracking.isActive = true;
      currentTracking.lastActivityTime = Date.now();
      return;
    }
    // No play signal yet — keep session open; content heartbeats will update state.
    return;
  }
  currentTracking.isActive = true;
  await getCurrentTab();
}

function handleIdleStateChange(state) {
  // Locked screen: definitely stop. Idle mouse while anime plays: keep counting.
  if (state === 'locked') {
    currentTracking.isActive = false;
    void saveCurrentSession();
    return;
  }

  if (state === 'idle') {
    if (isTrackedVideoPlaying()) {
      currentTracking.isActive = true;
      currentTracking.lastActivityTime = Date.now();
      return;
    }
    currentTracking.isActive = false;
    void saveCurrentSession();
    return;
  }

  currentTracking.isActive = true;
  if (currentTracking.hostname) {
    currentTracking.lastActivityTime = Date.now();
    if (!currentTracking.startTime) currentTracking.startTime = Date.now();
  }
}

function handleMessage(message, sender, sendResponse) {
  if (message?.type === 'ACTIVITY') {
    lastHeartbeatAt = Date.now();
    const senderTabId = sender.tab?.id;
    if (senderTabId != null) contentReadyTabs.add(senderTabId);

    if (senderTabId != null && currentTracking.tabId == null) {
      void startTrackingTab(senderTabId, message.url || sender.tab.url || '');
    }

    if (senderTabId != null && senderTabId === currentTracking.tabId) {
      currentTracking.videoProgress = message.videoProgress || null;
      if (message.url) currentTracking.url = message.url;

      const playing = isTrackedVideoPlaying();
      // Keep the session open while this tab is on a show; classify play vs pause on save.
      const wasPlaying = currentTracking.isPlaying;
      currentTracking.isPlaying = message.videoProgress != null ? playing : true;
      currentTracking.isActive = true;
      currentTracking.lastActivityTime = Date.now();
      if (!currentTracking.startTime) currentTracking.startTime = Date.now();

      // Flush when play/pause flips so focus ratio splits cleanly.
      if (wasPlaying != null && wasPlaying !== currentTracking.isPlaying) {
        void saveCurrentSession();
      }

      if (message.showInfo?.showName) {
        const nextName = message.showInfo.showName;
        // Netflix often omits season from the title overlay — keep last known
        // season for the same show instead of falling back to Season 1.
        const scrapedSeason = message.showInfo.seasonNumber ?? null;
        const nextSeason =
          scrapedSeason != null
            ? scrapedSeason
            : currentTracking.showName === nextName
              ? currentTracking.seasonNumber
              : null;
        const nextEpisode =
          message.showInfo.episodeNumber ?? message.showInfo.episodeLabel ?? null;
        const prevEpisode =
          currentTracking.episodeNumber ?? currentTracking.episodeLabel ?? null;
        const changed =
          currentTracking.showName &&
          (currentTracking.showName !== nextName ||
            String(currentTracking.seasonNumber ?? '') !== String(nextSeason ?? '') ||
            String(prevEpisode) !== String(nextEpisode));

        if (changed) {
          void saveCurrentSession().then(() => {
            currentTracking.startTime = Date.now();
          });
        }

        const showChanged = currentTracking.showName !== nextName;
        currentTracking.showName = nextName;
        currentTracking.seasonNumber = nextSeason;
        currentTracking.episodeNumber = message.showInfo.episodeNumber ?? null;
        currentTracking.episodeLabel = message.showInfo.episodeLabel ?? null;
        if (message.showInfo.site) currentTracking.platform = message.showInfo.site;

        if (showChanged || !currentTracking.animeMatch) {
          void ensureAnimeVerification(nextName).then(async (result) => {
            currentTracking.seasonProgress = await buildSeasonProgress(
              nextName,
              nextSeason,
              result
            );
          });
        } else {
          void buildSeasonProgress(
            nextName,
            nextSeason,
            currentTracking.animeMatch
          ).then((progress) => {
            currentTracking.seasonProgress = progress;
          });
        }
      }

    }

    sendResponse({ received: true });
    return true;
  }

  if (message?.type === 'GET_TRACKING_STATE') {
    const respond = async () => {
      try {
        if (currentTracking.showName && !currentTracking.animeMatch) {
          currentTracking.animeMatch = await getCatalogEntry(currentTracking.showName);
        }
        if (currentTracking.showName) {
          currentTracking.seasonProgress = await buildSeasonProgress(
            currentTracking.showName,
            currentTracking.seasonNumber,
            currentTracking.animeMatch
          );
        }
      } catch (error) {
        console.error('[Shiori] GET_TRACKING_STATE enrich failed', error);
      }
      return {
        tracking: currentTracking,
        debug: {
          lastHeartbeatAt,
          schemaVersion: SCHEMA_VERSION,
          alarm: ALARM_SAVE,
        },
      };
    };
    respond()
      .then((payload) => sendResponse(payload))
      .catch((error) => {
        console.error('[Shiori] GET_TRACKING_STATE failed', error);
        sendResponse({
          tracking: currentTracking,
          debug: { lastHeartbeatAt, error: String(error) },
        });
      });
    return true;
  }

  if (message?.type === 'VERIFY_ANIME') {
    ensureAnimeVerification(message.showName, { force: Boolean(message.force) })
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === 'SET_ANIME_OVERRIDE') {
    setCatalogOverride(message.showName, {
      status: message.status,
      match: message.match || null,
    })
      .then(async (entry) => {
        if (currentTracking.showName === message.showName) {
          currentTracking.animeMatch = {
            ...entry,
            isAnime: isAnimeStatus(entry.status),
          };
        }
        if (entry.status === 'confirmed' && entry.match) {
          await maybeAutoTagFromAniList(message.showName, entry.match);
        }
        sendResponse({ ok: true, result: entry });
      })
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === 'GET_ANIME_CATALOG_ENTRY') {
    getCatalogEntry(message.showName)
      .then((entry) => sendResponse({ ok: true, result: entry }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  return false;
}

async function saveCurrentSession() {
  if (!currentTracking.hostname || !currentTracking.startTime || !currentTracking.showName) {
    return;
  }

  const settings = await getSettings();
  if (settings.animeOnlyTracking) {
    let match = currentTracking.animeMatch;
    if (!match) {
      match = await ensureAnimeVerification(currentTracking.showName);
      currentTracking.animeMatch = match;
    }
    // Still counting while lookup is in-flight/error; skip clear non-anime.
    if (match && (match.status === 'rejected' || match.status === 'unlikely')) {
      currentTracking.startTime = Date.now();
      return;
    }
  }

  const now = Date.now();
  let sessionDuration = now - currentTracking.startTime;

  if (!currentTracking.isActive && currentTracking.lastActivityTime) {
    sessionDuration = Math.max(0, currentTracking.lastActivityTime - currentTracking.startTime);
  }

  if (sessionDuration < CONFIG.MIN_SAVE_MS) {
    return;
  }

  const dateKey = getDateKey(new Date());
  const hour = String(new Date().getHours()).padStart(2, '0');

  try {
    const data = await chrome.storage.local.get([dateKey, 'lastVisits']);
    const dayData = data[dateKey] || { shows: {}, dailyStats: {} };
    const lastVisits = data.lastVisits || {};

    if (!dayData.dailyStats) {
      dayData.dailyStats = { totalTime: 0, episodesWatched: 0, showsActive: 0 };
    }

    if (!dayData.shows[currentTracking.showName]) {
      dayData.shows[currentTracking.showName] = {
        site: currentTracking.hostname,
        platform: currentTracking.platform,
        totalTime: 0,
        activeTime: 0,
        pausedTime: 0,
        episodes: {},
        sessions: 0,
        lastWatched: now,
        hourly: {},
      };
    }

    const showData = dayData.shows[currentTracking.showName];
    const playing =
      currentTracking.isPlaying != null
        ? currentTracking.isPlaying
        : isTrackedVideoPlaying();

    showData.totalTime += sessionDuration;
    if (playing) showData.activeTime += sessionDuration;
    else showData.pausedTime = (showData.pausedTime || 0) + sessionDuration;
    showData.lastWatched = now;
    showData.site = currentTracking.hostname;
    showData.platform = currentTracking.platform;
    showData.hourly[hour] = (showData.hourly[hour] || 0) + sessionDuration;

    const episodeKey = episodeStorageKey(
      currentTracking.seasonNumber,
      currentTracking.episodeNumber,
      currentTracking.episodeLabel
    );

    if (episodeKey) {
      if (!showData.episodes[episodeKey]) {
        showData.episodes[episodeKey] = {
          time: 0,
          progress: 0,
          currentTime: 0,
          duration: 0,
          completed: false,
          timestamp: now,
          sessions: 0,
          rewatches: 0,
          seasonNumber:
            currentTracking.seasonNumber != null
              ? Number(currentTracking.seasonNumber)
              : 1,
          label: currentTracking.episodeLabel || episodeKey,
        };
      }

      const episodeData = showData.episodes[episodeKey];
      const wasCompleted = Boolean(episodeData.completed);
      if (playing) episodeData.time += sessionDuration;
      episodeData.timestamp = now;
      episodeData.seasonNumber =
        currentTracking.seasonNumber != null
          ? Number(currentTracking.seasonNumber)
          : episodeData.seasonNumber || 1;
      if (currentTracking.episodeLabel) episodeData.label = currentTracking.episodeLabel;

      const vp = currentTracking.videoProgress;
      if (vp?.duration > 0) {
        episodeData.duration = vp.duration;
        if (vp.currentTime >= 0) {
          episodeData.currentTime = vp.currentTime;
          episodeData.progress = vp.progress;
          if (vp.progress >= 0.8) episodeData.completed = true;
        }
      }

      // Stash for session bump below (rewatch = new session on already-finished ep).
      episodeData._wasCompletedAtSave = wasCompleted;
    }

    const visitKey = `${currentTracking.showName}_${currentTracking.hostname}`;
    const lastVisit = lastVisits[visitKey] || 0;
    if (now - lastVisit > CONFIG.SESSION_TIMEOUT) {
      showData.sessions += 1;
      lastVisits[visitKey] = now;
      if (episodeKey && showData.episodes[episodeKey]) {
        const episodeData = showData.episodes[episodeKey];
        episodeData.sessions = (episodeData.sessions || 0) + 1;
        if (episodeData._wasCompletedAtSave) {
          episodeData.rewatches = (episodeData.rewatches || 0) + 1;
        }
      }
    }
    if (episodeKey && showData.episodes[episodeKey]) {
      delete showData.episodes[episodeKey]._wasCompletedAtSave;
    }

    dayData.dailyStats.totalTime += sessionDuration;
    dayData.dailyStats.showsActive = Object.keys(dayData.shows).length;
    dayData.dailyStats.episodesWatched = Object.values(dayData.shows).reduce((sum, show) => {
      return (
        sum +
        Object.values(show.episodes || {}).filter((episode) => episode.completed).length
      );
    }, 0);

    await chrome.storage.local.set({
      [dateKey]: dayData,
      lastVisits,
      meta: {
        schemaVersion: SCHEMA_VERSION,
        updatedAt: new Date().toISOString(),
      },
    });

    currentTracking.startTime = now;
  } catch (error) {
    console.error('[Shiori] save failed', error);
  }
}

function schedulePosterBackfill() {
  // Defer so popup/message handlers are ready immediately after reload.
  setTimeout(() => {
    void backfillMissingPosters({ limit: 8 });
  }, 5000);
}

chrome.runtime.onInstalled.addListener(() => {
  void initializeStorage()
    .then(startTracking)
    .then(injectIntoOpenWatchTabs)
    .then(schedulePosterBackfill);
});

chrome.runtime.onStartup.addListener(() => {
  void startTracking()
    .then(injectIntoOpenWatchTabs)
    .then(schedulePosterBackfill);
});

void initializeStorage()
  .then(startTracking)
  .then(injectIntoOpenWatchTabs)
  .then(schedulePosterBackfill);

export { currentTracking, CONFIG };
