import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { TweetData } from '../types';
import { ScraperService } from './scraper-service';

puppeteer.use(StealthPlugin());

export class NitterScraperService implements ScraperService {
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

  private async resolveShortUrl(shortUrl: string): Promise<string> {
    const page = await this.browser.newPage();
    try {
      await page.setDefaultNavigationTimeout(10000);
      await page.goto(shortUrl, {
        waitUntil: 'networkidle0',
      });

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

  // private shouldResolveVideoUrls(
  //   tweetTimestamp: string,
  //   nitterUrl: string
  // ): boolean {
  //   const lastScrape = this.lastScrapeTime.get(nitterUrl);
  //   if (!lastScrape) return true;

  //   const tweetDate = new Date(tweetTimestamp);
  //   const twoMinutesBeforeLastScrape = new Date(
  //     lastScrape.getTime() - 2 * 60 * 1000
  //   );

  //   if (this.DEBUG) {
  //     console.log(
  //       tweetTimestamp +
  //         ' comparing ' +
  //         tweetDate +
  //         ' to ' +
  //         twoMinutesBeforeLastScrape
  //     );
  //   }

  //   return tweetDate > twoMinutesBeforeLastScrape;
  // }

  private async resolveVideoUrls(
    videoLinks: string[],
    tweetTimestamp: string,
    nitterUrl: string
  ): Promise<string[]> {
    //nitter links are already resolved
    const resolvedLinks: string[] = [];
    for (const link of videoLinks) {
      resolvedLinks.push(link.replace('piped.video', 'youtube.com'));
    }
    return resolvedLinks;
  }

  async getLatestTweets(nitterUrl: string): Promise<TweetData[]> {
    if (!this.browser) {
      throw new Error('Browser not initialized');
    }

    const page = await this.browser.newPage();
    try {
      await page.setViewport({ width: 1280, height: 800 });
      await page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      );

      await page.goto(nitterUrl, {
        waitUntil: ['domcontentloaded', 'load'],
        timeout: 30000,
      });

      await page.waitForSelector('.timeline-item', {
        timeout: 10000,
      });

      if (this.DEBUG) {
        await page.screenshot({ path: 'nitter-page.png' });
      }

      await page.content();
      const tweets = await this.extractTweetsFromPage(page, nitterUrl);

      // Resolve video URLs for eligible tweets
      for (const tweet of tweets) {
        if (tweet.videos && tweet.videos.length > 0) {
          const resolvedUrls = await this.resolveVideoUrls(
            tweet.videos,
            tweet.timestamp,
            nitterUrl
          );
          if (resolvedUrls.length > 0) {
            tweet.videos = resolvedUrls;
          }
        }
      }

      // Update last scrape time before processing videos
      this.lastScrapeTime.set(nitterUrl, new Date());

      return tweets;
    } finally {
      await page.close();
    }
  }

  private async extractTweetsFromPage(
    page: any,
    nitterUrl: string
  ): Promise<TweetData[]> {
    // Forward console messages from the browser
    page.on('console', (msg: { text: () => any }) =>
      console.log('Browser console:', msg.text())
    );
    page.on('pageerror', (error: { message: any }) =>
      console.log('Browser error:', error.message)
    );

    // const hasElements = await page.evaluate(() => {
    //   return !!document.querySelector('.timeline-item');
    // });
    // console.log('Has timeline items:', hasElements);

    // const htmlContent = await page.evaluate(() => {
    //   return document.querySelector('.timeline-item')?.outerHTML;
    // });
    // console.log('First item HTML:', htmlContent);

    if (this.DEBUG)
      console.log(
        'extractTweetsFromPage():  Extracting tweets from ' + nitterUrl
      );
    return await page.evaluate((nitterUrl: string) => {
      if (this.DEBUG) console.log('Starting tweet extraction...');
      const extractedTweets: any[] = [];

      const tweetElements = document.querySelectorAll('.timeline-item');
      if (this.DEBUG) console.log(`Found ${tweetElements.length} tweets`);

      tweetElements.forEach((tweet, index) => {
        if (this.DEBUG) console.log(`Processing tweet ${index + 1}`);
        // Extract text content
        const textElement = tweet.querySelector('.tweet-content');
        const timeElement = tweet.querySelector('.tweet-date');
        const tweetLink = tweet.querySelector('.tweet-link');

        // Process text and links
        let text = '';
        if (textElement) {
          // Get all child nodes to handle both text and links
          const childNodes = Array.from(textElement.childNodes);
          childNodes.forEach((node) => {
            if (node.nodeType === Node.TEXT_NODE) {
              // Handle plain text
              text += node.textContent;
            } else if (node instanceof HTMLAnchorElement) {
              // Handle links - format for Bluesky rich text
              const href = node.href;
              const displayText = node.textContent;
              // Only add the link if we have both href and display text
              if (href && displayText) {
                // Convert relative URLs to absolute if necessary
                const absoluteUrl = href.startsWith('http')
                  ? href
                  : new URL(href, window.location.origin).href;
                text += absoluteUrl;
              }
            }
          });
        }
        text = text.replace('piped.video', 'youtube.com');

        // Extract images
        const images: string[] = [];
        const imageElements = tweet.querySelectorAll('.attachment.image img');
        imageElements.forEach((img: Element) => {
          const src = (img as HTMLImageElement).src;
          if (src && !src.includes('profile') && !src.includes('normal')) {
            // Convert thumbnail URL to full resolution
            const fullResUrl = src
              .replace('%3Fname%3Dsmall%26format%3Dwebp', '')
              .replace('thumb', 'orig');
            images.push(fullResUrl);
          }
        });

        // Extract video links
        const videoLinks: string[] = [];
        const cardElements = tweet.querySelectorAll('.card-container');
        cardElements.forEach((card: Element) => {
          const href = card.getAttribute('href');
          const hasPlayButton =
            card.querySelector('.overlay-triangle') !== null;

          if (href && hasPlayButton) {
            if (!videoLinks.includes(href)) {
              videoLinks.push(href);
            }
          }
        });

        let timestamp = '';

        if (timeElement) {
          // First try to get the timestamp from the title attribute
          const titleTimestamp = timeElement.getAttribute('title');
          if (titleTimestamp) {
            // Parse timestamps like "Feb 4, 2025 · 7:12 PM UTC"
            timestamp = new Date(titleTimestamp.split(' · ')[0]).toISOString();
          } else {
            // Fall back to relative time parsing
            const relativeTime = timeElement.textContent?.trim() || '';
            const now = new Date();

            if (relativeTime.includes('h')) {
              // Handle "2h" format
              const hours = parseInt(relativeTime);
              now.setHours(now.getHours() - hours);
              timestamp = now.toISOString();
            } else if (relativeTime.includes('d')) {
              // Handle "2d" format
              const days = parseInt(relativeTime);
              now.setDate(now.getDate() - days);
              timestamp = now.toISOString();
            } else if (relativeTime.includes('m')) {
              // Handle "2m" format
              const minutes = parseInt(relativeTime);
              now.setMinutes(now.getMinutes() - minutes);
              timestamp = now.toISOString();
            } else if (
              relativeTime.includes('Feb') ||
              relativeTime.includes('Jan')
            ) {
              // Handle "Feb 3" format
              const currentYear = new Date().getFullYear();
              timestamp = new Date(
                `${relativeTime}, ${currentYear}`
              ).toISOString();
            }
          }
        }

        if (text && timestamp && tweetLink) {
          const id = `${tweetLink.getAttribute('href')}`;

          const extracted = {
            id: id,
            text: text,
            timestamp: timestamp,
            images: images,
            videos: videoLinks,
            sourceAccount: nitterUrl,
            postedToBluesky: false,
          };

          extractedTweets.push(extracted);
        }
      });

      // console.log('extracted ' + extractedTweets.length);

      return extractedTweets.slice(0, 10);
    }, nitterUrl);
  }
}
