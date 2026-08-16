import { Song } from "@/data/songs";

export const YOUTUBE_API_KEY = "AIzaSyDd957ow_f9i9fiuIo8jZbmfrWVdrr_NnY";

export async function searchYouTubeSongs(
  query: string,
  maxResults = 50,
  pageToken = ""
): Promise<{ songs: Song[]; nextPageToken?: string }> {
  try {
    const encodedQuery = encodeURIComponent(query);
    let url = `https://www.googleapis.com/youtube/v3/search?part=snippet&maxResults=${maxResults}&q=${encodedQuery}&type=video&key=${YOUTUBE_API_KEY}`;
    if (pageToken) {
      url += `&pageToken=${pageToken}`;
    }

    const res = await fetch(url);
    if (!res.ok) return { songs: [] };

    const data = await res.json();
    if (!data.items) return { songs: [] };

    const songs = data.items.map((item: any) => ({
      id: item.id.videoId,
      title: item.snippet.title
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">"),
      artist: item.snippet.channelTitle || "YouTube Music",
      tag: "Live YouTube Stream",
    }));

    return { songs, nextPageToken: data.nextPageToken };
  } catch (err) {
    console.warn("YouTube API search error:", err);
    return { songs: [] };
  }
}
