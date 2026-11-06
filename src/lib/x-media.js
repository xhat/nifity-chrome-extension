/**
 * X (Twitter) video resolution, shared by the content script (classic script)
 * and the background worker (imported for its side effect).
 *
 * X plays every video through MSE: the `<video>` holds a `blob:` URL and the
 * network only carries HLS playlists, init fragments and `.m4s` segments — none
 * of them a downloadable file. The tweet's own metadata, however, lists
 * progressive MP4 renditions (`video_info.variants`, `content_type: video/mp4`)
 * that are complete files with `moov` up front. The public syndication endpoint
 * behind embedded tweets serves that metadata without a login, so a video is
 * resolved by: poster URL → media key, surrounding DOM → tweet id, syndication
 * JSON → MP4 variants of that media key.
 */
(function (global) {
  const X_HOSTS = /(^|\.)(x|twitter)\.com$/i;
  // amplify_video/<id>/…, ext_tw_video/<id>/… and their `_thumb` posters.
  const NUMERIC_KEY = /\/(amplify_video|ext_tw_video)(?:_thumb)?\/(\d+)\//;
  // GIFs: tweet_video/<key>.mp4 and tweet_video_thumb/<key>.jpg.
  const GIF_KEY = /\/tweet_video(?:_thumb)?\/([A-Za-z0-9_-]+)\./;
  const STATUS_ID = /\/status(?:es)?\/(\d{5,25})/;

  function isXHost(hostname) {
    return X_HOSTS.test(String(hostname || ''));
  }

  /** Stable id of one X media item, from either a poster or a video URL. */
  function mediaKey(rawURL) {
    let url;
    try {
      url = new URL(rawURL);
    } catch {
      return '';
    }
    if (!/(^|\.)twimg\.com$/i.test(url.hostname)) return '';
    const numeric = NUMERIC_KEY.exec(url.pathname);
    if (numeric) return numeric[2];
    const gif = GIF_KEY.exec(url.pathname);
    return gif ? `gif:${gif[1]}` : '';
  }

  function statusId(href) {
    return STATUS_ID.exec(String(href || ''))?.[1] || '';
  }

  /** The syndication token is derived from the id the same way X's embed does. */
  function syndicationURL(tweetId) {
    const token = ((Number(tweetId) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, '');
    return `https://cdn.syndication.twimg.com/tweet-result?id=${encodeURIComponent(tweetId)}&lang=en&token=${token}`;
  }

  function resolutionOf(url) {
    return /\/(\d{2,5}x\d{2,5})\//.exec(String(url || ''))?.[1] || '';
  }

  /**
   * Every video in a syndication `tweet-result` (the tweet and the tweet it
   * quotes), with only its progressive MP4 variants, highest bitrate first.
   *
   * @returns {Array<{key: string, tweetId: string, screenName: string,
   *   durationMs: number, variants: Array<{url: string, bitrate: number, resolution: string}>}>}
   */
  function videosFromTweet(tweet) {
    const out = [];
    const visit = (node) => {
      if (!node || typeof node !== 'object') return;
      for (const media of Array.isArray(node.mediaDetails) ? node.mediaDetails : []) {
        const variants = (media?.video_info?.variants || [])
          .filter((variant) => variant?.content_type === 'video/mp4' && /^https:\/\//.test(variant.url || ''))
          .map((variant) => ({
            url: variant.url,
            bitrate: Number(variant.bitrate) || 0,
            resolution: resolutionOf(variant.url),
          }))
          .sort((a, b) => b.bitrate - a.bitrate);
        if (!variants.length) continue;
        const key = mediaKey(variants[0].url) || mediaKey(media.media_url_https);
        if (!key) continue;
        out.push({
          key,
          tweetId: String(node.id_str || ''),
          screenName: String(node.user?.screen_name || ''),
          durationMs: Number(media.video_info.duration_millis) || 0,
          variants,
        });
      }
      visit(node.quoted_tweet);
    };
    visit(tweet);
    return out;
  }

  global.NiftyXMedia = { isXHost, mediaKey, statusId, syndicationURL, resolutionOf, videosFromTweet };
})(globalThis);
