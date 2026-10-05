export type ProjectPipelineStatus =
  | 'idea'
  | 'story'
  | 'characters'
  | 'storyboard'
  | 'voice'
  | 'animation'
  | 'editing'
  | 'qc'
  | 'thumbnail'
  | 'ready'
  | 'scheduled'
  | 'published'
  | 'blocked';

export interface CharacterVoiceProfile {
  voiceType: string;
  pitch: number;
  speed: number;
  timbre?: string;
  language?: string;
}

export interface Character {
  id: string;
  name: string;
  species: string;
  personality: string;
  age: string;
  colorPalette: string[];
  clothing: string;
  visualFeatures: string;
  voiceProfile: CharacterVoiceProfile;
  visualConsistencyPrompt: string;
  masterPrompt: string;
  tagline?: string;
  turnaroundNotes?: string;
  avatarSvg?: string;
  referenceImages?: string[];
}

export type SceneMotionType = 'pan-left' | 'pan-right' | 'zoom-in' | 'zoom-out' | 'static' | 'ken-burns';

export interface Scene {
  id: string;
  scene_id: string;
  location: string;
  time: string;
  characters: string[];
  action: string;
  camera: string;
  dialogue: string;
  narration: string;
  sound_effects: string;
  music: string;
  duration: number; // in seconds
  visual_prompt: string;
  visualSvg?: string;
  imageUrl?: string;
  imageStorageKey?: string;
  visualState?: 'pending' | 'generating' | 'ready' | 'failed';
  seedUsed?: number;
  motionType: SceneMotionType;
  voiceAudioState?: 'ready' | 'pending' | 'synthesized';
  audioUrl?: string;
  measuredAudioDuration?: number;
}

export interface QualityControlCategory {
  score: number;
  status: 'pass' | 'warning' | 'fail';
  notes: string;
}

export interface QualityControlReport {
  overallScore: number;
  approvedForProduction: boolean;
  isBlocked?: boolean;
  blockingReasons?: string[];
  driftTelemetry?: {
    audioDurationSeconds: number;
    videoDurationSeconds: number;
    driftSeconds: number;
    maxAllowedDriftSeconds: number;
    isSynchronized: boolean;
  };
  categories: {
    storyCoherence: QualityControlCategory;
    characterContinuity: QualityControlCategory;
    audioAndDialogue: QualityControlCategory;
    visualFeasibility: QualityControlCategory;
    safetyAndCoppa: QualityControlCategory;
    youtubeEngagement?: QualityControlCategory;
    technicalDelivery?: QualityControlCategory;
    [key: string]: QualityControlCategory | undefined;
  };
  flags: string[];
  recommendations: string[];
}

export interface YouTubeMetadata {
  title: string;
  description: string;
  tags: string[];
  hashtags: string[];
  madeForKids: boolean;
  privacyStatus: 'private' | 'unlisted' | 'public' | 'scheduled';
  category: string;
  thumbnailOverlayText: string;
  recommendedPlaylist: string;
  coppaComplianceConfirmed: boolean;
  monetizationNotice?: string;
  scheduledDate?: string;
  scheduledTime?: string;
  publishedVideoId?: string;
  publishedVideoUrl?: string;
}

export interface CostMetrics {
  totalTokensUsed: number;
  imagesGenerated: number;
  audioSeconds: number;
  estimatedCostEur: number;
  generationCallsCount: number;
}

export interface VideoTrackConfig {
  videoUrl?: string;
  renderingProgress: number;
  isRendered: boolean;
  subtitlesSrt: string;
  subtitlesVtt: string;
  aspectRatio: '16:9' | '9:16';
  fps: number;
  resolution: '1080p' | '720p' | '4k';
  musicVolume: number;
  voiceVolume: number;
  sfxVolume: number;
}

export interface Project {
  id: string;
  title: string;
  idea: string;
  targetAge: '2-4' | '4-6' | '6-8' | '8-10' | '10-12';
  language: string;
  durationCategory: 'Short' | '3-5 min' | '5-8 min' | '8-12 min' | 'Custom';
  educationalObjective: string;
  tone: string;
  status: ProjectPipelineStatus;
  seriesId?: string;
  characters: Character[];
  scenes: Scene[];
  logline: string;
  moral: string;
  ending: string;
  qualityScore?: QualityControlReport;
  youtubeMetadata?: YouTubeMetadata;
  thumbnailUrl?: string;
  videoTrack: VideoTrackConfig;
  costMetrics: CostMetrics;
  createdAt: string;
  updatedAt: string;
  lastJobStatus?: 'pending' | 'processing' | 'completed' | 'failed';
}

export interface Series {
  id: string;
  name: string;
  description: string;
  mainCharacterName: string;
  visualStyle: string;
  targetAge: string;
  language: string;
  episodeLength: string;
  rules: string[];
  episodesCount: number;
}

export interface ProductionJob {
  id: string;
  projectId: string;
  projectTitle: string;
  stage: ProjectPipelineStatus;
  type: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress: number;
  startedAt: string;
  completedAt?: string;
  error?: string;
  stepDescription: string;
}

export interface YouTubeChannelInfo {
  connected: boolean;
  isDemoMode: boolean;
  channelId: string;
  channelTitle: string;
  channelCustomUrl: string;
  subscriberCount: string;
  videoCount: number;
  viewCount: string;
  avatarUrl: string;
  statusMessage: string;
}

export interface LibraryItem {
  id: string;
  type: 'character' | 'background' | 'music' | 'sfx' | 'voice' | 'template';
  title: string;
  category: string;
  tags: string[];
  description: string;
  previewColor?: string;
  previewSvg?: string;
  usedInProjectsCount: number;
  createdAt: string;
}

export interface EditorialCalendarItem {
  id: string;
  projectId: string;
  title: string;
  scheduledDate: string; // YYYY-MM-DD
  scheduledTime: string; // HH:MM
  privacyStatus: 'private' | 'unlisted' | 'public' | 'scheduled';
  episodeCode: string; // e.g. EP01
  status: 'draft' | 'scheduled' | 'published';
}
