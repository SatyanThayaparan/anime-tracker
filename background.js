import { extractHostname } from './utils/categories.js';
import { isWatchSite } from './utils/shows.js';
import {
  CURRENT_SCHEMA_VERSION,
  getDateKey,
  migrateWatchData,
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

function emptyTracking() {
  return {
    tabId: null,
    url: null,
    hostname: null,
    platform: null,
    showName: null,
    episodeNumber: null,
    episodeLabel: null,
    startTime: null,
    lastActivityTime: null,
    isActive: false,
    isPlaying: null,
    videoProgress: null,
  };
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
        `[Anime Tracker] Migrated storage to v${SCHEMA_VERSION}; fixed ${result.fixedShows} show keys`
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
    console.error('[Anime Tracker] migration failed', error);
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
          console.debug('[Anime Tracker] inject skipped', tab.id, error?.message);
        }
      })
    );
  } catch (error) {
    console.error('[Anime Tracker] injectIntoOpenWatchTabs failed', error);
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
    console.error('[Anime Tracker] getCurrentTab failed', error);
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
    episodeNumber: null,
    episodeLabel: null,
    startTime: now,
    lastActivityTime: now,
    isActive: true,
    isPlaying: null,
    videoProgress: null,
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
    console.debug('[Anime Tracker] ensureContent skipped', tabId, error?.message);
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
    console.error('[Anime Tracker] tab activate failed', error);
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
        const nextEpisode =
          message.showInfo.episodeNumber ?? message.showInfo.episodeLabel ?? null;
        const prevEpisode =
          currentTracking.episodeNumber ?? currentTracking.episodeLabel ?? null;
        const changed =
          currentTracking.showName &&
          (currentTracking.showName !== nextName || String(prevEpisode) !== String(nextEpisode));

        if (changed) {
          void saveCurrentSession().then(() => {
            currentTracking.startTime = Date.now();
          });
        }

        currentTracking.showName = nextName;
        currentTracking.episodeNumber = message.showInfo.episodeNumber ?? null;
        currentTracking.episodeLabel = message.showInfo.episodeLabel ?? null;
        if (message.showInfo.site) currentTracking.platform = message.showInfo.site;
      }

    }

    sendResponse({ received: true });
    return true;
  }

  if (message?.type === 'GET_TRACKING_STATE') {
    sendResponse({
      tracking: currentTracking,
      debug: {
        lastHeartbeatAt,
        schemaVersion: SCHEMA_VERSION,
        alarm: ALARM_SAVE,
      },
    });
    return true;
  }

  return false;
}

async function saveCurrentSession() {
  if (!currentTracking.hostname || !currentTracking.startTime || !currentTracking.showName) {
    return;
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

    const episodeKey =
      currentTracking.episodeNumber != null
        ? String(currentTracking.episodeNumber)
        : currentTracking.episodeLabel
          ? String(currentTracking.episodeLabel)
          : null;

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
          label: currentTracking.episodeLabel || episodeKey,
        };
      }

      const episodeData = showData.episodes[episodeKey];
      const wasCompleted = Boolean(episodeData.completed);
      if (playing) episodeData.time += sessionDuration;
      episodeData.timestamp = now;
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
    console.error('[Anime Tracker] save failed', error);
  }
}

chrome.runtime.onInstalled.addListener(() => {
  void initializeStorage()
    .then(startTracking)
    .then(injectIntoOpenWatchTabs);
});

chrome.runtime.onStartup.addListener(() => {
  void startTracking().then(injectIntoOpenWatchTabs);
});

void initializeStorage()
  .then(startTracking)
  .then(injectIntoOpenWatchTabs);

export { currentTracking, CONFIG };
