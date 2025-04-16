import { debugError, debugLog, debugWarn, formatDateTime } from '../script.js';
import { TWITTER_USERNAME } from './constants.js';

export function parseTwitterDate(dateStr) {
    try {
        // Remove UTC and dot from the string
        const cleanDateStr = dateStr.replace(' UTC', '').replace(' · ', ' ');
        
        // Parse the UTC date
        const utcDate = new Date(cleanDateStr + ' UTC');
        
        // Convert to local timestamp
        const localTimestamp = utcDate.getTime();
        
        // Create new date object in local timezone
        const localDate = new Date(localTimestamp);
        
        debugLog('Date conversion:', {
            original: dateStr,
            cleaned: cleanDateStr,
            utc: utcDate.toISOString(),
            local: localDate.toLocaleString()
        });
        
        return localDate;
    } catch (error) {
        debugWarn('Error parsing date:', dateStr, error);
        return null;
    }
}

export async function scrapeNitterTweets() {
    debugLog('Scraping tweets from Nitter frontend...');

    // Only include a working proxy:
    const corsProxies = [
        'https://api.codetabs.com/v1/proxy?quest='
    ];

    // Try these Nitter instances in order
    const NITTER_INSTANCES = [
        'https://nitter.moonaroh.com',
        'https://nitter.privacydev.net'
    ];

    // Helper function to scrape tweets from a specific URL
    async function scrapeTweetsFromUrl(url, proxy) {
        const response = await fetch(`${proxy}${encodeURIComponent(url)}`);
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const html = await response.text();
        debugLog(`Got HTML response length for ${url}:`, html.length);
        
        // Create a DOM parser
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        
        // Find all timeline items within the timeline container
        const timelineItems = doc.querySelectorAll('.timeline .timeline-item');
        debugLog(`Found timeline items for ${url}:`, timelineItems.length);
        
        const tweets = [];
        
        // Extract the nitter base URL from the provided URL
        const urlObject = new URL(url);
        const nitterBase = `${urlObject.protocol}//${urlObject.hostname}`;
        
        for (const item of timelineItems) {
            try {
                // Skip pinned tweets
                const isPinned = item.querySelector('.pinned');
                if (isPinned) {
                    debugLog('Skipping pinned tweet');
                    continue;
                }

                // Check for reply
                const replyHeader = item.querySelector('.replying-to');
                const isReply = !!replyHeader;
                let replyTo = '';
                if (isReply) {
                    const replyUsername = replyHeader.querySelector('a')?.textContent?.trim();
                    if (replyUsername) {
                        replyTo = replyUsername;
                        debugLog('Found reply to:', replyTo);
                    }
                }

                // Check for retweet
                const retweetHeader = item.querySelector('.retweet-header');
                const isRetweet = !!retweetHeader;
                let retweetedFrom = '';
                if (isRetweet) {
                    // Get the original tweet's author
                    const originalAuthor = item.querySelector('.fullname')?.textContent?.trim();
                    const originalUsername = item.querySelector('.username')?.textContent?.trim();
                    if (originalUsername) {
                        retweetedFrom = originalUsername;
                        debugLog('Found retweet:', { 
                            author: originalAuthor,
                            username: originalUsername 
                        });
                    }
                }

                // Check for quote tweet
                const quoteTweet = item.querySelector('.quote');
                const isQuote = !!quoteTweet;
                let quotedFrom = '';
                let quotedTweetId = '';
                if (isQuote) {
                    const quoteUsername = quoteTweet.querySelector('.username')?.textContent.trim();
                    const quoteLink = quoteTweet.querySelector('a.quote-link')?.getAttribute('href');
                    if (quoteUsername) {
                        quotedFrom = quoteUsername;
                        quotedTweetId = quoteLink ? quoteLink.split('/status/')[1]?.split('#')[0] : '';
                        debugLog('Found quote tweet:', { from: quotedFrom, id: quotedTweetId });
                    }
                }

                // Get tweet content
                const contentElement = item.querySelector('.tweet-content');
                if (!contentElement) {
                    debugLog('No content element found');
                    continue;
                }
                let content = contentElement.textContent.trim();

                // Get tweet ID from the link
                const tweetLink = item.querySelector('a.tweet-link');
                const tweetId = tweetLink ? tweetLink.getAttribute('href').split('/status/')[1]?.split('#')[0] : null;
                if (!tweetId) {
                    debugLog('No tweet ID found');
                    continue;
                }

                // Get timestamp from tweet-date
                const dateElement = item.querySelector('.tweet-date a');
                const dateText = dateElement?.getAttribute('title'); // This contains the full date format
                if (!dateText) {
                    debugLog('No date found');
                    continue;
                }

                // Parse the date
                const date = parseTwitterDate(dateText);
                if (!date) {
                    debugLog('Invalid date:', dateText);
                    continue;
                }

                // Get tweet stats
                const stats = {
                    replies: parseInt(item.querySelector('.icon-comment')?.closest('.tweet-stat')?.textContent?.trim() || '0'),
                    retweets: parseInt(item.querySelector('.icon-retweet')?.closest('.tweet-stat')?.textContent?.trim() || '0'),
                    likes: parseInt(item.querySelector('.icon-heart')?.closest('.tweet-stat')?.textContent?.trim() || '0')
                };

                // Get media attachments
                const media = [];
                
                // Check for images
                const images = item.querySelectorAll('.attachments .attachment.image img, .gallery-row img');
                images.forEach(img => {
                    let url = img.getAttribute('src');
                    if (url && url.startsWith('/')) {
                        url = nitterBase + url;
                    }
                    if (url) {
                        media.push({
                            type: 'image',
                            url: url
                        });
                    }
                });

                // Check for videos
                const videos = item.querySelectorAll('.attachments .gallery-video video source, .gallery-video video source');
                videos.forEach(source => {
                    let url = source.getAttribute('src');
                    if (url && url.startsWith('/')) {
                        url = nitterBase + url;
                    }
                    if (url) {
                        media.push({
                            type: 'video',
                            url: url
                        });
                    }
                });

                tweets.push({
                    id: tweetId,
                    text: content,
                    timestamp: Math.floor(date.getTime() / 1000),
                    stats,
                    media,
                    isReply,
                    isRetweet,
                    isQuote,
                    replyTo,
                    retweetedFrom,
                    quotedFrom,
                    quotedTweetId
                });

            } catch (error) {
                debugWarn('Error parsing tweet:', error);
            }

        }

        return tweets;
    }

    // Try with each Nitter instance
    for (const NITTER_BASE of NITTER_INSTANCES) {
        debugLog(`Trying Nitter instance: ${NITTER_BASE}`);
        
        // Try with CORS proxies first for this instance
        for (const proxy of corsProxies) {
            try {
                // Fetch from both endpoints
                const [mainTweets, replyTweets] = await Promise.all([
                    scrapeTweetsFromUrl(`${NITTER_BASE}/${TWITTER_USERNAME}`, proxy),
                    scrapeTweetsFromUrl(`${NITTER_BASE}/${TWITTER_USERNAME}/with_replies`, proxy)
                ]);

                // Combine and deduplicate tweets
                const allTweets = [...mainTweets, ...replyTweets];
                const seenIds = new Set();
                const uniqueTweets = [];

                for (const tweet of allTweets) {
                    if (!seenIds.has(tweet.id)) {
                        seenIds.add(tweet.id);
                        uniqueTweets.push(tweet);
                    }
                }

                // Sort by timestamp and return if we have tweets
                if (uniqueTweets.length > 0) {
                    return {
                        tweets: uniqueTweets.sort((a, b) => b.timestamp - a.timestamp),
                        source: NITTER_BASE
                    };
                }
            } catch (error) {
                debugWarn(`Proxy ${proxy} with ${NITTER_BASE} failed:`, error);
                continue;
            }
        }

        // If all proxies fail for this instance, try direct fetch without proxy
        try {
            debugLog(`All proxies failed for ${NITTER_BASE}, attempting direct fetch...`);
            const [mainResponse, replyResponse] = await Promise.all([
                fetch(`${NITTER_BASE}/${TWITTER_USERNAME}`),
                fetch(`${NITTER_BASE}/${TWITTER_USERNAME}/with_replies`)
            ]);

            // If both responses are successful, process them
            if (mainResponse.ok && replyResponse.ok) {
                const [mainHtml, replyHtml] = await Promise.all([
                    mainResponse.text(),
                    replyResponse.text()
                ]);

                const mainTweets = await processTweetsHtml(mainHtml, NITTER_BASE);
                const replyTweets = await processTweetsHtml(replyHtml, NITTER_BASE);

                // Combine and deduplicate tweets
                const allTweets = [...mainTweets, ...replyTweets];
                const seenIds = new Set();
                const uniqueTweets = [];

                for (const tweet of allTweets) {
                    if (!seenIds.has(tweet.id)) {
                        seenIds.add(tweet.id);
                        uniqueTweets.push(tweet);
                    }
                }

                // Return tweets if we have any
                if (uniqueTweets.length > 0) {
                    return {
                        tweets: uniqueTweets.sort((a, b) => b.timestamp - a.timestamp),
                        source: NITTER_BASE
                    };
                }
            }
        } catch (error) {
            debugWarn(`Direct fetch from ${NITTER_BASE} failed:`, error);
        }
    }

    // If all instances fail, throw an error
    throw new Error('NITTER_UNAVAILABLE');
}

