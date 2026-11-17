/**
 * Storage utilities for Website Usage Tracker
 * Helper functions for reading/writing usage data and aggregation
 */

/**
 * Get local date key in YYYY-MM-DD format
 * @param {Date} date
 * @returns {string}
 */
export function getDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Get an array of date keys for a range
 * @param {number} days - Number of days to include (including today)
 * @returns {string[]}
 */
export function getDateRange(days) {
  const dates = [];
  const today = new Date();
  
  for (let i = 0; i < days; i++) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);
    dates.push(getDateKey(date));
  }
  
  return dates;
}

/**
 * Get today's usage data
 * @returns {Promise<Object>}
 */
export async function getTodayData() {
  const dateKey = getDateKey(new Date());
  const data = await chrome.storage.local.get([dateKey]);
  return data[dateKey] || { shows: {}, dailyStats: {} };
}

/**
 * Get usage data for a specific date
 * @param {string} dateKey - Date in YYYY-MM-DD format
 * @returns {Promise<Object>}
 */
export async function getDataForDate(dateKey) {
  const data = await chrome.storage.local.get([dateKey]);
  return data[dateKey] || { shows: {}, dailyStats: {} };
}

/**
 * Get usage data for multiple dates
 * @param {string[]} dateKeys - Array of date keys
 * @returns {Promise<Object>}
 */
export async function getDataForDates(dateKeys) {
  const data = await chrome.storage.local.get(dateKeys);
  return data;
}

/**
 * Get aggregated data for a date range
 * @param {number} days - Number of days to aggregate
 * @returns {Promise<Object>}
 */
export async function getAggregatedData(days) {
  const dateKeys = getDateRange(days);
  const rawData = await getDataForDates(dateKeys);
  
  const aggregated = {
    shows: {},
    daily: {},
    hourly: {},
    stats: {
      totalTime: 0,
      episodesWatched: 0,
      showsActive: 0
    }
  };
  
  // Initialize hourly buckets
  for (let i = 0; i < 24; i++) {
    aggregated.hourly[i.toString().padStart(2, '0')] = 0;
  }
  
  const allShows = new Set();
  let totalEpisodes = 0;
  
  for (const dateKey of dateKeys) {
    const dayData = rawData[dateKey];
    if (!dayData) continue;
    
    // Store daily totals
    let dayTotal = 0;
    
    // Aggregate show data
    if (dayData.shows) {
      for (const [showName, showData] of Object.entries(dayData.shows)) {
        allShows.add(showName);
        
        if (!aggregated.shows[showName]) {
          aggregated.shows[showName] = {
            site: showData.site,
            totalTime: 0,
            activeTime: 0,
            sessions: 0,
            episodes: {},
            lastWatched: 0
          };
        }
        
        aggregated.shows[showName].totalTime += showData.totalTime || 0;
        aggregated.shows[showName].activeTime += showData.activeTime || 0;
        aggregated.shows[showName].sessions += showData.sessions || 0;
        
        if (showData.lastWatched > aggregated.shows[showName].lastWatched) {
          aggregated.shows[showName].lastWatched = showData.lastWatched;
        }
        
        dayTotal += showData.totalTime || 0;
        
        // Aggregate episode data
        if (showData.episodes) {
          for (const [episodeNum, episodeData] of Object.entries(showData.episodes)) {
            if (!aggregated.shows[showName].episodes[episodeNum]) {
              aggregated.shows[showName].episodes[episodeNum] = {
                time: 0,
                progress: 0,
                currentTime: 0,
                duration: 0,
                completed: false,
                timestamp: 0,
                sessions: 0
              };
            }
            
            const aggEpisode = aggregated.shows[showName].episodes[episodeNum];
            aggEpisode.time += episodeData.time || 0;
            aggEpisode.sessions += episodeData.sessions || 0;
            
            // Update progress - use maximum progress seen
            if (episodeData.progress !== undefined && episodeData.progress > aggEpisode.progress) {
              aggEpisode.progress = episodeData.progress;
            }
            
            // Update duration - use maximum duration seen (most accurate)
            if (episodeData.duration > 0) {
              if (aggEpisode.duration === 0 || episodeData.duration > aggEpisode.duration) {
                aggEpisode.duration = episodeData.duration;
              }
            }
            
            // Update current time - use maximum current time seen
            if (episodeData.currentTime > aggEpisode.currentTime) {
              aggEpisode.currentTime = episodeData.currentTime;
            }
            
            if (episodeData.completed) {
              aggEpisode.completed = true;
            }
            
            if (episodeData.timestamp > aggEpisode.timestamp) {
              aggEpisode.timestamp = episodeData.timestamp;
            }
            
            if (episodeData.completed) {
              totalEpisodes++;
            }
          }
        }
        
        // Aggregate hourly data
        if (showData.hourly) {
          for (const [hour, time] of Object.entries(showData.hourly)) {
            aggregated.hourly[hour] = (aggregated.hourly[hour] || 0) + time;
          }
        }
      }
    }
    
    aggregated.daily[dateKey] = dayTotal;
  }
  
  // Calculate aggregated stats
  aggregated.stats.totalTime = Object.values(aggregated.shows)
    .reduce((sum, show) => sum + (show.totalTime || 0), 0);
  aggregated.stats.episodesWatched = totalEpisodes;
  aggregated.stats.showsActive = allShows.size;
  
  return aggregated;
}

