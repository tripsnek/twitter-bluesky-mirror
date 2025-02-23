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
        await new Promise(resolve => setTimeout(resolve, 1000));
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
          
          // Extract image URLs
          const imageUrls: string[] = [];
          wrapper.querySelectorAll('.media-gallery img').forEach((img: Element) => {
            const src = (img as HTMLImageElement).src;
            if (src) {
              // Convert from small to original size
              imageUrls.push(src.replace('/small/', '/original/'));
            }
          });
  
          // Extract video URLs - Handle Truth Social video format
          const videoUrls: string[] = [];
          wrapper.querySelectorAll('video').forEach((video: Element) => {
            // Get video source elements
            const sources = video.querySelectorAll('source');
            if (sources.length > 0) {
              // Get all available video sources (different qualities)
              sources.forEach((source: Element) => {
                const videoUrl = source.getAttribute('src');
                const dataQuality = source.getAttribute('data-quality');
                if (videoUrl) {
                  videoUrls.push(videoUrl);
                  console.log(`Found video source: ${videoUrl} (${dataQuality})`);
                }
              });
            } else {
              // Handle videos with direct src attribute
              const videoSrc = video.getAttribute('src');
              if (videoSrc) {
                videoUrls.push(videoSrc);
                console.log(`Found direct video source: ${videoSrc}`);
              }
            }
          });
  
          if (id) {
            extractedPosts.push({
              id,
              text: text || '[No Text Content]',
              timestamp: timestamp ? new Date(timestamp).toISOString() : new Date().toISOString(),
              imageUrls, // Store URLs for processing
              videoUrls, // Store video URLs
              sourceAccount: profileUrl,
              postedToBluesky: false,
              platform: 'truthsocial'
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
  
        // Handle videos - store video URLs directly
        if (post.videoUrls && post.videoUrls.length > 0) {
          // For video URLs, we'll use the highest quality version available
          post.videos = post.videoUrls.filter((url: string) => url.includes('haa.mp4'));
          // If no high quality version found, use whatever is available
          if (post.videos.length === 0) {
            post.videos = [post.videoUrls[0]];
          }
        }
  
        // Remove the URL arrays as we've processed them
        delete post.imageUrls;
        delete post.videoUrls;
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