import { extractHostname } from './utils/categories.js';
import { isWatchSite } from './utils/shows.js';
import { getDateKey } from './utils/storage.js';

const SCHEMA_VERSION = 1;
const ALARM_SAVE = 'anime-tracker-save';

const CONFIG = {
  IDLE_THRESHOLD: 60,
  SESSION_TIMEOUT: 30 * 60 * 1000,
  MIN_SAVE_MS: 1000,
};

let currentTracking = emptyTracking();
let lastHeartbeatAt = null;
let listenersBound = false;

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
    videoProgress: null,
  };
}

async function initializeStorage() {
  const data = await chrome.storage.local.get(['settings', 'meta']);
  const patch = {};

  if (!data.meta) {
    patch.meta = {
      schemaVersion: SCHEMA_VERSION,
      createdAt: new Date().toISOString(),
    };
  }

  if (!data.settings) {
    patch.settings = {
      idleThreshold: CONFIG.IDLE_THRESHOLD,
      sessionTimeout: CONFIG.SESSION_TIMEOUT,
    };
  }

  if (Object.keys(patch).length) {
    await chrome.storage.local.set(patch);
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
  await chrome.alarms.create(ALARM_SAVE, { periodInMinutes: 1 });
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
    videoProgress: null,
  };
}

async function handleTabActivated(activeInfo) {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    if (tab?.url) await startTrackingTab(tab.id, tab.url);
  } catch (error) {
    console.error('[Anime Tracker] tab activate failed', error);
  }
}

function handleTabUpdated(tabId, changeInfo, tab) {
  if (changeInfo.url && tabId === currentTracking.tabId) {
    void startTrackingTab(tabId, changeInfo.url);
  } else if (changeInfo.status === 'complete' && tab?.active && tab.url) {
    void startTrackingTab(tabId, tab.url);
  }
}

function handleTabRemoved(tabId) {
  if (tabId !== currentTracking.tabId) return;
  void saveCurrentSession().then(() => {
    currentTracking = emptyTracking();
  });
}

async function handleWindowFocusChanged(windowId) {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    currentTracking.isActive = false;
    await saveCurrentSession();
    return;
  }
  currentTracking.isActive = true;
  await getCurrentTab();
}

function handleIdleStateChange(state) {
  if (state === 'idle' || state === 'locked') {
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

    if (senderTabId != null && currentTracking.tabId == null) {
      void startTrackingTab(senderTabId, message.url || sender.tab.url || '');
    }

    if (senderTabId != null && senderTabId === currentTracking.tabId) {
      currentTracking.lastActivityTime = Date.now();
      currentTracking.isActive = true;
      if (!currentTracking.startTime) currentTracking.startTime = Date.now();

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

      currentTracking.videoProgress = message.videoProgress || null;
      if (message.url) currentTracking.url = message.url;
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
        episodes: {},
        sessions: 0,
        lastWatched: now,
        hourly: {},
      };
    }

    const showData = dayData.shows[currentTracking.showName];
    showData.totalTime += sessionDuration;
    showData.activeTime += sessionDuration;
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
          label: currentTracking.episodeLabel || episodeKey,
        };
      }

      const episodeData = showData.episodes[episodeKey];
      episodeData.time += sessionDuration;
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
    }

    const visitKey = `${currentTracking.showName}_${currentTracking.hostname}`;
    const lastVisit = lastVisits[visitKey] || 0;
    if (now - lastVisit > CONFIG.SESSION_TIMEOUT) {
      showData.sessions += 1;
      lastVisits[visitKey] = now;
      if (episodeKey && showData.episodes[episodeKey]) {
        showData.episodes[episodeKey].sessions =
          (showData.episodes[episodeKey].sessions || 0) + 1;
      }
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
  void initializeStorage().then(startTracking);
});

chrome.runtime.onStartup.addListener(() => {
  void startTracking();
});

void initializeStorage().then(startTracking);

export { currentTracking, CONFIG };
