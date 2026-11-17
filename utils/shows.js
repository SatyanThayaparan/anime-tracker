/**
 * Platform detection + title/episode extraction for
 * Netflix, YouTube, Disney+, Crunchyroll, Prime Video.
 */

import {
  cleanText,
  isUiNoiseTitle,
  normalizeWatchIdentity,
  parseEpisodeLabel,
  parseSeasonOnly,
} from './normalize.js';

export const WATCH_SITES = [
  'netflix.com',
  'youtube.com',
  'youtu.be',
  'disneyplus.com',
  'crunchyroll.com',
  'primevideo.com',
];

function isAmazonHost(host) {
  return (
    host === 'amazon.com' ||
    host.endsWith('.amazon.com') ||
    /^amazon\.[a-z.]+$/.test(host) ||
    host.endsWith('.amazon.co.uk') ||
    host.endsWith('.amazon.co.jp') ||
    host.endsWith('.amazon.com.au')
  );
}

function isPrimeVideoPath(pathname, host = '') {
  const path = String(pathname || '').toLowerCase();
  const h = String(host || '').toLowerCase();
  // Dedicated Prime Video site — /detail/ASIN is the player/title page.
  if (h.includes('primevideo')) {
    return (
      path.includes('/detail/') ||
      (path.includes('/region/') && path.includes('/detail'))
    );
  }
  // Amazon storefront — only explicit video paths (never shopping /detail/).
  return path.includes('/gp/video') || path.includes('/video/detail');
}

/**
 * @param {string} url
 * @returns {boolean}
 */
export function isWatchSite(url) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
    if (WATCH_SITES.some((site) => host === site || host.endsWith(`.${site}`))) {
      return true;
    }
    // Amazon storefront only counts on video paths (not shopping).
    if (isAmazonHost(host) && isPrimeVideoPath(parsed.pathname, host)) return true;
    return false;
  } catch {
    return false;
  }
}

/** @deprecated use isWatchSite */
export const isAnimeSite = isWatchSite;

/**
 * @param {string} url
 * @returns {'netflix'|'youtube'|'disneyplus'|'crunchyroll'|'primevideo'|null}
 */
export function getPlatform(url) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
    if (host.includes('netflix')) return 'netflix';
    if (host.includes('youtube') || host === 'youtu.be') return 'youtube';
    if (host.includes('disneyplus')) return 'disneyplus';
    if (host.includes('crunchyroll')) return 'crunchyroll';
    if (host.includes('primevideo')) return 'primevideo';
    if (isAmazonHost(host) && isPrimeVideoPath(parsed.pathname, host)) {
      return 'primevideo';
    }
    return null;
  } catch {
    return null;
  }
}

function firstText(selectors, root = document) {
  for (const selector of selectors) {
    const el = root.querySelector(selector);
    const text = cleanText(el?.textContent || el?.getAttribute?.('aria-label') || '');
    if (text) return text;
  }
  return '';
}

function childTexts(root, selectors) {
  if (!root) return [];
  return selectors
    .map((selector) => cleanText(root.querySelector(selector)?.textContent || ''))
    .filter(Boolean);
}

/**
 * Find a usable HTML5 video element when the platform exposes one.
 * @param {Document} doc
 * @returns {HTMLVideoElement|null}
 */
export function findVideoPlayer(doc = document) {
  const videos = Array.from(doc.querySelectorAll('video'));
  if (!videos.length) return null;

  // Prefer a video that is actually playing / has media time.
  const playing = videos.find((video) => {
    try {
      return !video.paused && !video.ended && video.readyState >= 2;
    } catch {
      return false;
    }
  });
  if (playing) return playing;

  const visible = videos.find((video) => {
    const rect = video.getBoundingClientRect();
    return rect.width > 80 && rect.height > 45;
  });
  return visible || videos[0];
}

/**
 * True when the URL is a playback page (not browse/search/profile).
 * @param {string} url
 * @param {'netflix'|'youtube'|'disneyplus'|'crunchyroll'|'primevideo'|null} [platform]
 */
