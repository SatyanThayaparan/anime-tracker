/**
 * Show detection and parsing utilities for anime tracking
 * Supports: Crunchyroll, Funimation, 9anime, Zoro, Gogoanime
 */

// Supported anime sites
export const ANIME_SITES = [
  'crunchyroll.com',
  'funimation.com',
  '9anime.to',
  '9anime.id',
  'zoro.to',
  'gogoanime.sk',
  'gogoanime.cm',
  'gogoanime.fi',
  'gogoanimehd.io'
];

/**
 * DOM selector configuration for each anime site
 * These selectors are tried in order until one works
 */
export const DOM_SELECTORS = {
  crunchyroll: {
    showName: [
      // Series title in header/breadcrumb
      '[data-testid="seriesTitle"]',
      '[data-t="series-title"]',
      '.series-title',
      '[class*="series-title"]',
      '[class*="SeriesTitle"]',
      '[class*="seriesTitle"]',
      // Main heading
      'h1[class*="title"]',
      'h1.ellipsis-text',
      'h1',
      'h2[class*="title"]',
      'h2',
      // Breadcrumb navigation
      'nav[aria-label*="breadcrumb"] a',
      '[class*="breadcrumb"] a',
      '[class*="Breadcrumb"] a',
      // Metadata
      '[itemprop="name"]',
      '[class*="metadata"] h1',
      '[class*="Metadata"] h1',
      // Generic title patterns
      '[class*="Title"]',
      '[class*="title"]',
      // Page title (fallback)
      'title'
    ],
    episodeNumber: [
      // Episode number in player/episode selector
      '[data-testid="episodeNumber"]',
      '[data-t="episode-number"]',
      '.episode-number',
      '[class*="episode-number"]',
      '[class*="EpisodeNumber"]',
      '[class*="episodeNumber"]',
      // Episode title/header
      '.episode-title',
      '[class*="episode-title"]',
      '[class*="EpisodeTitle"]',
      'h2[class*="episode"]',
      'h3[class*="episode"]',
      // Episode selector dropdown
      'select[class*="episode"]',
      '[class*="episode-selector"]',
      '[class*="EpisodeSelector"]',
      // Generic episode patterns
      '[class*="episode"]',
      'span[class*="episode"]',
      'div[class*="episode"]',
      // Episode in text content
      '[class*="episode-info"]',
      '[class*="EpisodeInfo"]'
    ],
    videoPlayer: [
      'video',
      '[class*="player"] video',
      '[class*="Player"] video',
      '[class*="video-player"] video',
      '[class*="VideoPlayer"] video',
      '#player video',
      '[id*="player"] video',
      'iframe[src*="player"]',
      'iframe[src*="crunchyroll"]',
      '[class*="vilos"] video',
      '[class*="Vilos"] video'
    ]
  },
  funimation: {
    showName: [
      'h1[class*="title"]',
      '.show-title',
      '[data-testid="showTitle"]',
      'h1',
      'title'
    ],
    episodeNumber: [
      '.episode-number',
      '[data-testid="episodeNumber"]',
      '.episode-title',
      '[class*="episode"]'
    ],
    videoPlayer: [
      'video',
      '[class*="player"] video',
      '#player video'
    ]
  },
  '9anime': {
    showName: [
      'h1',
      '.title',
      '.anime-name',
      '[itemprop="name"]',
      '[class*="title"]',
      '[class*="anime-name"]',
      'title'
    ],
    episodeNumber: [
      '.episode-number',
      '.episode',
      '[data-episode]',
      '[class*="episode-number"]',
      '[class*="episode"]'
    ],
    videoPlayer: [
      'video',
      '#player video',
      '[class*="player"] video',
      'iframe[src*="player"]'
    ]
  },
  zoro: {
    showName: [
      'h1',
      '.anime-title',
      '.film-name',
      '[data-title]',
      '[class*="title"]',
      '[class*="anime-title"]',
      'title'
    ],
    episodeNumber: [
      '.episode-number',
      '.episode',
      '[data-episode]',
      '[class*="episode-number"]',
      '[class*="episode"]'
    ],
    videoPlayer: [
      'video',
      '#player video',
      '[class*="player"] video',
      'iframe[src*="player"]'
    ]
  },
  gogoanime: {
    showName: [
      'h1',
      '.anime_title',
      '.anime-name',
      '[itemprop="name"]',
      '[class*="title"]',
      '[class*="anime_title"]',
      'title'
    ],
    episodeNumber: [
      '.episode-number',
      '.episode',
      '[data-episode]',
      '[class*="episode-number"]',
      '[class*="episode"]'
    ],
    videoPlayer: [
      'video',
      '#player video',
      '[class*="player"] video',
      'iframe[src*="player"]'
    ]
  }
};

