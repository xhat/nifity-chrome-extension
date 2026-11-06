import test from 'node:test';
import assert from 'node:assert/strict';

import '../src/lib/x-media.js';

const { isXHost, mediaKey, statusId, syndicationURL, videosFromTweet } = globalThis.NiftyXMedia;

test('poster and video URLs of one X media share a key', () => {
  const poster = 'https://pbs.twimg.com/amplify_video_thumb/2118296005737390080/img/848aptj1-y63no-C?format=webp&name=medium';
  const mp4 = 'https://video.twimg.com/amplify_video/2118296005737390080/vid/avc1/1280x720/n9T2i5Mq0NgYiU4g.mp4?tag=29';
  const playlist = 'https://video.twimg.com/amplify_video/2118296005737390080/pl/r8rB9gVV3BeerB2F.m3u8?tag=29&v=cfc';
  assert.equal(mediaKey(poster), '2118296005737390080');
  assert.equal(mediaKey(mp4), '2118296005737390080');
  assert.equal(mediaKey(playlist), '2118296005737390080');

  assert.equal(mediaKey('https://pbs.twimg.com/ext_tw_video_thumb/1966323443231522816/pu/img/a.jpg'), '1966323443231522816');
  assert.equal(mediaKey('https://video.twimg.com/ext_tw_video/1966323443231522816/pu/vid/avc1/480x360/b.mp4'), '1966323443231522816');

  // GIFs are keyed by their file stem, not a numeric id.
  assert.equal(mediaKey('https://pbs.twimg.com/tweet_video_thumb/GxAbC-1_z.jpg'), 'gif:GxAbC-1_z');
  assert.equal(mediaKey('https://video.twimg.com/tweet_video/GxAbC-1_z.mp4'), 'gif:GxAbC-1_z');

  // Same path shape on another host is not X media.
  assert.equal(mediaKey('https://evil.example.com/amplify_video/123456/vid/a.mp4'), '');
  assert.equal(mediaKey(''), '');
});

test('statusId and host detection', () => {
  assert.equal(statusId('/Makkiiil/status/2118296109001171386/video/1'), '2118296109001171386');
  assert.equal(statusId('https://twitter.com/i/web/status/2118296109001171386'), '2118296109001171386');
  assert.equal(statusId('/home'), '');
  assert.equal(isXHost('x.com'), true);
  assert.equal(isXHost('mobile.twitter.com'), true);
  assert.equal(isXHost('notx.com'), false);
});

test('syndicationURL matches the token X accepts', () => {
  // Captured from a live 200 response for this tweet.
  assert.equal(
    syndicationURL('2118296109001171386'),
    'https://cdn.syndication.twimg.com/tweet-result?id=2118296109001171386&lang=en&token=54utn8xz66k',
  );
});

test('videosFromTweet keeps MP4 variants, best first, including quoted tweets', () => {
  const tweet = {
    id_str: '2118296109001171386',
    user: { screen_name: 'Makkiiil' },
    mediaDetails: [
      { type: 'photo', media_url_https: 'https://pbs.twimg.com/media/x.jpg' },
      {
        type: 'video',
        media_url_https: 'https://pbs.twimg.com/amplify_video_thumb/2118296005737390080/img/a.jpg',
        video_info: {
          duration_millis: 46648,
          variants: [
            { content_type: 'application/x-mpegURL', url: 'https://video.twimg.com/amplify_video/2118296005737390080/pl/m.m3u8' },
            { bitrate: 256000, content_type: 'video/mp4', url: 'https://video.twimg.com/amplify_video/2118296005737390080/vid/avc1/480x270/a.mp4' },
            { bitrate: 2176000, content_type: 'video/mp4', url: 'https://video.twimg.com/amplify_video/2118296005737390080/vid/avc1/1280x720/c.mp4' },
            { bitrate: 832000, content_type: 'video/mp4', url: 'https://video.twimg.com/amplify_video/2118296005737390080/vid/avc1/640x360/b.mp4' },
          ],
        },
      },
    ],
    quoted_tweet: {
      id_str: '111',
      user: { screen_name: 'quoted' },
      mediaDetails: [
        {
          type: 'animated_gif',
          video_info: { variants: [{ bitrate: 0, content_type: 'video/mp4', url: 'https://video.twimg.com/tweet_video/Gif1.mp4' }] },
        },
      ],
    },
  };

  const videos = videosFromTweet(tweet);
  assert.deepEqual(
    videos.map((video) => [video.key, video.tweetId, video.screenName]),
    [
      ['2118296005737390080', '2118296109001171386', 'Makkiiil'],
      ['gif:Gif1', '111', 'quoted'],
    ],
  );
  assert.deepEqual(
    videos[0].variants.map((variant) => [variant.resolution, variant.bitrate]),
    [
      ['1280x720', 2176000],
      ['640x360', 832000],
      ['480x270', 256000],
    ],
  );
  assert.equal(videos[0].durationMs, 46648);
  assert.deepEqual(videosFromTweet(null), []);
  assert.deepEqual(videosFromTweet({ mediaDetails: [{ video_info: { variants: [] } }] }), []);
});
