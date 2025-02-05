import { AgentConfig, TweetData } from './types';
import { StorageService } from './services/storage-service';
// import { TwitterScraperService } from './services/twitter-scraper-service';
import { BlueskyService } from './services/bluesky-service';
import fs from 'fs/promises';
import { ScraperService } from './services/scraper-service';
import { NitterScraperService } from './services/nitter-scraper-service';
import { TwitterScraperService } from './services/twitter-scraper-service';

export class CrossPostAgent {
  private readonly config: AgentConfig;
  private readonly twitterService: ScraperService;
  private readonly blueskyService: BlueskyService;
  private lastCheckedTweets: Map<string, TweetData[]>;

  public static SCRAPE_SOURCE = 'nitter';
  // public static SCRAPE_SOURCE = 'twitter';


  constructor(config: AgentConfig) {
    this.config = config;
    // this.twitterService = new TwitterScraperService();
    this.twitterService = CrossPostAgent.SCRAPE_SOURCE === 'twitter' ? new TwitterScraperService() : new NitterScraperService();
    this.blueskyService = new BlueskyService();
    this.lastCheckedTweets = new Map();
  }

  async initialize(): Promise<void> {
    await Promise.all([
      this.twitterService.initialize(),
      this.blueskyService.initialize(this.config.accountPairs),
    ]);

    // Ensure storage directories exist
    for (const pair of this.config.accountPairs) {
      await fs.mkdir(pair.storageDir, { recursive: true });
    }
  }

  private async findNewTweets(latestTweets: TweetData[], sourceAccount: string): Promise<TweetData[]> {
    if (!this.lastCheckedTweets.has(sourceAccount)) {
      this.lastCheckedTweets.set(sourceAccount, []);
    }

    const lastChecked = this.lastCheckedTweets.get(sourceAccount)!;
    const newTweets = latestTweets.filter(
      tweet => !lastChecked.some(cached => cached.id === tweet.id)
    );

    this.lastCheckedTweets.set(sourceAccount, latestTweets);
    return newTweets;
  }

  async checkAndPost(): Promise<void> {
    try {
      for (const pair of this.config.accountPairs) {
        console.log('checkAndPost ' + pair.twitter);
        const latestTweets = await this.twitterService.getLatestTweets(pair.twitter);
        const newTweets = await this.findNewTweets(latestTweets, pair.twitter);

        console.log(`checkAndPost(): ${newTweets.length} of ${latestTweets.length} ${pair.twitter} tweets are new`);
        
        let toPost = [];
        for (const tweet of newTweets) {
          try {

            //if a duplicate tweet is detected with bluesky recents, not need to proceed further
            if(this.blueskyService.isDuplicateWithRecentBlueskyPosts(tweet.text,pair.twitter)){
              console.log(`Abandoning further updates, duplicate tweet detected: ${tweet.text}`);
              break;
            }
            toPost.push(tweet);

          } catch (error) {
            console.error(`Failed during duplicate detection of ${tweet.id}:`, error);
          }
        }

        //reverse tweets, most recent should be last
        toPost.reverse();
        
        //post to blue sky
        for (const tweet of toPost) {
          try {
            await this.blueskyService.postTweet(tweet, pair.twitter);
            tweet.postedToBluesky = true;
          } catch (error) {
            tweet.postedToBluesky = false;
            console.error(`Failed to post tweet ${tweet.id}:`, error);
          }
          await StorageService.saveTweet(tweet, pair.storageDir);
        }
      }
    } catch (error) {
      console.error('Error in check and post cycle:', error);
    }
  }

    // New method for posting a specific tweet from storage
    async postStoredTweet(config: AgentConfig, tweetFile: string, sourceAccount: string): Promise<boolean> {
      const accountPair = config.accountPairs.find(pair => pair.twitter === sourceAccount);
      if (!accountPair) {
        throw new Error(`No account pair found for ${sourceAccount}`);
      }
  
      const tweet = await StorageService.loadTweet(tweetFile, accountPair.storageDir);
      if (!tweet) {
        throw new Error(`Tweet ${tweetFile} not found in storage`);
      }
  
      try {
        await this.blueskyService.postTweet(tweet, sourceAccount);
        // Update the stored tweet to reflect successful posting
        tweet.postedToBluesky = true;
        await StorageService.saveTweet(tweet, accountPair.storageDir);
        return true;
      } catch (error) {
        console.error(`Failed to post stored tweet ${tweetFile}:`, error);
        return false;
      }
    }

  async start(): Promise<void> {
    await this.initialize();
    await this.checkAndPost();
    setInterval(() => this.checkAndPost(), this.config.CHECK_INTERVAL_MS);
    console.log(`Cross-posting agent started with ${this.config.CHECK_INTERVAL_MS / 1000}s interval`);
  }

  async cleanup(): Promise<void> {
    await this.twitterService.cleanup();
  }
}