/**
 * Generic fallback selectors used when site-specific ones fail
 */
const GENERIC_SELECTORS = {
  showName: ['h1', 'h2', '.title', '[class*="title"]', 'title'],
  episodeNumber: ['.episode', '[class*="episode"]', '[data-episode]'],
  videoPlayer: ['video', 'iframe[src*="player"]', '[class*="player"]']
};

/**
 * Check if a URL is from a supported anime site
 * @param {string} url - The URL to check
 * @returns {boolean}
 */
export function isAnimeSite(url) {
  if (!url) return false;
  
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname.replace(/^www\./, '');
    
    return ANIME_SITES.some(site => 
      hostname === site || hostname.endsWith('.' + site)
    );
  } catch (e) {
    return false;
  }
}

// Debug mode - set to true to enable console logging
const DEBUG_MODE = true;

/**
 * Debug logging helper
 */
function debugLog(...args) {
  if (DEBUG_MODE) {
    console.log('[Anime Tracker]', ...args);
  }
}

/**
 * Normalize show name (clean special chars, normalize spacing)
 * @param {string} showName - Raw show name
 * @returns {string} - Normalized show name
 */
export function normalizeShowName(showName) {
  if (!showName) return null;
  
  // First, clean up common prefixes/suffixes
  let cleaned = showName
    .trim()
    // Remove common prefixes
    .replace(/^\s*Watch\s+/i, '')
    .replace(/^\s*Stream\s+/i, '')
    // Remove common suffixes
    .replace(/\s*-\s*Episode.*$/i, '')
    .replace(/\s*-\s*EP.*$/i, '')
    .replace(/\s*-\s*Crunchyroll.*$/i, '')
    .replace(/\s*-\s*Watch.*$/i, '')
    .replace(/\s*\(.*?\)\s*$/g, '') // Remove parenthetical content at end
    .trim();
  
  // Normalize spacing
  cleaned = cleaned.replace(/\s+/g, ' ');
  
  // Don't remove special chars - keep them for better matching
  // Only remove if it would make the name empty
  const withoutSpecial = cleaned.replace(/[^\w\s-]/g, '');
  if (withoutSpecial.trim().length > 0 && withoutSpecial.trim().length >= cleaned.trim().length * 0.5) {
    // If removing special chars doesn't remove too much, use cleaned version
    cleaned = withoutSpecial.trim();
  }
  
  return cleaned || showName.trim();
}

/**
 * Extract episode number from text or URL
 * @param {string} text - Text to search
 * @returns {number|null} - Episode number or null
 */
export function extractEpisodeNumber(text) {
  if (!text) return null;
  
  // Common patterns: episode-1, ep-1, episode 1, ep 1, episode/1, ep.1, etc.
  const patterns = [
    /episode[-\s/.:]*(\d+)/i,  // "Episode 1", "Episode-1", "Episode: 1"
    /ep[-\s/.:]*(\d+)/i,       // "EP 1", "Ep-1", "Ep.1"
    /^(\d+)$/,                 // Just a number
    /[^0-9](\d+)[^0-9]/,       // Number surrounded by non-digits
    /#(\d+)/,                  // "#1", "#12"
    /(\d+)\s*of\s*\d+/i,       // "1 of 12"
    /episode\s*(\d+)/i         // "Episode 1" (more flexible)
  ];
  
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const num = parseInt(match[1] || match[0], 10);
      if (num > 0 && num < 10000) {  // Reasonable episode number range
        debugLog('Extracted episode number:', num, 'from text:', text);
        return num;
      }
    }
  }
  
  return null;
}

