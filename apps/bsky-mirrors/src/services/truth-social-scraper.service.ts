import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { TweetData } from '../types';
import { ScraperService } from './scraper-service';

puppeteer.use(StealthPlugin());

export class TruthSocialScraperService implements ScraperService {
  private browser: any = null;
  private readonly DEBUG: boolean = false;
  private lastScrapeTime: Map<string, Date> = new Map();

  async initialize(): Promise<void> {
    this.browser = await puppeteer.connect({
      browserURL: 'http://localhost:9222',
      defaultViewport: null,
    });
  }

  async cleanup(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
    }
  }

  async getLatestTweets(truthProfileUrl: string): Promise<TweetData[]> {
    if (!this.browser) {
      throw new Error('Browser not initialized');
    }
  
    const page = await this.browser.newPage();
    try {
      await page.setViewport({ width: 1280, height: 800 });
      await page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      );
  
      await page.goto(truthProfileUrl, {
        waitUntil: ['domcontentloaded', 'load'],
        timeout: 30000,
      });
  
      // Wait for initial posts to load
      await page.waitForSelector('[data-testid="status"]', {
        timeout: 10000,
      });
  
      // Get initial posts
      const initialTweets = await this.extractTweetsFromPage(page, truthProfileUrl);
  
      // Do one gentle scroll
      await page.evaluate(async () => {
        // Scroll just enough to trigger a bit more content loading - about 1000px
        window.scrollTo(0, 1000);
        
        // Wait a moment for content to load
        await new Promise(resolve => setTimeout(resolve, 3000));
      });
  
      // Get posts after scrolling
      const moreTweets = await this.extractTweetsFromPage(page, truthProfileUrl);
  
      // Combine and deduplicate tweets
      const allTweets = [...initialTweets];
      for (const tweet of moreTweets) {
        if (!allTweets.find(t => t.id === tweet.id)) {
          allTweets.push(tweet);
        }
      }
  
      if (this.DEBUG) {
        console.log(`Found ${allTweets.length} total tweets`);
      }
  
      // Sort by timestamp, newest first
      return allTweets.sort((a, b) => {
        return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
      });
  
    } finally {
      await page.close();
    }
  }
  
  private async extractTweetsFromPage(
    page: any,
    profileUrl: string
  ): Promise<TweetData[]> {
    // First get the post information
    const posts = await page.evaluate((profileUrl: string) => {
      const extractedPosts: any[] = [];
      
      // Get all status divs
      const postElements = document.querySelectorAll('[data-testid="status"]');
      
      postElements.forEach((post) => {
        try {
          // Get the wrapper
          const wrapper = post.querySelector('.status__wrapper');
          if (!wrapper) return;
                  
          // Skip retweets
          const retweetButton = wrapper.querySelector('button[title="ReTruth"].active');
          if (retweetButton) return;
  
          // Extract post content
          const contentElement = wrapper.querySelector('[data-markup="true"]');
          let text = contentElement?.textContent?.trim() || '';
          
          // Extract timestamp
          const timeElement = wrapper.querySelector('time[title]');
          const timestamp = timeElement?.getAttribute('title') || '';
          
          // Extract ID
          const postLink = wrapper.querySelector('a[href*="posts"]')?.getAttribute('href') || '';
          const id = postLink ? postLink.split('/').pop() || '' : '';
          
          // Extract thumbnail URLs and video URLs together
          const videoData: { videoUrl: string, thumbnailUrl: string }[] = [];
          wrapper.querySelectorAll('video').forEach((video: Element) => {
            // Get video source and its thumbnail
            const sources = video.querySelectorAll('source');
            const videoUrl = sources[0]?.getAttribute('src') || video.getAttribute('src');
            
            // Get the video thumbnail from the poster attribute or any nearby img
            const posterUrl = video.getAttribute('poster');
            const thumbnailImg = wrapper.querySelector('.media-gallery img[src*="/original/"]');
            const thumbnailUrl = posterUrl || thumbnailImg?.getAttribute('src');
  
            if (videoUrl && thumbnailUrl) {
              videoData.push({ videoUrl, thumbnailUrl });
            }
          });
  
          // Extract image URLs
          const imageUrls: string[] = [];
          wrapper.querySelectorAll('.media-gallery img').forEach((img: Element) => {
            const src = (img as HTMLImageElement).src;
            if (src && !videoData.some(v => v.thumbnailUrl === src)) { // Don't duplicate video thumbnails
              imageUrls.push(src.replace('/small/', '/original/'));
            }
          });
  
          if (id) {
            extractedPosts.push({
              id,
              text: text || '[No Text Content]',
              timestamp: timestamp ? new Date(timestamp).toISOString() : new Date().toISOString(),
              imageUrls,
              videoData,
              sourceAccount: profileUrl,
              platform: 'truthsocial',
              postedToBluesky: false
            });
          }
        } catch (error) {
          console.error('Error extracting post:', error);
        }
      });
      
      return extractedPosts;
    }, profileUrl);
  
    // Now fetch each media item using Puppeteer's page context
    const tweetsWithMedia = await Promise.all(
      posts.map(async (post: any) => {
        // Handle images
        if (post.imageUrls && post.imageUrls.length > 0) {
          const images = await Promise.all(
            post.imageUrls.map(async (url: string) => {
              try {
                const imagePage = await this.browser.newPage();
                try {
                  await imagePage.goto(url, {
                    waitUntil: 'networkidle0',
                    timeout: 10000
                  });
  
                  const base64Image = await imagePage.evaluate(async () => {
                    const img = document.querySelector('img');
                    if (!img) return null;
  
                    const canvas = document.createElement('canvas');
                    canvas.width = img.width;
                    canvas.height = img.height;
                    const ctx = canvas.getContext('2d');
                    ctx?.drawImage(img, 0, 0);
                    return canvas.toDataURL('image/jpeg', 0.95);
                  });
  
                  if (!base64Image) return null;
                  const base64Data = base64Image.replace(/^data:image\/\w+;base64,/, '');
                  const imageBuffer = Buffer.from(base64Data, 'base64');
                  return imageBuffer;
                } finally {
                  await imagePage.close();
                }
              } catch (error) {
                console.error(`Error capturing image from ${url}:`, error);
                return null;
              }
            })
          );
  
          post.images = images.filter(img => img !== null);
        }
  
        // Handle video thumbnails
        if (post.videoData && post.videoData.length > 0) {
          const thumbnails = await Promise.all(
            post.videoData.map(async (data: { videoUrl: string, thumbnailUrl: string }) => {
              try {
                const imagePage = await this.browser.newPage();
                try {
                  await imagePage.goto(data.thumbnailUrl, {
                    waitUntil: 'networkidle0',
                    timeout: 10000
                  });
  
                  const base64Image = await imagePage.evaluate(async () => {
                    const img = document.querySelector('img');
                    if (!img) return null;
  
                    const canvas = document.createElement('canvas');
                    canvas.width = img.width;
                    canvas.height = img.height;
                    const ctx = canvas.getContext('2d');
                    ctx?.drawImage(img, 0, 0);
                    return canvas.toDataURL('image/jpeg', 0.95);
                  });
  
                  if (!base64Image) return null;
                  const base64Data = base64Image.replace(/^data:image\/\w+;base64,/, '');
                  const imageBuffer = Buffer.from(base64Data, 'base64');
                  return {
                    videoUrl: data.videoUrl,
                    thumbnail: imageBuffer
                  };
                } finally {
                  await imagePage.close();
                }
              } catch (error) {
                console.error(`Error capturing thumbnail from ${data.thumbnailUrl}:`, error);
                return {
                  videoUrl: data.videoUrl,
                  thumbnail: null
                };
              }
            })
          );
  
          post.videos = thumbnails.map(t => t.videoUrl).filter(Boolean);
          post.videoThumbnails = thumbnails.map(t => t.thumbnail).filter(Boolean);
        }
  
        // Clean up intermediate data
        delete post.imageUrls;
        delete post.videoData;
        return post;
      })
    );
  
    // Sort by timestamp, newest first
    return tweetsWithMedia.sort((a, b) => {
      return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
    });
  }
  // Helper method to extract username from profile URL
  private extractUsernameFromUrl(url: string): string {
    const match = url.match(/@([^/]+)/);
    return match ? match[1] : '';
  }
}