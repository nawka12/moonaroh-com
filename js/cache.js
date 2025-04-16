import { debugError, debugLog, debugWarn } from '../script.js';
import { domRefs } from './constants.js';
import { initializeHolodexClient } from '../script.js';
import { CLIPS_CACHE_KEY, COLLABS_CACHE_KEY, ORIGINAL_SONGS_CACHE_KEY, COVER_SONGS_CACHE_KEY, TALENT_MERCH_CACHE_KEY } from './cache-keys.js';
import { getFormatter } from '../script.js';

let holodexClient = null;

// Update the cache duration to be longer
export const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes in milliseconds

// Update the cache object's get method to be more strict
export const cache = {
    get: (key) => {
        try {
            const item = localStorage.getItem(key);
            if (!item) return null;

            try {
                const parsed = JSON.parse(item);
                
                // Handle standard cache format
                if (parsed && parsed.value) {
                    const { value, timestamp } = parsed;
                    
                    // Basic staleness check based on timestamp
                    if (timestamp && Date.now() - timestamp <= CACHE_DURATION) {
                        return value;
                    } else {
                        debugLog(`Cache expired for ${key}`);
                        localStorage.removeItem(key);
                        return null;
                    }
                }
                
                // Handle legacy merchandise cache format
                if (key === TALENT_MERCH_CACHE_KEY && parsed && parsed.data) {
                    const { data, timestamp } = parsed;
                    
                    // Use a longer cache duration for merchandise data (4 hours)
                    const merchCacheDuration = 4 * 60 * 60 * 1000; 
                    
                    if (timestamp && Date.now() - timestamp <= merchCacheDuration) {
                        debugLog(`Using legacy merchandise cache (${Math.floor((Date.now() - timestamp) / 60000)} minutes old)`);
                        return data;
                    } else {
                        debugLog(`Legacy merchandise cache expired`);
                        // Don't remove it, as we might still want to use it as a fallback
                    }
                }
                
                return null;
            } catch (parseError) {
                debugError(`Error parsing cache for ${key}:`, parseError);
                localStorage.removeItem(key);
                return null;
            }
        } catch (e) {
            debugWarn('Cache read error:', e);
            return null;
        }
    },
    set: (key, data) => {
        try {
            localStorage.setItem(key, JSON.stringify({
                value: data,
                timestamp: Date.now()
            }));
        } catch (e) {
            debugWarn('Cache write error:', e);
            try {
                localStorage.clear();
                localStorage.setItem(key, JSON.stringify({
                    value: data,
                    timestamp: Date.now()
                }));
            } catch (e2) {
                debugError('Cache write failed after clear:', e2);
            }
        }
    }
};

export function updateTimeCounter(latestActivity) {
    const counterElement = domRefs.timeCounter;
    
    function update() {
        const now = new Date();
        const diff = now - latestActivity;
        
        const days = Math.floor(diff / (1000 * 60 * 60 * 24));
        const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((diff % (1000 * 60)) / 1000);
        
        counterElement.textContent = `${days}d ${hours}h ${minutes}m ${seconds}s`;
    }
    
    // Update immediately and then every second
    update();
    return setInterval(update, 1000);
}

export function updateCacheStatus() {
    const lastUpdateDiv = domRefs.lastUpdate;
    if (!lastUpdateDiv) return;
    
    // Get cache times for all types of data
    const cacheTypes = [
        { key: 'liveVideos', label: 'Live videos' },
        { key: 'recentVideos', label: 'Recent videos' },
        { key: 'tweets', label: 'Tweets' },
        { key: CLIPS_CACHE_KEY, label: 'Clips' },
        { key: COLLABS_CACHE_KEY, label: 'Collabs' },
        { key: ORIGINAL_SONGS_CACHE_KEY, label: 'Original songs' },
        { key: COVER_SONGS_CACHE_KEY, label: 'Cover songs' },
        { key: TALENT_MERCH_CACHE_KEY, label: 'Merchandise' }
    ];
    
    const cacheInfo = cacheTypes.map(type => {
        // First check for standard cache format
        const cachedValue = cache.get(type.key);
        if (cachedValue) {
            // If the item was retrieved from cache, it's valid
            const count = Array.isArray(cachedValue) ? cachedValue.length : 
                         (typeof cachedValue === 'object' ? Object.keys(cachedValue).length : 1);
            
            return { 
                type: type.label, 
                time: new Date(),
                count: count
            };
        }
        
        // If not in cache, check localStorage directly (for debugging)
        const cachedData = localStorage.getItem(type.key);
        if (!cachedData) return { type: type.label, time: null };
        
        try {
            // Handle the merchandise cache format
            if (type.key === TALENT_MERCH_CACHE_KEY) {
                const parsedData = JSON.parse(cachedData);
                if (parsedData && parsedData.timestamp) {
                    const merchCount = parsedData.data && Array.isArray(parsedData.data) ? 
                                      parsedData.data.length : 0;
                    
                    // Only report if we have actual items
                    if (merchCount > 0) {
                        return { 
                            type: type.label, 
                            time: new Date(parsedData.timestamp),
                            count: merchCount
                        };
                    }
                }
            } else {
                // Handle regular cache format
                const parsed = JSON.parse(cachedData);
                // Standard cache format with value/timestamp
                if (parsed && parsed.value) {
                    const count = Array.isArray(parsed.value) ? parsed.value.length : 1;
                    return { 
                        type: type.label, 
                        time: new Date(parsed.timestamp),
                        count: count
                    };
                }
                // Array response (older format)
                else if (Array.isArray(parsed) && parsed.length > 0) {
                    return { 
                        type: type.label, 
                        time: new Date(),
                        count: parsed.length
                    };
                }
            }
        } catch (e) {
            debugError(`Error parsing cache data for ${type.key}:`, e);
        }
        
        return { type: type.label, time: null };
    });
    
    // Find the most recent cache update
    const validCacheTimes = cacheInfo
        .filter(info => info.time !== null)
        .sort((a, b) => b.time - a.time);
    
    if (validCacheTimes.length > 0) {
        const mostRecent = validCacheTimes[0];
        const formatter = getFormatter({ hour: 'numeric', minute: 'numeric' });
        
        lastUpdateDiv.innerHTML = `
            <div class="text-center">
                <p>Last updated: ${formatter.format(mostRecent.time)}</p>
                <details class="mt-1 text-xs opacity-75">
                    <summary>Cache status</summary>
                    <ul class="list-disc list-inside text-left mt-2">
                        ${cacheInfo.map(info => {
                            if (!info.time) return `<li>${info.type}: Not cached</li>`;
                            const timeAgo = Math.round((new Date() - info.time) / 60000);
                            return `<li>${info.type}: ${timeAgo} min ago (${info.count || 0} items)</li>`;
                        }).join('')}
                    </ul>
                </details>
            </div>
        `;
    } else {
        lastUpdateDiv.innerHTML = `<p>No cached data available</p>`;
    }
}