/**
 * Try multiple selectors to extract text from DOM
 * @param {Document} document - DOM document
 * @param {string[]} selectors - Array of CSS selectors to try
 * @param {Function} transform - Optional function to transform extracted text
 * @param {string} debugLabel - Label for debug logging
 * @returns {string|null} - Extracted text or null
 */
function trySelectors(document, selectors, transform = null, debugLabel = 'text') {
  if (!document || !selectors || selectors.length === 0) return null;
  
  debugLog(`Trying ${selectors.length} selectors for ${debugLabel}`);
  
  for (const selector of selectors) {
    try {
      const element = document.querySelector(selector);
      if (element) {
        let text = element.textContent || element.innerText || element.getAttribute('data-title') || element.getAttribute('title') || element.getAttribute('aria-label') || '';
        text = text.trim();
        
        if (text) {
          debugLog(`Found ${debugLabel} with selector "${selector}":`, text.substring(0, 50));
          
          if (transform) {
            text = transform(text);
          }
          if (text) {
            debugLog(`Extracted ${debugLabel}:`, text);
            return text;
          }
        }
      }
    } catch (e) {
      debugLog(`Selector "${selector}" failed:`, e.message);
      // Continue to next selector if this one fails
      continue;
    }
  }
  
  debugLog(`No ${debugLabel} found with any selector`);
  return null;
}

/**
 * Extract show name from meta tags
 * @param {Document} document - DOM document
 * @returns {string|null} - Show name or null
 */
function extractShowNameFromMeta(document) {
  if (!document) return null;
  
  const metaSelectors = [
    'meta[property="og:title"]',
    'meta[name="twitter:title"]',
    'meta[property="og:site_name"]',
    'meta[name="title"]'
  ];
  
  for (const selector of metaSelectors) {
    try {
      const meta = document.querySelector(selector);
      if (meta) {
        const content = meta.getAttribute('content');
        if (content) {
          // Clean up meta title
          const cleaned = content
            .replace(/\s*-\s*Episode.*$/i, '')
            .replace(/\s*-\s*EP.*$/i, '')
            .replace(/\s*-\s*Crunchyroll.*$/i, '')
            .trim();
          if (cleaned) {
            debugLog('Found show name in meta tag:', cleaned);
            return cleaned;
          }
        }
      }
    } catch (e) {
      continue;
    }
  }
  
  return null;
}

/**
 * Extract show name from structured data (JSON-LD)
 * @param {Document} document - DOM document
 * @returns {string|null} - Show name or null
 */
function extractShowNameFromStructuredData(document) {
  if (!document) return null;
  
  try {
    const scripts = document.querySelectorAll('script[type="application/ld+json"]');
    for (const script of scripts) {
      try {
        const data = JSON.parse(script.textContent);
        
        // Check for VideoObject or TVSeries
        if (data['@type'] === 'VideoObject' || data['@type'] === 'TVSeries' || data['@type'] === 'Movie') {
          if (data.name) {
            debugLog('Found show name in structured data:', data.name);
            return data.name;
          }
          if (data.partOfSeries && data.partOfSeries.name) {
            debugLog('Found show name in structured data (partOfSeries):', data.partOfSeries.name);
            return data.partOfSeries.name;
          }
        }
        
        // Check if it's an array
        if (Array.isArray(data)) {
          for (const item of data) {
            if (item['@type'] === 'VideoObject' || item['@type'] === 'TVSeries') {
              if (item.name) {
                debugLog('Found show name in structured data array:', item.name);
                return item.name;
              }
              if (item.partOfSeries && item.partOfSeries.name) {
                debugLog('Found show name in structured data array (partOfSeries):', item.partOfSeries.name);
                return item.partOfSeries.name;
              }
            }
          }
        }
      } catch (e) {
        // Invalid JSON, continue
        continue;
      }
    }
  } catch (e) {
    // Ignore errors
  }
  
  return null;
}

