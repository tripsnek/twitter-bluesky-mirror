import { TweetData } from "../types";

export interface ScraperService{
 getLatestTweets(twitter: string): Promise<TweetData[]>;
 initialize(): any;   
 cleanup(): any;
}