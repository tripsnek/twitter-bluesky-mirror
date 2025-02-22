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
    return await page.evaluate((profileUrl: string) => {
      const extractedTweets: any[] = [];
      
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
          
          // Extract media
          const images: string[] = [];
          wrapper.querySelectorAll('.media-gallery img').forEach((img: Element) => {
            const src = (img as HTMLImageElement).src;
            if (src) {
              const fullResUrl = src.replace('/small/', '/original/');
              images.push(fullResUrl);
            }
          });
  
          const videos: string[] = [];
          wrapper.querySelectorAll('video').forEach((video: Element) => {
            const sources = video.querySelectorAll('source');
            if (sources.length > 0) {
              const videoUrl = sources[0]?.getAttribute('src');
              if (videoUrl) videos.push(videoUrl);
            }
          });
  
          if (id) {
            extractedTweets.push({
              id,
              text: text || '[No Text Content]',
              timestamp: timestamp ? new Date(timestamp).toISOString() : new Date().toISOString(),
              images,
              videos,
              sourceAccount: profileUrl,
              postedToBluesky: false
            });
          }
        } catch (error) {
          console.error('Error extracting post:', error);
        }
      });
      
      return extractedTweets;
    }, profileUrl);
  }
  // Helper method to extract username from profile URL
  private extractUsernameFromUrl(url: string): string {
    const match = url.match(/@([^/]+)/);
    return match ? match[1] : '';
  }
}