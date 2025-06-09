
// src/services/reddit-auth-service.ts
import axios from 'axios';

export interface RedditAuthConfig {
  clientId: string;
  clientSecret: string;
  username: string;
  password: string;
  userAgent: string;
}

export interface RedditAuthResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
}

export class RedditAuthService {
  private config: RedditAuthConfig;
  private token: string | null = null;
  private tokenExpiry: Date | null = null;

  constructor(config: RedditAuthConfig) {
    this.config = config;
    
    // Validate the User-Agent
    if (!config.userAgent || config.userAgent === 'SubredditKeywordMonitor/1.0') {
      console.warn('Warning: Using a generic User-Agent may cause API blocks. Consider using a more specific one.');
    }
  }

  /**
   * Get a valid access token, refreshing if necessary
   */
  async getAccessToken(): Promise<string> {
    // Check if we already have a valid token
    if (this.token && this.tokenExpiry && this.tokenExpiry > new Date()) {
      return this.token;
    }

    // Need to get a new token
    try {
      console.log('Requesting new access token...');
      
      const response = await axios.post<RedditAuthResponse>(
        'https://www.reddit.com/api/v1/access_token',
        new URLSearchParams({
          grant_type: 'password',
          username: this.config.username,
          password: this.config.password,
        }),
        {
          headers: {
            'User-Agent': this.config.userAgent,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          auth: {
            username: this.config.clientId,
            password: this.config.clientSecret,
          },
        }
      );

      console.log('Access token obtained successfully');
      this.token = response.data.access_token;
      
      // Set expiry time (with a small buffer)
      const expiresInMs = (response.data.expires_in - 60) * 1000;
      this.tokenExpiry = new Date(Date.now() + expiresInMs);
      
      return this.token;
    } catch (error) {
      console.error('Error obtaining Reddit access token:', error);
      throw new Error('Failed to authenticate with Reddit API');
    }
  }
}