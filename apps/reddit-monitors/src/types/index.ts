
// TypeScript interfaces
export interface RedditPost {
  data: {
    id: string;
    title: string;
    permalink: string;
    created_utc: number;
    author: string;
    url: string;
  };
}

export interface RedditResponse {
  data: {
    children: RedditPost[];
  };
}

export interface RedditMonitorConfig {
  subreddit: string;
  checkInterval: string; // Cron pattern
  keywords: string[];
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  userAgent: string;
  onMatchFound?: (post: RedditPost, matchedKeywords: string[]) => void;
}