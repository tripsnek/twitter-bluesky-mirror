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

  process.on('SIGINT', async () => {
    console.log('Cleaning up...');
    await agent.cleanup();
    process.exit(0);
  });

  agent.start().catch(console.error);
}

runAgents();