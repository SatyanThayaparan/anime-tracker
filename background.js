import { extractHostname } from './utils/categories.js';
import { isAnimeSite } from './utils/shows.js';

// Tracking state
let currentTracking = {
  tabId: null,
  url: null,
  hostname: null,
  showName: null,
  episodeNumber: null,
  startTime: null,
  lastActivityTime: null,
  isActive: true,
  videoProgress: null  // Current video progress state
};

// Configuration
const CONFIG = {
  SAVE_INTERVAL: 5000,        // Save to storage every 5 seconds
  IDLE_THRESHOLD: 60,         // Seconds of inactivity before considered idle
  SESSION_TIMEOUT: 1800000,   // 30 minutes for new session
  ACTIVITY_TIMEOUT: 60000     // 60 seconds without activity = idle
};

// Initialize
chrome.runtime.onInstalled.addListener(() => {
  console.log('Anime Tracker installed');
  initializeStorage();
});

chrome.runtime.onStartup.addListener(() => {
  console.log('Anime Tracker started');
  startTracking();
});

// Start tracking on load
startTracking();

/**
 * Initialize storage with default settings
 */
async function initializeStorage() {
  const data = await chrome.storage.local.get(['settings']);
  
  if (!data.settings) {
    await chrome.storage.local.set({
      settings: {
        idleThreshold: CONFIG.IDLE_THRESHOLD,
        sessionTimeout: CONFIG.SESSION_TIMEOUT,
        customCategories: null
      }
    });
  }
}

/**
 * Start the tracking system
 */
function startTracking() {
  // Set up idle detection
  chrome.idle.setDetectionInterval(CONFIG.IDLE_THRESHOLD);
  
  // Listen for idle state changes
  chrome.idle.onStateChanged.addListener(handleIdleStateChange);
  
  // Listen for tab changes
  chrome.tabs.onActivated.addListener(handleTabActivated);
  chrome.tabs.onUpdated.addListener(handleTabUpdated);
  chrome.tabs.onRemoved.addListener(handleTabRemoved);
  
  // Listen for window focus changes
  chrome.windows.onFocusChanged.addListener(handleWindowFocusChanged);
  
  // Listen for messages from content scripts
  chrome.runtime.onMessage.addListener(handleMessage);
  
  // Set up periodic saving
  setInterval(saveCurrentSession, CONFIG.SAVE_INTERVAL);
  
  // Get current active tab
  getCurrentTab();
}

/**
 * Get the current active tab and start tracking
 */
async function getCurrentTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.url) {
      startTrackingTab(tab.id, tab.url);
    }
  } catch (e) {
    console.error('Error getting current tab:', e);
  }
}

/**
 * Start tracking a new tab
 */
function startTrackingTab(tabId, url) {
  // Save previous session before switching
  saveCurrentSession();
  
  const hostname = extractHostname(url);
  
  // Skip tracking for chrome:// urls, extensions, etc.
  if (!hostname || url.startsWith('chrome://') || url.startsWith('chrome-extension://')) {
    currentTracking = {
      tabId: null,
      url: null,
      hostname: null,
      showName: null,
      episodeNumber: null,
      startTime: null,
      lastActivityTime: null,
      isActive: false
    };
    return;
  }
  
  // Only track anime sites
  if (!isAnimeSite(url)) {
    currentTracking = {
      tabId: null,
      url: null,
      hostname: null,
      showName: null,
      episodeNumber: null,
      startTime: null,
      lastActivityTime: null,
      isActive: false
    };
    return;
  }
  
  const now = Date.now();
  
  currentTracking = {
    tabId,
    url,
    hostname,
    showName: null,  // Will be updated from content script
    episodeNumber: null,  // Will be updated from content script
    startTime: now,
    lastActivityTime: now,
    isActive: true
  };
}

/**
 * Handle tab activation (switching tabs)
 */
async function handleTabActivated(activeInfo) {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    if (tab && tab.url) {
      startTrackingTab(tab.id, tab.url);
    }
  } catch (e) {
    console.error('Error handling tab activation:', e);
  }
}

