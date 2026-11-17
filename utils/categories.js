// Default category definitions with URL patterns
export const DEFAULT_CATEGORIES = {
  social: {
    name: 'Social Media',
    color: '#3b82f6',
    patterns: [
      'facebook.com',
      'twitter.com',
      'x.com',
      'instagram.com',
      'reddit.com',
      'linkedin.com',
      'tiktok.com',
      'snapchat.com',
      'pinterest.com',
      'tumblr.com',
      'discord.com',
      'mastodon.social'
    ]
  },
  entertainment: {
    name: 'Entertainment',
    color: '#ef4444',
    patterns: [
      'youtube.com',
      'netflix.com',
      'twitch.tv',
      'spotify.com',
      'hulu.com',
      'disneyplus.com',
      'primevideo.com',
      'hbomax.com',
      'soundcloud.com',
      'vimeo.com',
      'dailymotion.com',
      'crunchyroll.com'
    ]
  },
  productivity: {
    name: 'Work/Productivity',
    color: '#22c55e',
    patterns: [
      'github.com',
      'gitlab.com',
      'bitbucket.org',
      'notion.so',
      'slack.com',
      'docs.google.com',
      'sheets.google.com',
      'drive.google.com',
      'trello.com',
      'asana.com',
      'monday.com',
      'jira.atlassian.com',
      'confluence.atlassian.com',
      'figma.com',
      'miro.com',
      'zoom.us',
      'teams.microsoft.com',
      'office.com',
      'dropbox.com'
    ]
  },
  shopping: {
    name: 'Shopping',
    color: '#f59e0b',
    patterns: [
      'amazon.com',
      'amazon.ca',
      'amazon.co.uk',
      'ebay.com',
      'etsy.com',
      'walmart.com',
      'target.com',
      'bestbuy.com',
      'aliexpress.com',
      'wish.com',
      'shopify.com'
    ]
  },
  news: {
    name: 'News',
    color: '#8b5cf6',
    patterns: [
      'cnn.com',
      'bbc.com',
      'bbc.co.uk',
      'nytimes.com',
      'washingtonpost.com',
      'theguardian.com',
      'reuters.com',
      'apnews.com',
      'news.google.com',
      'news.ycombinator.com',
      'techcrunch.com',
      'theverge.com',
      'arstechnica.com',
      'wired.com'
    ]
  },
  education: {
    name: 'Education',
    color: '#06b6d4',
    patterns: [
      'coursera.org',
      'udemy.com',
      'edx.org',
      'khanacademy.org',
      'skillshare.com',
      'linkedin.com/learning',
      'pluralsight.com',
      'codecademy.com',
      'freecodecamp.org',
      'stackoverflow.com',
      'medium.com',
      'dev.to',
      'wikipedia.org'
    ]
  },
  other: {
    name: 'Other',
    color: '#6b7280',
    patterns: []
  }
};

/**
 * Extract the hostname from a URL
 * @param {string} url - The full URL
 * @returns {string} - The hostname (e.g., "www.youtube.com" -> "youtube.com")
 */
export function extractHostname(url) {
  try {
    const urlObj = new URL(url);
    let hostname = urlObj.hostname;
    
    // Remove 'www.' prefix if present
    if (hostname.startsWith('www.')) {
      hostname = hostname.substring(4);
    }
    
    return hostname;
  } catch (e) {
    return null;
  }
}

/**
 * Get the category for a given URL
 * @param {string} url - The URL to categorize
 * @param {Object} customCategories - User's custom category settings (optional)
 * @returns {string} - The category key (e.g., "social", "entertainment", "other")
 */
export function getCategoryForUrl(url, customCategories = null) {
  const hostname = extractHostname(url);
  
  if (!hostname) {
    return 'other';
  }
  
  const categories = customCategories || DEFAULT_CATEGORIES;
  
  // Check each category's patterns
  for (const [categoryKey, category] of Object.entries(categories)) {
    if (categoryKey === 'other') continue;
    
    for (const pattern of category.patterns) {
      // Check if hostname matches or ends with the pattern
      if (hostname === pattern || hostname.endsWith('.' + pattern)) {
        return categoryKey;
      }
      
      // Check for subdomain matches (e.g., "docs.google.com" matches "google.com")
      const patternParts = pattern.split('.');
      const hostnameParts = hostname.split('.');
      
      if (patternParts.length <= hostnameParts.length) {
        const hostnameSuffix = hostnameParts.slice(-patternParts.length).join('.');
        if (hostnameSuffix === pattern) {
          return categoryKey;
        }
      }
    }
  }
  
  return 'other';
}

/**
 * Get category info (name and color) by category key
 * @param {string} categoryKey - The category key
 * @param {Object} customCategories - User's custom category settings (optional)
 * @returns {Object} - { name, color }
 */
export function getCategoryInfo(categoryKey, customCategories = null) {
  const categories = customCategories || DEFAULT_CATEGORIES;
  
  if (categories[categoryKey]) {
    return {
      name: categories[categoryKey].name,
      color: categories[categoryKey].color
    };
  }
  
  return {
    name: 'Other',
    color: '#6b7280'
  };
}

/**
 * Get all category keys
 * @param {Object} customCategories - User's custom category settings (optional)
 * @returns {string[]} - Array of category keys
 */
export function getAllCategoryKeys(customCategories = null) {
  const categories = customCategories || DEFAULT_CATEGORIES;
  return Object.keys(categories);
}

/**
 * Merge custom categories with default categories
 * @param {Object} customCategories - User's custom additions/overrides
 * @returns {Object} - Merged categories
 */
export function mergeCategories(customCategories) {
  if (!customCategories) {
    return DEFAULT_CATEGORIES;
  }
  
  const merged = { ...DEFAULT_CATEGORIES };
  
  for (const [key, value] of Object.entries(customCategories)) {
    if (merged[key]) {
      // Merge patterns for existing categories
      merged[key] = {
        ...merged[key],
        ...value,
        patterns: [...new Set([...merged[key].patterns, ...(value.patterns || [])])]
      };
    } else {
      // Add new category
      merged[key] = value;
    }
  }
  
  return merged;
}
