/**
 * Subset of the official SoundCloud Public API schema
 * (https://github.com/soundcloud/api/blob/master/openapi/api.yaml)
 * that this server reads. Every field is optional/nullable because the API
 * omits or nulls many of them in practice.
 */

export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface SCUser {
  urn?: string | null;
  id?: number | null;
  kind?: string | null;
  username?: string | null;
  permalink?: string | null;
  permalink_url?: string | null;
  full_name?: string | null;
  avatar_url?: string | null;
  track_count?: number | null;
  playlist_count?: number | null;
  followers_count?: number | null;
  website?: string | null;
  uri?: string | null;
}

export interface SCTrack {
  kind?: string | null;
  urn?: string | null;
  id?: number | null;
  title?: string | null;
  artwork_url?: string | null;
  bpm?: number | null;
  key_signature?: string | null;
  genre?: string | null;
  tag_list?: string | null;
  duration?: number | null;
  license?: string | null;
  downloadable?: boolean | null;
  download_url?: string | null;
  download_count?: number | null;
  purchase_url?: string | null;
  purchase_title?: string | null;
  permalink_url?: string | null;
  metadata_artist?: string | null;
  label_name?: string | null;
  release_year?: number | null;
  sharing?: string | null;
  streamable?: boolean | null;
  access?: "playable" | "preview" | "blocked" | null;
  playback_count?: number | null;
  favoritings_count?: number | null;
  created_at?: string | null;
  uri?: string | null;
  user?: SCUser | null;
}

export interface SCPlaylist {
  kind?: string | null;
  urn?: string | null;
  id?: number | null;
  title?: string | null;
  description?: string | null;
  duration?: number | null;
  genre?: string | null;
  license?: string | null;
  permalink_url?: string | null;
  playlist_type?: string | null;
  track_count?: number | null;
  tracks?: SCTrack[] | null;
  user?: SCUser | null;
  uri?: string | null;
}

/** Paginated collection (linked_partitioning=true). */
export interface SCCollection<T> {
  collection?: T[] | null;
  next_href?: string | null;
}

export interface SCTokenResponse {
  access_token: string;
  expires_in?: number;
  refresh_token?: string;
  token_type?: string;
  scope?: string;
}

export interface OEmbedResponse {
  version?: number | string;
  type?: string;
  provider_name?: string;
  provider_url?: string;
  title?: string;
  description?: string | null;
  author_name?: string;
  author_url?: string;
  thumbnail_url?: string;
  html?: string;
  width?: number | string;
  height?: number | string;
}
