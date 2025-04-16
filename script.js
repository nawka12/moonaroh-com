import { HolodexApiClient } from 'holodex.js';
import { COLLABS_CACHE_KEY, CLIPS_CACHE_KEY, ORIGINAL_SONGS_CACHE_KEY, COVER_SONGS_CACHE_KEY, TALENT_MERCH_CACHE_KEY, PREFERENCES_KEY } from './js/cache-keys.js';
import { CAREER_TIMELINE } from './js/career-timeline.js';
import { domRefs, TALENT_CHANNEL_ID, NON_VTUBER_COVER_COLLABS } from './js/constants.js';
import { getTalentMerch } from './js/get-merch.js';
import { getCachedOrFetch } from './js/cache.js';
import { updateCacheStatus } from './js/cache.js';
import { updateTimeCounter } from './js/cache.js';
import { getTweets, generateTweetHTML } from './js/tweets.js';
import { CACHE_DURATION } from './js/cache.js';

// At the top of the file, after imports
console.log('Script loaded');

// Initialize global state
window.backgroundFetchInProgress = false;

// Initialize both clients
let holodexClient = null;

// Add formatter cache
const formatterCache = new Map();
export function getFormatter(options) {
    const key = JSON.stringify(options);
    if (!formatterCache.has(key)) {
        formatterCache.set(key, new Intl.DateTimeFormat('en-GB', options));
    }
    return formatterCache.get(key);
}

// Update existing formatDate and formatDateTime to use cache
export function formatDate(dateString) {
    const date = new Date(dateString);
    const formatter = getFormatter({
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
    });
    return formatter.format(date);
}

export function formatDateTime(dateString) {
    const date = new Date(dateString);
    const formatter = getFormatter({
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    });
    return formatter.format(date);
}

// Add lazy loading observer
const lazyLoadObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            const img = entry.target;
            if (img.dataset.src) {
                img.src = img.dataset.src;
                lazyLoadObserver.unobserve(img);
            }
        }
    });
});

// Add debounced resize handler
let resizeTimeout;
window.addEventListener('resize', () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
        // Update any layout-dependent elements
        if (domRefs.liveStatus) {
            updateLayoutForViewport();
        }
    }, 100);
});

export function updateLayoutForViewport() {
    const isMobile = window.innerWidth < 640;
    // Add any viewport-specific updates here
    document.documentElement.style.setProperty('--card-width', isMobile ? '85%' : '350px');
}

// Add this near the top with other constants
const VERBOSE = false;

// Add this debug logger function
export const debugLog = (...args) => {
    if (VERBOSE) {
        console.log(...args);
    }
};

// Add this debug error logger function
export const debugError = (...args) => {
    if (VERBOSE) {
        console.error(...args);
    } else if (args[0] instanceof Error) {
        // Always log actual Error objects even in non-verbose mode
        console.error(args[0]);
    }
};

// Add this debug warning logger function
export const debugWarn = (...args) => {
    if (VERBOSE) {
        console.warn(...args);
    }
};

export async function initializeHolodexClient() {
    debugLog('initializeHolodexClient called');
    // Always create a new client, regardless of existing one
    try {
        debugLog('Creating new Holodex client...');
        holodexClient = new HolodexApiClient({
            apiKey: 'YOUR_HOLODEX_API_KEY' // Replace with your actual key, consider using environment variables
        });
        debugLog('Holodex client created successfully');
        return holodexClient;
    } catch (error) {
        debugError('Failed to initialize Holodex client:', error);
        return null;
    }
}

let lastUpdateTime = null;
const UPDATE_INTERVAL = 10 * 60 * 1000; // 10 minutes in milliseconds

