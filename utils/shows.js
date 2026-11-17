/**
 * Platform detection + title/episode extraction for Netflix, YouTube, Disney+.
 */

export const WATCH_SITES = [
  'netflix.com',
  'youtube.com',
  'youtu.be',
  'disneyplus.com',
];

/**
 * @param {string} url
 * @returns {boolean}
 */
export function isWatchSite(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
    return WATCH_SITES.some((site) => host === site || host.endsWith(`.${site}`));
  } catch {
    return false;
  }
}

/** @deprecated use isWatchSite */
export const isAnimeSite = isWatchSite;

/**
 * @param {string} url
 * @returns {'netflix'|'youtube'|'disneyplus'|null}
 */
export function getPlatform(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
    if (host.includes('netflix')) return 'netflix';
    if (host.includes('youtube') || host === 'youtu.be') return 'youtube';
    if (host.includes('disneyplus')) return 'disneyplus';
    return null;
  } catch {
    return null;
  }
}

function cleanText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/\u00a0/g, ' ')
    .trim();
}

function firstText(selectors, root = document) {
  for (const selector of selectors) {
    const el = root.querySelector(selector);
    const text = cleanText(el?.textContent || el?.getAttribute?.('aria-label') || '');
    if (text) return text;
  }
  return '';
}

function parseEpisodeLabel(text) {
  const raw = cleanText(text);
  if (!raw) return null;

  const seasonEpisode = raw.match(/S(?:eason)?\s*(\d+)\s*E(?:p(?:isode)?)?\s*(\d+)/i);
  if (seasonEpisode) {
    return {
      episodeNumber: Number(seasonEpisode[2]),
      episodeLabel: `S${seasonEpisode[1]} E${seasonEpisode[2]}`,
    };
  }

  const episodeOnly = raw.match(/(?:Ep(?:isode)?|E)\s*(\d+)/i);
  if (episodeOnly) {
    return {
      episodeNumber: Number(episodeOnly[1]),
      episodeLabel: `Episode ${episodeOnly[1]}`,
    };
  }

  return null;
}

/**
 * Find a usable HTML5 video element when the platform exposes one.
 * @param {Document} doc
 * @returns {HTMLVideoElement|null}
 */
export function findVideoPlayer(doc = document) {
  const videos = Array.from(doc.querySelectorAll('video'));
  if (!videos.length) return null;

  const visible = videos.find((video) => {
    const rect = video.getBoundingClientRect();
    return rect.width > 80 && rect.height > 45;
  });
  return visible || videos[0];
}

function parseYouTube(url, doc = document) {
  const title =
    firstText(
      [
        'h1.ytd-watch-metadata yt-formatted-string',
        'h1.ytd-video-primary-info-renderer',
        '#title h1',
        'h1.title',
        'meta[name="title"]',
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

  if (!title) return null;

  return {
    showName: title,
    episodeNumber: null,
    episodeLabel: channel || null,
    site: 'youtube',
    url,
  };
}

function parseNetflix(url, doc = document) {
  const title =
    firstText(
      [
        '[data-uia="video-title"]',
        '[data-uia="video-title"] h4',
        '.video-title h4',
        '.watch-video--title-container h4',
        'h4[data-uia="video-title"]',
      ],
      doc
    ) ||
    cleanText(doc.querySelector('meta[property="og:title"]')?.content) ||
    cleanText(doc.title.replace(/\s*-\s*Netflix.*$/i, ''));

  const episodeText = firstText(
    [
      '[data-uia="video-subtitle"]',
      '[data-uia="episode-title"]',
      '.ellipsis',
      '.watch-video--bottom-controls-container [data-uia="video-title"] ~ *',
    ],
    doc
  );

  const parsed = parseEpisodeLabel(episodeText) || parseEpisodeLabel(doc.title);

  if (!title) return null;

  return {
    showName: title,
    episodeNumber: parsed?.episodeNumber ?? null,
    episodeLabel: parsed?.episodeLabel || episodeText || null,
    site: 'netflix',
    url,
  };
}

function parseDisneyPlus(url, doc = document) {
  const title =
    firstText(
      [
        '[data-testid="title-text"]',
        '[data-testid="asset-title"]',
        'h1',
        '.title-field',
        '[class*="titleText"]',
      ],
      doc
    ) ||
    cleanText(doc.querySelector('meta[property="og:title"]')?.content) ||
    cleanText(doc.title.replace(/\s*\|\s*Disney\+.*$/i, ''));

  const episodeText = firstText(
    [
      '[data-testid="subtitle-text"]',
      '[data-testid="episode-title"]',
      '[class*="subtitle"]',
      'h2',
    ],
    doc
  );

  const parsed = parseEpisodeLabel(episodeText) || parseEpisodeLabel(doc.title);

  if (!title) return null;

  return {
    showName: title,
    episodeNumber: parsed?.episodeNumber ?? null,
    episodeLabel: parsed?.episodeLabel || episodeText || null,
    site: 'disneyplus',
    url,
  };
}

/**
 * Extract watch metadata for the current page.
 * @param {string} url
 * @param {Document|null} doc
 * @returns {{showName:string, episodeNumber:number|null, episodeLabel:string|null, site:string, url:string}|null}
 */
export function extractShowInfo(url, doc = document) {
  const platform = getPlatform(url);
  if (!platform) return null;

  try {
    if (platform === 'youtube') return parseYouTube(url, doc);
    if (platform === 'netflix') return parseNetflix(url, doc);
    if (platform === 'disneyplus') return parseDisneyPlus(url, doc);
  } catch (error) {
    console.debug('[Anime Tracker] extractShowInfo failed', error);
  }

  // Last-resort fallback so time can still accrue once a title exists.
  const fallback = cleanText(doc?.title || '');
  if (!fallback) return null;
  return {
    showName: fallback,
    episodeNumber: null,
    episodeLabel: null,
    site: platform,
    url,
  };
}