// Helper function to cache and fetch data
export const getCachedOrFetch = async (key, fetchFn) => {
    try {
        debugLog(`Fetching ${key}...`);
        const cachedData = cache.get(key);
        
        if (cachedData) {
            debugLog(`Found cached data for ${key}:`, {
                sample: cachedData[0] ? {
                    videoId: cachedData[0].videoId,
                    title: cachedData[0].title,
                    scheduledStart: cachedData[0].scheduledStart,
                    publishedAt: cachedData[0].publishedAt,
                    raw: {
                        published_at: cachedData[0].raw?.published_at,
                        available_at: cachedData[0].raw?.available_at,
                        start_scheduled: cachedData[0].raw?.start_scheduled
                    }
                } : 'No items'
            });
            return cachedData;
        }
        
        if (key.includes('Videos')) {
            debugLog(`Initializing client for ${key}`);
            holodexClient = await initializeHolodexClient();
            if (!holodexClient) {
                throw new Error('Holodex client not initialized');
            }
        }
        
        debugLog(`Fetching fresh data for ${key}`);
        const rawData = await fetchFn();

        // Special handling for tweets error object
        if (key === 'tweets' && rawData?.error) {
            cache.set(key, rawData);
            return rawData;
        }
        
        // Process the fresh data to ensure consistent date handling
        const freshData = Array.isArray(rawData) ? rawData.map(item => {
            if (item.status === 'upcoming' && item.raw?.start_scheduled) {
                return {
                    ...item,
                    videoId: item.videoId || item.raw?.id,
                    title: item.title || item.raw?.title,
                    scheduledStart: new Date(item.raw.start_scheduled),
                    status: 'upcoming',
                    raw: item.raw
                };
            }
            
            const publishedAt = item.raw?.published_at ? new Date(item.raw.published_at) : null;
            const availableAt = item.raw?.available_at ? new Date(item.raw.available_at) : null;
            
            const latestTime = publishedAt && availableAt ? 
                (availableAt > publishedAt ? availableAt : publishedAt) : 
                (publishedAt || availableAt);
            
            return {
                ...item,
                videoId: item.videoId || item.raw?.id,
                title: item.title || item.raw?.title,
                publishedAt: latestTime,
                status: item.status || item.raw?.status,
                raw: item.raw
            };
        }) : rawData;

        debugLog(`Processed fresh data for ${key}:`, {
            sample: freshData[0] ? {
                videoId: freshData[0].videoId,
                title: freshData[0].title,
                scheduledStart: freshData[0].scheduledStart,
                publishedAt: freshData[0].publishedAt,
                raw: {
                    published_at: freshData[0].raw?.published_at,
                    available_at: freshData[0].raw?.available_at,
                    start_scheduled: freshData[0].raw?.start_scheduled
                }
            } : 'No items'
        });
        
        if (!freshData) {
            throw new Error(`No data returned for ${key}`);
        }
        
        cache.set(key, freshData);
        return freshData;
    } catch (error) {
        debugError(`Error in getCachedOrFetch for ${key}:`, error);
        domRefs.liveStatus.innerHTML = `
            <div class="bg-purple-600 border-2 border-red-500 rounded-lg p-6">
                <p class="text-red-400">Error loading data: ${error.message}</p>
                <button onclick="window.location.reload()" 
                        class="mt-4 bg-yellow-500 hover:bg-yellow-400 text-purple-900 font-semibold px-4 py-2 rounded">
                    Reload Page
                </button>
            </div>
        `;
        return [];
    }
};