/**
 * Get top shows by time spent
 * @param {Object} showsData - Shows data object
 * @param {number} limit - Number of top shows to return
 * @returns {Array}
 */
export function getTopShows(showsData, limit = 5) {
  return Object.entries(showsData)
    .map(([showName, data]) => ({
      showName,
      ...data
    }))
    .sort((a, b) => b.totalTime - a.totalTime)
    .slice(0, limit);
}

/**
 * Get top sites by time spent (legacy function for compatibility)
 * @param {Object} sitesData - Sites data object
 * @param {number} limit - Number of top sites to return
 * @returns {Array}
 */
export function getTopSites(sitesData, limit = 5) {
  return Object.entries(sitesData)
    .map(([hostname, data]) => ({
      hostname,
      ...data
    }))
    .sort((a, b) => b.totalTime - a.totalTime)
    .slice(0, limit);
}

/**
 * Get total time across all shows/sites/categories
 * @param {Object} data - Data object with totalTime properties
 * @returns {number}
 */
export function getTotalTime(data) {
  return Object.values(data).reduce((sum, item) => sum + (item.totalTime || 0), 0);
}

/**
 * Get total episodes watched for a show
 * @param {Object} episodes - Episodes object
 * @returns {number}
 */
export function getCompletedEpisodes(episodes) {
  if (!episodes) return 0;
  return Object.values(episodes).filter(ep => ep.completed).length;
}

/**
 * Format milliseconds to human-readable time
 * @param {number} ms - Time in milliseconds
 * @param {boolean} short - Use short format (1h 30m vs 1 hour 30 minutes)
 * @returns {string}
 */
export function formatTime(ms, short = false) {
  if (ms < 1000) return short ? '0s' : '0 seconds';
  
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  
  if (hours > 0) {
    const remainingMinutes = minutes % 60;
    if (short) {
      return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
    }
    return remainingMinutes > 0 
      ? `${hours} hour${hours > 1 ? 's' : ''} ${remainingMinutes} minute${remainingMinutes > 1 ? 's' : ''}`
      : `${hours} hour${hours > 1 ? 's' : ''}`;
  }
  
  if (minutes > 0) {
    if (short) {
      return `${minutes}m`;
    }
    return `${minutes} minute${minutes > 1 ? 's' : ''}`;
  }
  
  if (short) {
    return `${seconds}s`;
  }
  return `${seconds} second${seconds > 1 ? 's' : ''}`;
}

/**
 * Format milliseconds to HH:MM:SS
 * @param {number} ms - Time in milliseconds
 * @returns {string}
 */
export function formatTimeDigital(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/**
 * Get settings from storage
 * @returns {Promise<Object>}
 */
export async function getSettings() {
  const data = await chrome.storage.local.get(['settings']);
  return data.settings || {
    idleThreshold: 60,
    sessionTimeout: 1800000,
    customCategories: null
  };
}

/**
 * Save settings to storage
 * @param {Object} settings 
 * @returns {Promise<void>}
 */
export async function saveSettings(settings) {
  await chrome.storage.local.set({ settings });
}

/**
 * Clean up old data (older than specified days)
 * @param {number} daysToKeep - Number of days of data to keep
 * @returns {Promise<void>}
 */
export async function cleanupOldData(daysToKeep = 90) {
  const allData = await chrome.storage.local.get(null);
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
  const cutoffKey = getDateKey(cutoffDate);
  
  const keysToRemove = [];
  
  for (const key of Object.keys(allData)) {
    // Check if key is a date key (YYYY-MM-DD format)
    if (/^\d{4}-\d{2}-\d{2}$/.test(key)) {
      if (key < cutoffKey) {
        keysToRemove.push(key);
      }
    }
  }
  
  if (keysToRemove.length > 0) {
    await chrome.storage.local.remove(keysToRemove);
    console.log(`Cleaned up ${keysToRemove.length} old data entries`);
  }
}

/**
 * Export all usage data
 * @returns {Promise<Object>}
 */
export async function exportData() {
  const allData = await chrome.storage.local.get(null);
  return {
    schemaVersion: allData.meta?.schemaVersion || 1,
    exportDate: new Date().toISOString(),
    data: allData,
  };
}

/**
 * Clear all usage data (keep settings)
 * @returns {Promise<void>}
 */
export async function clearAllData() {
  const settings = await getSettings();
  await chrome.storage.local.clear();
  await saveSettings(settings);
}

/**
 * Calculate percentage of time
 * @param {number} part - Part value
 * @param {number} total - Total value
 * @returns {number} - Percentage (0-100)
 */
export function calculatePercentage(part, total) {
  if (total === 0) return 0;
  return Math.round((part / total) * 100);
}
