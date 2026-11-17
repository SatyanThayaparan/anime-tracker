import { formatTime } from '../utils/storage.js';

/**
 * Initialize popup
 */
async function initPopup() {
  try {
    await loadCurrentWatching();
    setupEventListeners();
    
    // Update every 2 seconds to show real-time progress
    setInterval(async () => {
      await loadCurrentWatching();
    }, 2000);
  } catch (error) {
    console.error('Error initializing popup:', error);
    showError();
  }
}

/**
 * Load and display currently watching anime
 */
async function loadCurrentWatching() {
  try {
    // Get current tracking state from background script
    chrome.runtime.sendMessage({ type: 'GET_TRACKING_STATE' }, (response) => {
      if (chrome.runtime.lastError) {
        console.error('Error getting tracking state:', chrome.runtime.lastError);
        showError();
        return;
      }
      
      const tracking = response?.tracking;
      displayCurrentWatching(tracking);
    });
  } catch (error) {
    console.error('Error loading current watching:', error);
    showError();
  }
}

/**
 * Format time from seconds to MM:SS or HH:MM:SS
 */
function formatTimeFromSeconds(seconds) {
  if (!seconds || seconds < 0) return '0:00';
  
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Display currently watching anime
 */
function displayCurrentWatching(tracking) {
  const container = document.getElementById('currentWatching');
  
  // Check if we're tracking an anime site
  if (!tracking || !tracking.showName || !tracking.isActive) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">📺</div>
        <div class="empty-state-title">Not watching anything</div>
        <div class="empty-state-subtitle">Open an anime site to start tracking</div>
      </div>
    `;
    return;
  }
  
  const showName = tracking.showName;
  const episodeNumber = tracking.episodeNumber;
  const videoProgress = tracking.videoProgress;
  const site = tracking.hostname || 'anime site';
  
  let progressHTML = '';
  let episodeInfo = '';
  
  if (episodeNumber !== null) {
    episodeInfo = `<div class="episode-info">Episode ${episodeNumber}</div>`;
  }
  
  if (videoProgress) {
    const { currentTime, duration, progress, paused } = videoProgress;
    
    if (duration > 0 && currentTime >= 0) {
      const progressPercent = Math.round(progress * 100);
      const timeRemaining = duration - currentTime;
      
      progressHTML = `
        <div class="video-progress">
          <div class="progress-bar-container">
            <div class="progress-bar" style="width: ${progressPercent}%"></div>
          </div>
          <div class="progress-info">
            <span class="progress-time">${formatTimeFromSeconds(currentTime)} / ${formatTimeFromSeconds(duration)}</span>
            <span class="progress-percent">${progressPercent}%</span>
          </div>
          ${timeRemaining > 0 ? `<div class="time-remaining">${formatTimeFromSeconds(timeRemaining)} remaining</div>` : ''}
          ${paused ? '<div class="playback-status">⏸ Paused</div>' : '<div class="playback-status">▶ Playing</div>'}
        </div>
      `;
    }
  }
  
  container.innerHTML = `
    <div class="current-show-card">
      <div class="show-header">
        <div class="show-name">${showName}</div>
        ${episodeInfo}
        <div class="show-site">on ${site}</div>
      </div>
      ${progressHTML}
      ${!videoProgress ? '<div class="no-progress">Video player not detected</div>' : ''}
    </div>
  `;
}

/**
 * Setup event listeners
 */
function setupEventListeners() {
  // Open dashboard button
  document.getElementById('openDashboard').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('dashboard/dashboard.html') });
    window.close();
  });
}

/**
 * Show error state
 */
function showError() {
  document.getElementById('currentWatching').innerHTML = `
    <div class="empty-state">
      <div class="empty-state-icon">⚠️</div>
      <div>Error loading data</div>
    </div>
  `;
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', initPopup);
