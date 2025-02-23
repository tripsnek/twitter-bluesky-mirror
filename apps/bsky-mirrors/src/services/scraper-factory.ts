import { ScraperService } from './scraper-service';
import { TwitterScraperService } from './twitter-scraper-service';
import { NitterScraperService } from './nitter-scraper-service';
import { TruthSocialScraperService } from './truth-social-scraper.service';
import puppeteer from 'puppeteer-extra';

export class ScraperFactory {
  private scrapers: Map<string, ScraperService> = new Map();

  private browser: any = null;

  async getScraperForPlatform(platform: string): Promise<ScraperService> {

    if(!this.browser){
      this.browser = await puppeteer.connect({
        browserURL: 'http://localhost:9222',
        defaultViewport: null,
      });
    }

    if (this.scrapers.has(platform)) {
      return this.scrapers.get(platform)!;
    }

    let scraper: ScraperService;
    switch (platform) {
      case 'twitter':
        scraper = new TwitterScraperService();
        break;
      case 'nitter':
        scraper = new NitterScraperService();
        break;
      case 'truthsocial':
        scraper = new TruthSocialScraperService();
        break;
      default:
        throw new Error(`Unsupported platform: ${platform}`);
    }

    await scraper.initialize();
    this.scrapers.set(platform, scraper);
    return scraper;
  }

  async cleanup(): Promise<void> {
    for (const scraper of this.scrapers.values()) {
      await scraper.cleanup();
    }
  }
}