export function isPlayerPage(url, platform = getPlatform(url)) {
  try {
    const path = new URL(url).pathname.toLowerCase();
    if (platform === 'netflix') return path.includes('/watch');
    if (platform === 'youtube') return path.includes('/watch') || path === '/';
    if (platform === 'disneyplus') {
      return (
        path.includes('/play/') ||
        path.includes('/video/') ||
        path.includes('/watch/')
      );
    }
    if (platform === 'crunchyroll') return path.includes('/watch/');
    if (platform === 'primevideo') {
      // Prime plays on /detail/ASIN (and amazon.com/gp/video/detail/...).
      return (
        path.includes('/detail/') ||
        path.includes('/gp/video/detail') ||
        path.includes('/video/detail')
      );
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * DOM fallback when HTML5 media progress is blocked (common on Disney+).
 * Only call on player pages.
 * @param {Document} doc
 * @returns {{ paused: boolean, ended: boolean, currentTime: number, duration: number, progress: number, timestamp: number, inferred: boolean }|null}
 */
export function inferPlaybackState(doc = document) {
  const pauseControl = doc.querySelector(
    [
      '[data-testid="pause-button"]',
      '[data-testid="control-pause"]',
      'button[aria-label="Pause"]',
      'button[aria-label*="Pause" i]',
      '[aria-label="Pause"]',
      '.atvwebplayersdk-playpause-button[aria-label*="Pause" i]',
      'button.atvwebplayersdk-playpause-button[aria-label*="Pause" i]',
    ].join(', ')
  );
  if (pauseControl) {
    return {
      currentTime: 0,
      duration: 0,
      progress: 0,
      paused: false,
      ended: false,
      timestamp: Date.now(),
      inferred: true,
    };
  }

  const playControl = doc.querySelector(
    [
      '[data-testid="play-button"]',
      '[data-testid="control-play"]',
      'button[aria-label="Play"]',
      'button[aria-label*="Play" i]',
      '[aria-label="Play"]',
      '.atvwebplayersdk-playpause-button[aria-label*="Play" i]',
      'button.atvwebplayersdk-playpause-button[aria-label*="Play" i]',
    ].join(', ')
  );
  if (playControl) {
    return {
      currentTime: 0,
      duration: 0,
      progress: 0,
      paused: true,
      ended: false,
      timestamp: Date.now(),
      inferred: true,
    };
  }

  return null;
}

function parseYouTube(url, doc = document) {
  const title =
    firstText(
      [
        'h1.ytd-watch-metadata yt-formatted-string',
        'h1.ytd-video-primary-info-renderer',
        '#title h1',
        'h1.title',
      ],
      doc
    ) ||
    cleanText(doc.querySelector('meta[property="og:title"]')?.content) ||
    cleanText(doc.title.replace(/ - YouTube$/i, ''));

  const channel = firstText(
    [
      '#channel-name a',
      'ytd-channel-name a',
      '#owner-name a',
      '#upload-info #channel-name',
    ],
    doc
  );

  const normalized = normalizeWatchIdentity(title);
  if (!normalized) return null;

  return {
    showName: normalized.showName,
    seasonNumber: normalized.seasonNumber,
    episodeNumber: null,
    episodeLabel: channel || null,
    site: 'youtube',
    url,
  };
}

/**
 * Netflix player often only shows "E11" — season lives in the episodes panel /
 * season selector / aria-labels. Scrape those so we don't default to Season 1.
 * @param {Document} doc
 * @returns {number|null}
 */
function extractNetflixSeason(doc = document) {
  const selectorTexts = [
    firstText(
      [
        '[data-uia="selector-label"]',
        '[data-uia="season-selector"]',
        '[data-uia="season-selector"] button',
        'button[data-uia*="season"]',
        '.episode-selector .dropdown-toggle',
        '[class*="episode-selector"] button',
      ],
      doc
    ),
  ];

  // Visible "Season N" labels anywhere in player chrome / episodes tray
  const seasonNodes = doc.querySelectorAll(
    '[data-uia="selector-label"], [data-uia*="season"], [aria-label*="Season"], [aria-label*="season"], button, h3, h4, label'
  );
  for (const node of seasonNodes) {
    const label = cleanText(node.getAttribute?.('aria-label') || node.textContent || '');
    if (!label || label.length > 40) continue;
    const season = parseSeasonOnly(label);
    if (season != null) selectorTexts.push(label);
  }

  for (const text of selectorTexts) {
    const season = parseSeasonOnly(text);
    if (season != null) return season;
  }

  // Selected / highlighted episode row often includes season in aria-label
  const episodeRows = doc.querySelectorAll(
    '[data-uia="episode-item"], [data-uia*="episode"], [class*="episode-item"], [aria-current="true"]'
  );
  for (const row of episodeRows) {
    const label = cleanText(row.getAttribute?.('aria-label') || row.textContent || '');
    if (!label) continue;
    const parsed = parseEpisodeLabel(label);
    if (parsed?.seasonNumber != null) return parsed.seasonNumber;
    const season = parseSeasonOnly(label);
    if (season != null) return season;
  }

  return null;
}

function parseNetflix(url, doc = document) {
  const titleRoot =
    doc.querySelector('[data-uia="video-title"]') ||
    doc.querySelector('.watch-video--player-view [data-uia="video-title"]') ||
    doc.querySelector('.video-title');

  // Netflix often nests show + episode under the same video-title node.
  // Prefer direct children text (h4 + spans) the way the player renders it.
  const nested = [];
  if (titleRoot) {
    const kids = titleRoot.querySelectorAll(':scope > h4, :scope > span, :scope > p, :scope > div');
    kids.forEach((el) => {
      const text = cleanText(el.textContent || '');
      if (text) nested.push(text);
    });
    if (!nested.length) {
      nested.push(...childTexts(titleRoot, ['h4', 'span', 'p', 'div']));
    }
  }

  let showCandidate = nested[0] || '';
  let episodeCandidate = nested.slice(1).join(' · ');

  // Also try span[0] alone — often "S2:E11" or "2 11" on Netflix
  const firstSpan = nested[1] || '';

  if (!showCandidate) {
    showCandidate =
      firstText(
        [
          '[data-uia="video-title"] h4',
          '.video-title h4',
          '.watch-video--title-container h4',
          'h4[data-uia="video-title"]',
        ],
        doc
      ) ||
      cleanText(doc.querySelector('meta[property="og:title"]')?.content) ||
      cleanText(doc.title.replace(/\s*[-–|]\s*Netflix.*$/i, ''));
  }

  if (!episodeCandidate) {
    episodeCandidate = firstText(
      [
        '[data-uia="video-subtitle"]',
        '[data-uia="episode-title"]',
        '[data-uia="video-title"] span',
        '.ellipsis',
      ],
      doc
    );
  }

  // If the only scraped string is the whole title blob, let normalizer split E#
  const normalized = normalizeWatchIdentity(showCandidate, episodeCandidate);
  if (!normalized) return null;

  // Prefer explicit episode parsing from episode candidate when present
  const episodeParsed =
    parseEpisodeLabel(firstSpan) ||
    parseEpisodeLabel(episodeCandidate) ||
    parseEpisodeLabel(nested.slice(1).join(' '));

  const episodeNumber = episodeParsed?.episodeNumber ?? normalized.episodeNumber;
  let seasonNumber =
    episodeParsed?.seasonNumber ?? normalized.seasonNumber ?? null;

  // Player title often omits season — pull from season selector / episode tray
  if (seasonNumber == null) {
    seasonNumber = extractNetflixSeason(doc);
  }

  const episodeLabel =
    episodeParsed?.episodeLabel ||
    normalized.episodeLabel ||
    (episodeCandidate && !episodeParsed ? cleanText(episodeCandidate) : null);

  return {
    showName: normalized.showName,
    seasonNumber,
    episodeNumber,
    episodeLabel,
    site: 'netflix',
    url,
  };
}

function parseDisneyPlus(url, doc = document) {
  // Browse / profile / search pages are not watch sessions.
  if (!isPlayerPage(url, 'disneyplus')) return null;

  const titleCandidates = [
    firstText(
      [
        '[data-testid="title-text"]',
        '[data-testid="asset-title"]',
        '[data-testid="player-title"]',
        '.title-field',
        '[class*="titleText"]',
      ],
      doc
    ),
    cleanText(doc.querySelector('meta[property="og:title"]')?.content),
    cleanText(doc.title.replace(/\s*\|\s*Disney\+.*$/i, '')),
  ].filter((t) => t && !isUiNoiseTitle(t));

  // Avoid bare `h1`/`h2` — cookie banners (“Privacy Preference Center”) win those.
  const title = titleCandidates[0] || '';

  let episodeText = firstText(
    [
      '[data-testid="subtitle-text"]',
      '[data-testid="episode-title"]',
      '[data-testid="player-subtitle"]',
    ],
    doc
  );
  if (episodeText && isUiNoiseTitle(episodeText)) episodeText = '';

  const normalized = normalizeWatchIdentity(title, episodeText);
  if (!normalized || isUiNoiseTitle(normalized.showName)) return null;

  return {
    showName: normalized.showName,
    seasonNumber: normalized.seasonNumber,
    episodeNumber: normalized.episodeNumber,
    episodeLabel: normalized.episodeLabel,
    site: 'disneyplus',
    url,
  };
}

function extractCrunchyrollSeason(doc = document) {
  const seasonText = firstText(
    [
      '[class*="season-select"]',
      '[class*="seasonSelect"]',
      '[data-t*="season"]',
      '.erc-season-select',
      'div[class*="season"] button',
      'button[aria-label*="Season" i]',
    ],
    doc
  );
  const fromLabel = parseSeasonOnly(seasonText);
  if (fromLabel != null) return fromLabel;

  const meta = cleanText(doc.querySelector('meta[property="og:description"]')?.content || '');
  return parseSeasonOnly(meta);
}

function parseCrunchyroll(url, doc = document) {
  if (!isPlayerPage(url, 'crunchyroll')) return null;

  // Series title sits beside the player; episode title is the big h1.
  let showCandidate = firstText(
    [
      '.show-title-link h4',
      'a.show-title-link',
      '.show-title-link',
      '[data-t="series-title"]',
      '.erc-current-media-info a[href*="/series/"]',
      '.hero-heading-line h1',
    ],
    doc
  );

  let episodeCandidate = firstText(
    [
      '.erc-current-media-info h1.title',
      '.erc-current-media-info h1',
      '.current-media-wrapper h1',
      'h1.title',
      '[data-t="episode-title"]',
    ],
    doc
  );

  if (episodeCandidate && isUiNoiseTitle(episodeCandidate)) episodeCandidate = '';

  // Tab title fallback: "Show Name Episode 12 - Watch on Crunchyroll"
  const docTitle = cleanText(
    doc.title
      .replace(/\s*[-–|]\s*Watch on Crunchyroll.*$/i, '')
      .replace(/\s*[-–|]\s*Crunchyroll.*$/i, '')
  );

  if (!showCandidate && docTitle) {
    const fromDoc = normalizeWatchIdentity(docTitle, episodeCandidate);
    if (fromDoc?.showName) showCandidate = fromDoc.showName;
  }

  if (!showCandidate) {
    showCandidate =
      cleanText(doc.querySelector('meta[property="og:title"]')?.content) || docTitle;
  }

  const normalized = normalizeWatchIdentity(showCandidate, episodeCandidate || docTitle);
  if (!normalized || isUiNoiseTitle(normalized.showName)) return null;

  const episodeParsed =
    parseEpisodeLabel(episodeCandidate) || parseEpisodeLabel(docTitle);
  const episodeNumber = episodeParsed?.episodeNumber ?? normalized.episodeNumber;
  let seasonNumber = episodeParsed?.seasonNumber ?? normalized.seasonNumber ?? null;
  if (seasonNumber == null) seasonNumber = extractCrunchyrollSeason(doc);

  const episodeLabel =
    episodeParsed?.episodeLabel ||
    normalized.episodeLabel ||
    (episodeCandidate && !episodeParsed ? cleanText(episodeCandidate) : null);

  return {
    showName: normalized.showName,
    seasonNumber,
    episodeNumber,
    episodeLabel,
    site: 'crunchyroll',
    url,
  };
}

function parsePrimeVideo(url, doc = document) {
  if (!isPlayerPage(url, 'primevideo')) return null;

  // Player overlays (most reliable while playing).
  let showCandidate = firstText(
    [
      '.atvwebplayersdk-title-text',
      '[class*="atvwebplayersdk-title-text"]',
      '[data-automation-id="title"]',
      'h1[data-automation-id="title"]',
    ],
    doc
  );

  let episodeCandidate = firstText(
    [
      '.atvwebplayersdk-subtitle-text',
      '[class*="atvwebplayersdk-subtitle-text"]',
      '[data-automation-id="subtitle"]',
    ],
    doc
  );

  if (episodeCandidate && isUiNoiseTitle(episodeCandidate)) episodeCandidate = '';

  // Detail page fallback before/while player chrome mounts.
  if (!showCandidate) {
    showCandidate = firstText(
      [
        '[data-automation-id="title"]',
        'h1[data-automation-id="title"]',
        'h1',
      ],
      doc
    );
  }

  const docTitle = cleanText(
    (doc.title || '')
      .replace(/\s*[-–|:]\s*Prime Video.*$/i, '')
      .replace(/\s*[-–|:]\s*Amazon.*$/i, '')
  );

  if (!showCandidate) {
    showCandidate =
      cleanText(doc.querySelector('meta[property="og:title"]')?.content) || docTitle;
  }

  if (showCandidate && isUiNoiseTitle(showCandidate)) return null;

  const normalized = normalizeWatchIdentity(showCandidate, episodeCandidate || docTitle);
  if (!normalized || isUiNoiseTitle(normalized.showName)) return null;

  // Subtitle often: "Season 2, Episode 5 Title of Episode"
  const subtitleParsed =
    parseEpisodeLabel(episodeCandidate) ||
    (() => {
      const m = cleanText(episodeCandidate).match(
        /(?:Season|Temporada|Staffel|Saison|Stagione)\s+(\d+)\D+(\d+)\s*(.*)$/i
      );
      if (!m) return null;
      const seasonNumber = Number(m[1]);
      const episodeNumber = Number(m[2]);
      const rest = cleanText(m[3] || '');
      return {
        seasonNumber,
        episodeNumber,
        episodeLabel: rest
          ? `S${seasonNumber} E${episodeNumber} · ${rest}`
          : `S${seasonNumber} E${episodeNumber}`,
        remainder: rest,
      };
    })();

  const episodeNumber = subtitleParsed?.episodeNumber ?? normalized.episodeNumber;
  const seasonNumber = subtitleParsed?.seasonNumber ?? normalized.seasonNumber ?? null;
  const episodeLabel =
    subtitleParsed?.episodeLabel ||
    normalized.episodeLabel ||
    (episodeCandidate && !subtitleParsed ? cleanText(episodeCandidate) : null);

  return {
    showName: normalized.showName,
    seasonNumber,
    episodeNumber,
    episodeLabel,
    site: 'primevideo',
    url,
  };
}

/**
 * Extract watch metadata for the current page.
 * @param {string} url
 * @param {Document|null} doc
 */
export function extractShowInfo(url, doc = document) {
  const platform = getPlatform(url);
  if (!platform) return null;

  try {
    if (platform === 'youtube') return parseYouTube(url, doc);
    if (platform === 'netflix') return parseNetflix(url, doc);
    if (platform === 'disneyplus') return parseDisneyPlus(url, doc);
    if (platform === 'crunchyroll') return parseCrunchyroll(url, doc);
    if (platform === 'primevideo') return parsePrimeVideo(url, doc);
  } catch (error) {
    console.debug('[Shiori] extractShowInfo failed', error);
  }

  const fallback = normalizeWatchIdentity(doc?.title || '');
  if (!fallback) return null;
  return {
    showName: fallback.showName,
    seasonNumber: fallback.seasonNumber,
    episodeNumber: fallback.episodeNumber,
    episodeLabel: fallback.episodeLabel,
    site: platform,
    url,
  };
}

export { normalizeWatchIdentity, parseEpisodeLabel };