export async function checkLiveStatus() {
    // Show loading state
    domRefs.liveStatus.innerHTML = `
        <div class="bg-purple-600 border-2 border-red-500 rounded-lg p-6">
            <p class="text-red-400">Loading...</p>
        </div>
    `;
    
    try {
        const now = new Date();
        lastUpdateTime = now;

        // Replace the direct call to getCachedOrFetch with a wrapped promise that handles timeouts gracefully
        const merchPromise = getCachedOrFetch(TALENT_MERCH_CACHE_KEY, getTalentMerch)
            .catch(error => {
                debugError('Merchandise fetch failed with timeout or error:', error);
                // Return empty array on failure
                return [];
            });
        
        const [liveVideos, recentVideos, collabVideos, clipVideos, originalSongs, coverSongs, tweets, moonaMerch] = await Promise.all([
            getCachedOrFetch('liveVideos', async () => {
                const client = await initializeHolodexClient();
                const videos = await client.getLiveVideosByChannelId(TALENT_CHANNEL_ID);
                return videos.filter(video => video.status !== 'missing');
            }),
            getCachedOrFetch('recentVideos', async () => {
                const client = await initializeHolodexClient();
                const videos = await client.getVideosByChannelId(TALENT_CHANNEL_ID, 'videos', { limit: 15 });
                return videos.filter(video => video.status !== 'missing');
            }),
            getCachedOrFetch(COLLABS_CACHE_KEY, async () => {
                const client = await initializeHolodexClient();
                // Fetch 10 collabs instead of 5
                const videos = await client.getVideosByChannelId(TALENT_CHANNEL_ID, 'collabs', { limit: 15 });
                return videos.filter(video => video.status !== 'missing');
            }),
            getCachedOrFetch(CLIPS_CACHE_KEY, async () => {
                const client = await initializeHolodexClient();
                const videos = await client.getVideosByChannelId(TALENT_CHANNEL_ID, 'clips', { limit: 15 });
                return videos.filter(video => video.status !== 'missing');
            }),
            getCachedOrFetch(ORIGINAL_SONGS_CACHE_KEY, async () => {
                const client = await initializeHolodexClient();
                
                debugLog('Fetching original songs...');
                
                // Fetch original songs from Moona's channel
                const moonaOriginals = await client.getVideosByChannelId(TALENT_CHANNEL_ID, 'videos', { 
                    limit: 50,
                    topic: 'Original_Song'
                });

                // Fetch original songs where Moona is mentioned
                const mentionedOriginals = await client.getVideos({ 
                    mentioned_channel_id: TALENT_CHANNEL_ID,
                    topic: 'Original_Song',
                    limit: 25,
                    sort: 'available_at',
                    order: 'desc'
                });

                // Filter out missing videos and unwanted titles
                const filteredMoonaOriginals = moonaOriginals.filter(video => 
                    video.status !== 'missing' &&
                    video.videoId !== 'opaixR7ZpIE' &&
                    video.videoId !== 'Lbv8E-rzVW8' // &&
                    // video.videoId !== 'frcPP_RH6yI'
                );
                const filteredMentionedOriginals = mentionedOriginals.filter(video => 
                    video.status !== 'missing' &&
                    video.videoId !== 'opaixR7ZpIE' &&
                    video.videoId !== 'Lbv8E-rzVW8' // &&
                    // video.videoId !== 'frcPP_RH6yI'
                );

                // Combine all originals
                const allOriginals = [...filteredMoonaOriginals, ...filteredMentionedOriginals];

                // Group videos by similar titles
                const groupedVideos = allOriginals.reduce((groups, video) => {
                    // Clean the title for grouping
                    let cleanTitle = video.title
                        .replace(/[\[【].*?[\]】]/g, '') // Remove text in brackets
                        .replace(/(MV|Official|Music Video|Video|Music|Animated)/gi, '') // Remove common markers
                        .replace(/\(.*?(remastered|ver|version).*?\)/gi, '') // Remove remastered/version variations in parentheses
                        .replace(/（.*?(remastered|ver|version).*?）/gi, '') // Remove remastered/version variations in Japanese parentheses
                        .replace(/\(.*?\)/g, '') // Remove remaining text in parentheses
                        .replace(/（.*?）/g, '') // Remove remaining Japanese parentheses
                        .replace(/feat\.|ft\./gi, '') // Remove featuring markers
                        .replace(/\s+feat(?:\.|ur(?:ing)?)?\s+.*$/gi, '') // Remove featuring with no (.)
                        .replace(/moona\s+hoshinova\s*[-–]\s*/gi, '') // Remove "Moona Hoshinova -"
                        .replace(/\s*[-–]\s*moona\s+hoshinova/gi, '') // Remove "- Moona Hoshinova"
                        .replace(/moona\s+hoshinova/gi, '') // Remove just "Moona Hoshinova"
                        .replace(/\s*[-–]\s*/g, ' ') // Replace dashes with spaces instead of removing them
                        .replace(/\s*\|\|\s*/g, ' - ') // Replace || with a hyphen and spaces
                        .replace(/\s+/g, ' ') // Normalize whitespace
                        .replace(/instrumental/gi, '') // Remove "instrumental"
                        .replace(/remastered(\s+ver(sion)?)?/gi, '') // Remove standalone remastered mentions
                        .replace(/^['"]/g, '') // Remove leading quotes
                        .replace(/['"]$/g, '') // Remove trailing quotes
                        .replace(/\s*\[Original Song\]/gi, '') // Remove [Original Song] marker
                        .replace(/\s*\[.*?\]/g, '') // Remove any remaining text in square brackets
                        .replace(/\s*\(.*?\)/g, '') // Remove any remaining text in parentheses
                        .replace(/\s*（.*?）/g, '') // Remove any remaining text in Japanese parentheses
                        .replace(/\s*hololive\s+id/gi, '') // Remove "hololive id" in all cases
                        .trim()
                        .toLowerCase();

                    // Special handling for Japanese titles with romanized versions (pattern: Japanese - Romanized)
                    // If the title contains Japanese characters and romanized version separated by '-' or similar
                    const hasJapaneseChars = /[\u3000-\u303f\u3040-\u309f\u30a0-\u30ff\uff00-\uff9f\u4e00-\u9faf\u3400-\u4dbf]/.test(cleanTitle);
                    if (hasJapaneseChars) {
                        // Extract Japanese title part if it's in the format "Japanese - Romanized"
                        const parts = cleanTitle.split(/\s-\s/);
                        if (parts.length > 1) {
                            const japanesePartIndex = parts.findIndex(part => 
                                /[\u3000-\u303f\u3040-\u309f\u30a0-\u30ff\uff00-\uff9f\u4e00-\u9faf\u3400-\u4dbf]/.test(part)
                            );
                            if (japanesePartIndex >= 0) {
                                cleanTitle = parts[japanesePartIndex].trim();
                            }
                        }
                    }

                    debugLog(`Title cleaning: "${video.title}" -> "${cleanTitle}"`);

                    if (!groups[cleanTitle]) {
                        groups[cleanTitle] = [];
                    }
                    groups[cleanTitle].push(video);
                    return groups;
                }, {});

                // For each group, select the best version
                const dedupedVideos = Object.values(groupedVideos).map(group => {
                    // Sort versions by priority:
                    // 1. MV versions (with 】)
                    // 2. Original versions (with "Original Song" or similar markers)
                    // 3. Non-instrumental versions
                    // 4. Non-remastered versions
                    // 5. Most recent version
                    return group.sort((a, b) => {
                        // Prefer MV versions
                        const aMV = a.title.includes('】');
                        const bMV = b.title.includes('】');
                        if (aMV && !bMV) return -1;
                        if (!aMV && bMV) return 1;

                        // Then prefer versions with "Original Song" or similar markers
                        const aOriginal = a.title.match(/Original Song|Official|MV/i);
                        const bOriginal = b.title.match(/Original Song|Official|MV/i);
                        if (aOriginal && !bOriginal) return -1;
                        if (!aOriginal && bOriginal) return 1;

                        // Then prefer non-instrumental versions
                        const aInst = a.title.toLowerCase().includes('instrumental');
                        const bInst = b.title.toLowerCase().includes('instrumental');
                        if (!aInst && bInst) return -1;
                        if (aInst && !bInst) return 1;

                        // Then prefer non-remastered versions
                        const aRemaster = a.title.toLowerCase().match(/remastered|remaster\s+ver/);
                        const bRemaster = b.title.toLowerCase().match(/remastered|remaster\s+ver/);
                        if (!aRemaster && bRemaster) return -1;
                        if (aRemaster && !bRemaster) return 1;

                        // Finally, sort by date
                        const timeA = getLatestTime(a);
                        const timeB = getLatestTime(b);
                        return timeB - timeA;
                    })[0]; // Take the first (highest priority) version
                });

                // Sort the final list by date
                const sortedVideos = dedupedVideos.sort((a, b) => {
                    const timeA = getLatestTime(a);
                    const timeB = getLatestTime(b);
                    
                    debugLog(`Comparing originals:
                        A: ${a.title} (${timeA.toISOString()})
                        B: ${b.title} (${timeB.toISOString()})
                        Result: ${timeB - timeA}`
                    );
                    
                    return timeB - timeA;
                });

                debugLog('Final sorted originals:', sortedVideos.map(v => ({
                    title: v.title,
                    date: getLatestTime(v).toISOString(),
                    channel: v.channel?.name,
                    raw: {
                        published_at: v.published_at,
                        available_at: v.available_at,
                        start_scheduled: v.start_scheduled
                    }
                })));

                return sortedVideos;
            }),
            getCachedOrFetch(COVER_SONGS_CACHE_KEY, async () => {
                const client = await initializeHolodexClient();
                
                debugLog('Fetching cover songs...');
                
                // Fetch covers from Moona's channel
                const moonaCovers = await client.getVideos({ 
                    channel_id: TALENT_CHANNEL_ID,
                    topic: 'Music_Cover',
                    limit: 25,
                    sort: 'available_at',
                    order: 'desc'
                });

                // Fetch covers where Moona is mentioned
                const mentionedCovers = await client.getVideos({ 
                    mentioned_channel_id: TALENT_CHANNEL_ID,
                    topic: 'Music_Cover',
                    limit: 25,
                    sort: 'available_at',
                    order: 'desc'
                });

                // Filter out missing videos, unwanted titles, and the specific AREA15 video
                const filteredMoonaCovers = moonaCovers.filter(video => 
                    video.status !== 'missing' && 
                    !video.title.includes('Amaya Miyu') && 
                    !video.title.includes('Rora Meeza') &&
                    !video.title.includes('AREA15 Original Song Medley')  // Added this condition
                );
                const filteredMentionedCovers = mentionedCovers.filter(video => 
                    video.status !== 'missing' && 
                    !video.title.includes('Amaya Miyu') && 
                    !video.title.includes('Rora Meeza') &&
                    !video.title.includes('AREA15 Original Song Medley')  // Added this condition
                );

                // Create video objects from hardcoded non-vtuber collaborations
                const nonVtuberCollabs = NON_VTUBER_COVER_COLLABS.map(collab => {
                    return {
                        videoId: collab.videoId,
                        title: collab.title,
                        status: 'available',
                        channel: {
                            name: collab.channel_name
                        },
                        published_at: collab.published_at,
                        available_at: collab.published_at,
                        publishedAt: collab.published_at,
                        raw: {
                            published_at: collab.published_at,
                            available_at: collab.published_at
                        }
                    };
                });

                // Combine all covers and sort them together
                const allCovers = [...filteredMoonaCovers, ...filteredMentionedCovers, ...nonVtuberCollabs]
                    .sort((a, b) => {
                        const timeA = getLatestTime(a);
                        const timeB = getLatestTime(b);
                        
                        // Add debug logging for sorting
                        debugLog(`Comparing:
                            A: ${a.title} (${timeA.toISOString()})
                            B: ${b.title} (${timeB.toISOString()})
                            Result: ${timeB - timeA}`
                        );
                        
                        return timeB - timeA;
                    });

                debugLog('Final sorted covers:', allCovers.map(v => ({
                    title: v.title,
                    date: getLatestTime(v).toISOString(),
                    raw: {
                        published_at: v.published_at,
                        available_at: v.available_at,
                        start_scheduled: v.start_scheduled
                    }
                })));

                return allCovers;
            }),
            getCachedOrFetch('tweets', getTweets),
            merchPromise
        ]);

        // Move updateCacheStatus() here, after data is fetched
        updateCacheStatus();

        // Filter out live and upcoming streams from recent videos
        const filteredRecentVideos = recentVideos
            .filter(video => 
                video.status !== 'live' && 
                video.status !== 'upcoming' &&
                video.raw?.status !== 'upcoming'  // Added check for raw status
            )
            .slice(0, 6); // Changed from 5 to 6

        // Add similar filter for collabs
        const filteredCollabVideos = collabVideos && Array.isArray(collabVideos)
            ? collabVideos
                .filter(video => 
                    video && video.status !== 'live' && 
                    video.status !== 'upcoming' &&
                    video.raw?.status !== 'upcoming'  // Added check for raw status
                )
                .slice(0, 6)
            : [];

        // Get the latest activity time from videos, collabs, and tweets
        let latestActivity = null;

        // Check videos first
        if (filteredRecentVideos.length > 0) {
            const latestVideo = filteredRecentVideos[0];
            debugLog('Latest video data:', {
                title: latestVideo.title,
                publishedAt: latestVideo.publishedAt,
                raw: {
                    published_at: latestVideo.raw?.published_at,
                    available_at: latestVideo.raw?.available_at
                }
            });
            
            if (latestVideo.publishedAt) {
                latestActivity = new Date(latestVideo.publishedAt);
            }
        }

        // Check collabs and compare with current latest activity
        if (filteredCollabVideos && filteredCollabVideos.length > 0) {
            const latestCollab = filteredCollabVideos[0];
            debugLog('Latest collab data:', {
                title: latestCollab.title,
                publishedAt: latestCollab.publishedAt,
                raw: {
                    published_at: latestCollab.raw?.published_at,
                    available_at: latestCollab.raw?.available_at
                }
            });
            
            if (latestCollab.publishedAt) {
                const collabDate = new Date(latestCollab.publishedAt);
                if (!latestActivity || collabDate > latestActivity) {
                    latestActivity = collabDate;
                }
            }
        }

        // Check tweets and compare with current latest activity
        if (tweets && tweets.tweets && tweets.tweets.length > 0) {
            const latestTweet = new Date(tweets.tweets[0].timestamp * 1000);
            if (!latestActivity || latestTweet > latestActivity) {
                latestActivity = latestTweet;
            }
        }

        // Update the time counter if we found an activity
        if (latestActivity) {
            // Clear existing interval if any
            if (window.timeCounterInterval) {
                clearInterval(window.timeCounterInterval);
            }
            window.timeCounterInterval = updateTimeCounter(latestActivity);
        }

        if (liveVideos && liveVideos.length > 0) {
            const liveStreams = liveVideos.filter(stream => stream.status === 'live');
            const upcomingStreams = liveVideos
                .filter(stream => stream.status === 'upcoming')
                .sort((a, b) => new Date(a.scheduledStart) - new Date(b.scheduledStart))
                .slice(0, 5);
            
            let html = `
                <style>
                    .grid-container {
                        width: 100%;
                        max-width: 100%;
                        margin: 0 auto;
                        box-sizing: border-box;
                    }
                    .scroll-container {
                        display: flex;
                        overflow-x: auto;
                        gap: 0.75rem;
                        padding: 0.75rem;
                        scroll-snap-type: x mandatory;
                        -webkit-overflow-scrolling: touch;
                        scrollbar-width: thin;
                    }
                    .scroll-container::-webkit-scrollbar {
                        height: 4px;
                    }
                    .scroll-container::-webkit-scrollbar-track {
                        background: #f1f1f1;
                        border-radius: 4px;
                    }
                    .scroll-container::-webkit-scrollbar-thumb {
                        background: #888;
                        border-radius: 4px;
                    }
                    .grid-item {
                        flex: 0 0 calc(85% - 1rem);
                        max-width: calc(85% - 1rem);
                        scroll-snap-align: start;
                        border-radius: 12px;
                        overflow: hidden;
                        padding: 1rem;
                    }
                    @media (min-width: 640px) {
                        .scroll-container {
                            flex-wrap: wrap;
                            justify-content: center;
                            gap: 1rem;
                            padding: 1rem;
                            overflow-x: visible;
                        }
                        .grid-item {
                            flex: 0 0 350px;
                            max-width: 350px;
                            padding: 1.5rem;
                        }
                    }
                    .stream-thumbnail {
                        width: 100%;
                        height: auto;
                        aspect-ratio: 16/9;
                        object-fit: cover;
                        background-color: rgba(0, 0, 0, 0.2);
                        border-radius: 0.75rem;
                        transition: transform 0.3s ease;
                    }
                    .thumbnail-container {
                        position: relative;
                        overflow: hidden;
                        border-radius: 0.75rem;
                        margin-bottom: 1rem;
                    }
                    .thumbnail-container:hover .stream-thumbnail {
                        transform: scale(1.05);
                    }
                    @media (min-width: 640px) {
                        .grid-container {
                            margin: 0;
                            gap: 1rem;
                        }
                        .grid-item {
                            flex: 0 0 350px;
                            max-width: 350px;
                        }
                    }
                    @media (max-width: 640px) {
                        .content-container {
                            padding-left: 0.75rem;
                            padding-right: 0.75rem;
                        }
                        .time-counter {
                            font-size: 1.125rem;
                        }
                        h1, h2, h3 {
                            word-break: break-word;
                        }
                        .grid-item {
                            margin-bottom: 0.5rem;
                        }
                    }
                </style>
            `;

            // Live Streams Section
            if (liveStreams.length > 0) {
                html += `
                    <div class="flex flex-col items-center mb-8">
                        <h2 class="section-title text-2xl md:text-3xl font-bold text-yellow-300">🔴 Live Now</h2>
                        <span class="text-xs text-yellow-200 italic opacity-75">Powered by Holodex</span>
                    </div>
                `;
                html += `
                    <div class="grid-container mb-12">
                        <div class="scroll-container">
                `;
                
                for (const stream of liveStreams) {
                    const videoId = stream.raw?.id;
                    const title = stream.raw?.title;
                    const actualStart = stream.actualStart || new Date(stream.raw?.start_actual);
                    const liveViewers = stream.raw?.live_viewers;

                    html += `
                        <div class="card glass-effect rounded-2xl p-4 md:p-6 relative">
                            ${stream.status === 'live' ? '<span class="status-badge live-badge">LIVE</span>' : ''}
                            <h3 class="text-lg md:text-xl font-semibold text-yellow-200 mb-4">${title}</h3>
                            <div class="thumbnail-container">
                                <img class="stream-thumbnail"
                                     src="https://i.ytimg.com/vi/${videoId}/hqdefault.jpg"
                                     data-video-id="${videoId}"
                                     onerror="this.onerror=null; this.src='https://i.ytimg.com/vi/${videoId}/hqdefault.jpg';"
                                     alt="Video thumbnail">
                            </div>
                            <div class="space-y-2 mb-4">
                                <p class="text-sm md:text-base text-yellow-100 opacity-90">${actualStart ? formatDateTime(actualStart) : 'N/A'}</p>
                                <p class="text-sm md:text-base text-yellow-100">Viewers: ${liveViewers?.toLocaleString() || 'N/A'}</p>
                            </div>
                            <a href="https://youtube.com/watch?v=${videoId}"
                               target="_blank"
                               class="inline-block w-full bg-yellow-500 hover:bg-yellow-400 text-purple-900 font-semibold px-6 py-3 rounded-xl text-center transition-colors duration-200">
                                Watch Stream
                            </a>
                        </div>
                    `;
                }
                html += '</div>';
            }

            // Upcoming Streams Section
            if (upcomingStreams.length > 0) {
                html += `
                    <div class="flex flex-col items-center mb-8">
                        <h2 class="section-title text-2xl md:text-3xl font-bold text-yellow-300">⏰ Upcoming Streams</h2>
                        <span class="text-xs text-yellow-200 italic opacity-75">Powered by Holodex</span>
                    </div>
                `;
                html += `
                    <div class="grid-container mb-12">
                        <div class="scroll-container">
                `;
                
                for (const stream of upcomingStreams) {
                    const videoId = stream.raw?.id;
                    const title = stream.raw?.title;
                    const scheduledStart = stream.scheduledStart || new Date(stream.raw?.scheduled_start);
                    const channelName = stream.raw?.channel?.name;
                    const isOtherChannel = stream.raw?.channel?.id !== TALENT_CHANNEL_ID;
                    
                    html += `
                        <div class="card glass-effect rounded-2xl p-4 md:p-6 relative">
                            <span class="status-badge live-badge">${isOtherChannel ? 'UPCOMING COLLAB' : 'UPCOMING'}</span>
                            <h3 class="text-lg md:text-xl font-semibold text-yellow-200 mb-4">${title}</h3>
                            <div class="thumbnail-container">
                                <img class="stream-thumbnail"
                                     src="https://i.ytimg.com/vi/${videoId}/hqdefault.jpg"
                                     data-video-id="${videoId}"
                                     onerror="this.onerror=null; this.src='https://i.ytimg.com/vi/${videoId}/hqdefault.jpg';"
                                     alt="Video thumbnail">
                            </div>
                            <div class="space-y-2 mb-4">
                                <p class="text-sm md:text-base text-yellow-100 opacity-90">Scheduled for: ${scheduledStart ? formatDateTime(scheduledStart) : 'N/A'}</p>
                                ${isOtherChannel ? `
                                    <p class="text-sm text-yellow-200">Channel: ${channelName}</p>
                                ` : ''}
                            </div>
                            <a href="https://youtube.com/watch?v=${videoId}"
                               target="_blank"
                               class="inline-block w-full bg-yellow-500 hover:bg-yellow-400 text-purple-900 font-semibold px-6 py-3 rounded-xl text-center transition-colors duration-200">
                                Set Reminder
                            </a>
                        </div>
                    `;
                }
                html += '</div>';
            }

            // Recent videos section
            if (filteredRecentVideos.length > 0) {
                html += `
                    <div class="flex flex-col items-center mb-8">
                        <h2 class="section-title text-2xl md:text-3xl font-bold text-yellow-300">Recent Videos</h2>
                        <span class="text-xs text-yellow-200 italic opacity-75">Powered by Holodex</span>
                    </div>
                `;
                html += `
                    <div class="grid-container mb-12">
                        <div class="scroll-container">
                `;
                for (const video of filteredRecentVideos) {
                    html += `
                        <div class="card glass-effect rounded-2xl p-4 md:p-6 relative">
                            ${video.status === 'live' ? '<span class="status-badge live-badge">LIVE</span>' : ''}
                            <h3 class="text-lg md:text-xl font-semibold text-yellow-200 mb-4">${video.title}</h3>
                            <div class="thumbnail-container">
                                <img class="stream-thumbnail"
                                     src="https://i.ytimg.com/vi/${video.videoId}/hqdefault.jpg"
                                     data-video-id="${video.videoId}"
                                     onerror="this.onerror=null; this.src='https://i.ytimg.com/vi/${video.videoId}/hqdefault.jpg';"
                                     alt="Video thumbnail">
                            </div>
                            <div class="space-y-2 mb-4">
                                <p class="text-sm md:text-base text-yellow-100 opacity-90">Latest activity: ${video.publishedAt ? formatDateTime(video.publishedAt) : 'N/A'}</p>
                                <p class="text-xs text-yellow-200">
                                    Published: ${video.raw?.published_at ? formatDateTime(new Date(video.raw.published_at)) : 'N/A'}<br>
                                    Available at: ${video.raw?.available_at ? formatDateTime(new Date(video.raw.available_at)) : 'N/A'}
                                </p>
                            </div>
                            <a href="https://youtube.com/watch?v=${video.videoId}"
                               target="_blank"
                               class="inline-block w-full bg-yellow-500 hover:bg-yellow-400 text-purple-900 font-semibold px-6 py-3 rounded-xl text-center transition-colors duration-200">
                                Watch Video
                            </a>
                        </div>
                    `;
                }
                html += '</div>';
            }

            // Add tweets section after recent videos
            if ((tweets.tweets && tweets.tweets.length > 0) || tweets.error) {
                // Extract the domain name from the source URL
                let sourceText = 'Nitter';
                if (tweets.source) {
                    const sourceUrl = new URL(tweets.source);
                    sourceText = sourceUrl.hostname;
                }
                
                html += `
                    <div class="flex flex-col items-center mb-8">
                        <h2 class="section-title text-2xl md:text-3xl font-bold text-yellow-300">Recent Tweets</h2>
                        <span class="text-xs text-yellow-200 italic opacity-75">Powered by ${sourceText}</span>
                    </div>
                `;

                if (tweets.error) {
                    // Show warning message when Nitter is down
                    html += `
                        <div class="grid-container mb-12">
                            <div class="scroll-container">
                                <div class="card glass-effect rounded-2xl p-4 md:p-6 relative grid-item">
                                    <div class="flex items-center justify-center">
                                        <div class="text-yellow-300">
                                            <svg class="w-6 h-6 inline-block mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                            </svg>
                                            ${tweets.message}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    `;
                } else {
                    // Regular tweets display code
                    html += `
                        <div class="grid-container mb-12">
                            <div class="scroll-container">
                                ${tweets.tweets.slice(0, 6).map(tweet => generateTweetHTML(tweet)).join('')}
                            </div>
                        </div>
                    `;
                }
            }

            // Add collabs section before the music playlist section
            if (filteredCollabVideos && filteredCollabVideos.length > 0) {
                html += `
                    <div class="flex flex-col items-center mb-8">
                        <h2 class="section-title text-2xl md:text-3xl font-bold text-yellow-300">Recent Collaborations</h2>
                        <span class="text-xs text-yellow-200 italic opacity-75">Powered by Holodex</span>
                    </div>
                `;
                html += `
                    <div class="grid-container mb-12">
                        <div class="scroll-container">
                            ${filteredCollabVideos.map(video => `
                                <div class="card glass-effect rounded-2xl p-4 md:p-6 relative">
                                    ${video.status === 'live' ? '<span class="status-badge live-badge">LIVE</span>' : ''}
                                    <h3 class="text-lg md:text-xl font-semibold text-yellow-200 mb-4">${video.title}</h3>
                                    <div class="thumbnail-container">
                                        <img class="stream-thumbnail"
                                             src="https://i.ytimg.com/vi/${video.videoId}/hqdefault.jpg"
                                             data-video-id="${video.videoId}"
                                             onerror="this.onerror=null; this.src='https://i.ytimg.com/vi/${video.videoId}/hqdefault.jpg';"
                                             alt="Video thumbnail">
                                    </div>
                                    <div class="space-y-2 mb-4">
                                        <p class="text-sm md:text-base text-yellow-100 opacity-90">Latest activity: ${video.publishedAt ? formatDateTime(video.publishedAt) : 'N/A'}</p>
                                        <p class="text-xs text-yellow-200">
                                            Published: ${video.raw?.published_at ? formatDateTime(new Date(video.raw.published_at)) : 'N/A'}<br>
                                            Available at: ${video.raw?.available_at ? formatDateTime(new Date(video.raw.available_at)) : 'N/A'}
                                        </p>
                                        ${video.raw?.channel?.name ? 
                                            `<p class="text-sm text-yellow-200">Channel: ${video.raw.channel.name}</p>` : 
                                            ''}
                                    </div>
                                    <a href="https://youtube.com/watch?v=${video.videoId}" 
                                       target="_blank" 
                                       class="inline-block w-full bg-yellow-500 hover:bg-yellow-400 text-purple-900 font-semibold px-6 py-3 rounded-xl text-center transition-colors duration-200">
                                        Watch Collab
                                    </a>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                `;
            }

            // Add clips section before the music playlist section (after collabs)
            const filteredClipVideos = clipVideos
                .filter(video => 
                    video.status !== 'live' && 
                    video.status !== 'upcoming' &&
                    video.raw?.status !== 'upcoming'  // Added check for raw status
                )
                .slice(0, 6); // Changed from 5 to 6

            if (filteredClipVideos.length > 0) {
                html += `
                    <div class="flex flex-col items-center mb-8">
                        <h2 class="section-title text-2xl md:text-3xl font-bold text-yellow-300">Recent Clips</h2>
                        <span class="text-xs text-yellow-200 italic opacity-75">Powered by Holodex</span>
                    </div>
                `;
                html += `
                    <div class="grid-container mb-12">
                        <div class="scroll-container">
                            ${filteredClipVideos.map(video => `
                                <div class="card glass-effect rounded-2xl p-4 md:p-6 relative">
                                    ${video.status === 'live' ? '<span class="status-badge live-badge">LIVE</span>' : ''}
                                    <h3 class="text-lg md:text-xl font-semibold text-yellow-200 mb-4">${video.title}</h3>
                                    <div class="thumbnail-container">
                                        <img class="stream-thumbnail"
                                             src="https://i.ytimg.com/vi/${video.videoId}/hqdefault.jpg"
                                             data-video-id="${video.videoId}"
                                             onerror="this.onerror=null; this.src='https://i.ytimg.com/vi/${video.videoId}/hqdefault.jpg';"
                                             alt="Video thumbnail">
                                    </div>
                                    <div class="space-y-2 mb-4">
                                        <p class="text-sm md:text-base text-yellow-100 opacity-90">Latest activity: ${video.publishedAt ? formatDateTime(video.publishedAt) : 'N/A'}</p>
                                        <p class="text-xs text-yellow-200">
                                            Published: ${video.raw?.published_at ? formatDateTime(new Date(video.raw.published_at)) : 'N/A'}<br>
                                            Available at: ${video.raw?.available_at ? formatDateTime(new Date(video.raw.available_at)) : 'N/A'}
                                        </p>
                                        ${video.raw?.channel?.name ? 
                                            `<p class="text-sm text-yellow-200">Clipped by: ${video.raw.channel.name}</p>` : 
                                            ''}
                                    </div>
                                    <a href="https://youtube.com/watch?v=${video.videoId}" 
                                       target="_blank" 
                                       class="inline-block w-full bg-yellow-500 hover:bg-yellow-400 text-purple-900 font-semibold px-6 py-3 rounded-xl text-center transition-colors duration-200">
                                        Watch Clip
                                    </a>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                `;
            }

            // Add music playlist section
            if (originalSongs.length > 0) {
                html += `
                    <div class="flex flex-col items-center mb-8">
                        <h2 class="section-title text-2xl md:text-3xl font-bold text-yellow-300">Original Songs</h2>
                        <span class="text-xs text-yellow-200 italic opacity-75">Powered by Holodex</span>
                    </div>
                `;
                html += `
                    <div class="grid-container mb-12">
                        <div class="scroll-container">
                            ${originalSongs.map(song => `
                                <div class="card glass-effect rounded-2xl p-4 md:p-6 relative">
                                    <h3 class="text-lg md:text-xl font-semibold text-yellow-200 mb-4">${song.title}</h3>
                                    <div class="thumbnail-container">
                                        <img class="stream-thumbnail"
                                             src="https://i.ytimg.com/vi/${song.videoId || song.id}/hqdefault.jpg"
                                             data-video-id="${song.videoId || song.id}"
                                             onerror="this.onerror=null; this.src='https://i.ytimg.com/vi/${song.videoId || song.id}/hqdefault.jpg';"
                                             alt="Song thumbnail">
                                    </div>
                                    <div class="space-y-2 mb-4">
                                        <p class="text-sm md:text-base text-yellow-100 opacity-90">
                                            Published: ${song.publishedAt ? formatDateTime(song.publishedAt) : 'N/A'}
                                        </p>
                                        ${song.channel?.name ? 
                                            `<p class="text-sm text-yellow-200">Channel: ${song.channel.name}</p>` : 
                                            ''}
                                    </div>
                                    <a href="https://youtube.com/watch?v=${song.videoId || song.id}" 
                                       target="_blank" 
                                       class="inline-block w-full bg-yellow-500 hover:bg-yellow-400 text-purple-900 font-semibold px-6 py-3 rounded-xl text-center transition-colors duration-200">
                                        Listen Now
                                    </a>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                `;
            }

            // Add cover songs section
            if (coverSongs.length > 0) {
                html += `
                    <div class="flex flex-col items-center mb-8">
                        <h2 class="section-title text-2xl md:text-3xl font-bold text-yellow-300">Cover Songs</h2>
                        <span class="text-xs text-yellow-200 italic opacity-75">Powered by Holodex</span>
                    </div>
                `;
                html += `
                    <div class="grid-container mb-12">
                        <div class="scroll-container">
                            ${coverSongs.map(song => `
                                <div class="card glass-effect rounded-2xl p-4 md:p-6 relative">
                                    <h3 class="text-lg md:text-xl font-semibold text-yellow-200 mb-4">${song.title}</h3>
                                    <div class="thumbnail-container">
                                        <img class="stream-thumbnail"
                                             src="https://i.ytimg.com/vi/${song.videoId || song.id}/hqdefault.jpg"
                                             data-video-id="${song.videoId || song.id}"
                                             onerror="this.onerror=null; this.src='https://i.ytimg.com/vi/${song.videoId || song.id}/hqdefault.jpg';"
                                             alt="Song thumbnail">
                                    </div>
                                    <div class="space-y-2 mb-4">
                                        <p class="text-sm md:text-base text-yellow-100 opacity-90">
                                            Published: ${song.publishedAt ? formatDateTime(song.publishedAt) : 'N/A'}
                                        </p>
                                        ${song.channel?.name ? 
                                            `<p class="text-sm text-yellow-200">Channel: ${song.channel.name}</p>` : 
                                            ''}
                                    </div>
                                    <a href="https://youtube.com/watch?v=${song.videoId || song.id}" 
                                       target="_blank" 
                                       class="inline-block w-full bg-yellow-500 hover:bg-yellow-400 text-purple-900 font-semibold px-6 py-3 rounded-xl text-center transition-colors duration-200">
                                        Listen Now
                                    </a>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                `;
            }
            
            // Add Moona Merch section
            html += `
                <div class="flex flex-col items-center mb-8">
                    <h2 class="section-title text-2xl md:text-3xl font-bold text-yellow-300">Moona Merch</h2>
                    <span class="text-xs text-yellow-200 italic opacity-75">Official hololive Shop</span>
                </div>
                
                <style>
                    /* Square aspect ratio for merchandise thumbnails */
                    .merch-thumbnail-container {
                        position: relative;
                        width: 100%;
                        padding-bottom: 100%; /* 1:1 Aspect Ratio */
                        overflow: hidden;
                        border-radius: 0.75rem;
                        margin-bottom: 1rem;
                    }
                    
                    .merch-thumbnail {
                        position: absolute;
                        top: 0;
                        left: 0;
                        width: 100%;
                        height: 100%;
                        object-fit: cover;
                        object-position: center;
                        aspect-ratio: 1/1;
                        background-color: rgba(0, 0, 0, 0.1);
                    }
                    
                    @media (min-width: 1024px) {
                        .merch-thumbnail-container {
                            max-width: 280px;
                            max-height: 280px;
                            margin: 0 auto 1rem auto;
                        }
                    }
                </style>
            `;
            
            // Only show one of these two sections based on whether we have merch data
            if (moonaMerch && moonaMerch.length > 0) {
                // Show merch items when data is available
                html += `
                    <div class="grid-container mb-12 merch-container">
                        <div class="scroll-container">
                            ${moonaMerch.map(item => `
                                <div class="card glass-effect rounded-2xl p-4 md:p-6 relative">
                                    <h3 class="text-lg md:text-xl font-semibold text-yellow-200 mb-4">${item.title || 'Moona Merchandise'}</h3>
                                    <div class="thumbnail-container merch-thumbnail-container">
                                        <a href="${item.itemUrl}" target="_blank" rel="noopener noreferrer">
                                            <img class="stream-thumbnail merch-thumbnail hover:opacity-80 transition-opacity"
                                                 src="${item.imageUrl}"
                                                 onerror="this.onerror=null; this.src='${item.secondaryImageUrl || 'https://via.placeholder.com/480x480?text=Moona+Merch'}';"
                                                 alt="${item.imageAlt || 'Moona Merchandise'}">
                                        </a>
                                    </div>
                                    <div class="space-y-2 mb-4">
                                        <p class="text-sm md:text-base text-yellow-100 opacity-90">
                                            Price: ${item.price || 'See shop for details'}
                                        </p>
                                    </div>
                                    <div class="card-footer mt-auto pt-4 flex justify-between items-center">
                                        <a href="${item.itemUrl}" target="_blank" rel="noopener noreferrer" class="inline-flex items-center px-4 py-2 bg-yellow-500 hover:bg-yellow-600 text-purple-900 font-bold rounded transition-colors">
                                            <span>View Item</span>
                                            <svg class="w-4 h-4 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"></path>
                                            </svg>
                                        </a>
                                    </div>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                `;
            } else {
                // Show a message only if no merchandise was found
                html += `
                    <div class="grid-container mb-12 merch-empty-container">
                        <div class="glass-effect rounded-2xl p-6 text-center">
                            <p class="text-yellow-100 mb-4">Unable to load merchandise information at this time.</p>
                            <a href="https://shop.hololivepro.com/en/collections/moonahoshinova" target="_blank" rel="noopener noreferrer" 
                               class="inline-flex items-center px-4 py-2 bg-yellow-500 hover:bg-yellow-600 text-purple-900 font-bold rounded transition-colors">
                                <span>Visit Moona's Shop Page</span>
                                <svg class="w-4 h-4 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"></path>
                                </svg>
                            </a>
                        </div>
                    </div>
                `;
            }

            // Add timeline section
            html += `
                <div class="flex flex-col items-center mb-8">
                    <h2 class="section-title text-2xl md:text-3xl font-bold text-yellow-300">Career Timeline</h2>
                    <span class="text-xs text-yellow-200 italic opacity-75">Major Milestones</span>
                </div>
                <div class="grid-container mb-12">
                    <div class="relative px-4 py-8 max-w-4xl mx-auto">
                        <div class="absolute left-1/2 transform -translate-x-1/2 h-full w-1 bg-yellow-500/30"></div>
                        ${CAREER_TIMELINE.map((event, index) => `
                            <div class="relative mb-8">
                                <div class="flex items-center">
                                    <div class="absolute left-1/2 transform -translate-x-1/2 w-4 h-4 bg-yellow-500 rounded-full"></div>
                                    <div class="w-1/2 ${index % 2 === 0 ? 'pr-8 text-right' : 'pl-8 ml-auto'}">
                                        <div class="card glass-effect rounded-xl p-4">
                                            <div class="text-yellow-300 font-semibold mb-1">${formatDate(event.date)}</div>
                                            <div class="text-yellow-100">${event.event}</div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;

            const statusDiv = domRefs.liveStatus;
            if (!statusDiv) {
                console.error('Could not find liveStatus element');
                return;
            }

            statusDiv.innerHTML = html;

            if (liveStreams.length > 0) {
                // Clear existing interval if any
                if (window.timeCounterInterval) {
                    clearInterval(window.timeCounterInterval);
                }
                // Set counter text to "MOONA ON SIGHT!"
                domRefs.timeCounter.textContent = 'MOONA ON SIGHT!';
            } else {
                // Regular time counter update for non-live state
                if (latestActivity) {
                    if (window.timeCounterInterval) {
                        clearInterval(window.timeCounterInterval);
                    }
                    window.timeCounterInterval = updateTimeCounter(latestActivity);
                }
            }
        } else {
            statusDiv.innerHTML = `
                <div class="bg-gray-50 border-2 border-gray-300 rounded-lg p-6 shadow-lg mb-8">
                    <h2 class="text-2xl font-bold text-gray-700 mb-4">⚫ Moona is currently offline</h2>
                    <p class="text-gray-600 mb-4">
                        Check back later or follow her 
                        <a href="https://youtube.com/channel/${TALENT_CHANNEL_ID}" 
                           target="_blank"
                           class="text-blue-600 hover:text-blue-800 underline">
                            YouTube channel
                        </a>
                        for updates!
                    </p>
                </div>
            `;
        }

    } catch (error) {
        console.error('Error:', error);
        domRefs.liveStatus.innerHTML = `
            <div class="bg-purple-600 border-2 border-red-500 rounded-lg p-6">
                <p class="text-red-400">Error checking live status: ${error.message}</p>
                <button onclick="window.location.reload()" 
                        class="mt-4 bg-yellow-500 hover:bg-yellow-400 text-purple-900 font-semibold px-4 py-2 rounded">
                    Reload Page
                </button>
            </div>
        `;
        domRefs.timeCounter.textContent = 'Error loading time';
    }
}

// Add these variables near the top with other constants
let pageVisible = true;
let lastVisibilityChange = Date.now();
let lastHiddenTime = null;

// Add this function near the top with other initialization functions
function handleVisibilityChange() {
    if (document.hidden) {
        pageVisible = false;
        lastHiddenTime = Date.now();
    } else {
        // Page just became visible
        pageVisible = true;
        
        // Only force refresh if the page was hidden for longer than CACHE_DURATION
        const hiddenDuration = lastHiddenTime ? Date.now() - lastHiddenTime : 0;
        
        if (hiddenDuration > CACHE_DURATION) {
            console.log(`Page was hidden for ${Math.floor(hiddenDuration/1000)}s, forcing refresh...`);
            window.forceCacheRefresh();
        } else if (lastHiddenTime) {
            console.log(`Page was hidden for ${Math.floor(hiddenDuration/1000)}s, not refreshing (< ${CACHE_DURATION/1000}s threshold)`);
        }
        
        lastVisibilityChange = Date.now();
        lastHiddenTime = null;
    }
}

// Update the safeCheckLiveStatus function
async function safeCheckLiveStatus(isForceRefresh = false) {
    try {
        // Only proceed if page is visible
        if (!pageVisible && !isForceRefresh) {
            debugLog('Page is not visible, skipping status check');
            return;
        }

        // Check if we've been hidden for too long
        const timeSinceVisibilityChange = Date.now() - lastVisibilityChange;
        if (timeSinceVisibilityChange > UPDATE_INTERVAL && !isForceRefresh) {
            debugLog('Long period of inactivity detected, forcing cache refresh...');
            await window.forceCacheRefresh();
            return;
        }

        // Reset Holodex client on each check to ensure fresh connection
        holodexClient = await initializeHolodexClient();
        
        await checkLiveStatus();
        
        // Update last check time after successful update
        lastUpdateTime = new Date();
    } catch (error) {
        debugError('Failed to check live status:', error);
        domRefs.liveStatus.innerHTML = `
            <div class="bg-purple-600 border-2 border-red-500 rounded-lg p-6">
                <p class="text-red-400">Error checking live status: ${error.message}</p>
                <button onclick="window.location.reload()" 
                        class="mt-4 bg-yellow-500 hover:bg-yellow-400 text-purple-900 font-semibold px-4 py-2 rounded">
                    Reload Page
                </button>
            </div>
        `;
    }
}

// Add these constants near the top
const PULL_THRESHOLD = 80; // pixels
let touchStartY = 0;
let pullDistance = 0;
let isPulling = false;
let refreshIndicator = null;

// Add this function near other initialization code
function initializePullToRefresh() {
    // Create refresh indicator element with improved styling
    refreshIndicator = document.createElement('div');
    refreshIndicator.className = 'fixed left-0 right-0 flex items-center justify-center -translate-y-full transition-all duration-200 ease-out z-50 opacity-0';
    refreshIndicator.innerHTML = `
        <div class="bg-yellow-500 text-purple-900 p-3 rounded-full shadow-lg transform transition-all duration-200 ease-out">
            <span class="pull-text">
                <svg class="w-6 h-6 transform rotate-0 transition-transform duration-200" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                </svg>
            </span>
            <span class="refreshing-text hidden">
                <svg class="animate-spin h-6 w-6" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
            </span>
        </div>
    `;
    document.body.appendChild(refreshIndicator);

    // Add touch event listeners
    document.addEventListener('touchstart', handleTouchStart, { passive: true });
    document.addEventListener('touchmove', handleTouchMove, { passive: false });
    document.addEventListener('touchend', handleTouchEnd, { passive: true });
}

// Add these touch event handlers
function handleTouchStart(e) {
    // Only enable pull to refresh when at top of page
    if (window.scrollY === 0) {
        touchStartY = e.touches[0].clientY;
        isPulling = true;
    }
}

function handleTouchMove(e) {
    if (!isPulling) return;

    pullDistance = Math.max(0, e.touches[0].clientY - touchStartY);
    
    // Prevent default scrolling while pulling
    if (pullDistance > 0) {
        e.preventDefault();
    }

    // Add resistance to the pull (square root function for natural feel)
    const resistedPull = Math.sqrt(pullDistance) * 8;
    
    // Only show indicator when pulling down
    if (pullDistance > 0) {
        refreshIndicator.style.opacity = '1';
        refreshIndicator.style.transform = `translateY(${Math.min(resistedPull, PULL_THRESHOLD * 1.2)}px)`;
        
        // Rotate arrow based on pull progress
        const arrow = refreshIndicator.querySelector('.pull-text svg');
        const progress = Math.min(pullDistance / PULL_THRESHOLD, 1);
        arrow.style.transform = `rotate(${180 * progress}deg)`;
    } else {
        refreshIndicator.style.opacity = '0';
        refreshIndicator.style.transform = 'translateY(-100%)';
    }
}

function handleTouchEnd() {
    if (!isPulling) return;
    isPulling = false;

    if (pullDistance >= PULL_THRESHOLD) {
        // Show refreshing state with smooth transition
        const pullText = refreshIndicator.querySelector('.pull-text');
        const refreshingText = refreshIndicator.querySelector('.refreshing-text');
        
        pullText.classList.add('hidden');
        refreshingText.classList.remove('hidden');

        // Keep indicator visible during refresh
        refreshIndicator.style.opacity = '1';
        refreshIndicator.style.transform = `translateY(${PULL_THRESHOLD * 0.5}px)`;

        // Trigger refresh
        window.forceCacheRefresh().finally(() => {
            // Smooth reset after refresh
            refreshIndicator.style.transition = 'transform 0.3s ease-out, opacity 0.3s ease-out';
            refreshIndicator.style.transform = 'translateY(-100%)';
            refreshIndicator.style.opacity = '0';
            
            setTimeout(() => {
                refreshingText.classList.add('hidden');
                pullText.classList.remove('hidden');
                refreshIndicator.style.transition = ''; // Reset transition
            }, 300);
        });
    } else {
        // Smooth reset without refreshing
        refreshIndicator.style.transition = 'transform 0.3s ease-out, opacity 0.3s ease-out';
        refreshIndicator.style.transform = 'translateY(-100%)';
        refreshIndicator.style.opacity = '0';
        setTimeout(() => {
            refreshIndicator.style.transition = ''; // Reset transition
        }, 300);
    }

    pullDistance = 0;
}

// Update the initializeApp function to include pull-to-refresh
async function initializeApp() {
    debugLog('Initializing app...');
    try {
        // Initialize pull-to-refresh
        initializePullToRefresh();
        
        // Add visibility change listener
        document.addEventListener('visibilitychange', handleVisibilityChange);
        
        // Initialize the Holodex client first
        debugLog('Initializing Holodex client...');
        holodexClient = await initializeHolodexClient();
        debugLog('Holodex client initialized:', holodexClient);
        
        if (!holodexClient) {
            throw new Error('Failed to initialize Holodex client');
        }
        
        // Initial status check
        debugLog('Starting initial live status check...');
        await safeCheckLiveStatus();
        
        // Set up interval for auto-refresh
        const autoRefreshInterval = setInterval(async () => {
            const now = new Date();
            if (!lastUpdateTime || (now - lastUpdateTime) >= UPDATE_INTERVAL) {
                debugLog('Running auto-refresh...');
                await safeCheckLiveStatus();
            }
        }, 60000); // Check every minute

        // Cleanup on page unload
        window.addEventListener('beforeunload', () => {
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            if (autoRefreshInterval) clearInterval(autoRefreshInterval);
            if (window.timeCounterInterval) clearInterval(window.timeCounterInterval);
        });
    } catch (error) {
        debugError('App initialization failed:', error);
        domRefs.liveStatus.innerHTML = `
            <div class="bg-purple-600 border-2 border-red-500 rounded-lg p-6">
                <p class="text-red-400">Failed to initialize application: ${error.message}</p>
                <button onclick="window.location.reload()" 
                        class="mt-4 bg-yellow-500 hover:bg-yellow-400 text-purple-900 font-semibold px-4 py-2 rounded">
                    Reload Page
                </button>
            </div>
        `;
    }
}

// Update the forceCacheRefresh function
window.forceCacheRefresh = async () => {
    debugLog('Force refreshing cache...');
    try {
        // Clear all cached data
        ['liveVideos', 'recentVideos', 'tweets', COLLABS_CACHE_KEY, CLIPS_CACHE_KEY, 
         ORIGINAL_SONGS_CACHE_KEY, COVER_SONGS_CACHE_KEY, TALENT_MERCH_CACHE_KEY].forEach(key => {
            localStorage.removeItem(key);
        });

        // Reset the Holodex client to ensure a fresh connection
        holodexClient = await initializeHolodexClient();
        
        // Force a check with the isForceRefresh flag
        await safeCheckLiveStatus(true);
        
        // Update the cache status display
        updateCacheStatus();
    } catch (error) {
        debugError('Failed to refresh cache:', error);
        domRefs.liveStatus.innerHTML = `
            <div class="bg-purple-600 border-2 border-red-500 rounded-lg p-6">
                <p class="text-red-400">Error refreshing data: ${error.message}</p>
                <button onclick="window.location.reload()" 
                        class="mt-4 bg-yellow-500 hover:bg-yellow-400 text-purple-900 font-semibold px-4 py-2 rounded">
                    Reload Page
                </button>
            </div>
        `;
    }
};

// Helper function to fetch with timeout
export async function fetchWithTimeout(url, options = {}, timeout = 10000) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);

    try {
        const response = await fetch(url, {
            ...options,
            signal: controller.signal
        });
        clearTimeout(id);
        return response;
    } catch (error) {
        clearTimeout(id);
        if (error.name === 'AbortError') {
            throw new Error(`Request timeout after ${timeout}ms`);
        }
        throw error;
    }
}

// Add at the beginning of the file
let bgMusic;
let isMuted = false;

// Initialize audio handling
function initializeAudio() {
    bgMusic = domRefs.bgMusic;
    const muteButton = domRefs.muteButton;
    const soundWaves = domRefs.soundWaves;
    
    // Load saved preferences immediately
    try {
        const savedPreferences = localStorage.getItem(PREFERENCES_KEY);
        debugLog('Loaded preferences:', savedPreferences);
        
        if (savedPreferences) {
            const { isMuted: savedMuted } = JSON.parse(savedPreferences);
            isMuted = savedMuted;
            
            // Apply muted state immediately
            bgMusic.muted = isMuted;
            soundWaves.style.display = isMuted ? 'none' : 'block';
            debugLog('Applied saved mute state:', isMuted);
        }
    } catch (error) {
        debugWarn('Error loading audio preferences:', error);
    }
    
    // Handle initial audio setup
    const initAudio = () => {
        bgMusic.volume = 0.25;
        bgMusic.muted = isMuted; // Ensure muted state is applied
        
        // Always start playing, but respect muted state
        bgMusic.play().catch(error => debugWarn("Audio autoplay failed:", error));
        
        document.removeEventListener('click', initAudio);
        debugLog('Audio initialized with muted state:', isMuted);
    };
    
    document.addEventListener('click', initAudio, { once: true });

    // Handle mute button clicks with debug logging
    muteButton.addEventListener('click', () => {
        isMuted = !isMuted;
        debugLog('Mute button clicked, new state:', isMuted);
        
        // Apply muted state and ensure playback
        bgMusic.muted = isMuted;
        soundWaves.style.display = isMuted ? 'none' : 'block';
        
        // If unmuting, ensure audio is playing
        if (!isMuted) {
            bgMusic.play().catch(error => debugWarn("Audio play failed:", error));
        }
        
        // Save preferences
        try {
            const preferences = JSON.stringify({ isMuted });
            localStorage.setItem(PREFERENCES_KEY, preferences);
            debugLog('Saved preferences:', preferences);
        } catch (error) {
            debugWarn('Error saving audio preferences:', error);
        }
    });
}

// Add this after the initializeAudio function
function initializeCreditsPopup() {
    const infoButton = domRefs.infoButton;
    const creditsPopup = domRefs.creditsPopup;
    const closeCredits = domRefs.closeCredits;

    // Show popup
    infoButton.addEventListener('click', () => {
        creditsPopup.classList.remove('hidden');
        // Add animation classes
        creditsPopup.classList.add('animate-fadeIn');
        creditsPopup.querySelector('.glass-effect').classList.add('animate-slideIn');
    });

    // Hide popup
    function hidePopup() {
        creditsPopup.classList.add('hidden');
        creditsPopup.classList.remove('animate-fadeIn');
        creditsPopup.querySelector('.glass-effect').classList.remove('animate-slideIn');
    }

    closeCredits.addEventListener('click', hidePopup);
    
    // Close when clicking outside
    creditsPopup.addEventListener('click', (e) => {
        if (e.target === creditsPopup) {
            hidePopup();
        }
    });

    // Close on escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !creditsPopup.classList.contains('hidden')) {
            hidePopup();
        }
    });
}

// Wait for DOM to be fully loaded, then initialize
document.addEventListener('DOMContentLoaded', () => {
    initializeAudio();
    initializeApp();  // Your existing initialization function
    initializeCreditsPopup();
});

// Add this helper function near the other date functions
function getLatestTime(video) {
    // Try all possible date fields
    const dates = [
        video.published_at,
        video.available_at,
        video.start_scheduled,
        video.start_actual,
        // Also try nested fields
        video.raw?.published_at,
        video.raw?.available_at,
        video.raw?.start_scheduled,
        video.raw?.start_actual
    ].filter(Boolean); // Remove null/undefined values

    if (dates.length === 0) {
        debugWarn('No valid date found for video:', video.title);
        return new Date(0); // Return oldest possible date if no valid date found
    }

    // Convert all dates to Date objects
    const dateTimes = dates.map(d => new Date(d));
    
    // Return the most recent date
    return new Date(Math.max(...dateTimes.map(d => d.getTime())));
}

function showSpecialPopup() {
  const now = new Date();
  const todayKey = now.toLocaleDateString();
  
  // Check local storage dismissal flag for today's date
  if (localStorage.getItem('specialPopupDismissed') === todayKey) {
    return;
  }
  
  // Check if date is Feb 14, 15, or 16 (months are 0-indexed, so February is month 1)
  if (now.getMonth() === 1 && (now.getDate() >= 14 && now.getDate() <= 16)) {
    // Create a full-screen overlay using Tailwind utility classes
    const overlay = document.createElement('div');
    overlay.id = 'specialPopupOverlay';
    overlay.className =
      'fixed inset-0 flex items-center justify-center z-50 bg-black bg-opacity-50';

    // Create the popup container with significantly increased width
    const popup = document.createElement('div');
    popup.id = 'specialPopup';
    popup.className =
      'card glass-effect rounded-xl p-8 text-center mx-4'; // Increased padding
    // Force a much wider width of 1200px
    popup.style.width = "1200px";
    popup.style.maxWidth = "95vw"; // Increased from 90vw to allow more width on mobile

    // Customize message based on the date
    let message = '';
    if (now.getDate() === 14) {
      message = "Tomorrow is Moona Hoshinova's birthday! 🎉";
    } else if (now.getDate() === 15) {
      message = "Happy birthday to my dearest Oshi, Moona Hoshinova! 🎂";
    } else if (now.getDate() === 16) {
      message = "Hope you had a wonderful birthday celebration, Moona! 🎊";
    }

    // Make the content larger too
    const content = document.createElement('p');
    content.className = 'text-yellow-300 text-4xl font-bold mb-4'; // Increased text size
    content.innerHTML = `
      ${message}<br>
      <span class="text-2xl text-white">Wishing you a magical celebration filled with joy 🎉💖</span>
    `;

    // Create a container for the "Don't show me this again today" checkbox
    const checkboxContainer = document.createElement('div');
    checkboxContainer.className = 'flex items-center justify-center mb-4';

    // Create the checkbox input element
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.id = 'dontShowAgain';
    checkbox.className = 'mr-2';

    // Create the label for the checkbox and update its text
    const checkboxLabel = document.createElement('label');
    checkboxLabel.htmlFor = 'dontShowAgain';
    checkboxLabel.className = 'text-yellow-300 text-sm';
    checkboxLabel.textContent = "Don't show me this again today";

    // Append the checkbox and label into the container
    checkboxContainer.appendChild(checkbox);
    checkboxContainer.appendChild(checkboxLabel);

    // Create a close button for the popup with themed styling
    const closeButton = document.createElement('button');
    closeButton.textContent = 'Close';
    closeButton.className =
      'mt-4 inline-block bg-yellow-500 hover:bg-yellow-400 text-purple-900 font-semibold px-6 py-3 rounded-xl transition-colors duration-200';
    closeButton.addEventListener('click', function () {
      // If the checkbox is checked, store the dismissal flag with today's date
      if (checkbox.checked) {
        localStorage.setItem('specialPopupDismissed', todayKey);
      }
      overlay.remove();
    });

    // Append the content, checkbox container, and close button to the popup container
    popup.appendChild(content);
    popup.appendChild(checkboxContainer);
    popup.appendChild(closeButton);

    // Append the popup container to the overlay
    overlay.appendChild(popup);

    // Append the overlay to the document body to display the popup
    document.body.appendChild(overlay);
  }
}

// When the DOM is fully loaded, check the date and show the popup if needed
document.addEventListener('DOMContentLoaded', function () {
  showSpecialPopup();
});
