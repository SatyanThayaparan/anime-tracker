/**
 * Content Script for Anime Tracker
 * 
 * Detects user activity and extracts show/episode information
 * from anime streaming sites, sending heartbeat messages to the background script.
 */

import { extractShowInfo, isAnimeSite, findVideoPlayer } from './utils/shows.js';

// Configuration
const HEARTBEAT_INTERVAL = 5000;  // Send heartbeat every 5 seconds if active
const ACTIVITY_DEBOUNCE = 1000;   // Debounce activity events by 1 second
const SHOW_INFO_UPDATE_INTERVAL = 10000;  // Update show info every 10 seconds
const VIDEO_UPDATE_INTERVAL = 2000;  // Update video progress every 2 seconds
const VIDEO_DETECTION_INTERVAL = 5000;  // Try to detect video player every 5 seconds

// State
let lastActivityTime = Date.now();
let lastHeartbeatTime = 0;
let isPageVisible = !document.hidden;
let currentShowInfo = null;
let lastShowInfoUpdate = 0;
let currentVideoPlayer = null;
let videoProgress = null;
let videoEventListeners = [];
let mutationObserver = null;

/**
 * Get site identifier from URL
 */
function getSiteIdentifier(url) {
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname.replace(/^www\./, '');
    
    if (hostname.includes('crunchyroll')) return 'crunchyroll';
    if (hostname.includes('funimation')) return 'funimation';
    if (hostname.includes('9anime')) return '9anime';
    if (hostname.includes('zoro')) return 'zoro';
    if (hostname.includes('gogoanime')) return 'gogoanime';
    
    return null;
  } catch (e) {
    return null;
  }
}

/**
 * Update show info from current page
 */
function updateShowInfo() {
  const now = Date.now();
  
  // Only update show info periodically or if we don't have it yet
  if (now - lastShowInfoUpdate >= SHOW_INFO_UPDATE_INTERVAL || !currentShowInfo) {
    const url = window.location.href;
    
    if (isAnimeSite(url)) {
      console.log('[Anime Tracker] Updating show info from:', url);
      const showInfo = extractShowInfo(url, document);
      if (showInfo && showInfo.showName) {
        console.log('[Anime Tracker] Extracted show info:', showInfo);
        currentShowInfo = showInfo;
        lastShowInfoUpdate = now;
      } else {
        console.log('[Anime Tracker] Could not extract show info');
        // If we can't extract show info, clear it
        currentShowInfo = null;
      }
    } else {
      currentShowInfo = null;
    }
  }
}

/**
 * Remove video event listeners
 */
function removeVideoListeners() {
  if (currentVideoPlayer && videoEventListeners.length > 0) {
    videoEventListeners.forEach(({ event, handler }) => {
      currentVideoPlayer.removeEventListener(event, handler);
    });
    videoEventListeners = [];
  }
}

/**
 * Update video progress from current video player
 */
function updateVideoProgress() {
  if (!currentVideoPlayer) {
    videoProgress = null;
    return;
  }
  
  try {
    const currentTime = currentVideoPlayer.currentTime || 0;
    const duration = currentVideoPlayer.duration || 0;
    const paused = currentVideoPlayer.paused;
    const ended = currentVideoPlayer.ended;
    
    if (duration > 0 && currentTime >= 0) {
      const progress = currentTime / duration;
      
      videoProgress = {
        currentTime: Math.floor(currentTime), // seconds
        duration: Math.floor(duration), // seconds
        progress: progress, // 0-1
        paused: paused,
        ended: ended,
        timestamp: Date.now()
      };
    } else {
      videoProgress = null;
    }
  } catch (e) {
    console.debug('Error updating video progress:', e);
    videoProgress = null;
  }
}

/**
 * Setup video player event listeners
 */
function setupVideoListeners(video) {
  if (!video) return;
  
  // Remove existing listeners first
  removeVideoListeners();
  
  const handlers = {
    timeupdate: () => {
      updateVideoProgress();
    },
    play: () => {
      updateVideoProgress();
    },
    pause: () => {
      updateVideoProgress();
    },
    ended: () => {
      updateVideoProgress();
    },
    loadedmetadata: () => {
      updateVideoProgress();
    },
    seeked: () => {
      updateVideoProgress();
    }
  };
  
  // Add event listeners
  Object.entries(handlers).forEach(([event, handler]) => {
    video.addEventListener(event, handler, { passive: true });
    videoEventListeners.push({ event, handler });
  });
  
  // Initial progress update
  updateVideoProgress();
}

/**
 * Detect and setup video player
 */
function detectVideoPlayer() {
  const url = window.location.href;
  
  if (!isAnimeSite(url)) {
    if (currentVideoPlayer) {
      removeVideoListeners();
      currentVideoPlayer = null;
      videoProgress = null;
    }
    return;
  }
  
  // If we already have a video player and it's still in the DOM, keep using it
  if (currentVideoPlayer && document.contains(currentVideoPlayer)) {
    // Verify it's still a valid video element
    if (currentVideoPlayer.tagName === 'VIDEO' && !currentVideoPlayer.paused) {
      return;
    }
  }
  
  // Try to find video player
  const site = getSiteIdentifier(url);
  const video = findVideoPlayer(document, site);
  
  if (video && video !== currentVideoPlayer) {
    // Remove old listeners
    removeVideoListeners();
    
    // Setup new video player
    currentVideoPlayer = video;
    setupVideoListeners(video);
  } else if (!video && currentVideoPlayer) {
    // Video player was removed from DOM
    removeVideoListeners();
    currentVideoPlayer = null;
    videoProgress = null;
  }
}

