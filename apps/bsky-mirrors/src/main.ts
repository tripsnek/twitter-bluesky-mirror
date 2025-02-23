import * as dotenv from 'dotenv';
import { CrossPostAgent } from './cross-post-agent';
import { AgentConfig } from './types';
import { BlueskyService } from './services/bluesky-service';
import { TwitterScraperService } from './services/twitter-scraper-service';
import { NitterScraperService } from './services/nitter-scraper-service';
import { TruthSocialScraperService } from './services/truth-social-scraper.service';
import { ScraperService } from './services/scraper-service';
import fs from 'fs/promises';
import { ScraperFactory } from './services/scraper-factory';

dotenv.config();

interface BlueskyCredentials {
  identifier: string;
  password: string;
}

interface AccountPair {
  twitter: string;  // Using 'twitter' for backward compatibility
  platform: 'nitter' | 'twitter' | 'truthsocial';
  bluesky: BlueskyCredentials;
  storageDir: string;
}

const agentConfig: AgentConfig = {
  accountPairs: loadMirrorConfigurations(),
  CHECK_INTERVAL_MS: 10 * 60 * 1000, // 10 minutes
};

function getPlatformBaseUrl(platform: string): string {
  switch (platform) {
    case 'nitter':
      return 'https://' + process.env.NITTER_HOST;
    case 'truthsocial':
      return 'https://truthsocial.com';
    case 'twitter':
      return 'https://x.com';
    default:
      throw new Error(`Unsupported platform: ${platform}`);
  }
}

function loadMirrorConfigurations(): AccountPair[] {
  const pairs: AccountPair[] = [];
  let configIndex = 1;

  while (true) {
    const identifier = process.env[`MIRROR_${configIndex}_IDENTIFIER`];
    let platform = process.env[`MIRROR_${configIndex}_PLATFORM`];
    if(!platform) platform = 'nitter';
    const blueskyId = process.env[`MIRROR_${configIndex}_BLUESKY_IDENTIFIER`];
    const blueskyPassword = process.env[`MIRROR_${configIndex}_BLUESKY_PASSWORD`];

    // If we don't find a configuration for this index, we're done
    if (!identifier || !platform || !blueskyId || !blueskyPassword) {
      break;
    }

    // Validate platform type
    if (!['nitter', 'twitter', 'truthsocial'].includes(platform)) {
      console.error(`Invalid platform ${platform} for account ${identifier}, skipping...`);
      configIndex++;
      continue;
    }

    pairs.push({
      twitter: `${getPlatformBaseUrl(platform)}/${identifier}`,
      platform: platform as 'nitter' | 'twitter' | 'truthsocial',
      bluesky: {
        identifier: blueskyId,
        password: blueskyPassword,
      },
      storageDir: `./storage/${identifier.toLowerCase()}`
    });

    configIndex++;
  }

  return pairs;
}

async function runAgents() {
  const scraperFactory = new ScraperFactory();
  const blueskyService = new BlueskyService();

  // Initialize Bluesky service
  await blueskyService.initialize(agentConfig.accountPairs);

  // Ensure storage directories exist
  for (const pair of agentConfig.accountPairs) {
    await fs.mkdir(pair.storageDir, { recursive: true });
  }

  const agent = new CrossPostAgent(agentConfig, scraperFactory, blueskyService);
  
// const tweetData = JSON.parse(`{
//   "id": "114055226421032415",
//   "text": "So-called “Author” Michael Wolff’s new book is a total FAKE JOB, just like the other JUNK he wrote. He called me many times trying to set up a meeting, but I never called him back because I didn’t want to give him the credibility of an interview. Others in the Administration were also called, they reported his calls, and likewise, did not talk to him. I assume, however, he was able to speak to a small number of people, but not meaningfully. His other books about me have been discredited, as this one will be also. I am one who believes in commenting about FAKE NEWS, or made up stories, even if you have to “punch low,” and shouldn’t be wasting the time required to do so. We had one of the Greatest Elections in History, and perhaps the Greatest First Month EVER, according to almost everybody, but Wolff doesn’t want to talk about that. He mentions the people that surrounded me during the Election, and in many cases now, in derogatory terms, but they couldn’t have been that bad because here I am in the White House, refusing to take his calls. Wolff says he has sources, but he doesn’t have them, it’s a LIE, as is the case with many so-called “journalists.” If he has sources, let them be revealed. Watch, it will never happen. He is FAKE NEWS, a total LOSER, and no one should waste their time or money in buying this boring and obviously fictitious book!",
//   "timestamp": "2025-02-23T21:04:00.000Z",
//   "sourceAccount": "https://truthsocial.com/@realDonaldTrump",
//   "platform": "truthsocial",
//   "postedToBluesky": true
// }`);

//   blueskyService.postTweet(tweetData,'https://truthsocial.com/@realDonaldTrump');

  process.on('SIGINT', async () => {
    console.log('Cleaning up...');
    await agent.cleanup();
    process.exit(0);
  });

  agent.start().catch(console.error);
}

runAgents();