/**
 * Content script for Netflix / YouTube / Disney+.
 * Loads utils via chrome.runtime.getURL so MV3 content scripts can use modules.
 * Re-injectable after extension reload (tears down any previous instance first).
 */

(async function boot() {
  // Stop a prior instance left behind after extension reload (dead chrome.runtime).
  if (typeof globalThis.__ANIME_TRACKER_STOP__ === 'function') {
    try {
      globalThis.__ANIME_TRACKER_STOP__();
    } catch {
      /* ignore */
    }
  }

  const HEARTBEAT_INTERVAL = 5000;
  const ACTIVITY_DEBOUNCE = 800;
  const SHOW_INFO_UPDATE_INTERVAL = 8000;
  const VIDEO_UPDATE_INTERVAL = 2000;
  const VIDEO_DETECTION_INTERVAL = 4000;

  let stopped = false;
  const timers = [];
  const listeners = [];

  function trackListener(target, event, handler, options) {
    target.addEventListener(event, handler, options);
    listeners.push({ target, event, handler, options });
  }

  function trackInterval(fn, ms) {
    const id = setInterval(() => {
      if (!stopped) fn();
    }, ms);
    timers.push(id);
    return id;
  }

  globalThis.__ANIME_TRACKER_STOP__ = () => {
    stopped = true;
    timers.forEach((id) => clearInterval(id));
    timers.length = 0;
    listeners.forEach(({ target, event, handler, options }) => {
      try {
        target.removeEventListener(event, handler, options);
      } catch {
        /* ignore */
      }
    });
    listeners.length = 0;
    try {
      if (typeof removeVideoListeners === 'function') removeVideoListeners();
    } catch {
      /* ignore */
    }
  };

  let shows;
  try {
    shows = await import(chrome.runtime.getURL('utils/shows.js'));
  } catch (error) {
    console.error('[Shiori] Failed to load shows.js', error);
    return;
  }

  if (stopped) return;

  const {
    extractShowInfo,
    isWatchSite,
    isPlayerPage,
    findVideoPlayer,
    inferPlaybackState,
  } = shows;

  let lastActivityTime = Date.now();
  let lastHeartbeatTime = 0;
  let lastShowInfoUpdate = 0;
  let isPageVisible = !document.hidden;
  let currentShowInfo = null;
  let currentVideoPlayer = null;
  let videoProgress = null;
  let videoEventListeners = [];
  let activityTimeout = null;
  let lastUrl = window.location.href;
  let observer = null;
  let lastKnownPlaying = false;

  function updateShowInfo(force = false) {
    if (stopped) return;
    const now = Date.now();
    const missingSeason =
      currentShowInfo?.showName &&
      currentShowInfo.episodeNumber != null &&
      currentShowInfo.seasonNumber == null;
    // Retry sooner when episode is known but season is still missing (Netflix).
    const minInterval = missingSeason ? 2000 : SHOW_INFO_UPDATE_INTERVAL;
    if (!force && currentShowInfo && now - lastShowInfoUpdate < minInterval) {
      return;
    }

    const url = window.location.href;
    if (!isWatchSite(url) || !isPlayerPage(url)) {
      currentShowInfo = null;
      lastShowInfoUpdate = now;
      return;
    }

    const info = extractShowInfo(url, document);
    if (info?.showName) {
      // Prefer newly scraped season; keep prior season if scrape still omitted it.
      if (
        info.seasonNumber == null &&
        currentShowInfo?.showName === info.showName &&
        currentShowInfo.seasonNumber != null
      ) {
        info.seasonNumber = currentShowInfo.seasonNumber;
      }
      currentShowInfo = info;
      lastShowInfoUpdate = now;
    } else {
      // Left a real title for browse chrome — clear so we stop attributing time.
      currentShowInfo = null;
      lastShowInfoUpdate = now;
    }
  }

  function removeVideoListeners() {
    if (!currentVideoPlayer || !videoEventListeners.length) return;
    videoEventListeners.forEach(({ event, handler }) => {
      currentVideoPlayer.removeEventListener(event, handler);
    });
    videoEventListeners = [];
  }

  function updateVideoProgress() {
    if (stopped) return;
    const url = window.location.href;

    if (!currentVideoPlayer || !document.contains(currentVideoPlayer)) {
      // Disney+ often blocks media progress — infer play/pause from player chrome.
      videoProgress =
        isPlayerPage(url) && typeof inferPlaybackState === 'function'
          ? inferPlaybackState(document)
          : null;
      return;
    }

    try {
      const currentTime = Number(currentVideoPlayer.currentTime) || 0;
      const duration = Number(currentVideoPlayer.duration);
      const hasDuration = Number.isFinite(duration) && duration > 0;
      // Always report play/pause even when duration is unknown (DRM players).
      videoProgress = {
        currentTime: Math.floor(currentTime),
        duration: hasDuration ? Math.floor(duration) : 0,
        progress: hasDuration ? currentTime / duration : 0,
        paused: Boolean(currentVideoPlayer.paused),
        ended: Boolean(currentVideoPlayer.ended),
        timestamp: Date.now(),
      };
    } catch {
      videoProgress =
        isPlayerPage(url) && typeof inferPlaybackState === 'function'
          ? inferPlaybackState(document)
          : null;
    }
  }

  function setupVideoListeners(video) {
    removeVideoListeners();
    currentVideoPlayer = video;

    const onPlayState = (force = false) => {
      updateVideoProgress();
      // timeupdate keeps heartbeats alive when Chrome is in the background (timers throttle).
      sendHeartbeat(force);
    };

    const handlers = {
      timeupdate: () => onPlayState(false),
      play: () => onPlayState(true),
      pause: () => onPlayState(true),
      ended: () => onPlayState(true),
      loadedmetadata: updateVideoProgress,
      seeked: () => onPlayState(false),
    };

    Object.entries(handlers).forEach(([event, handler]) => {
      video.addEventListener(event, handler, { passive: true });
      videoEventListeners.push({ event, handler });
    });

    updateVideoProgress();
  }

  function detectVideoPlayer() {
    if (stopped) return;
    const url = window.location.href;
    if (!isWatchSite(url)) {
      removeVideoListeners();
      currentVideoPlayer = null;
      videoProgress = null;
      return;
    }

    if (currentVideoPlayer && document.contains(currentVideoPlayer)) {
      updateVideoProgress();
      return;
    }

    const video = findVideoPlayer(document);
    if (video) {
      setupVideoListeners(video);
    } else {
      removeVideoListeners();
      currentVideoPlayer = null;
      videoProgress = null;
    }
  }

  function isVideoPlaying() {
    return Boolean(videoProgress && !videoProgress.paused && !videoProgress.ended);
  }

  function sendHeartbeat(force = false) {
    if (stopped) return;
    const now = Date.now();
    updateShowInfo();
    updateVideoProgress();

    const playing = isVideoPlaying();
    const onPlayer = isPlayerPage(window.location.href);

    // Only pulse while actually playing (or a forced pause/play edge).
    // Mouse activity on a paused player must not keep the session counting.
    if (!force && !playing) return;
    if (!force && !onPlayer) return;
    if (!force && now - lastHeartbeatTime < HEARTBEAT_INTERVAL) return;

    try {
      if (!chrome.runtime?.id) {
        globalThis.__ANIME_TRACKER_STOP__?.();
        return;
      }
      chrome.runtime.sendMessage(
        {
          type: 'ACTIVITY',
          showInfo: currentShowInfo,
          videoProgress,
          url: window.location.href,
          at: now,
          playing,
        },
        () => {
          void chrome.runtime.lastError;
        }
      );
      lastHeartbeatTime = now;
    } catch (error) {
      console.debug('[Shiori] heartbeat failed', error);
      try {
        globalThis.__ANIME_TRACKER_STOP__?.();
      } catch {
        /* ignore */
      }
    }
  }

  function handleActivity() {
    if (stopped) return;
    lastActivityTime = Date.now();
    sendHeartbeat();
  }

  function debouncedActivity() {
    if (stopped) return;
    if (activityTimeout) clearTimeout(activityTimeout);
    activityTimeout = setTimeout(() => {
      handleActivity();
      activityTimeout = null;
    }, ACTIVITY_DEBOUNCE);
  }

  function onVisibility() {
    if (stopped) return;
    isPageVisible = !document.hidden;
    updateVideoProgress();
    if (isPageVisible) {
      lastActivityTime = Date.now();
      updateShowInfo(true);
      detectVideoPlayer();
      sendHeartbeat(true);
    } else if (isVideoPlaying()) {
      // Still playing while Chrome is in the background / another app is focused.
      sendHeartbeat(true);
    }
  }

  function checkSpaNavigation() {
    if (stopped) return;
    if (window.location.href === lastUrl) return;
    lastUrl = window.location.href;
    currentShowInfo = null;
    removeVideoListeners();
    currentVideoPlayer = null;
    videoProgress = null;
    updateShowInfo(true);
    detectVideoPlayer();
    sendHeartbeat(true);
  }

  function init() {
    if (stopped) return;

    ['mousemove', 'scroll'].forEach((eventName) => {
      trackListener(document, eventName, debouncedActivity, { passive: true });
    });
    ['mousedown', 'click', 'keydown', 'touchstart'].forEach((eventName) => {
      trackListener(document, eventName, handleActivity, { passive: true });
    });
    trackListener(document, 'visibilitychange', onVisibility);
    trackListener(window, 'focus', () => {
      isPageVisible = true;
      handleActivity();
    });
    // Do not treat blur as "stop watching" — video may keep playing beside another app.
    trackListener(window, 'blur', () => {
      updateVideoProgress();
      if (isVideoPlaying()) sendHeartbeat(true);
    });

    observer = new MutationObserver(() => {
      if (stopped || !isWatchSite(window.location.href)) return;
      detectVideoPlayer();
      if (!currentShowInfo) updateShowInfo(true);
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });

    const prevStop = globalThis.__ANIME_TRACKER_STOP__;
    globalThis.__ANIME_TRACKER_STOP__ = () => {
      if (observer) {
        try {
          observer.disconnect();
        } catch {
          /* ignore */
        }
        observer = null;
      }
      if (activityTimeout) {
        clearTimeout(activityTimeout);
        activityTimeout = null;
      }
      prevStop();
    };

    trackInterval(() => {
      sendHeartbeat();
    }, HEARTBEAT_INTERVAL);
    trackInterval(() => {
      if (isPageVisible || isVideoPlaying()) updateShowInfo();
    }, SHOW_INFO_UPDATE_INTERVAL);
    trackInterval(() => {
      if (isPageVisible || isVideoPlaying()) detectVideoPlayer();
    }, VIDEO_DETECTION_INTERVAL);
    trackInterval(() => {
      updateVideoProgress();
      const playing = isVideoPlaying();
      // Catch play/pause when DRM blocks media events (Disney+).
      if (playing !== lastKnownPlaying) {
        lastKnownPlaying = playing;
        sendHeartbeat(true);
      } else {
        lastKnownPlaying = playing;
      }
    }, VIDEO_UPDATE_INTERVAL);
    trackInterval(checkSpaNavigation, 1000);

    updateShowInfo(true);
    detectVideoPlayer();
    sendHeartbeat(true);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
