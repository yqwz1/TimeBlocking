const YOUTUBE_VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

function validVideoId(value: string | null | undefined): string | null {
  const candidate = value?.trim() ?? '';
  return YOUTUBE_VIDEO_ID.test(candidate) ? candidate : null;
}

/** Extracts a video id from regular, shortened, Shorts, Live, and embed YouTube URLs. */
export function getYouTubeVideoId(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }

  const host = url.hostname.toLocaleLowerCase().replace(/^www\./, '');
  if (host === 'youtu.be') {
    return validVideoId(url.pathname.split('/').filter(Boolean)[0]);
  }

  const isYouTubeHost = host === 'youtube.com' || host.endsWith('.youtube.com');
  const isPrivacyHost = host === 'youtube-nocookie.com' || host.endsWith('.youtube-nocookie.com');
  if (!isYouTubeHost && !isPrivacyHost) return null;

  const queryId = validVideoId(url.searchParams.get('v'));
  if (queryId) return queryId;

  const [kind, pathId] = url.pathname.split('/').filter(Boolean);
  if (['shorts', 'live', 'embed'].includes(kind?.toLocaleLowerCase() ?? '')) {
    return validVideoId(pathId);
  }
  return null;
}

export function getYouTubeCanonicalUrl(videoId: string): string {
  const id = validVideoId(videoId);
  if (!id) throw new Error('Invalid YouTube video id');
  return `https://www.youtube.com/watch?v=${id}`;
}

export function getYouTubeEmbedUrl(videoId: string): string {
  const id = validVideoId(videoId);
  if (!id) throw new Error('Invalid YouTube video id');
  return `https://www.youtube-nocookie.com/embed/${id}?rel=0`;
}

export function getYouTubeThumbnailUrl(videoId: string): string {
  const id = validVideoId(videoId);
  if (!id) throw new Error('Invalid YouTube video id');
  return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
}
