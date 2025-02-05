import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { TweetData } from '../types';
import { ScraperService } from './scraper-service';

puppeteer.use(StealthPlugin());

export class TwitterScraperService implements ScraperService{
  private browser: any = null;
  private readonly DEBUG: boolean = true;
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

  private async resolveShortUrl(shortUrl: string): Promise<string> {
    const page = await this.browser.newPage();
    try {
      // Set a short timeout since we just need the redirect
      await page.setDefaultNavigationTimeout(10000);

      // Navigate to the URL
      await page.goto(shortUrl, {
        waitUntil: 'networkidle0',
      });
      
      // Get the final URL
      const finalUrl = page.url();
      
      if (this.DEBUG) {
        console.log(`Resolved ${shortUrl} to ${finalUrl}`);
      }

      return finalUrl;
    } catch (error) {
      console.error(`Error resolving short URL ${shortUrl}:`, error);
      return shortUrl;
    } finally {
      await page.close();
    }
  }

  private shouldResolveVideoUrls(tweetTimestamp: string, twitterUrl: string): boolean {
    const lastScrape = this.lastScrapeTime.get(twitterUrl);
    if (!lastScrape) return true;

    const tweetDate = new Date(tweetTimestamp);
    const twoMinutesBeforeLastScrape = new Date(lastScrape.getTime() - 2 * 60 * 1000);
    console.log(tweetTimestamp + ' comparing ' + tweetDate + ' to ' + twoMinutesBeforeLastScrape);

    return tweetDate > twoMinutesBeforeLastScrape;
  }

  private async resolveVideoUrls(videoLinks: string[], tweetTimestamp: string, twitterUrl: string): Promise<string[]> {
    if (!this.shouldResolveVideoUrls(tweetTimestamp, twitterUrl)) {
      if (this.DEBUG) {
        console.log(`Skipping video resolution for tweet from ${tweetTimestamp} - older than 2 minutes before last scrape`);
      }
      return videoLinks;
    }

    const resolvedLinks: string[] = [];
    for (const link of videoLinks) {
      try {
        const resolvedUrl = await this.resolveShortUrl(link);
        // if (resolvedUrl !== link) { 
        resolvedLinks.push(resolvedUrl);
        // }
      } catch (error) {
        console.error(`Failed to resolve video URL ${link}:`, error);
      }
    }
    return resolvedLinks;
  }

  async getLatestTweets(twitterUrl: string): Promise<TweetData[]> {
    if (!this.browser) {
      throw new Error('Browser not initialized');
    }

    const page = await this.browser.newPage();
    try {
      await page.setViewport({ width: 1280, height: 800 });
      await page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      );

      const waitCondition = ['domcontentloaded', 'load'];
      await page.goto(twitterUrl, {
        waitUntil: waitCondition,
        timeout: 30000,
      });

      await page.waitForSelector('article[data-testid="tweet"]', {
        timeout: 10000,
      });

      if (this.DEBUG) {
        await page.screenshot({ path: 'twitter-page.png' });
      }

      const tweets = await this.extractTweetsFromPage(page, twitterUrl);
      
      // Resolve video URLs for eligible tweets
      for (const tweet of tweets) {
        if (tweet.videos && tweet.videos.length > 0) {
          const resolvedUrls = await this.resolveVideoUrls(tweet.videos, tweet.timestamp, twitterUrl);
          if (resolvedUrls.length > 0) {
            tweet.videos = resolvedUrls;
          }
        }
      }

      // Update last scrape time before processing videos
      this.lastScrapeTime.set(twitterUrl, new Date());

      return tweets;
    } finally {
      await page.close();
    }
  }

  private async extractTweetsFromPage(page: any, twitterUrl: string): Promise<TweetData[]> {
    return await page.evaluate((twitterUrl: any) => {
      const extractedTweets: Array<TweetData> = [];
      const tweetElements = document.querySelectorAll('article[data-testid="tweet"]');

      tweetElements.forEach((tweet: Element) => {
        const textElement = tweet.querySelector('[data-testid="tweetText"]');
        const timeElement = tweet.querySelector('time');

        // Extract images
        const images: string[] = [];
        const bgImageElements = tweet.querySelectorAll('[style*="background-image"]');
        bgImageElements.forEach((el: Element) => {
          const style = el.getAttribute('style') || '';
          const match = style.match(/url\("([^"]+)"\)/);
          if (match && match[1]) {
            const imageUrl = match[1];
            if ((imageUrl.includes('format=jpg') || imageUrl.includes('format=png')) 
                && !imageUrl.includes('profile') 
                && !imageUrl.includes('normal')) {
                  const fullResUrl = imageUrl
                    .replace(/&name=[^&]+/g, '')
                    .replace('?format=jpg', '?format=jpg&name=large')
                    .replace('?format=png', '?format=png&name=large');
                  images.push(fullResUrl);
                }
          }
        });

        // Extract video links (including YouTube)
        const videoLinks: string[] = [];
        
        // Check for all possible video/media cards
        const mediaSelectors = [
          'a[href*="t.co"]',                           // t.co links
          '[data-testid="card.wrapper"] a',            // Card wrappers with links
          'a[href*="youtu.be"]',                       // Direct YouTube short links
          'a[href*="youtube.com"]',                    // Direct YouTube links
        ];
        
        mediaSelectors.forEach(selector => {
          const elements = tweet.querySelectorAll(selector);
          elements.forEach((el: Element) => {
            const href = el.getAttribute('href');
            if (href) {
              // Check if this link is within a media card
              const isInMediaCard = el.closest('[data-testid="card.wrapper"]') !== null;
              const hasPlayButton = el.closest('[data-testid="card.wrapper"]')?.querySelector('[aria-label="Play"]') !== null;
              
              if (isInMediaCard && hasPlayButton) {
                if (!videoLinks.includes(href)) {
                  videoLinks.push(href);
                }
              }
            }
          });
        });

        const text = textElement?.textContent || '';
        let timestamp = '';

        if (timeElement) {
          const dateAttr = timeElement.getAttribute('datetime');
          const relativeTime = timeElement.textContent;

          if (dateAttr) {
            timestamp = dateAttr;
          } else if (relativeTime) {
            const now = new Date();
            if (relativeTime.includes('h')) {
              const hours = parseInt(relativeTime);
              now.setHours(now.getHours() - hours);
              timestamp = now.toISOString();
            } else if (relativeTime.includes('d')) {
              const days = parseInt(relativeTime);
              now.setDate(now.getDate() - days);
              timestamp = now.toISOString();
            } else if (relativeTime.includes('m')) {
              const minutes = parseInt(relativeTime);
              now.setMinutes(now.getMinutes() - minutes);
              timestamp = now.toISOString();
            }
          }
        }

        if (text && timestamp) {
          const id = `${text.slice(0, 20)}_${timestamp}`;
          const extracted = {
            id: id,
            text: text,
            timestamp: timestamp,
            images: images,
            videos: videoLinks,
            sourceAccount: twitterUrl,
            postedToBluesky: false
          };
          extractedTweets.push(extracted);
        }
      });

      return extractedTweets.slice(0, 10);
    }, twitterUrl);
  }
}