// Add new helper function to process HTML
export async function processTweetsHtml(html, nitterBase) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    
    // Find all timeline items within the timeline container
    const timelineItems = doc.querySelectorAll('.timeline .timeline-item');
    debugLog(`Found timeline items:`, timelineItems.length);
    
    const tweets = [];
    
    for (const item of timelineItems) {
        try {
            // Skip pinned tweets
            const isPinned = item.querySelector('.pinned');
            if (isPinned) {
                debugLog('Skipping pinned tweet');
                continue;
            }

            // Check for reply
            const replyHeader = item.querySelector('.replying-to');
            const isReply = !!replyHeader;
            let replyTo = '';
            if (isReply) {
                const replyUsername = replyHeader.querySelector('a')?.textContent?.trim();
                if (replyUsername) {
                    replyTo = replyUsername;
                    debugLog('Found reply to:', replyTo);
                }
            }

            // Check for retweet
            const retweetHeader = item.querySelector('.retweet-header');
            const isRetweet = !!retweetHeader;
            let retweetedFrom = '';
            if (isRetweet) {
                // Get the original tweet's author
                const originalAuthor = item.querySelector('.fullname')?.textContent?.trim();
                const originalUsername = item.querySelector('.username')?.textContent?.trim();
                if (originalUsername) {
                    retweetedFrom = originalUsername;
                    debugLog('Found retweet:', { 
                        author: originalAuthor,
                        username: originalUsername 
                    });
                }
            }

            // Check for quote tweet
            const quoteTweet = item.querySelector('.quote');
            const isQuote = !!quoteTweet;
            let quotedFrom = '';
            let quotedTweetId = '';
            if (isQuote) {
                const quoteUsername = quoteTweet.querySelector('.username')?.textContent.trim();
                const quoteLink = quoteTweet.querySelector('a.quote-link')?.getAttribute('href');
                if (quoteUsername) {
                    quotedFrom = quoteUsername;
                    quotedTweetId = quoteLink ? quoteLink.split('/status/')[1]?.split('#')[0] : '';
                    debugLog('Found quote tweet:', { from: quotedFrom, id: quotedTweetId });
                }
            }

            // Get tweet content
            const contentElement = item.querySelector('.tweet-content');
            if (!contentElement) {
                debugLog('No content element found');
                continue;
            }
            let content = contentElement.textContent.trim();

            // Get tweet ID from the link
            const tweetLink = item.querySelector('a.tweet-link');
            const tweetId = tweetLink ? tweetLink.getAttribute('href').split('/status/')[1]?.split('#')[0] : null;
            if (!tweetId) {
                debugLog('No tweet ID found');
                continue;
            }

            // Get timestamp from tweet-date
            const dateElement = item.querySelector('.tweet-date a');
            const dateText = dateElement?.getAttribute('title'); // This contains the full date format
            if (!dateText) {
                debugLog('No date found');
                continue;
            }

            // Parse the date
            const date = parseTwitterDate(dateText);
            if (!date) {
                debugLog('Invalid date:', dateText);
                continue;
            }

            // Get tweet stats
            const stats = {
                replies: parseInt(item.querySelector('.icon-comment')?.closest('.tweet-stat')?.textContent?.trim() || '0'),
                retweets: parseInt(item.querySelector('.icon-retweet')?.closest('.tweet-stat')?.textContent?.trim() || '0'),
                likes: parseInt(item.querySelector('.icon-heart')?.closest('.tweet-stat')?.textContent?.trim() || '0')
            };

            // Get media attachments
            const media = [];
            
            // Check for images
            const images = item.querySelectorAll('.attachments .attachment.image img, .gallery-row img');
            images.forEach(img => {
                let url = img.getAttribute('src');
                if (url && url.startsWith('/')) {
                    url = nitterBase + url;
                }
                if (url) {
                    media.push({
                        type: 'image',
                        url: url
                    });
                }
            });

            // Check for videos
            const videos = item.querySelectorAll('.attachments .gallery-video video source, .gallery-video video source');
            videos.forEach(source => {
                let url = source.getAttribute('src');
                if (url && url.startsWith('/')) {
                    url = nitterBase + url;
                }
                if (url) {
                    media.push({
                        type: 'video',
                        url: url
                    });
                }
            });

            tweets.push({
                id: tweetId,
                text: content,
                timestamp: Math.floor(date.getTime() / 1000),
                stats,
                media,
                isReply,
                isRetweet,
                isQuote,
                replyTo,
                retweetedFrom,
                quotedFrom,
                quotedTweetId
            });

        } catch (error) {
            debugWarn('Error parsing tweet:', error);
        }
    }

    return tweets;
}

