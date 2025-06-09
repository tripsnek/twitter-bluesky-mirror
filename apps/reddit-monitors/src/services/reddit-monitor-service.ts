// src/services/reddit-monitor-service.ts
import { RedditAuthService, RedditAuthConfig } from './reddit-auth-service';
import axios from 'axios';
import { CronJob } from 'cron';

export interface RedditMonitorConfig {
  subreddit: string;
  checkInterval: string;
  keywords: string[];
  clientId: string;
  clientSecret: string;
  username: string;
  password: string;
  userAgent: string;
  onMatchFound?: (post: any, matchedKeywords: string[]) => void;
}

export class RedditMonitorService {
  private config: RedditMonitorConfig;
  private authService: RedditAuthService;
  private job: CronJob | null = null;
  private lastPostId: string | null = null;

  constructor(config: RedditMonitorConfig) {
    this.config = config;
    
    // Create auth service
    const authConfig: RedditAuthConfig = {
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      username: config.username,
      password: config.password,
      userAgent: config.userAgent
    };
    
    this.authService = new RedditAuthService(authConfig);
  }

  /**
   * Authorize with Reddit API using password flow
   */
  async authorize(): Promise<void> {
    try {
      // Test that we can get a token
      const token = await this.authService.getAccessToken();
      console.log('Successfully authenticated with Reddit API');
      
      // Verify token is not undefined
      if (!token) {
        throw new Error('Authentication succeeded but token is undefined');
      }
    } catch (error) {
      console.error('Failed to authenticate with Reddit API:', error);
      throw error;
    }
  }

  /**
   * Start monitoring the subreddit
   */
  async start(): Promise<void> {
    if (this.job) {
      console.log('Monitor already running');
      return;
    }

    // Create a cron job to check the subreddit periodically
    this.job = new CronJob(
      this.config.checkInterval,
      () => this.checkSubreddit(),
      null,
      true
    );

    console.log(`Started monitoring r/${this.config.subreddit} for keywords: ${this.config.keywords.join(', ')}`);
    console.log(`Check interval: ${this.config.checkInterval}`);
    
    // Do an initial check
    await this.checkSubreddit();
  }

  /**
   * Stop monitoring
   */
  stop(): void {
    if (this.job) {
      this.job.stop();
      this.job = null;
      console.log('Monitoring stopped');
    }
  }

  /**
   * Check the subreddit for new posts containing keywords
   */
  private async checkSubreddit(): Promise<void> {
    try {
      // Always get a fresh token before making the request
      const token = await this.authService.getAccessToken();
      
      // Verify token exists before making request
      if (!token) {
        throw new Error('Access token is undefined');
      }
      
      console.log(`Making request to r/${this.config.subreddit}/new with token: ${token.substring(0, 5)}...`);
      
      const response = await axios.get(
        `https://oauth.reddit.com/r/${this.config.subreddit}/new`,
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'User-Agent': this.config.userAgent
          },
          params: {
            limit: 25
          }
        }
      );

      const posts = response.data.data.children;
      console.log(JSON.stringify(posts));
      console.log(`Fetched ${posts.length} posts from r/${this.config.subreddit}`);
      
      if (posts.length === 0) {
        return;
      }

      // If this is the first check, just record the newest ID
      if (!this.lastPostId) {
        this.lastPostId = posts[0].data.name;
        return;
      }

      // Find all new posts since last check
      const newPosts = [];
      for (const post of posts) {
        if (post.data.name === this.lastPostId) {
          break;
        }
        newPosts.push(post);
      }

      // Update the last seen post ID
      if (newPosts.length > 0) {
        this.lastPostId = newPosts[0].data.name;
      }

      // Check new posts for keywords
      for (const post of newPosts) {
        const title = post.data.title.toLowerCase();
        const matchedKeywords = this.config.keywords.filter(keyword => 
          title.includes(keyword.toLowerCase())
        );

        if (matchedKeywords.length > 0 && this.config.onMatchFound) {
          this.config.onMatchFound(post, matchedKeywords);
        }
      }
    } catch (error) {
      console.error('Error checking subreddit:', error);
    }
  }
}