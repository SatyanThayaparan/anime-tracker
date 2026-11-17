/**
 * Content script for Netflix / YouTube / Disney+.
 * Loads utils via chrome.runtime.getURL so MV3 content scripts can use modules.
 */

(async function boot() {
  const HEARTBEAT_INTERVAL = 5000;
  const ACTIVITY_DEBOUNCE = 800;
  const SHOW_INFO_UPDATE_INTERVAL = 8000;
  const VIDEO_UPDATE_INTERVAL = 2000;
  const VIDEO_DETECTION_INTERVAL = 4000;

  let shows;
  try {
    shows = await import(chrome.runtime.getURL('utils/shows.js'));
  } catch (error) {
    console.error('[Anime Tracker] Failed to load shows.js', error);
    return;
  }

  const { extractShowInfo, isWatchSite, findVideoPlayer } = shows;

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

  function updateShowInfo(force = false) {
    const now = Date.now();
    if (!force && now - lastShowInfoUpdate < SHOW_INFO_UPDATE_INTERVAL && currentShowInfo) {
      return;
    }

    const url = window.location.href;
    if (!isWatchSite(url)) {
      currentShowInfo = null;
      return;
    }

    const info = extractShowInfo(url, document);
    if (info?.showName) {
      currentShowInfo = info;
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
    if (!currentVideoPlayer) {
      videoProgress = null;
      return;
    }

    try {
      const currentTime = currentVideoPlayer.currentTime || 0;
      const duration = currentVideoPlayer.duration || 0;
      if (duration > 0 && currentTime >= 0) {
        videoProgress = {
          currentTime: Math.floor(currentTime),
          duration: Math.floor(duration),
          progress: currentTime / duration,
          paused: Boolean(currentVideoPlayer.paused),
          ended: Boolean(currentVideoPlayer.ended),
          timestamp: Date.now(),
        };
      } else {
        videoProgress = null;
      }
    } catch {
      videoProgress = null;
    }
  }

  function setupVideoListeners(video) {
    removeVideoListeners();
    currentVideoPlayer = video;

    const handlers = {
      timeupdate: updateVideoProgress,
      play: updateVideoProgress,
      pause: updateVideoProgress,
      ended: updateVideoProgress,
      loadedmetadata: updateVideoProgress,
      seeked: updateVideoProgress,
    };

    Object.entries(handlers).forEach(([event, handler]) => {
      video.addEventListener(event, handler, { passive: true });
      videoEventListeners.push({ event, handler });
    });

    updateVideoProgress();
  }

  function detectVideoPlayer() {
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

  function sendHeartbeat(force = false) {
    const now = Date.now();
    updateShowInfo();
    updateVideoProgress();

    const recentlyActive = now - lastActivityTime < HEARTBEAT_INTERVAL * 1.5;
    const playing =
      videoProgress && !videoProgress.paused && !videoProgress.ended;

    if (!isPageVisible || (!recentlyActive && !playing && !force)) return;
    if (!force && now - lastHeartbeatTime < HEARTBEAT_INTERVAL) return;

    try {
      chrome.runtime.sendMessage(
        {
          type: 'ACTIVITY',
          showInfo: currentShowInfo,
          videoProgress,
          url: window.location.href,
          at: now,
        },
        () => {
          void chrome.runtime.lastError;
        }
      );
      lastHeartbeatTime = now;
    } catch (error) {
      console.debug('[Anime Tracker] heartbeat failed', error);
    }
  }

  function handleActivity() {
    lastActivityTime = Date.now();
    sendHeartbeat();
  }

  function debouncedActivity() {
    if (activityTimeout) clearTimeout(activityTimeout);
    activityTimeout = setTimeout(() => {
      handleActivity();
      activityTimeout = null;
    }, ACTIVITY_DEBOUNCE);
  }

  function onVisibility() {
    isPageVisible = !document.hidden;
    if (isPageVisible) {
      lastActivityTime = Date.now();
      updateShowInfo(true);
      detectVideoPlayer();
      sendHeartbeat(true);
    }
  }

  function checkSpaNavigation() {
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
    ['mousemove', 'scroll'].forEach((eventName) => {
      document.addEventListener(eventName, debouncedActivity, { passive: true });
    });
    ['mousedown', 'click', 'keydown', 'touchstart'].forEach((eventName) => {
      document.addEventListener(eventName, handleActivity, { passive: true });
    });
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', () => {
      isPageVisible = true;
      handleActivity();
    });
    window.addEventListener('blur', () => {
      isPageVisible = false;
    });

    const observer = new MutationObserver(() => {
      if (!isWatchSite(window.location.href)) return;
      detectVideoPlayer();
      if (!currentShowInfo) updateShowInfo(true);
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });

    setInterval(() => {
      if (isPageVisible) sendHeartbeat();
    }, HEARTBEAT_INTERVAL);
    setInterval(() => {
      if (isPageVisible) updateShowInfo();
    }, SHOW_INFO_UPDATE_INTERVAL);
    setInterval(() => {
      if (isPageVisible) detectVideoPlayer();
    }, VIDEO_DETECTION_INTERVAL);
    setInterval(() => {
      if (isPageVisible && currentVideoPlayer) updateVideoProgress();
    }, VIDEO_UPDATE_INTERVAL);
    setInterval(checkSpaNavigation, 1000);

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