/**
 * Handle tab URL updates (navigation within tab)
 */
function handleTabUpdated(tabId, changeInfo, tab) {
  if (changeInfo.url && tabId === currentTracking.tabId) {
    startTrackingTab(tabId, changeInfo.url);
  }
}

/**
 * Handle tab removal
 */
function handleTabRemoved(tabId) {
  if (tabId === currentTracking.tabId) {
    saveCurrentSession();
    currentTracking = {
      tabId: null,
      url: null,
      hostname: null,
      category: null,
      startTime: null,
      lastActivityTime: null,
      isActive: false
    };
  }
}

/**
 * Handle window focus changes
 */
async function handleWindowFocusChanged(windowId) {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    // Browser lost focus
    currentTracking.isActive = false;
    saveCurrentSession();
  } else {
    // Browser gained focus, get active tab
    currentTracking.isActive = true;
    await getCurrentTab();
  }
}

/**
 * Handle idle state changes
 */
function handleIdleStateChange(state) {
  if (state === 'idle' || state === 'locked') {
    currentTracking.isActive = false;
    saveCurrentSession();
  } else if (state === 'active') {
    currentTracking.isActive = true;
    if (currentTracking.hostname) {
      currentTracking.lastActivityTime = Date.now();
    }
  }
}

/**
 * Handle messages from content scripts
 */
function handleMessage(message, sender, sendResponse) {
  if (message.type === 'ACTIVITY') {
    // User activity detected on page
    if (sender.tab && sender.tab.id === currentTracking.tabId) {
      currentTracking.lastActivityTime = Date.now();
      currentTracking.isActive = true;
      
      // Update show info if provided
      if (message.showInfo) {
        const showChanged = currentTracking.showName !== message.showInfo.showName ||
                           currentTracking.episodeNumber !== message.showInfo.episodeNumber;
        
        // If show or episode changed, save current session and start new one
        if (showChanged && currentTracking.showName) {
          saveCurrentSession();
          currentTracking.startTime = Date.now();
        }
        
        currentTracking.showName = message.showInfo.showName;
        currentTracking.episodeNumber = message.showInfo.episodeNumber;
      }
      
      // Update video progress if provided
      if (message.videoProgress) {
        currentTracking.videoProgress = message.videoProgress;
      } else {
        currentTracking.videoProgress = null;
      }
    }
    sendResponse({ received: true });
  } else if (message.type === 'GET_TRACKING_STATE') {
    sendResponse({ tracking: currentTracking });
  }
  
  return true; // Keep message channel open for async response
}

/**
 * Save current tracking session to storage
 */
