import { AppBskyFeedDefs, BskyAgent, RichText } from '@atproto/api';
import { TweetData, AccountPair } from '../types';

export class BlueskyService {
  private agents: Map<string, BskyAgent>;
  private recentPosts: Map<string, string[]> = new Map<string, string[]>(); // Store recent post texts by account

  constructor() {
    this.agents = new Map();
  }

  async initialize(accountPairs: AccountPair[]): Promise<void> {
    for (const pair of accountPairs) {
      const bsky = new BskyAgent({
        service: 'https://bsky.social',
      });

      await bsky.login({
        identifier: pair.bluesky.identifier,
        password: pair.bluesky.password,
      });

      this.agents.set(pair.twitter, bsky);

      console.log(
        `Successfully logged into Bluesky with ${pair.bluesky.identifier} to mirror ${pair.twitter}`
      );

      // Initialize recent posts cache for this account
      await this.loadRecentPosts(pair.twitter);
    }
  }

  private async loadRecentPosts(sourceAccount: string): Promise<void> {
    const bskyAgent = this.agents.get(sourceAccount);
    if (!bskyAgent) {
      throw new Error(`No Bluesky agent found for ${sourceAccount}`);
    }

    try {
      // Get the user's profile to get their DID
      const profile = await bskyAgent.getProfile({
        actor: bskyAgent.session?.did || '',
      });

      const response = await bskyAgent.getAuthorFeed({
        actor: profile.data.did,
        limit: 20,
      });

      // Extract and format the posts
      const posts = response.data.feed.map((item) => {
        const feedView = item.post as AppBskyFeedDefs.PostView;
        const record = feedView.record as { text: string; createdAt: string };

        // console.log('adding record ' + record.text);

        return {
          text: record.text,
          createdAt: record.createdAt,
        };
      });

      const recentPostTexts = [];
      for (const p of posts) recentPostTexts.push(p.text);

      this.recentPosts.set(sourceAccount, recentPostTexts);
      console.log(
        '\n\n=== MOST RECENT BSKY POSTS FOR ' + sourceAccount + '==='
      );
      for (const p of recentPostTexts) console.log(' - ' + p);
      console.log('==================================\n\n');
    } catch (error) {
      console.error('Error loading recent posts:', error);
      this.recentPosts.set(sourceAccount, []);
    }
  }

