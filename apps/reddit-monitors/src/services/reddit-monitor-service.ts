import axios from 'axios';
import { CronJob } from 'cron';
import * as http from 'http';
import * as url from 'url';
import { RedditMonitorConfig, RedditPost } from '../types';

export class RedditMonitorService {
  private config: RedditMonitorConfig;
  private lastProcessedPostId: string | null = null;
  private job: CronJob | null = null;
  private isRunning = false;
  private accessToken: string | null = null;
  private refreshToken: string | null = null;
  private tokenExpiry: number = 0;

  constructor(config: RedditMonitorConfig) {
    this.config = {
      ...config,
      // Default callback if none provided
      onMatchFound: config.onMatchFound || this.defaultMatchHandler.bind(this)
    };
  }

  /**
   * Start the authorization process
   */
  public async authorize(): Promise<void> {
    return new Promise((resolve, reject) => {
      // Create a server to handle the callback
      const server = http.createServer(async (req, res) => {
        try {
          if (!req.url) {
            throw new Error('No URL in request');
          }

          const parsedUrl = url.parse(req.url, true);
          const code = parsedUrl.query.code as string;

          if (code) {
            // Exchange code for token
            await this.exchangeCodeForToken(code);
            
            // Send a response to the browser
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end('<html><body><h1>Authentication successful!</h1><p>You can close this window now.</p></body></html>');
            
            // Close the server
            server.close();
            resolve();
          } else {
            throw new Error('No code in callback URL');
          }
        } catch (error) {
          console.error('Error during authorization callback:', error);
          res.writeHead(500, { 'Content-Type': 'text/html' });
          res.end('<html><body><h1>Authentication failed</h1><p>Please try again.</p></body></html>');
          reject(error);
        }
      });

      // Listen on a port
      const port = 8000;
      server.listen(port, async () => {
        console.log(`Listening for callback on port ${port}`);

        // Create the authorization URL
        const authUrl = this.getAuthorizationUrl();
        
        // Open the browser using dynamic import
        console.log(`Opening browser to authorize at: ${authUrl}`);
        try {
          const openModule = await import('open');
          await openModule.default(authUrl);
        } catch (error) {
          console.error('Failed to open browser:', error);
          console.log('Please manually open the following URL in your browser:');
          console.log(authUrl);
        }
      });
    });
  }

  /**
   * Get authorization URL
   */
  private getAuthorizationUrl(): string {
    const state = Math.random().toString(36).substring(2, 15);
    const duration = 'permanent'; // or 'temporary'
    const scope = 'read';
    
    return `https://www.reddit.com/api/v1/authorize?client_id=${this.config.clientId}&response_type=code&state=${state}&redirect_uri=${encodeURIComponent(this.config.redirectUri)}&duration=${duration}&scope=${scope}`;
  }

