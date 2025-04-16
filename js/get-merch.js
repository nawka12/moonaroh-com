import { debugLog, debugError, debugWarn, fetchWithTimeout } from '../script.js';
import { TALENT_MERCH_CACHE_KEY } from './cache-keys.js';
import { cache } from './cache.js';
import { domRefs } from './constants.js';

export async function getTalentMerch() {
    // Check if a background fetch is already in progress
    if (window.backgroundFetchInProgress) {
        debugLog('Background fetch already in progress, returning cached data if available');
        try {
            // Use the cache utility instead of directly accessing localStorage
            const cachedMerch = cache.get(TALENT_MERCH_CACHE_KEY);
            if (cachedMerch && Array.isArray(cachedMerch) && cachedMerch.length > 0) {
                debugLog(`Using cached merchandise data from cache utility`);
                return cachedMerch;
            }
            
            // Fallback to checking old cache format
            const cachedMerchData = localStorage.getItem(TALENT_MERCH_CACHE_KEY);
            if (cachedMerchData) {
                const parsedData = JSON.parse(cachedMerchData);
                const cacheTime = parsedData.timestamp || 0;
                const currentTime = new Date().getTime();
                const cacheAgeHours = (currentTime - cacheTime) / (1000 * 60 * 60);
                
                if (parsedData.data && parsedData.data.length > 0) {
                    debugLog(`Using cached merchandise data from localStorage (${cacheAgeHours.toFixed(2)} hours old)`);
                    // Update the cache using the new format
                    cache.set(TALENT_MERCH_CACHE_KEY, parsedData.data);
                    return parsedData.data;
                }
            }
        } catch (e) {
            debugError('Error reading cached data:', e);
        }
    }

    // Create a wrapper that adds an overall timeout
    const OVERALL_TIMEOUT = 3000; // 3 seconds max for the main operation
    let backgroundFetchInProgress = false;
    
    // Create a promise that rejects after the timeout
    const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Merchandise fetching timed out')), OVERALL_TIMEOUT);
    });
    
    // The main fetch function stays the same
    const fetchMerchPromise = async () => {
        try {
            debugLog('Fetching Moona merchandise data from Hololive shop...');
            
            // Check if we have cached data from localStorage and if it's still fresh (less than 12 hours old)
            const cachedMerchData = localStorage.getItem(TALENT_MERCH_CACHE_KEY);
            if (cachedMerchData) {
                try {
                    const parsedData = JSON.parse(cachedMerchData);
                    const cacheTime = parsedData.timestamp || 0;
                    const currentTime = new Date().getTime();
                    const cacheAgeHours = (currentTime - cacheTime) / (1000 * 60 * 60);
                    
                    // If cache is less than 12 hours old, use it
                    if (cacheAgeHours < 12 && parsedData.data && parsedData.data.length > 0) {
                        debugLog(`Using cached merchandise data (${cacheAgeHours.toFixed(2)} hours old)`);
                        return parsedData.data;
                    } else {
                        debugLog('Cache expired or empty, fetching fresh data');
                    }
                } catch (cacheError) {
                    debugError('Error parsing cached merchandise data:', cacheError);
                }
            }
            
            // Fetch directly from the Hololive shop instead of the local file
            const shopUrl = 'https://shop.hololivepro.com/en/collections/moonahoshinova';
            const corsProxyUrl = 'https://api.codetabs.com/v1/proxy?quest=';
            const backupCorsProxyUrl = 'https://corsproxy.io/?';
            
            let html = '';
            let response;
            
            // Define timeout for merchandise fetch (10 seconds)
            const MERCH_FETCH_TIMEOUT = 10000; // 10 seconds
            
            // Try the first CORS proxy
            try {
                debugLog('Trying primary CORS proxy...');
                response = await fetchWithTimeout(
                    `${corsProxyUrl}${encodeURIComponent(shopUrl)}`, 
                    {}, 
                    MERCH_FETCH_TIMEOUT
                );
                
                if (response.ok) {
                    html = await response.text();
                    debugLog('Successfully fetched data with primary CORS proxy');
                } else {
                    throw new Error(`Primary proxy failed: ${response.status} ${response.statusText}`);
                }
            } catch (primaryProxyError) {
                debugError('Primary CORS proxy failed:', primaryProxyError);
                
                // Try the backup CORS proxy
                try {
                    debugLog('Trying backup CORS proxy...');
                    response = await fetchWithTimeout(
                        `${backupCorsProxyUrl}${encodeURIComponent(shopUrl)}`, 
                        {}, 
                        MERCH_FETCH_TIMEOUT
                    );
                    
                    if (response.ok) {
                        html = await response.text();
                        debugLog('Successfully fetched data with backup CORS proxy');
                    } else {
                        throw new Error(`Backup proxy failed: ${response.status} ${response.statusText}`);
                    }
                } catch (backupProxyError) {
                    debugError('Backup CORS proxy failed:', backupProxyError);
                    
                    // Try direct fetch without proxy as a last resort (like in Nitter scrape)
                    try {
                        debugLog('All CORS proxies failed, attempting direct fetch...');
                        
                        // Try using fetch directly
                        response = await fetchWithTimeout(
                            shopUrl,
                            {
                                headers: {
                                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                                    'Accept': 'text/html,application/xhtml+xml,application/xml',
                                    'Accept-Language': 'en-US,en;q=0.9'
                                }
                            },
                            MERCH_FETCH_TIMEOUT
                        );
                        
                        if (response.ok) {
                            html = await response.text();
                            debugLog('Successfully fetched data with direct fetch');
                        } else {
                            throw new Error(`Direct fetch failed: ${response.status} ${response.statusText}`);
                        }
                    } catch (directFetchError) {
                        debugError('Direct fetch failed:', directFetchError);
                        // Now truly give up and throw the error
                        throw new Error('Could not fetch merchandise data from any source');
                    }
                }
            }
            
            // Create a DOM parser to extract the merchandise data
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');
            
            // Find all merchandise items
            const merchItems = [];
            const itemElements = doc.querySelectorAll('.Item_inner');
            
            itemElements.forEach(item => {
                try {
                    // Check if the item is sold out (has thumb_disable class)
                    const thumbDisable = item.querySelector('.thumb_disable');
                    if (thumbDisable) {
                        debugLog('Skipping sold out item (thumb_disable found)');
                        return; // Skip this item as it's sold out
                    }
                    
                    // Extract item details
                    const titleElement = item.querySelector('.Item_body');
                    const imagesContainer = item.querySelector('.Item_images');
                    const primaryImage = imagesContainer?.querySelector('.primary-image');
                    const secondaryImage = imagesContainer?.querySelector('.secondary-image');
                    const priceElement = item.querySelector('.Item_info_price');
                    
                    // Get data
                    const title = titleElement ? titleElement.textContent.trim() : '';
                    const imageUrl = primaryImage ? primaryImage.getAttribute('src') : '';
                    const imageAlt = primaryImage ? primaryImage.getAttribute('alt') : '';
                    const secondaryImageUrl = secondaryImage ? secondaryImage.getAttribute('src') : '';
                    const price = priceElement ? priceElement.textContent.trim() : '';
                    const itemUrl = item.getAttribute('href');
                    
                    // Add to items array
                    merchItems.push({
                        title,
                        price,
                        imageUrl: imageUrl.startsWith('//') ? 'https:' + imageUrl : imageUrl,
                        secondaryImageUrl: secondaryImageUrl && secondaryImageUrl.startsWith('//') ? 'https:' + secondaryImageUrl : secondaryImageUrl,
                        itemUrl: itemUrl.startsWith('/') ? 'https://shop.hololivepro.com' + itemUrl : itemUrl,
                        imageAlt
                    });
                } catch (itemError) {
                    debugError('Error processing merchandise item:', itemError);
                }
            });
            
            debugLog(`Found ${merchItems.length} Moona merchandise items (excluding sold out items)`);
            
            // If no items were found, try a fallback approach with a different selector
            if (merchItems.length === 0) {
                const productCards = doc.querySelectorAll('.product-card');
                productCards.forEach(card => {
                    try {
                        // Check if the item is sold out (has thumb_disable class)
                        const thumbDisable = card.querySelector('.thumb_disable');
                        if (thumbDisable) {
                            debugLog('Skipping sold out item in fallback (thumb_disable found)');
                            return; // Skip this item as it's sold out
                        }
                        
                        const titleElement = card.querySelector('.product-card__title');
                        const imageElement = card.querySelector('.product-card__image img');
                        const priceElement = card.querySelector('.product-card__price');
                        const linkElement = card.querySelector('a');
                        
                        const title = titleElement ? titleElement.textContent.trim() : '';
                        const imageUrl = imageElement ? imageElement.getAttribute('src') : '';
                        const imageAlt = imageElement ? imageElement.getAttribute('alt') : '';
                        const price = priceElement ? priceElement.textContent.trim() : '';
                        const itemUrl = linkElement ? linkElement.getAttribute('href') : '';
                        
                        merchItems.push({
                            title,
                            price,
                            imageUrl: imageUrl.startsWith('//') ? 'https:' + imageUrl : imageUrl,
                            secondaryImageUrl: '',
                            itemUrl: itemUrl.startsWith('/') ? 'https://shop.hololivepro.com' + itemUrl : itemUrl,
                            imageAlt
                        });
                    } catch (cardError) {
                        debugError('Error processing product card:', cardError);
                    }
                });
                
                debugLog(`Fallback found ${merchItems.length} Moona merchandise items (excluding sold out items)`);
            }
            
            // If still no items, try a more generic approach
            if (merchItems.length === 0) {
                debugLog('Using most generic selector approach as last resort');
                // Look for any product elements with images
                const productElements = Array.from(doc.querySelectorAll('a[href*="product"]'));
                
                for (const element of productElements) {
                    try {
                        // Only include items that might be related to Moona
                        const href = element.getAttribute('href') || '';
                        if (!href.includes('moona') && !href.includes('hoshinova') && !href.includes('moonahoshinova')) {
                            continue;
                        }
                        
                        // Check if the item is sold out (has thumb_disable class)
                        const thumbDisable = element.querySelector('.thumb_disable');
                        if (thumbDisable) {
                            debugLog('Skipping sold out item in generic approach (thumb_disable found)');
                            continue; // Skip this item as it's sold out
                        }
                        
                        const imgElement = element.querySelector('img');
                        const titleElement = element.querySelector('h3, .title, .name');
                        const priceElement = element.querySelector('.price');
                        
                        const title = titleElement ? titleElement.textContent.trim() : 'Moona Merch Item';
                        const imageUrl = imgElement ? imgElement.getAttribute('src') : '';
                        const imageAlt = imgElement ? imgElement.getAttribute('alt') : '';
                        const price = priceElement ? priceElement.textContent.trim() : '';
                        
                        merchItems.push({
                            title,
                            price,
                            imageUrl: imageUrl.startsWith('//') ? 'https:' + imageUrl : imageUrl,
                            secondaryImageUrl: '',
                            itemUrl: href.startsWith('/') ? 'https://shop.hololivepro.com' + href : href,
                            imageAlt
                        });
                    } catch (genericError) {
                        debugError('Error in generic processing:', genericError);
                    }
                }
                
                debugLog(`Generic approach found ${merchItems.length} Moona merchandise items (excluding sold out items)`);
            }
            
            // Save the fetched data to localStorage with a timestamp
            if (merchItems.length > 0) {
                try {
                    // Save to both old and new cache formats
                    const cacheData = {
                        timestamp: new Date().getTime(),
                        data: merchItems
                    };
                    localStorage.setItem(TALENT_MERCH_CACHE_KEY, JSON.stringify(cacheData));
                    
                    // Also save to cache utility
                    cache.set(TALENT_MERCH_CACHE_KEY, merchItems);
                    
                    debugLog('Merchandise data cached successfully');
                } catch (cacheError) {
                    debugError('Error caching merchandise data:', cacheError);
                }
            }
            
            return merchItems;
        } catch (error) {
            debugError('Error fetching Moona merchandise:', error);
            return [];
        }
    };
    
    // Function to perform background fetch
    const performBackgroundFetch = async () => {
        try {
            debugLog('Performing background fetch for merchandise...');
            backgroundFetchInProgress = true;
            
            // Execute the full fetch operation
            const merchItems = await fetchMerchPromise();
            
            // Update the cache with new data if successful
            if (merchItems && merchItems.length > 0) {
                try {
                    const cacheData = {
                        timestamp: new Date().getTime(),
                        data: merchItems
                    };
                    localStorage.setItem(TALENT_MERCH_CACHE_KEY, JSON.stringify(cacheData));
                    cache.set(TALENT_MERCH_CACHE_KEY, merchItems);
                    debugLog('Merchandise data updated from background fetch successfully');
                    
                    // Update the UI with the new merchandise data
                    debugLog('Updating UI with new merchandise data...');
                    
                    // Generate the HTML for the merchandise section
                    let merchHTML = '';
                    if (merchItems && merchItems.length > 0) {
                        merchHTML = `
                            <div class="grid-container mb-12 merch-container">
                                <div class="scroll-container">
                                    ${merchItems.map(item => `
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
                                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002-2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"></path>
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
                        merchHTML = `
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
                    
                    // Find the merchandise container and update it
                    const merchSectionTitle = Array.from(document.querySelectorAll('.section-title')).find(el => el.textContent.includes('Moona Merch'));
                    if (merchSectionTitle) {
                        // Get the parent container (the section title container)
                        const sectionContainer = merchSectionTitle.closest('div');
                        
                        // Look for both possible containers - the merch data or the empty message
                        const merchContainer = document.querySelector('.merch-container');
                        const emptyContainer = document.querySelector('.merch-empty-container');
                        
                        if (merchContainer) {
                            // If we already have a merchandise container, replace it
                            merchContainer.outerHTML = merchHTML;
                            debugLog('Replaced existing merchandise container with new data');
                        } else if (emptyContainer) {
                            // If we have the empty message container, replace it
                            emptyContainer.outerHTML = merchHTML;
                            debugLog('Replaced empty message container with merchandise data');
                        } else {
                            // If neither container exists, insert after the section title
                            sectionContainer.insertAdjacentHTML('afterend', merchHTML);
                            debugLog('Created new merchandise container with fresh data');
                        }
                        
                        // Show a temporary notification that data has been updated
                        const notification = document.createElement('div');
                        notification.className = 'fixed bottom-4 right-4 bg-yellow-500 text-purple-900 p-4 rounded-lg shadow-lg z-50';
                        notification.innerHTML = `
                            <div class="flex items-center">
                                <svg class="w-6 h-6 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path>
                                </svg>
                                <span class="font-bold">Merchandise data updated</span>
                            </div>
                        `;
                        document.body.appendChild(notification);
                        
                        // Remove the notification after 3 seconds
                        setTimeout(() => {
                            notification.remove();
                        }, 3000);
                    } else {
                        // Entire merchandise section is missing, try to find a good insertion point
                        debugLog('Merchandise section not found, looking for insertion point');
                        
                        // Find the main content container
                        const mainContent = domRefs.liveStatus;
                        if (mainContent) {
                            // Create the full merchandise section HTML
                            const fullMerchSection = `
                                <div class="flex flex-col items-center mb-8">
                                    <h2 class="section-title text-2xl md:text-3xl font-bold text-yellow-300">Moona Merch</h2>
                                    <span class="text-xs text-yellow-200 italic opacity-75">Official hololive Shop</span>
                                </div>
                                ${merchHTML}
                            `;
                            
                            // Append to the main content area
                            mainContent.insertAdjacentHTML('beforeend', fullMerchSection);
                            debugLog('Created full merchandise section at the end of main content');
                            
                            // Show notification
                            const notification = document.createElement('div');
                            notification.className = 'fixed bottom-4 right-4 bg-yellow-500 text-purple-900 p-4 rounded-lg shadow-lg z-50';
                            notification.innerHTML = `
                                <div class="flex items-center">
                                    <svg class="w-6 h-6 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path>
                                    </svg>
                                    <span class="font-bold">Merchandise data added</span>
                                </div>
                            `;
                            document.body.appendChild(notification);
                            
                            // Remove notification after 3 seconds
                            setTimeout(() => {
                                notification.remove();
                            }, 3000);
                        } else {
                            debugError('Could not find main content to add merchandise section');
                        }
                    }
                } catch (cacheError) {
                    debugError('Error caching merchandise data from background fetch:', cacheError);
                }
            }
        } catch (error) {
            debugError('Background merchandise fetch failed:', error);
        } finally {
            // Make sure we reset the flag regardless of success or failure
            backgroundFetchInProgress = false;
        }
    };
    
    // Race the fetch promise against the timeout
    try {
        const result = await Promise.race([fetchMerchPromise(), timeoutPromise]);
        // We got a successful result, no need for background fetch
        return result;
    } catch (error) {
        debugError('Merchandise operation timed out or failed:', error);
        
        // Start background fetch if it timed out and no background fetch is in progress
        if (error.message === 'Merchandise fetching timed out' && !backgroundFetchInProgress && !window.backgroundFetchInProgress) {
            debugLog('Starting background fetch for merchandise...');
            // Set global flag
            window.backgroundFetchInProgress = true;
            // Don't await this - let it run in background
            performBackgroundFetch().finally(() => {
                window.backgroundFetchInProgress = false;
            });
        }
        
        // Try to return cached merchandise regardless of age as a fallback
        try {
            // First try the cache utility
            const cachedMerch = cache.get(TALENT_MERCH_CACHE_KEY);
            if (cachedMerch && Array.isArray(cachedMerch) && cachedMerch.length > 0) {
                debugLog('Using cached merchandise from cache utility as fallback after timeout');
                return cachedMerch;
            }
            
            // Fall back to the old localStorage approach
            const cachedMerchData = localStorage.getItem(TALENT_MERCH_CACHE_KEY);
            if (cachedMerchData) {
                const parsedData = JSON.parse(cachedMerchData);
                if (parsedData.data && parsedData.data.length > 0) {
                    debugLog('Using cached merchandise data from localStorage as fallback after timeout');
                    // Update the cache utility with this data
                    cache.set(TALENT_MERCH_CACHE_KEY, parsedData.data);
                    return parsedData.data;
                }
            }
        } catch (cacheError) {
            debugError('Error using fallback cache after timeout:', cacheError);
        }
        
        return [];
    }
}