/**
 * Extract show name from DOM using site-specific selectors
 * @param {Document} document - DOM document
 * @param {string} site - Site identifier (crunchyroll, funimation, etc.)
 * @returns {string|null} - Show name or null
 */
function extractShowNameFromDOM(document, site) {
  if (!document) return null;
  
  debugLog(`Extracting show name for site: ${site}`);
  
  // Try site-specific selectors first
  const siteSelectors = DOM_SELECTORS[site]?.showName;
  if (siteSelectors) {
    const result = trySelectors(document, siteSelectors, (text) => {
      // Clean up common prefixes/suffixes
      return text
        .replace(/^\s*Watch\s+/i, '')
        .replace(/\s*-\s*Episode.*$/i, '')
        .replace(/\s*-\s*EP.*$/i, '')
        .replace(/\s*-\s*Crunchyroll.*$/i, '')
        .trim();
    }, 'show name (site-specific)');
    if (result) return result;
  }
  
  // Try meta tags
  const metaResult = extractShowNameFromMeta(document);
  if (metaResult) return metaResult;
  
  // Try structured data
  const structuredResult = extractShowNameFromStructuredData(document);
  if (structuredResult) return structuredResult;
  
  // Fallback to generic selectors
  const genericResult = trySelectors(document, GENERIC_SELECTORS.showName, (text) => {
    return text
      .replace(/^\s*Watch\s+/i, '')
      .replace(/\s*-\s*Episode.*$/i, '')
      .replace(/\s*-\s*EP.*$/i, '')
      .trim();
  }, 'show name (generic)');
  if (genericResult) return genericResult;
  
  // Last resort: try page title with better parsing
  try {
    const pageTitle = document.title;
    if (pageTitle) {
      debugLog('Trying to extract from page title:', pageTitle);
      
      // Try various patterns
      const patterns = [
        /^(.+?)\s*-\s*Episode\s*\d+/i,
        /^(.+?)\s*-\s*EP\s*\d+/i,
        /^(.+?)\s*-\s*Watch/i,
        /^(.+?)\s*-\s*Crunchyroll/i,
        /^(.+?)\s*\|/,
        /^(.+?)\s*:/,
        /^(.+?)$/  // Just return the whole title if no pattern matches
      ];
      
      for (const pattern of patterns) {
        const match = pageTitle.match(pattern);
        if (match && match[1]) {
          const extracted = match[1].trim();
          if (extracted && extracted.length > 0) {
            debugLog('Extracted show name from page title:', extracted);
            return extracted;
          }
        }
      }
    }
  } catch (e) {
    debugLog('Error extracting from page title:', e);
  }
  
  debugLog('Could not extract show name');
  return null;
}

/**
 * Extract episode number from DOM using site-specific selectors
 * @param {Document} document - DOM document
 * @param {string} site - Site identifier
 * @returns {number|null} - Episode number or null
 */
function extractEpisodeNumberFromDOM(document, site) {
  if (!document) return null;
  
  debugLog(`Extracting episode number for site: ${site}`);
  
  // Try site-specific selectors first
  const siteSelectors = DOM_SELECTORS[site]?.episodeNumber;
  if (siteSelectors) {
    for (const selector of siteSelectors) {
      try {
        const element = document.querySelector(selector);
        if (element) {
          const text = element.textContent || element.innerText || 
                      element.getAttribute('data-episode') || 
                      element.getAttribute('value') ||
                      element.getAttribute('aria-label') ||
                      '';
          debugLog(`Trying episode selector "${selector}":`, text.substring(0, 50));
          const episodeNum = extractEpisodeNumber(text);
          if (episodeNum) {
            debugLog('Found episode number:', episodeNum);
            return episodeNum;
          }
        }
      } catch (e) {
        debugLog(`Episode selector "${selector}" failed:`, e.message);
        continue;
      }
    }
  }
  
  // Fallback to generic selectors
  for (const selector of GENERIC_SELECTORS.episodeNumber) {
    try {
      const element = document.querySelector(selector);
      if (element) {
        const text = element.textContent || element.innerText || 
                    element.getAttribute('data-episode') || 
                    element.getAttribute('value') ||
                    '';
        const episodeNum = extractEpisodeNumber(text);
        if (episodeNum) {
          debugLog('Found episode number (generic):', episodeNum);
          return episodeNum;
        }
      }
    } catch (e) {
      continue;
    }
  }
  
  // Try URL for episode number
  try {
    const url = window.location.href;
    const episodeNum = extractEpisodeNumber(url);
    if (episodeNum) {
      debugLog('Found episode number in URL:', episodeNum);
      return episodeNum;
    }
  } catch (e) {
    // Ignore
  }
  
  // Last resort: try page title
  try {
    const pageTitle = document.title;
    if (pageTitle) {
      debugLog('Trying to extract episode from page title:', pageTitle);
      const episodeNum = extractEpisodeNumber(pageTitle);
      if (episodeNum) {
        debugLog('Found episode number in title:', episodeNum);
        return episodeNum;
      }
    }
  } catch (e) {
    debugLog('Error extracting episode from title:', e);
  }
  
  debugLog('Could not extract episode number');
  return null;
}