// Update the getTweets function to handle the specific error
export async function getTweets() {
    try {
        // Try to get tweets from both sources
        const [scrapedResult, rssTweets] = await Promise.all([
            scrapeNitterTweets().catch(error => {
                if (error.message === 'NITTER_UNAVAILABLE') {
                    debugWarn('Nitter scraping failed:', error);
                    return { tweets: [], source: null };
                }
                throw error; // Re-throw other errors
            }),
            getRSSTweets().catch(error => {
                debugWarn('RSS fetch failed:', error);
                return [];
            })
        ]);
        
        const scrapedTweets = scrapedResult.tweets || [];
        const nitterSource = scrapedResult.source;
        
        debugLog(`Got ${scrapedTweets.length} scraped tweets from ${nitterSource} and ${rssTweets.length} RSS tweets`);

        // If both methods return empty arrays, show the error message
        if (scrapedTweets.length === 0 && rssTweets.length === 0) {
            return {
                error: true,
                message: 'Unable to fetch tweets at the moment, please try again later.'
            };
        }

        // Combine tweets from both sources
        const allTweets = [...scrapedTweets, ...rssTweets];
        
        // Deduplicate tweets by ID
        const seenIds = new Set();
        const uniqueTweets = [];
        
        for (const tweet of allTweets) {
            if (!seenIds.has(tweet.id)) {
                seenIds.add(tweet.id);
                uniqueTweets.push(tweet);
            }
        }
        
        // Sort by timestamp (newest first)
        const sortedTweets = uniqueTweets.sort((a, b) => b.timestamp - a.timestamp);
        
        // Return the sorted tweets with source information
        return {
            tweets: sortedTweets,
            source: nitterSource
        };
    } catch (error) {
        debugError('Error fetching tweets:', error);
        return {
            error: true,
            message: 'An error occurred while fetching tweets.'
        };
    }
}