  /**
   * Exchange code for token
   */
  private async exchangeCodeForToken(code: string): Promise<void> {
    try {
      const response = await axios({
        method: 'post',
        url: 'https://www.reddit.com/api/v1/access_token',
        auth: {
          username: this.config.clientId,
          password: this.config.clientSecret
        },
        data: `grant_type=authorization_code&code=${code}&redirect_uri=${encodeURIComponent(this.config.redirectUri)}`,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': this.config.userAgent
        }
      });

      this.accessToken = response.data.access_token;
      this.refreshToken = response.data.refresh_token;
      this.tokenExpiry = Date.now() + (response.data.expires_in * 1000);
      
      console.log('Authentication successful!');
    } catch (error) {
      console.error('Error exchanging code for token:', error);
      throw error;
    }
  }

  /**
   * Refresh access token
   */
  private async refreshAccessToken(): Promise<void> {
    if (!this.refreshToken) {
      throw new Error('No refresh token available');
    }

    try {
      const response = await axios({
        method: 'post',
        url: 'https://www.reddit.com/api/v1/access_token',
        auth: {
          username: this.config.clientId,
          password: this.config.clientSecret
        },
        data: `grant_type=refresh_token&refresh_token=${this.refreshToken}`,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': this.config.userAgent
        }
      });

      this.accessToken = response.data.access_token;
      this.tokenExpiry = Date.now() + (response.data.expires_in * 1000);
      
      console.log('Token refreshed successfully');
    } catch (error) {
      console.error('Error refreshing token:', error);
      throw error;
    }
  }

  /**
   * Start the monitoring service
   */
  public async start(): Promise<void> {
    if (this.isRunning) {
      console.log('Monitor already running');
      return;
    }

    // Check if we have a valid token
    if (!this.accessToken || Date.now() >= this.tokenExpiry) {
      if (this.refreshToken) {
        await this.refreshAccessToken();
      } else {
        throw new Error('Not authorized. Please call authorize() first');
      }
    }

    console.log(`Starting Reddit monitor for r/${this.config.subreddit}`);
    console.log(`Looking for posts containing keywords: ${this.config.keywords.join(', ')}`);
    console.log(`Check interval: ${this.config.checkInterval}`);
    
    // Run immediately on startup
    await this.checkNewPosts();
    
    // Schedule periodic checks
    this.job = new CronJob(this.config.checkInterval, async () => {
      // Check if token needs refresh
      if (Date.now() >= this.tokenExpiry) {
        await this.refreshAccessToken();
      }
      await this.checkNewPosts();
    });
    this.job.start();
    
    this.isRunning = true;
    console.log('Monitoring started successfully');
  }

  /**
   * Stop the monitoring service
   */
  public stop(): void {
    if (!this.isRunning || !this.job) {
      console.log('Monitor is not running');
      return;
    }

    this.job.stop();
    this.isRunning = false;
    console.log('Monitoring stopped');
  }

  /**
   * Default handler for matched posts
   */
  private defaultMatchHandler(post: RedditPost, matchedKeywords: string[]): void {
    console.log('\n--- MATCHING POST FOUND ---');
    console.log(`Title: ${post.data.title}`);
    console.log(`Matched keywords: ${matchedKeywords.join(', ')}`);
    console.log(`Author: ${post.data.author}`);
    console.log(`URL: https://reddit.com${post.data.permalink}`);
    console.log(`Posted: ${new Date(post.data.created_utc * 1000).toLocaleString()}`);
    console.log('-------------------------\n');
  }

  /**
   * Check for new posts
   */
  private async checkNewPosts(): Promise<void> {
    try {
      console.log(`Checking r/${this.config.subreddit} for new posts at ${new Date().toISOString()}`);
      
      // Fetch new posts
      const response = await axios({
        method: 'get',
        url: `https://oauth.reddit.com/r/${this.config.subreddit}/new.json?limit=25`,
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'User-Agent': this.config.userAgent
        }
      });
      
      const posts = response.data.data.children as RedditPost[];
      
      // Process posts
      this.processPosts(posts);
      
    } catch (error) {
      console.error('Error checking new posts:', error);
    }
  }

  /**
   * Process posts and check for keywords
   */
  private processPosts(posts: RedditPost[]): void {
    // Reverse to process oldest to newest
    const sortedPosts = [...posts].sort((a, b) => 
      a.data.created_utc - b.data.created_utc
    );
    
    for (const post of sortedPosts) {
      // Skip if we've already processed this post
      if (this.lastProcessedPostId && post.data.id === this.lastProcessedPostId) {
        continue;
      }
      
      const title = post.data.title.toLowerCase();
      const matchedKeywords = this.config.keywords.filter(keyword => 
        title.includes(keyword.toLowerCase())
      );
      
      if (matchedKeywords.length > 0 && this.config.onMatchFound) {
        this.config.onMatchFound(post, matchedKeywords);
      }
      
      // Update the last processed post ID
      this.lastProcessedPostId = post.data.id;
    }
  }
}