/**
 * Find video player element on page
 * @param {Document} document - DOM document
 * @param {string} site - Site identifier
 * @returns {HTMLVideoElement|null} - Video element or null
 */
export function findVideoPlayer(document, site) {
  if (!document) return null;
  
  // Try site-specific selectors first
  const siteSelectors = DOM_SELECTORS[site]?.videoPlayer;
  if (siteSelectors) {
    for (const selector of siteSelectors) {
      try {
        const element = document.querySelector(selector);
        if (element && element.tagName === 'VIDEO') {
          return element;
        }
      } catch (e) {
        continue;
      }
    }
  }
  
  // Fallback to generic selectors
  for (const selector of GENERIC_SELECTORS.videoPlayer) {
    try {
      const element = document.querySelector(selector);
      if (element && element.tagName === 'VIDEO') {
        return element;
      }
    } catch (e) {
      continue;
    }
  }
  
  return null;
}

/**
 * Parse Crunchyroll URL/DOM for show and episode info
 * DOM parsing is PRIMARY, URL parsing is fallback
 * @param {string} url - Current URL
 * @param {Document} document - DOM document (required)
 * @returns {Object|null} - { showName, episodeNumber } or null
 */
export function parseCrunchyroll(url, document = null) {
  try {
    debugLog('Parsing Crunchyroll URL:', url);
    let showName = null;
    let episodeNumber = null;
    
    // PRIMARY: Try DOM parsing first
    if (document) {
      debugLog('Attempting DOM extraction for Crunchyroll');
      showName = extractShowNameFromDOM(document, 'crunchyroll');
      episodeNumber = extractEpisodeNumberFromDOM(document, 'crunchyroll');
    } else {
      debugLog('No document provided for DOM parsing');
    }
    
    // FALLBACK: Try URL parsing if DOM didn't work
    if (!showName) {
      debugLog('Show name not found in DOM, trying URL parsing');
      const urlObj = new URL(url);
      const path = urlObj.pathname;
      
      const watchMatch = path.match(/\/watch\/([^/]+)/);
      const seriesMatch = path.match(/\/series\/([^/]+)/);
      
      if (watchMatch) {
        const showSlug = watchMatch[1];
        showName = decodeURIComponent(showSlug)
          .replace(/-/g, ' ')
          .replace(/\b\w/g, l => l.toUpperCase());
        debugLog('Extracted show name from URL (watch):', showName);
      } else if (seriesMatch) {
        const showSlug = seriesMatch[1];
        showName = decodeURIComponent(showSlug)
          .replace(/-/g, ' ')
          .replace(/\b\w/g, l => l.toUpperCase());
        debugLog('Extracted show name from URL (series):', showName);
      }
      
      // Try episode from URL if not found in DOM
      if (!episodeNumber) {
        debugLog('Episode number not found in DOM, trying URL');
        const episodeMatch = path.match(/episode-(\d+)/i) || 
                            path.match(/ep-(\d+)/i);
        if (episodeMatch) {
          episodeNumber = parseInt(episodeMatch[1], 10);
          debugLog('Extracted episode number from URL:', episodeNumber);
        } else {
          const epParam = urlObj.searchParams.get('episode');
          if (epParam) {
            episodeNumber = extractEpisodeNumber(epParam);
            if (episodeNumber) {
              debugLog('Extracted episode number from URL param:', episodeNumber);
            }
          }
        }
      }
    }
    
    if (showName) {
      const normalized = normalizeShowName(showName);
      debugLog('Final parsed result:', { showName: normalized, episodeNumber });
      return {
        showName: normalized,
        episodeNumber: episodeNumber || null
      };
    } else {
      debugLog('Could not extract show name from Crunchyroll');
    }
  } catch (e) {
    debugLog('Error parsing Crunchyroll:', e);
    console.error('Error parsing Crunchyroll:', e);
  }
  
  return null;
}