async function saveCurrentSession() {
  if (!currentTracking.hostname || !currentTracking.startTime || !currentTracking.showName) {
    return;
  }
  
  const now = Date.now();
  const sessionDuration = now - currentTracking.startTime;
  
  // Calculate active vs idle time
  let activeTime = sessionDuration;
  if (!currentTracking.isActive) {
    // If currently idle, only count time up to last activity
    const timeSinceActivity = now - currentTracking.lastActivityTime;
    activeTime = Math.max(0, sessionDuration - timeSinceActivity);
  }
  
  // Get today's date key
  const dateKey = getDateKey(new Date());
  const hour = new Date().getHours().toString().padStart(2, '0');
  
  try {
    // Get existing data
    const data = await chrome.storage.local.get([dateKey, 'lastVisits']);
    const dayData = data[dateKey] || { shows: {}, dailyStats: {} };
    const lastVisits = data.lastVisits || {};
    
    // Initialize daily stats if needed
    if (!dayData.dailyStats) {
      dayData.dailyStats = {
        totalTime: 0,
        episodesWatched: 0,
        showsActive: 0
      };
    }
    
    // Update show data
    if (!dayData.shows[currentTracking.showName]) {
      dayData.shows[currentTracking.showName] = {
        site: currentTracking.hostname,
        totalTime: 0,
        activeTime: 0,
        episodes: {},
        sessions: 0,
        lastWatched: now,
        hourly: {}
      };
    }
    
    const showData = dayData.shows[currentTracking.showName];
    showData.totalTime += sessionDuration;
    showData.activeTime += activeTime;
    showData.lastWatched = now;
    
    // Update hourly breakdown
    if (!showData.hourly[hour]) {
      showData.hourly[hour] = 0;
    }
    showData.hourly[hour] += sessionDuration;
    
    // Track episode if we have episode number
    if (currentTracking.episodeNumber !== null) {
      const episodeKey = currentTracking.episodeNumber.toString();
      
      if (!showData.episodes[episodeKey]) {
        showData.episodes[episodeKey] = {
          time: 0,
          progress: 0,
          currentTime: 0,
          duration: 0,
          completed: false,
          timestamp: now,
          sessions: 0
        };
      }
      
      const episodeData = showData.episodes[episodeKey];
      episodeData.time += sessionDuration;
      episodeData.timestamp = now;
      
      // Update progress from video player if available
      if (currentTracking.videoProgress) {
        const vp = currentTracking.videoProgress;
        
        // Update duration if we have it and it's valid
        if (vp.duration > 0) {
          episodeData.duration = vp.duration;
        }
        
        // Update current time and progress
        if (vp.currentTime >= 0 && vp.duration > 0) {
          episodeData.currentTime = vp.currentTime;
          episodeData.progress = vp.progress;
          
          // Mark as completed if progress >= 0.8 (80%)
          if (vp.progress >= 0.8) {
            episodeData.completed = true;
          }
        } else if (vp.duration > 0) {
          // If we have duration but no current time, estimate progress from time watched
          episodeData.progress = Math.min(1, episodeData.time / (vp.duration * 1000));
          if (episodeData.progress >= 0.8) {
            episodeData.completed = true;
          }
        }
      } else {
        // Fallback: Mark as completed if watched for more than 80% of typical episode (20 minutes)
        const typicalEpisodeLength = 20 * 60 * 1000; // 20 minutes in ms
        if (episodeData.time >= typicalEpisodeLength * 0.8) {
          episodeData.completed = true;
          episodeData.progress = 1.0;
        } else if (episodeData.duration > 0) {
          // Estimate progress from time watched
          episodeData.progress = Math.min(1, episodeData.time / (episodeData.duration * 1000));
        }
      }
    }
    
    // Check if this is a new visit (session)
    const lastVisitKey = `${currentTracking.showName}_${currentTracking.hostname}`;
    const lastVisit = lastVisits[lastVisitKey] || 0;
    const isNewSession = now - lastVisit > CONFIG.SESSION_TIMEOUT;
    
    if (isNewSession) {
      showData.sessions += 1;
      lastVisits[lastVisitKey] = now;
      
      // Increment episode session count if we have episode number
      if (currentTracking.episodeNumber !== null) {
        const episodeKey = currentTracking.episodeNumber.toString();
        if (showData.episodes[episodeKey]) {
          showData.episodes[episodeKey].sessions = (showData.episodes[episodeKey].sessions || 0) + 1;
        }
      }
    }
    
    // Update daily stats
    dayData.dailyStats.totalTime += sessionDuration;
    
    // Count unique shows
    const uniqueShows = new Set(Object.keys(dayData.shows));
    dayData.dailyStats.showsActive = uniqueShows.size;
    
    // Count completed episodes
    let totalEpisodes = 0;
    for (const show of Object.values(dayData.shows)) {
      for (const episode of Object.values(show.episodes || {})) {
        if (episode.completed) {
          totalEpisodes++;
        }
      }
    }
    dayData.dailyStats.episodesWatched = totalEpisodes;
    
    // Save updated data
    await chrome.storage.local.set({
      [dateKey]: dayData,
      lastVisits: lastVisits
    });
    
    // Reset start time for next interval
    currentTracking.startTime = now;
    
  } catch (e) {
    console.error('Error saving session:', e);
  }
}

/**
 * Get date key in YYYY-MM-DD format
 */
function getDateKey(date) {
  return date.toISOString().split('T')[0];
}

// Export for testing
export { currentTracking, CONFIG };
