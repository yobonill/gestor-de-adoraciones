export type SongStatus = "pending" | "approved" | "blacklisted" | "rejected";
export type VideoStatus = "usable" | "blacklisted";

export type FilterOption = {
  id: string;
  label: string;
  active: boolean;
};

export type FilterGroup = {
  id: string;
  label: string;
  multiSelect: boolean;
  options: FilterOption[];
};

export type AppConfig = {
  filterGroups: FilterGroup[];
};

export type SongVideo = {
  id: string;
  youtubeVideoId: string;
  youtubeUrl: string;
  title: string;
  thumbnailUrl: string;
  videoTypeIds: string[];
  status: VideoStatus;
  blacklistReason?: string;
};

export type SongSearchIndex = {
  title: string;
  artist: string;
};

export type Song = {
  id: string;
  title: string;
  artist: string;
  search?: SongSearchIndex;
  notes: string;
  status: SongStatus;
  proposedStatus?: "approved" | "blacklisted";
  blacklistReason?: string;
  classifications: Record<string, string[]>;
  videos: SongVideo[];
  createdAt?: string;
  updatedAt?: string;
};

export type ServiceItem = {
  songId: string;
  songTitle: string;
  songArtist?: string;
  videoId: string;
  videoTitle: string;
  youtubeUrl: string;
  videoTypeLabel?: string;
};

export type ServiceSection = {
  id: string;
  label: string;
  date?: string;
  items: ServiceItem[];
};

export type ServicePlan = {
  id: string;
  title: string;
  kind: "single" | "weekend";
  date: string;
  sections: ServiceSection[];
  createdAt?: string;
  updatedAt?: string;
};
