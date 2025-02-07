import * as dotenv from 'dotenv';
import { CrossPostAgent } from './cross-post-agent';
import { AgentConfig } from './types';
import { BlueskyService } from './services/bluesky-service';
import { TwitterScraperService } from './services/twitter-scraper-service';
import { NitterScraperService } from './services/nitter-scraper-service';
import { ScraperService } from './services/scraper-service';
import fs from 'fs/promises';

dotenv.config();

const urlPre = CrossPostAgent.SCRAPE_SOURCE == 'nitter' ? 'https://' + process.env.NITTER_HOST : 'https://x.com';

interface BlueskyCredentials {
  identifier: string;
  password: string;
}

interface AccountPair {
  twitter: string;
  bluesky: BlueskyCredentials;
  storageDir: string;
}

const agentConfig: AgentConfig = {
  accountPairs: loadMirrorConfigurations(),
  CHECK_INTERVAL_MS: 10 * 60 * 1000, // 10 minutes
};

function loadMirrorConfigurations(): AccountPair[] {

  const pairs: AccountPair[] = [];
  let configIndex = 1;

  while (true) {
    const twitterId = process.env[`MIRROR_${configIndex}_TWITTER_IDENTIFIER`];
    const blueskyId = process.env[`MIRROR_${configIndex}_BLUESKY_IDENTIFIER`];
    const blueskyPassword = process.env[`MIRROR_${configIndex}_BLUESKY_PASSWORD`];

    // If we don't find a configuration for this index, we're done
    if (!twitterId || !blueskyId || !blueskyPassword) {
      break;
    }

    pairs.push({
      twitter: `${urlPre}/${twitterId}`,
      bluesky: {
        identifier: blueskyId,
        password: blueskyPassword,
      },
      storageDir: `./storage/${twitterId.toLowerCase()}`
    });

    configIndex++;
  }

  return pairs;
}

runAgents();

async function runAgents() {
  const scraperService =
    CrossPostAgent.SCRAPE_SOURCE === 'twitter'
      ? new TwitterScraperService()
      : new NitterScraperService();
  const blueskyService = new BlueskyService();

  await Promise.all([
    scraperService.initialize(),
    blueskyService.initialize(agentConfig.accountPairs),
  ]);

  // Ensure storage directories exist
  for (const pair of agentConfig.accountPairs) {
    await fs.mkdir(pair.storageDir, { recursive: true });
  }

  const agent = new CrossPostAgent(agentConfig, scraperService, blueskyService);

  process.on('SIGINT', async () => {
    console.log('Cleaning up...');
    await agent.cleanup();
    process.exit(0);
  });

  agent.start().catch(console.error);
}

