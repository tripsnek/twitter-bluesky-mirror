// src/types/index.ts
export interface TweetData {
  id: string;
  text: string;
  timestamp: string;
  images: string[];
  videos: string[];
  videoThumbnails?: Buffer[];  // Add this new field
  postedToBluesky: boolean;
  sourceAccount: string;
  platform: string;
}

export interface AccountPair {
  twitter: string;
  platform: string;
  bluesky: {
    identifier: string;
    password: string;
  };
  storageDir: string;
}

export interface AgentConfig {
  accountPairs: AccountPair[];
  CHECK_INTERVAL_MS: number;
}
