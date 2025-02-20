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

      // Wait for posts to load
      await page.waitForSelector('.status', {
        timeout: 10000,
      });

      if (this.DEBUG) {
        await page.screenshot({ path: 'truthsocial-page.png' });
      }

      await page.content();
      const tweets = await this.extractTweetsFromPage(page, truthProfileUrl);

      // Update last scrape time
      this.lastScrapeTime.set(truthProfileUrl, new Date());

      return tweets;
    } finally {
      await page.close();
    }
  }

  private async extractTweetsFromPage(
    page: any,
    profileUrl: string
  ): Promise<TweetData[]> {
    // Forward console messages from the browser
    page.on('console', (msg: { text: () => any }) =>
      this.DEBUG && console.log('Browser console:', msg.text())
    );
    page.on('pageerror', (error: { message: any }) =>
      this.DEBUG && console.log('Browser error:', error.message)
    );

    if (this.DEBUG) {
      console.log('extractTweetsFromPage(): Extracting posts from ' + profileUrl);
    }

    return await page.evaluate((profileUrl: string) => {
      const extractedTweets: any[] = [];
      
      // Truth Social posts have the class 'status'
      const postElements = document.querySelectorAll('.status');
      
      postElements.forEach((post) => {
        try {
          // Extract account info
          const accountElement = post.querySelector('[data-testid="account"]');
          const username = accountElement?.querySelector('[style="direction: ltr;"]')?.textContent?.trim() || '';
          
          // Skip re-truths if they're from other accounts
          const isSelfRetruth = !post.querySelector('[role="status-info"] [class*="text-xs"]')?.textContent?.includes(' ReTruthed');
          
          // Extract post content
          const contentElement = post.querySelector('[data-markup="true"]');
          let text = contentElement?.textContent?.trim() || '';
          
          // Extract post timestamp
          const timeElement = post.querySelector('time');
          const timestamp = timeElement?.getAttribute('title') || '';
          
          // Extract post link/ID
          const postLink = post.querySelector('a[href*="posts"]')?.getAttribute('href') || '';
          const id = postLink ? postLink.split('/').pop() || '' : '';
          
          // Extract images
          const images: string[] = [];
          const imageElements = post.querySelectorAll('.media-gallery__item-thumbnail img');
          imageElements.forEach((img: Element) => {
            const src = (img as HTMLImageElement).src;
            if (src) {
              // Get the full resolution image instead of thumbnail
              const fullResUrl = src.replace('/small/', '/original/');
              images.push(fullResUrl);
            }
          });
          
          // Extract videos
          const videos: string[] = [];
          const videoElement = post.querySelector('video');
          if (videoElement) {
            const sources = videoElement.querySelectorAll('source');
            // Use the highest quality video source
            if (sources.length > 0) {
              // Sort sources by quality if available
              const sortedSources = Array.from(sources).sort((a, b) => {
                const qualityA = a.getAttribute('data-quality') || '';
                const qualityB = b.getAttribute('data-quality') || '';
                // Higher resolution first (720p before 480p)
                return qualityB.localeCompare(qualityA);
              });
              
              const videoUrl = sortedSources[0]?.getAttribute('src') || '';
              if (videoUrl) {
                videos.push(videoUrl);
              }
            }
          }
          
          // Extract external links/cards
          const linkCards = post.querySelectorAll('.status-card--link');
          linkCards.forEach((card: Element) => {
            const linkElement = card as HTMLAnchorElement;
            const linkUrl = linkElement.href;
            if (linkUrl && !text.includes(linkUrl)) {
              // Append link to text if not already in text
              text += ` ${linkUrl}`;
            }
          });
          
          // Only process the post if it has text and a timestamp
          if (text && timestamp && id) {
            // Convert timestamp to ISO format
            const isoTimestamp = new Date(timestamp).toISOString();
            
            const extracted = {
              id: id,
              text: text,
              timestamp: isoTimestamp,
              images: images,
              videos: videos,
              sourceAccount: profileUrl,
              postedToBluesky: false,
            };
            
            extractedTweets.push(extracted);
          }
        } catch (error) {
          console.error('Error extracting post data:', error);
        }
      });
      
      return extractedTweets.slice(0, 10);
    }, profileUrl);
  }
  
  // Helper method to extract username from profile URL
  private extractUsernameFromUrl(url: string): string {
    const match = url.match(/@([^/]+)/);
    return match ? match[1] : '';
  }
}