/**
 * Send activity heartbeat to background script
 */
function sendHeartbeat() {
  const now = Date.now();
  
  // Update show info and video progress before sending heartbeat
  updateShowInfo();
  updateVideoProgress();
  
  // Only send heartbeat if there was recent activity and page is visible
  if (isPageVisible && (now - lastActivityTime < HEARTBEAT_INTERVAL)) {
    // Throttle heartbeats
    if (now - lastHeartbeatTime >= HEARTBEAT_INTERVAL) {
      try {
        const message = {
          type: 'ACTIVITY',
          showInfo: currentShowInfo,
          videoProgress: videoProgress
        };
        
        chrome.runtime.sendMessage(message, (response) => {
          // Handle potential disconnection
          if (chrome.runtime.lastError) {
            console.debug('Heartbeat failed:', chrome.runtime.lastError.message);
          }
        });
        lastHeartbeatTime = now;
      } catch (e) {
        console.debug('Failed to send heartbeat:', e);
      }
    }
  }
}

/**
 * Handle user activity events
 */
function handleActivity() {
  lastActivityTime = Date.now();
  sendHeartbeat();
}

/**
 * Debounced activity handler to avoid excessive event processing
 */
let activityTimeout = null;
function debouncedActivity() {
  if (activityTimeout) {
    clearTimeout(activityTimeout);
  }
  
  activityTimeout = setTimeout(() => {
    handleActivity();
    activityTimeout = null;
  }, ACTIVITY_DEBOUNCE);
}

/**
 * Handle visibility change (tab switching, minimizing)
 */
function handleVisibilityChange() {
  isPageVisible = !document.hidden;
  
  if (isPageVisible) {
    // Page became visible - update show info and send immediate heartbeat
    lastActivityTime = Date.now();
    lastShowInfoUpdate = 0; // Force update show info
    updateShowInfo();
    sendHeartbeat();
  }
}

/**
 * Setup MutationObserver to watch for DOM changes
 */
function setupMutationObserver() {
  if (mutationObserver) {
    mutationObserver.disconnect();
  }
  
  mutationObserver = new MutationObserver((mutations) => {
    // Check if video player was added/removed
    const url = window.location.href;
    if (isAnimeSite(url)) {
      detectVideoPlayer();
      // Force show info update when DOM changes significantly
      lastShowInfoUpdate = 0;
      updateShowInfo();
    }
  });
  
  // Observe changes to the document body and its children
  mutationObserver.observe(document.body || document.documentElement, {
    childList: true,
    subtree: true,
    attributes: false
  });
}

/**
 * Initialize activity tracking
 */
function initActivityTracking() {
  // Mouse events
  document.addEventListener('mousemove', debouncedActivity, { passive: true });
  document.addEventListener('mousedown', handleActivity, { passive: true });
  document.addEventListener('click', handleActivity, { passive: true });
  
  // Keyboard events
  document.addEventListener('keydown', handleActivity, { passive: true });
  document.addEventListener('keypress', handleActivity, { passive: true });
  
  // Scroll events
  document.addEventListener('scroll', debouncedActivity, { passive: true });
  window.addEventListener('scroll', debouncedActivity, { passive: true });
  
  // Touch events (for touchscreen support)
  document.addEventListener('touchstart', handleActivity, { passive: true });
  document.addEventListener('touchmove', debouncedActivity, { passive: true });
  
  // Visibility change
  document.addEventListener('visibilitychange', handleVisibilityChange);
  
  // Focus events
  window.addEventListener('focus', () => {
    isPageVisible = true;
    handleActivity();
  });
  
  window.addEventListener('blur', () => {
    isPageVisible = false;
  });
  
  // Setup MutationObserver for dynamic DOM changes
  setupMutationObserver();
  
  // Set up periodic heartbeat check
  setInterval(() => {
    if (isPageVisible) {
      sendHeartbeat();
    }
  }, HEARTBEAT_INTERVAL);
  
  // Set up periodic show info update
  setInterval(() => {
    if (isPageVisible) {
      updateShowInfo();
    }
  }, SHOW_INFO_UPDATE_INTERVAL);
  
  // Set up periodic video player detection
  setInterval(() => {
    if (isPageVisible) {
      detectVideoPlayer();
    }
  }, VIDEO_DETECTION_INTERVAL);
  
  // Set up periodic video progress update
  setInterval(() => {
    if (isPageVisible && currentVideoPlayer) {
      updateVideoProgress();
    }
  }, VIDEO_UPDATE_INTERVAL);
  
  // Update show info on URL changes (for SPA navigation)
  let lastUrl = window.location.href;
  setInterval(() => {
    if (window.location.href !== lastUrl) {
      lastUrl = window.location.href;
      lastShowInfoUpdate = 0; // Force update
      currentVideoPlayer = null; // Reset video player on URL change
      videoProgress = null;
      updateShowInfo();
      detectVideoPlayer();
    }
  }, 1000);
  
  // Initial setup
  updateShowInfo();
  detectVideoPlayer();
  sendHeartbeat();
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initActivityTracking);
} else {
  initActivityTracking();
}