/**
 * Parse Funimation URL/DOM for show and episode info
 * DOM parsing is PRIMARY, URL parsing is fallback
 * @param {string} url - Current URL
 * @param {Document} document - DOM document (required)
 * @returns {Object|null} - { showName, episodeNumber } or null
 */
export function parseFunimation(url, document = null) {
  try {
    let showName = null;
    let episodeNumber = null;
    
    // PRIMARY: Try DOM parsing first
    if (document) {
      showName = extractShowNameFromDOM(document, 'funimation');
      episodeNumber = extractEpisodeNumberFromDOM(document, 'funimation');
    }
    
    // FALLBACK: Try URL parsing if DOM didn't work
    if (!showName) {
      const urlObj = new URL(url);
      const path = urlObj.pathname;
      
      const showsMatch = path.match(/\/shows\/([^/]+)/);
      const videoMatch = path.match(/\/v\/([^/]+)\/([^/]+)/);
      
      if (videoMatch) {
        showName = decodeURIComponent(videoMatch[1])
          .replace(/-/g, ' ')
          .replace(/\b\w/g, l => l.toUpperCase());
        
        if (!episodeNumber) {
          const episodeText = videoMatch[2];
          episodeNumber = extractEpisodeNumber(episodeText);
        }
      } else if (showsMatch) {
        showName = decodeURIComponent(showsMatch[1])
          .replace(/-/g, ' ')
          .replace(/\b\w/g, l => l.toUpperCase());
      }
    }
    
    if (showName) {
      return {
        showName: normalizeShowName(showName),
        episodeNumber: episodeNumber || null
      };
    }
  } catch (e) {
    console.debug('Error parsing Funimation:', e);
  }
  
  return null;
}

/**
 * Parse 9anime URL/DOM for show and episode info
 * DOM parsing is PRIMARY, URL parsing is fallback
 * @param {string} url - Current URL
 * @param {Document} document - DOM document (required)
 * @returns {Object|null} - { showName, episodeNumber } or null
 */
export function parse9anime(url, document = null) {
  try {
    let showName = null;
    let episodeNumber = null;
    
    // PRIMARY: Try DOM parsing first
    if (document) {
      showName = extractShowNameFromDOM(document, '9anime');
      episodeNumber = extractEpisodeNumberFromDOM(document, '9anime');
    }
    
    // FALLBACK: Try URL parsing if DOM didn't work
    if (!showName) {
      const urlObj = new URL(url);
      const path = urlObj.pathname;
      
      const watchMatch = path.match(/\/watch\/([^.]+)/);
      if (watchMatch) {
        showName = decodeURIComponent(watchMatch[1])
          .replace(/-/g, ' ')
          .replace(/\b\w/g, l => l.toUpperCase());
        
        if (!episodeNumber) {
          const epParam = urlObj.searchParams.get('ep');
          if (epParam) {
            episodeNumber = extractEpisodeNumber(epParam);
          }
        }
      }
    }
    
    if (showName) {
      return {
        showName: normalizeShowName(showName),
        episodeNumber: episodeNumber || null
      };
    }
  } catch (e) {
    console.debug('Error parsing 9anime:', e);
  }
  
  return null;
}

/**
 * Parse Zoro URL/DOM for show and episode info
 * DOM parsing is PRIMARY, URL parsing is fallback
 * @param {string} url - Current URL
 * @param {Document} document - DOM document (required)
 * @returns {Object|null} - { showName, episodeNumber } or null
 */