// Add new helper function to get RSS tweets
export async function getRSSTweets() {
    // Only include a working proxy:
    const corsProxies = [
        'https://api.codetabs.com/v1/proxy?quest='
    ];

    // Try these Nitter instances in order (same as in scrapeNitterTweets)
    const NITTER_INSTANCES = [
        'https://nitter.moonaroh.com',
        'https://nitter.privacydev.net'
    ];

    // Try with each Nitter instance
    for (const NITTER_BASE of NITTER_INSTANCES) {
        debugLog(`Trying RSS from Nitter instance: ${NITTER_BASE}`);
        
        // Try with CORS proxies first for this instance
        for (const proxy of corsProxies) {
            try {
                // Fetch both RSS feeds
                const [mainResponse, repliesResponse] = await Promise.all([
                    fetch(proxy + encodeURIComponent(`${NITTER_BASE}/${TWITTER_USERNAME}/rss`)),
                    fetch(proxy + encodeURIComponent(`${NITTER_BASE}/${TWITTER_USERNAME}/with_replies/rss`))
                ]);

                if (!mainResponse.ok || !repliesResponse.ok) {
                    debugWarn(`Proxy ${proxy} with ${NITTER_BASE} failed with status: ${mainResponse.status}/${repliesResponse.status}`);
                    continue;
                }

                // Parse both feeds
                const parser = new DOMParser();
                const [mainXml, repliesXml] = await Promise.all([
                    parser.parseFromString(await mainResponse.text(), "text/xml"),
                    parser.parseFromString(await repliesResponse.text(), "text/xml")
                ]);

                // Verify both XMLs are valid
                if (mainXml.getElementsByTagName('parsererror').length > 0 || 
                    repliesXml.getElementsByTagName('parsererror').length > 0) {
                    debugWarn(`Proxy ${proxy} with ${NITTER_BASE} returned invalid XML`);
                    continue;
                }

                // Process tweets as before
                const mainItems = Array.from(mainXml.querySelectorAll('item'));
                const repliesItems = Array.from(repliesXml.querySelectorAll('item'));
                const allItems = [...mainItems, ...repliesItems];

                // Use a Set to track unique tweet IDs
                const seenIds = new Set();
                const tweets = [];

                // Add debug logging for feed contents
                debugLog(`Main feed items: ${mainItems.length}`);
                debugLog(`Replies feed items: ${repliesItems.length}`);
                debugLog(`Combined items: ${allItems.length}`);

                for (const item of allItems) {
                    try {
                        const link = item.querySelector('link')?.textContent || '';
                        const id = link.split('/status/')[1]?.split('#')[0];
                        
                        // Add debug logging for each item
                        debugLog(`Processing tweet: ${link} (ID: ${id})`);
                        
                        // Skip if we've already processed this tweet
                        if (!id || seenIds.has(id)) {
                            debugLog(`Skipping duplicate or invalid tweet: ${id}`);
                            continue;
                        }
                        seenIds.add(id);

                        // Rest of your existing tweet processing code
                        const title = item.querySelector('title')?.textContent || '';
                        const creator = item.querySelector('creator')?.textContent || `@${TWITTER_USERNAME}`;
                        const description = item.querySelector('description')?.textContent || '';
                        const pubDate = item.querySelector('pubDate')?.textContent;
                        
                        if (!link || !pubDate) continue;
                        
                        // Parse the description to extract text and links
                        const tempDiv = document.createElement('div');
                        tempDiv.innerHTML = description;
                        
                        // Get all paragraphs and links
                        const paragraphs = tempDiv.querySelectorAll('p');
                        const firstLink = tempDiv.querySelector('a')?.href;
                        
                        // Check if this is a Space
                        let isSpace = false;
                        let spaceInfo = null;
                        let mainText = '';
                        let isQuote = false;
                        let quotedTweet = null;

                        if (firstLink && (firstLink.includes('/spaces/') || title.includes('/spaces/'))) {
                            isSpace = true;
                            const spaceId = (firstLink || title).split('/spaces/')[1]?.split(/[/#]/)[0];
                            spaceInfo = {
                                id: spaceId,
                                url: `https://twitter.com/i/spaces/${spaceId}`
                            };
                            mainText = '🎙️ Started a Twitter Space';
                        } else {
                            // Regular tweet processing
                            mainText = paragraphs[0]?.textContent || '';
                            
                            // Check for quote tweet in second paragraph
                            if (paragraphs[1]) {
                                const quoteLink = paragraphs[1].querySelector('a')?.href;
                                if (quoteLink && !quoteLink.includes('/spaces/')) {
                                    isQuote = true;
                                    // Extract the quoted tweet ID from the link
                                    const quotedId = quoteLink.split('/status/')[1]?.split(/[#\?]/)[0];  // Split on # or ?
                                    const quotedAuthor = quoteLink.split('/')[3];
                                    quotedTweet = {
                                        id: quotedId,
                                        author: quotedAuthor
                                    };
                                }
                            }
                        }

                        // Process media as before
                        const media = Array.from(tempDiv.querySelectorAll('img, video'))
                            .map(element => {
                                let originalUrl = '';
                                
                                if (element.tagName.toLowerCase() === 'video') {
                                    // Get URL from source element inside video
                                    const source = element.querySelector('source');
                                    originalUrl = source?.getAttribute('src') || '';
                                    
                                    // Extract video filename from Nitter URL
                                    const videoMatch = originalUrl.match(/video\.twimg\.com%2Ftweet_video%2F([^.]+\.mp4)/);
                                    if (videoMatch) {
                                        const videoUrl = `https://video.twimg.com/tweet_video/${videoMatch[1]}`;
                                        return {
                                            type: 'video',
                                            url: videoUrl
                                        };
                                    }
                                } else {
                                    // Handle images
                                    originalUrl = element.src || '';
                                    const mediaMatch = originalUrl.match(/\/media%2F([^.]+\.[^?]+)/);
                                    if (mediaMatch) {
                                        const imageUrl = `https://pbs.twimg.com/media/${mediaMatch[1]}`; // Create the image URL
                                        return {
                                            type: 'image',
                                            url: imageUrl
                                        };
                                    }
                                }
                                return null;
                            })
                            .filter(Boolean);
                        
                        const isRetweet = title.startsWith('RT by');
                        const isReply = title.startsWith('R to');
                        let replyTo = '';
                        
                        if (isReply) {
                            replyTo = title.split('R to ')[1].split(':')[0].trim();
                        }

                        tweets.push({
                            id,
                            text: mainText,
                            isRetweet,
                            isReply,
                            isQuote,
                            isSpace,
                            replyTo,
                            quotedTweet,
                            spaceInfo,
                            originalAuthor: creator,
                            timestamp: new Date(pubDate).getTime() / 1000,
                            media
                        });

                    } catch (itemError) {
                        debugWarn('Error processing tweet:', itemError);
                        continue;
                    }
                }

                // After the loop, sort and slice
                return tweets
                    .sort((a, b) => b.timestamp - a.timestamp)
                    .slice(0, 6); // Changed from 5 to 6

            } catch (error) {
                debugWarn(`Proxy ${proxy} with ${NITTER_BASE} failed:`, error);
                continue;
            }
        }

        // If all proxies fail for this instance, try direct fetch without proxy
        try {
            debugLog(`All proxies failed for ${NITTER_BASE}, attempting direct RSS fetch...`);
            const [mainResponse, repliesResponse] = await Promise.all([
                fetch(`${NITTER_BASE}/${TWITTER_USERNAME}/rss`),
                fetch(`${NITTER_BASE}/${TWITTER_USERNAME}/with_replies/rss`)
            ]);

            if (!mainResponse.ok || !repliesResponse.ok) {
                debugWarn(`Direct RSS fetch from ${NITTER_BASE} failed with status: ${mainResponse.status}/${repliesResponse.status}`);
                continue;
            }

            // Process RSS responses
            const parser = new DOMParser();
            const [mainXml, repliesXml] = await Promise.all([
                parser.parseFromString(await mainResponse.text(), "text/xml"),
                parser.parseFromString(await repliesResponse.text(), "text/xml")
            ]);

            // Verify both XMLs are valid
            if (mainXml.getElementsByTagName('parsererror').length > 0 || 
                repliesXml.getElementsByTagName('parsererror').length > 0) {
                debugWarn(`Direct RSS fetch from ${NITTER_BASE} returned invalid XML`);
                continue;
            }

            // Process tweets as before
            const mainItems = Array.from(mainXml.querySelectorAll('item'));
            const repliesItems = Array.from(repliesXml.querySelectorAll('item'));
            const allItems = [...mainItems, ...repliesItems];

            // Use a Set to track unique tweet IDs
            const seenIds = new Set();
            const tweets = [];

            // Add debug logging for feed contents
            debugLog(`Main feed items: ${mainItems.length}`);
            debugLog(`Replies feed items: ${repliesItems.length}`);
            debugLog(`Combined items: ${allItems.length}`);

            for (const item of allItems) {
                try {
                    const link = item.querySelector('link')?.textContent || '';
                    const id = link.split('/status/')[1]?.split('#')[0];
                    
                    // Add debug logging for each item
                    debugLog(`Processing tweet: ${link} (ID: ${id})`);
                    
                    // Skip if we've already processed this tweet
                    if (!id || seenIds.has(id)) {
                        debugLog(`Skipping duplicate or invalid tweet: ${id}`);
                        continue;
                    }
                    seenIds.add(id);

                    // Rest of your existing tweet processing code
                    const title = item.querySelector('title')?.textContent || '';
                    const creator = item.querySelector('creator')?.textContent || `@${TWITTER_USERNAME}`;
                    const description = item.querySelector('description')?.textContent || '';
                    const pubDate = item.querySelector('pubDate')?.textContent;
                    
                    if (!link || !pubDate) continue;
                    
                    // Parse the description to extract text and links
                    const tempDiv = document.createElement('div');
                    tempDiv.innerHTML = description;
                    
                    // Get all paragraphs and links
                    const paragraphs = tempDiv.querySelectorAll('p');
                    const firstLink = tempDiv.querySelector('a')?.href;
                    
                    // Check if this is a Space
                    let isSpace = false;
                    let spaceInfo = null;
                    let mainText = '';
                    let isQuote = false;
                    let quotedTweet = null;

                    if (firstLink && (firstLink.includes('/spaces/') || title.includes('/spaces/'))) {
                        isSpace = true;
                        const spaceId = (firstLink || title).split('/spaces/')[1]?.split(/[/#]/)[0];
                        spaceInfo = {
                            id: spaceId,
                            url: `https://twitter.com/i/spaces/${spaceId}`
                        };
                        mainText = '🎙️ Started a Twitter Space';
                    } else {
                        // Regular tweet processing
                        mainText = paragraphs[0]?.textContent || '';
                        
                        // Check for quote tweet in second paragraph
                        if (paragraphs[1]) {
                            const quoteLink = paragraphs[1].querySelector('a')?.href;
                            if (quoteLink && !quoteLink.includes('/spaces/')) {
                                isQuote = true;
                                // Extract the quoted tweet ID from the link
                                const quotedId = quoteLink.split('/status/')[1]?.split(/[#\?]/)[0];  // Split on # or ?
                                const quotedAuthor = quoteLink.split('/')[3];
                                quotedTweet = {
                                    id: quotedId,
                                    author: quotedAuthor
                                };
                            }
                        }
                    }

                    // Process media as before
                    const media = Array.from(tempDiv.querySelectorAll('img, video'))
                        .map(element => {
                            let originalUrl = '';
                            
                            if (element.tagName.toLowerCase() === 'video') {
                                // Get URL from source element inside video
                                const source = element.querySelector('source');
                                originalUrl = source?.getAttribute('src') || '';
                                
                                // Extract video filename from Nitter URL
                                const videoMatch = originalUrl.match(/video\.twimg\.com%2Ftweet_video%2F([^.]+\.mp4)/);
                                if (videoMatch) {
                                    const videoUrl = `https://video.twimg.com/tweet_video/${videoMatch[1]}`;
                                    return {
                                        type: 'video',
                                        url: videoUrl
                                    };
                                }
                            } else {
                                // Handle images
                                originalUrl = element.src || '';
                                const mediaMatch = originalUrl.match(/\/media%2F([^.]+\.[^?]+)/);
                                if (mediaMatch) {
                                    const imageUrl = `https://pbs.twimg.com/media/${mediaMatch[1]}`; // Create the image URL
                                    return {
                                        type: 'image',
                                        url: imageUrl
                                    };
                                }
                            }
                            return null;
                        })
                        .filter(Boolean);
                    
                    const isRetweet = title.startsWith('RT by');
                    const isReply = title.startsWith('R to');
                    let replyTo = '';
                    
                    if (isReply) {
                        replyTo = title.split('R to ')[1].split(':')[0].trim();
                    }

                    tweets.push({
                        id,
                        text: mainText,
                        isRetweet,
                        isReply,
                        isQuote,
                        isSpace,
                        replyTo,
                        quotedTweet,
                        spaceInfo,
                        originalAuthor: creator,
                        timestamp: new Date(pubDate).getTime() / 1000,
                        media
                    });

                } catch (itemError) {
                    debugWarn('Error processing tweet:', itemError);
                    continue;
                }
            }

            // After the loop, sort and slice
            return tweets
                .sort((a, b) => b.timestamp - a.timestamp)
                .slice(0, 6);

        } catch (error) {
            debugWarn(`Direct RSS fetch from ${NITTER_BASE} failed:`, error);
            // Continue to try the next instance
        }
    }

    // If all instances fail, throw an error
    throw new Error('RSS_FETCH_FAILED');
}

// Helper function to format tweet text
export function formatTweetText(text) {
    return text
        // Remove links to nitter
        .replace(/https?:\/\/nitter\.[^\s]+/g, '')
        // Convert newlines to HTML breaks
        .replace(/\n/g, '<br>')
        // Make hashtags yellow and clickable
        .replace(/#(\w+)/g, '<span class="text-yellow-300">#$1</span>')
        // Clean up extra spaces and line breaks
        .replace(/(<br>){3,}/g, '<br><br>')
        .trim();
}

// Update the tweet processing code to better handle retweets
export function generateTweetHTML(tweet) {
    const tweetHeader = tweet.isRetweet ? 
        `<span class="text-yellow-200 text-sm">🔄 Retweeted from @${tweet.retweetedFrom?.replace(/^@/, '') || tweet.originalAuthor?.replace(/^@/, '') || TWITTER_USERNAME}</span>` :
        tweet.isReply ?
        `<span class="text-yellow-200 text-sm">↩️ Replying to @${tweet.replyTo?.replace(/^@/, '') || 'unknown'}</span>` :
        tweet.isSpace ?
        `<span class="text-yellow-200 text-sm">🎙️ Twitter Space</span>` :
        tweet.isQuote ?
        `<span class="text-yellow-200 text-sm">💬 Quoted @${tweet.quotedFrom?.replace(/^@/, '') || TWITTER_USERNAME}</span>` :
        `<span class="text-yellow-200 text-sm">@${tweet.originalAuthor?.replace(/^@/, '') || TWITTER_USERNAME}</span>`;

    return `
        <div class="card glass-effect rounded-2xl p-4 md:p-6 relative">
            <div class="flex items-center mb-2">
                ${tweetHeader}
            </div>
            <p class="text-sm md:text-base text-yellow-100 mb-3">${formatTweetText(tweet.text)}</p>
            
            ${tweet.isQuote ? `
                <div class="border border-yellow-500 rounded-lg p-3 mb-3 bg-purple-500">
                    <p class="text-sm text-yellow-200 mb-1">${tweet.quotedFrom?.replace(/^@/, '') || TWITTER_USERNAME}</p>
                    <a href="https://x.com/${tweet.quotedFrom?.replace(/^@/, '') || TWITTER_USERNAME}/status/${tweet.quotedTweet?.id || tweet.quotedTweetId || tweet.id}" 
                       target="_blank" 
                       class="text-sm text-yellow-300 hover:text-yellow-400">
                        View quoted tweet
                    </a>
                </div>
            ` : ''}

            ${tweet.spaceInfo ? `
                <div class="border border-yellow-500 rounded-lg p-3 mb-3 bg-purple-500">
                    <p class="text-sm font-semibold text-yellow-300 mb-2">🎙️ Twitter Space</p>
                    <a href="${tweet.spaceInfo.url}" 
                       target="_blank" 
                       class="inline-block bg-yellow-500 text-purple-900 px-4 py-2 text-sm rounded-lg hover:bg-yellow-600 transition-colors touch-feedback">
                        Join Space
                    </a>
                </div>
            ` : ''}

            ${tweet.media.length > 0 ? `
                <div class="mb-3 ${tweet.media.length > 1 ? 'grid grid-cols-2 gap-2' : ''}">
                    ${tweet.media.map(item => {
                        if (item.type === 'video') {
                            return `
                                <video autoplay loop muted playsinline 
                                       class="rounded-lg w-full object-contain"
                                       style="max-height: 400px;">
                                    <source src="${item.url}" type="video/mp4">
                                </video>
                            `;
                        } else {
                            return `
                                <img src="${item.url}" 
                                     alt="Tweet media" 
                                     class="rounded-lg w-full object-contain"
                                     style="max-height: 400px;"
                                     loading="lazy">
                            `;
                        }
                    }).join('')}
                </div>
            ` : ''}
            
            <div class="space-y-1 mb-4">
                <p class="text-xs text-yellow-200">Posted: ${formatDateTime(new Date(tweet.timestamp * 1000))}</p>
            </div>
            <a href="https://x.com/${tweet.originalAuthor ? tweet.originalAuthor.replace('@', '') : TWITTER_USERNAME}/status/${tweet.id}" 
               target="_blank" 
               class="inline-block w-full bg-yellow-500 hover:bg-yellow-400 text-purple-900 font-semibold px-6 py-3 rounded-xl text-center transition-colors duration-200">
                View Tweet
            </a>
        </div>
    `;
}