  public isDuplicateWithRecentBlueskyPosts(
    text: string,
    sourceAccount: string
  ): boolean {
    const recentPosts = this.recentPosts.get(sourceAccount);
    if (!recentPosts) {
      return false;
    }

    // Clean up the text for comparison (remove URLs, normalize whitespace)
    const cleanText = text
      .replace(/https?:\/\/\S+/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase()
      .substring(0, 70);

    // Check if any recent post matches this text
    for (const existingPost of recentPosts) {
      const cleanExisting = existingPost
        .replace(/https?:\/\/\S+/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase()
        .substring(0, 70);

      // return false;
      if (cleanText === cleanExisting) {
        return true;
      }
    }
    return false;
  }

  async postTweet(tweet: TweetData, sourceAccount: string): Promise<void> {
    const bskyAgent = this.agents.get(sourceAccount);
    if (!bskyAgent) {
      throw new Error(`No Bluesky agent found for ${sourceAccount}`);
    }

    // Check for duplicates before posting
    if (this.isDuplicateWithRecentBlueskyPosts(tweet.text, sourceAccount)) {
      console.log(`Skipping duplicate tweet: ${tweet.text}`);
      return;
    }

    console.log('Posting tweet ' + tweet.text);
    await new BlueskyPoster(bskyAgent).createPost(tweet);

    //add to recent posts
    const recentPosts = this.recentPosts.get(sourceAccount);
    recentPosts?.unshift(tweet.text);
    if (recentPosts) {
      while (recentPosts?.length > 0) recentPosts.pop();
    }
  }
}

interface ImageUploadResult {
  success: boolean;
  blob?: any;
  error?: string;
}

export class BlueskyPoster {
  private agent: BskyAgent;

  constructor(agent: BskyAgent) {
    this.agent = agent;
  }

  private async fetchAndUploadImage(
    imageUrl: string
  ): Promise<ImageUploadResult> {
    try {
      // Convert nitter URL to Twitter URL format
      const modifiedUrl = imageUrl.replace(
        /https:\/\/nitter\.net\/pic\/media%2F(.*?)\.(jpg|png|gif)/,
        'https://pbs.twimg.com/media/$1.$2'
      );

      console.log(`Attempting to fetch image from: ${modifiedUrl}`);

      const response = await fetch(modifiedUrl, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
          Accept: 'image/webp,image/apng,image/*,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
        },
      });

      if (!response.ok) {
        throw new Error(
          `Failed to fetch image: ${response.statusText} (${response.status})`
        );
      }

      const imageArrayBuffer = await response.arrayBuffer();
      const uint8Array = new Uint8Array(imageArrayBuffer);

      if (uint8Array.length === 0) {
        throw new Error('Received empty image data');
      }

      console.log(
        `Successfully fetched image, size: ${uint8Array.length} bytes`
      );

      // Get content type from response, or infer it
      let contentType = response.headers.get('content-type');
      if (!contentType || !contentType.startsWith('image/')) {
        const extension = modifiedUrl.split('.').pop()?.toLowerCase();
        contentType =
          extension === 'jpg' || extension === 'jpeg'
            ? 'image/jpeg'
            : `image/${extension}`;
      }

      const { data } = await this.agent.uploadBlob(uint8Array, {
        encoding: contentType,
      });

      if (!data.blob || data.blob.size === 0) {
        throw new Error('Blob upload succeeded but resulted in empty blob');
      }

      console.log('Successfully uploaded image to Bluesky');
      return {
        success: true,
        blob: data.blob,
      };
    } catch (error) {
      console.error('Image upload error:', error);
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : 'Unknown error during image upload',
      };
    }
  }
  private readonly CHAR_LIMIT = 299;

  private splitTextIntoChunks(text: string): string[] {
    
    // Leave more room for thread markers (e.g., "1/5 " = 4 chars)
    const SAFE_LIMIT = this.CHAR_LIMIT - 20;

    //no chunking if text is already safe
    if(text.length<SAFE_LIMIT) return [text];
    const chunks: string[] = [];

    // First try splitting on sentences
    const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
    let currentChunk = '';

    for (const sentence of sentences) {
      if ((currentChunk + sentence).length <= SAFE_LIMIT) {
        currentChunk += sentence;
      } else {
        // If current chunk is not empty, save it
        if (currentChunk) {
          chunks.push(currentChunk.trim());
        }

        // If sentence is longer than limit, split on spaces
        if (sentence.length > SAFE_LIMIT) {
          const words = sentence.split(/\s+/);
          currentChunk = '';

          for (const word of words) {
            if ((currentChunk + ' ' + word).length <= SAFE_LIMIT) {
              currentChunk += (currentChunk ? ' ' : '') + word;
            } else {
              if (currentChunk) {
                chunks.push(currentChunk.trim());
              }
              currentChunk = word;
            }
          }
        } else {
          currentChunk = sentence;
        }
      }
    }

    // Add any remaining text
    if (currentChunk) {
      chunks.push(currentChunk.trim());
    }

    // Verify no chunk is too long
    return chunks.map((chunk) => {
      if (chunk.length > SAFE_LIMIT) {
        // If still too long, force split at limit
        return chunk.substring(0, SAFE_LIMIT);
      }
      return chunk;
    });
  }
  // Create a single post with media
  private async createSinglePost(
    text: string,
    embed: any,
    threadInfo?: { 
      root?: { uri: string; cid: string },
      parent: { uri: string; cid: string }
    },
    timestamp?: string
  ) {
    const rt = new RichText({ text });
    await rt.detectFacets(this.agent);

    const postData: any = {
      text: rt.text,
      facets: rt.facets,
      embed,
    };

    if (threadInfo) {
      postData.reply = {
        root: threadInfo.root || threadInfo.parent, // First post is both root and parent
        parent: threadInfo.parent
      };
    }

    if (timestamp) {
      postData.createdAt = new Date(timestamp).toISOString();
    }

    return await this.agent.post(postData);
  }

  async createPost(postData: TweetData) {
    await new Promise((f) => setTimeout(f, 1000));

    if (!this.agent) {
      throw new Error('Agent not initialized. Please login first.');
    }

    try {
      // Always split the text into chunks first
      const textChunks = this.splitTextIntoChunks(postData.text);
      console.log(`Split text into ${textChunks.length} chunks:`);
      textChunks.forEach((chunk, i) =>
        console.log(
          `Chunk ${i + 1}/${textChunks.length}: ${chunk.length} chars`
        )
      );

      // Prepare media embed (only for the first post in thread)
      let embed = undefined;

      // Inside the createPost method, update the Truth Social video handling:

      if (postData.platform === 'truthsocial') {
        // Handle Truth Social direct video URLs
        if (postData.videos?.length > 0) {
          const videoUrl = postData.videos[0];
          const thumbnail = postData.videoThumbnails?.[0];

          // Create external embed with video link
          const embedData: any = {
            $type: 'app.bsky.embed.external',
            external: {
              uri: videoUrl,
              title: 'Video',
              description: postData.text.substring(0, 300),
            },
          };

          // Add thumbnail if we have it
          if (thumbnail) {
            try {
              const { data } = await this.agent.uploadBlob(thumbnail, {
                encoding: 'image/jpeg',
              });

              if (data.blob) {
                embedData.external.thumb = data.blob;
              }
            } catch (error) {
              console.log(
                'Failed to upload video thumbnail, continuing without it:',
                error
              );
            }
          }

          embed = embedData;
        }
        // Handle Truth Social images if no video
        else if (postData.images?.length) {
          const imageUploads = await Promise.all(
            postData.images.slice(0, 4).map(async (imageBuffer) => {
              try {
                const { data } = await this.agent.uploadBlob(imageBuffer, {
                  encoding: 'image/jpeg',
                });

                return {
                  success: true,
                  blob: data.blob,
                };
              } catch (error) {
                console.error('Image upload error:', error);
                return {
                  success: false,
                  error:
                    error instanceof Error
                      ? error.message
                      : 'Unknown error during image upload',
                };
              }
            })
          );

          const successfulUploads = imageUploads.filter(
            (upload) => upload.success && upload.blob
          );

          if (successfulUploads.length > 0) {
            embed = {
              $type: 'app.bsky.embed.images',
              images: successfulUploads.map((upload) => ({
                alt: 'Image from original post',
                image: upload.blob,
                aspectRatio: {
                  width: 1,
                  height: 1,
                },
              })),
            };
          }
        }
      } else {
        // Original handling for other platforms
        // Handle YouTube videos
        if (postData.videos?.length > 0) {
          const videoUrl = postData.videos[0];
          if (
            videoUrl.includes('youtube.com') ||
            videoUrl.includes('youtu.be')
          ) {
            let videoId;
            if (videoUrl.includes('youtube.com/watch?v=')) {
              videoId = new URL(videoUrl).searchParams.get('v');
            } else if (videoUrl.includes('youtu.be/')) {
              videoId = videoUrl.split('youtu.be/')[1];
            }

            if (videoId) {
              const thumbUrl = `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`;
              embed = {
                $type: 'app.bsky.embed.external',
                external: {
                  uri: videoUrl,
                  title: 'YouTube Video',
                  description: '',
                  thumb: (await this.fetchAndUploadImage(thumbUrl))?.blob,
                },
              };
            }
          }
        }
        // Handle images if no video
        else if (postData.images?.length) {
          const imageUploads = await Promise.all(
            postData.images
              .slice(0, 4)
              .map((url) => this.fetchAndUploadImage(url))
          );

          const successfulUploads = imageUploads.filter(
            (upload) => upload.success && upload.blob
          );

          if (successfulUploads.length > 0) {
            embed = {
              $type: 'app.bsky.embed.images',
              images: successfulUploads.map((upload) => ({
                alt: 'Image from original tweet',
                image: upload.blob,
                aspectRatio: {
                  width: 1,
                  height: 1,
                },
              })),
            };
          }
        }
      }

      // Create posts
      // Never try to post a single post if we have multiple chunks
      if (textChunks.length > 1 || textChunks[0].length > this.CHAR_LIMIT) {
        // Create thread for multiple chunks
        let rootRef: { uri: string; cid: string } | undefined;
        let parentRef: { uri: string; cid: string } | undefined;
        const posts = [];
  
        for (let i = 0; i < textChunks.length; i++) {
          const chunk = textChunks[i];
          const postEmbed = i === 0 ? embed : undefined;
          const threadMarker = `${i + 1}/${textChunks.length} `;
  
          let threadInfo;
          if (i > 0 && parentRef) {  // Only create threadInfo if we have a parent and it's not the first post
            threadInfo = {
              root: rootRef,
              parent: parentRef
            };
          }
  
          const post = await this.createSinglePost(
            threadMarker + chunk,
            postEmbed,
            threadInfo,
            postData.timestamp
          );
  
          posts.push(post);
          
          if (i === 0) {
            rootRef = { uri: post.uri, cid: post.cid };
          }
          parentRef = { uri: post.uri, cid: post.cid };
  
          // Add small delay between posts to avoid rate limits
          if (i < textChunks.length - 1) {
            await new Promise(f => setTimeout(f, 1000));
          }
        }
  
        return {
          success: true,
          uri: posts[0].uri,
          cid: posts[0].cid,
          isThread: true,
          threadPosts: posts.map(p => ({ uri: p.uri, cid: p.cid }))
        };
      } else {
        // Only create a single post if we have one small chunk
        const post = await this.createSinglePost(
          textChunks[0],
          embed,
          undefined,
          postData.timestamp
        );

        return {
          success: true,
          uri: post.uri,
          cid: post.cid,
        };
      }
    } catch (error) {
      console.error('Post creation error:', error);
      throw error;
    }
  }
}
