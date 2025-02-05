// src/services/StorageService.ts
import fs from 'fs/promises';
import path from 'path';
import { TweetData } from '../types';

export class StorageService {
  private static sanitizeTimestamp(timestamp: string): string {
    return timestamp.replace(/:/g, '_').replace(/[<>:"\/\\|?*]/g, '_');
  }

  static async saveTweet(tweet: TweetData, storageDir: string): Promise<void> {
    const tweetPath = path.join(storageDir, `${this.sanitizeTimestamp(tweet.timestamp)}.json`);
    await fs.mkdir(path.dirname(tweetPath), { recursive: true });
    await fs.writeFile(tweetPath, JSON.stringify(tweet, null, 2));
  }

  static async loadTweet(tweetFile: string, storageDir: string): Promise<TweetData | null> {
    try {
      const tweetPath = path.join(storageDir, `${tweetFile}`);
      const content = await fs.readFile(tweetPath, 'utf-8');
      return JSON.parse(content);
    } catch (error) {
      console.error(`Failed to load tweet ${tweetFile}:`, error);
      return null;
    }
  }
}