export function parseZoro(url, document = null) {
  try {
    let showName = null;
    let episodeNumber = null;
    
    // PRIMARY: Try DOM parsing first (essential for Zoro)
    if (document) {
      showName = extractShowNameFromDOM(document, 'zoro');
      episodeNumber = extractEpisodeNumberFromDOM(document, 'zoro');
    }
    
    // FALLBACK: Try URL parsing if DOM didn't work
    if (!episodeNumber) {
      const urlObj = new URL(url);
      const path = urlObj.pathname;
      
      const watchMatch = path.match(/\/watch\/([^/]+)\/(\d+)/);
      if (watchMatch) {
        episodeNumber = parseInt(watchMatch[2], 10);
      } else {
        const showMatch = path.match(/^\/([^/]+)$/);
        if (showMatch && !showName) {
          showName = decodeURIComponent(showMatch[1])
            .replace(/-/g, ' ')
            .replace(/\b\w/g, l => l.toUpperCase());
        }
      }
    }
    
    if (showName) {
      return {
        showName: normalizeShowName(showName),
        episodeNumber: episodeNumber || null
      };
    }
  } catch (e) {
    console.debug('Error parsing Zoro:', e);
  }
  
  return null;
}

/**
 * Parse Gogoanime URL/DOM for show and episode info
 * DOM parsing is PRIMARY, URL parsing is fallback
 * @param {string} url - Current URL
 * @param {Document} document - DOM document (required)
 * @returns {Object|null} - { showName, episodeNumber } or null
 */
export function parseGogoanime(url, document = null) {
  try {
    let showName = null;
    let episodeNumber = null;
    
    // PRIMARY: Try DOM parsing first
    if (document) {
      showName = extractShowNameFromDOM(document, 'gogoanime');
      episodeNumber = extractEpisodeNumberFromDOM(document, 'gogoanime');
    }
    
    // FALLBACK: Try URL parsing if DOM didn't work
    if (!showName || !episodeNumber) {
      const urlObj = new URL(url);
      const path = urlObj.pathname;
      
      const episodeMatch = path.match(/\/([^-]+)-episode-(\d+)/);
      const categoryMatch = path.match(/\/category\/([^/]+)/);
      
      if (episodeMatch) {
        if (!showName) {
          showName = decodeURIComponent(episodeMatch[1])
            .replace(/-/g, ' ')
            .replace(/\b\w/g, l => l.toUpperCase());
        }
        if (!episodeNumber) {
          episodeNumber = parseInt(episodeMatch[2], 10);
        }
      } else if (categoryMatch && !showName) {
        showName = decodeURIComponent(categoryMatch[1])
          .replace(/-/g, ' ')
          .replace(/\b\w/g, l => l.toUpperCase());
      }
    }
    
    if (showName) {
      return {
        showName: normalizeShowName(showName),
        episodeNumber: episodeNumber || null
      };
    }
  } catch (e) {
    console.debug('Error parsing Gogoanime:', e);
  }
  
  return null;
}

/**
 * Extract show and episode info from URL and DOM
 * @param {string} url - Current URL
 * @param {Document} document - DOM document (optional)
 * @returns {Object|null} - { showName, episodeNumber, site } or null
 */
export function extractShowInfo(url, document = null) {
  if (!isAnimeSite(url)) {
    return null;
  }
  
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname.replace(/^www\./, '');
    
    let result = null;
    
    // Route to appropriate parser
    if (hostname.includes('crunchyroll')) {
      result = parseCrunchyroll(url, document);
    } else if (hostname.includes('funimation')) {
      result = parseFunimation(url, document);
    } else if (hostname.includes('9anime')) {
      result = parse9anime(url, document);
    } else if (hostname.includes('zoro')) {
      result = parseZoro(url, document);
    } else if (hostname.includes('gogoanime')) {
      result = parseGogoanime(url, document);
    }
    
    if (result && result.showName) {
      return {
        ...result,
        site: hostname
      };
    }
  } catch (e) {
    console.debug('Error extracting show info:', e);
  }
  
  return null;
}
