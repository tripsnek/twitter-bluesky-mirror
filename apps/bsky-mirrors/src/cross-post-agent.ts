import { AccountPair, AgentConfig, TweetData } from './types';
import { StorageService } from './services/storage-service';
import { BlueskyService } from './services/bluesky-service';
import { ScraperService } from './services/scraper-service';

export class CrossPostAgent {
  private readonly config: AgentConfig;

  private lastCheckedTweets: Map<string, TweetData[]>;

  public static SCRAPE_SOURCE = 'truthsocial';
  // public static SCRAPE_SOURCE = 'nitter';
  // public static SCRAPE_SOURCE = 'twitter';


  constructor(config: AgentConfig, public scraperService: ScraperService, public blueskyService: BlueskyService) {
    this.config = config;

    this.lastCheckedTweets = new Map();
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

  async checkAndPost(pair: AccountPair): Promise<void> {
    try {
      // for (const pair of this.config.accountPairs) {
        console.log('=====   checkAndPost ' + pair.twitter + '   =====');
        const latestTweets = await this.scraperService.getLatestTweets(pair.twitter);
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
      // }
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
    const numAccts = this.config.accountPairs.length;
    let pairInd = 0;
    await this.checkAndPost(this.config.accountPairs[pairInd++]);
    const subinterval = this.config.CHECK_INTERVAL_MS/numAccts;
    setInterval(() => {
      if(pairInd>=numAccts) pairInd = 0;
      this.checkAndPost(this.config.accountPairs[pairInd]);
      pairInd+=1;
    }, subinterval);
    console.log(`Cross-posting agent started with ${this.config.CHECK_INTERVAL_MS / 1000}s total interval, ${subinterval/1000} subinterval`);
  }

  async cleanup(): Promise<void> {
    await this.scraperService.cleanup();
  }
}
