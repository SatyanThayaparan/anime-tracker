/**
 * Storage utilities for Anime Tracker
 * Helper functions for reading/writing usage data and aggregation
 */

import { isServiceName, normalizeWatchIdentity } from './normalize.js';

export const CURRENT_SCHEMA_VERSION = 4;

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
            platform: showData.platform,
            totalTime: 0,
            activeTime: 0,
            pausedTime: 0,
            sessions: 0,
            episodes: {},
            hourly: {},
            lastWatched: 0
          };
        }
        
        aggregated.shows[showName].totalTime += showData.totalTime || 0;
        aggregated.shows[showName].activeTime += showData.activeTime || 0;
        aggregated.shows[showName].pausedTime += showData.pausedTime || 0;
        aggregated.shows[showName].sessions += showData.sessions || 0;
        if (showData.site) aggregated.shows[showName].site = showData.site;
        if (showData.platform) aggregated.shows[showName].platform = showData.platform;
        
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
                sessions: 0,
                rewatches: 0,
                seasonNumber: episodeData.seasonNumber || 1,
                label: episodeData.label || episodeNum
              };
            }
            
            const aggEpisode = aggregated.shows[showName].episodes[episodeNum];
            aggEpisode.time += episodeData.time || 0;
            aggEpisode.sessions += episodeData.sessions || 0;
            aggEpisode.rewatches += episodeData.rewatches || 0;
            if (episodeData.seasonNumber != null) {
              aggEpisode.seasonNumber = episodeData.seasonNumber;
            }
            if (episodeData.label) aggEpisode.label = episodeData.label;
            
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
        
        // Aggregate hourly data (global + per show for detail drawer)
        if (showData.hourly) {
          for (const [hour, time] of Object.entries(showData.hourly)) {
            aggregated.hourly[hour] = (aggregated.hourly[hour] || 0) + time;
            aggregated.shows[showName].hourly[hour] =
              (aggregated.shows[showName].hourly[hour] || 0) + time;
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
  return {
    idleThreshold: 60,
    sessionTimeout: 1800000,
    customCategories: null,
    animeOnlyTracking: false,
    autoTagFromAniList: true,
    ...(data.settings || {}),
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
 * Persistent genre/tags map: { [showName]: string[] }
 */
export async function getShowTags() {
  const data = await chrome.storage.local.get(['showTags']);
  return data.showTags || {};
}

/**
 * Replace tags for one show.
 * @param {string} showName
 * @param {string[]} tags
 */
export async function setShowTags(showName, tags) {
  const showTags = await getShowTags();
  const cleaned = [...new Set(
    (tags || [])
      .map((tag) => String(tag).trim().toLowerCase())
      .filter(Boolean)
  )];
  if (cleaned.length) showTags[showName] = cleaned;
  else delete showTags[showName];
  await chrome.storage.local.set({ showTags });
  return showTags;
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

function emptyShow(seed = {}) {
  return {
    site: seed.site || '',
    platform: seed.platform || '',
    totalTime: 0,
    activeTime: 0,
    pausedTime: 0,
    episodes: {},
    sessions: 0,
    lastWatched: 0,
    hourly: {},
  };
}

function mergeShowRecords(target, source) {
  target.totalTime += source.totalTime || 0;
  target.activeTime += source.activeTime || 0;
  target.pausedTime = (target.pausedTime || 0) + (source.pausedTime || 0);
  target.sessions += source.sessions || 0;
  target.lastWatched = Math.max(target.lastWatched || 0, source.lastWatched || 0);
  if (!target.site && source.site) target.site = source.site;
  if (!target.platform && source.platform) target.platform = source.platform;

  for (const [hour, ms] of Object.entries(source.hourly || {})) {
    target.hourly[hour] = (target.hourly[hour] || 0) + (ms || 0);
  }

  for (const [episodeKey, episode] of Object.entries(source.episodes || {})) {
    if (!target.episodes[episodeKey]) {
      target.episodes[episodeKey] = { ...episode };
      continue;
    }
    const dest = target.episodes[episodeKey];
    dest.time = (dest.time || 0) + (episode.time || 0);
    dest.sessions = (dest.sessions || 0) + (episode.sessions || 0);
    dest.rewatches = (dest.rewatches || 0) + (episode.rewatches || 0);
    dest.progress = Math.max(dest.progress || 0, episode.progress || 0);
    dest.currentTime = Math.max(dest.currentTime || 0, episode.currentTime || 0);
    dest.duration = Math.max(dest.duration || 0, episode.duration || 0);
    dest.completed = Boolean(dest.completed || episode.completed);
    dest.timestamp = Math.max(dest.timestamp || 0, episode.timestamp || 0);
    if (!dest.label && episode.label) dest.label = episode.label;
  }
}

function recomputeDailyStats(dayData) {
  const shows = Object.values(dayData.shows || {});
  dayData.dailyStats = {
    totalTime: shows.reduce((sum, show) => sum + (show.totalTime || 0), 0),
    showsActive: shows.length,
    episodesWatched: shows.reduce((sum, show) => {
      return (
        sum + Object.values(show.episodes || {}).filter((episode) => episode.completed).length
      );
    }, 0),
  };
}

function dayNeedsRepair(shows = {}) {
  return Object.keys(shows).some((rawName) => {
    if (isServiceName(rawName)) return true;
    const normalized = normalizeWatchIdentity(rawName);
    return Boolean(normalized && normalized.showName !== rawName);
  });
}

/**
 * Repair fragmented show keys (service names / glued episode titles).
 * Preserves time by merging into canonical shows (never deletes watch time).
 * @returns {Promise<{ migrated: boolean, fixedShows: number }>}
 */
export async function migrateWatchData(targetSchema = CURRENT_SCHEMA_VERSION) {
  const allData = await chrome.storage.local.get(null);
  const current = allData.meta?.schemaVersion || 1;
  const dateEntries = Object.entries(allData).filter(
    ([key, value]) => /^\d{4}-\d{2}-\d{2}$/.test(key) && value?.shows
  );
  const needsRepair = dateEntries.some(([, value]) => dayNeedsRepair(value.shows));

  if (current >= targetSchema && !needsRepair) {
    return { migrated: false, fixedShows: 0 };
  }

  const patch = {};
  let fixedShows = 0;

  for (const [key, value] of dateEntries) {
    const nextShows = {};
    const orphans = [];

    for (const [rawName, showData] of Object.entries(value.shows)) {
      if (isServiceName(rawName)) {
        orphans.push(showData);
        fixedShows += 1;
        continue;
      }

      const normalized = normalizeWatchIdentity(rawName);
      const canonical = normalized?.showName || rawName;
      if (canonical !== rawName) fixedShows += 1;

      if (!nextShows[canonical]) {
        nextShows[canonical] = emptyShow(showData);
      }
      mergeShowRecords(nextShows[canonical], showData);

      // Attribute glued-title time into an episode bucket (show total already merged above).
      // Only seed when this source had no episode map of its own (avoid double-counting).
      const hadEpisodes = Object.keys(showData.episodes || {}).length > 0;
      if (
        !hadEpisodes &&
        (normalized?.episodeNumber != null || normalized?.episodeLabel)
      ) {
        const episodeKey = String(normalized.episodeNumber ?? normalized.episodeLabel);
        if (!nextShows[canonical].episodes[episodeKey]) {
          nextShows[canonical].episodes[episodeKey] = {
            time: showData.totalTime || 0,
            progress: 0,
            currentTime: 0,
            duration: 0,
            completed: false,
            timestamp: showData.lastWatched || Date.now(),
            sessions: showData.sessions || 0,
            label: normalized.episodeLabel || episodeKey,
          };
        } else {
          nextShows[canonical].episodes[episodeKey].time += showData.totalTime || 0;
        }
      }
    }

    // Fold service-only buckets into the largest real show that day (keeps totals).
    for (const orphan of orphans) {
      const candidates = Object.values(nextShows);
      if (!candidates.length) {
        nextShows['Other watching'] = emptyShow(orphan);
        mergeShowRecords(nextShows['Other watching'], orphan);
        continue;
      }
      candidates.sort((a, b) => (b.totalTime || 0) - (a.totalTime || 0));
      const preferred =
        candidates.find(
          (show) =>
            (orphan.site && show.site === orphan.site) ||
            (orphan.platform && show.platform === orphan.platform)
        ) || candidates[0];
      mergeShowRecords(preferred, orphan);
    }

    const dayData = { ...value, shows: nextShows };
    recomputeDailyStats(dayData);
    patch[key] = dayData;
  }

  patch.meta = {
    ...(allData.meta || {}),
    schemaVersion: targetSchema,
    migratedAt: new Date().toISOString(),
  };

  await chrome.storage.local.set(patch);
  return { migrated: true, fixedShows };
}

/**
 * Export all usage data
 * @returns {Promise<Object>}
 */
export async function exportData() {
  const allData = await chrome.storage.local.get(null);
  return {
    schemaVersion: allData.meta?.schemaVersion || CURRENT_SCHEMA_VERSION,
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
