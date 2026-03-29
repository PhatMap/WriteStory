import { clearStoryDraftStorage, persistStoryToIndexedStorage } from "./storyStorage";
import { safeGetItem, safeRemoveItem, safeSetItem } from "./storage";

export type StoryProjectChapterVersion = {
  id: string;
  timestamp: number;
  content: string;
  title: string;
};

export type StoryProjectChapter = {
  id: string;
  title: string;
  content: string;
  history?: StoryProjectChapterVersion[];
};

export type StoryProjectVolume = {
  id: string;
  title: string;
  chapters: StoryProjectChapter[];
};

export type StoryProjectPayload = {
  volumes: StoryProjectVolume[];
  activeVolumeId?: string;
  activeChapterId?: string;
  expandedVolumes?: string[];
  writingStyles?: string[];
  worldSettings?: Record<string, unknown>;
  characterSettings?: Record<string, unknown>;
  supportingCharacters?: unknown[];
  storyRules?: Record<string, unknown>;
  plotMap?: string;
  storyMemory?: string;
  fanficContext?: string;
  autoScanErrors?: boolean;
};

export type StoryProjectMeta = {
  id: string;
  title: string;
  excerpt: string;
  createdAt: string;
  updatedAt: string;
  chapterCount: number;
  volumeCount: number;
  totalCharacters: number;
  activeChapterTitle: string;
};

export type StoryProjectRecord = StoryProjectMeta & {
  payload: StoryProjectPayload;
};

type StoryLibraryIndex = {
  format: "storycraft-library-index";
  version: 1;
  projects: StoryProjectMeta[];
};

const STORY_LIBRARY_INDEX_KEY = "storyLibraryIndexV1";
const STORY_LIBRARY_PROJECT_PREFIX = "storyLibraryProject:";
const CURRENT_STORY_PROJECT_KEY = "currentStoryProjectId";
const MAX_IMPORTED_CHAPTER_HISTORY = 20;

const getProjectStorageKey = (projectId: string) => `${STORY_LIBRARY_PROJECT_PREFIX}${projectId}`;

const createProjectId = () =>
  `story-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const normalizeImportedHistory = (
  rawHistory: unknown,
): StoryProjectChapterVersion[] | undefined => {
  if (!Array.isArray(rawHistory) || rawHistory.length === 0) {
    return undefined;
  }

  const normalizedHistory = rawHistory
    .map((version, index) => ({
      id:
        typeof (version as StoryProjectChapterVersion)?.id === "string" &&
        (version as StoryProjectChapterVersion).id.trim()
          ? (version as StoryProjectChapterVersion).id
          : `${Date.now()}-history-${index}`,
      timestamp:
        typeof (version as StoryProjectChapterVersion)?.timestamp === "number"
          ? (version as StoryProjectChapterVersion).timestamp
          : Date.now(),
      content:
        typeof (version as StoryProjectChapterVersion)?.content === "string"
          ? (version as StoryProjectChapterVersion).content
          : "",
      title:
        typeof (version as StoryProjectChapterVersion)?.title === "string"
          ? (version as StoryProjectChapterVersion).title
          : "",
    }))
    .slice(0, MAX_IMPORTED_CHAPTER_HISTORY);

  return normalizedHistory.length > 0 ? normalizedHistory : undefined;
};

const normalizeImportedVolumes = (rawVolumes: unknown): StoryProjectVolume[] => {
  if (!Array.isArray(rawVolumes)) {
    return [];
  }

  return rawVolumes
    .map((volume, volumeIndex) => ({
      id:
        typeof (volume as StoryProjectVolume)?.id === "string" &&
        (volume as StoryProjectVolume).id.trim()
          ? (volume as StoryProjectVolume).id
          : `v${volumeIndex + 1}`,
      title:
        typeof (volume as StoryProjectVolume)?.title === "string" &&
        (volume as StoryProjectVolume).title.trim()
          ? (volume as StoryProjectVolume).title
          : `Quyen ${volumeIndex + 1}`,
      chapters: Array.isArray((volume as StoryProjectVolume)?.chapters)
        ? (volume as StoryProjectVolume).chapters
            .map((chapter, chapterIndex) => ({
              id:
                typeof chapter?.id === "string" && chapter.id.trim()
                  ? chapter.id
                  : `c${volumeIndex + 1}-${chapterIndex + 1}`,
              title:
                typeof chapter?.title === "string" && chapter.title.trim()
                  ? chapter.title
                  : `Chuong ${chapterIndex + 1}`,
              content: typeof chapter?.content === "string" ? chapter.content : "",
              history: normalizeImportedHistory(chapter?.history),
            }))
            .filter((chapter) => Boolean(chapter.id))
        : [],
    }))
    .filter((volume) => volume.chapters.length > 0);
};

export const parseImportedStoryData = (rawData: any): StoryProjectPayload => {
  if (rawData?.format === "storycraft-backup" && rawData.data) {
    return {
      ...rawData.data,
      volumes: normalizeImportedVolumes(rawData.data.volumes),
    };
  }

  let volumesSource = rawData?.volumes ?? rawData?.storyVolumes;
  if (typeof volumesSource === "string") {
    try {
      volumesSource = JSON.parse(volumesSource);
    } catch (error) {
      console.error("Failed to parse legacy story volumes", error);
      volumesSource = null;
    }
  }

  if (!volumesSource && typeof rawData?.story === "string") {
    volumesSource = [
      {
        id: "v1",
        title: "Quyen 1",
        chapters: [{ id: "c1", title: "Chuong 1", content: rawData.story }],
      },
    ];
  }

  return {
    volumes: normalizeImportedVolumes(volumesSource),
    activeVolumeId: rawData?.activeVolumeId,
    activeChapterId: rawData?.activeChapterId,
    expandedVolumes: rawData?.expandedVolumes,
    writingStyles: rawData?.writingStyles,
    worldSettings: rawData?.worldSettings,
    characterSettings: rawData?.characterSettings,
    supportingCharacters: rawData?.supportingCharacters,
    storyRules: rawData?.storyRules || rawData?.rules,
    plotMap: rawData?.plotMap,
    storyMemory: rawData?.storyMemory,
    fanficContext: rawData?.fanficContext,
    autoScanErrors: rawData?.autoScanErrors,
  };
};

const createEmptyPayload = (): StoryProjectPayload => ({
  volumes: [
    {
      id: "v1",
      title: "Quyen 1",
      chapters: [{ id: "c1", title: "Chuong 1", content: "" }],
    },
  ],
  activeVolumeId: "v1",
  activeChapterId: "c1",
  expandedVolumes: ["v1"],
  writingStyles: [],
  worldSettings: {},
  characterSettings: {},
  supportingCharacters: [],
  storyRules: {},
  plotMap: "",
  storyMemory: "",
  fanficContext: "",
  autoScanErrors: false,
});

export const createEmptyStoryProjectPayload = createEmptyPayload;

const getPayloadTitle = (payload: StoryProjectPayload) => {
  const worldPrompt = `${payload.worldSettings?.prompt || ""}`.trim();
  const characterName = `${payload.characterSettings?.characterName || ""}`.trim();
  const activeChapter = payload.volumes
    .flatMap((volume) => volume.chapters)
    .find((chapter) => chapter.id === payload.activeChapterId);
  const firstNonEmptyChapter = payload.volumes
    .flatMap((volume) => volume.chapters)
    .find((chapter) => chapter.content.trim() || chapter.title.trim());

  return (
    worldPrompt ||
    characterName ||
    activeChapter?.title?.trim() ||
    firstNonEmptyChapter?.title?.trim() ||
    "Truyen chua dat ten"
  );
};

const getPayloadExcerpt = (payload: StoryProjectPayload) => {
  const firstContent = payload.volumes
    .flatMap((volume) => volume.chapters)
    .map((chapter) => chapter.content.trim())
    .find(Boolean);

  if (firstContent) {
    return firstContent.slice(0, 180);
  }

  const worldPrompt = `${payload.worldSettings?.prompt || ""}`.trim();
  if (worldPrompt) {
    return worldPrompt.slice(0, 180);
  }

  const fanficContext = `${payload.fanficContext || ""}`.trim();
  return fanficContext.slice(0, 180);
};

const buildProjectMeta = (
  projectId: string,
  payload: StoryProjectPayload,
  existing?: StoryProjectMeta,
): StoryProjectMeta => {
  const chapters = payload.volumes.flatMap((volume) => volume.chapters);
  const activeChapter =
    chapters.find((chapter) => chapter.id === payload.activeChapterId) || chapters[0];
  const now = new Date().toISOString();

  return {
    id: projectId,
    title: getPayloadTitle(payload),
    excerpt: getPayloadExcerpt(payload),
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    chapterCount: chapters.length,
    volumeCount: payload.volumes.length,
    totalCharacters: chapters.reduce((total, chapter) => total + chapter.content.length, 0),
    activeChapterTitle: activeChapter?.title || "Chuong 1",
  };
};

const readLibraryIndex = async (): Promise<StoryLibraryIndex> => {
  const rawIndex = await safeGetItem(STORY_LIBRARY_INDEX_KEY);
  if (!rawIndex) {
    return {
      format: "storycraft-library-index",
      version: 1,
      projects: [],
    };
  }

  try {
    const parsed = JSON.parse(rawIndex) as StoryLibraryIndex;
    if (parsed?.format === "storycraft-library-index" && Array.isArray(parsed.projects)) {
      return parsed;
    }
  } catch (error) {
    console.error("Failed to parse story library index", error);
  }

  return {
    format: "storycraft-library-index",
    version: 1,
    projects: [],
  };
};

const writeLibraryIndex = async (index: StoryLibraryIndex) => {
  await safeSetItem(STORY_LIBRARY_INDEX_KEY, JSON.stringify(index), false);
};

export const listStoryProjects = async (): Promise<StoryProjectMeta[]> => {
  const index = await readLibraryIndex();
  return [...index.projects].sort(
    (left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime(),
  );
};

export const getStoryProject = async (
  projectId: string,
): Promise<StoryProjectRecord | null> => {
  const rawProject = await safeGetItem(getProjectStorageKey(projectId));
  if (!rawProject) {
    return null;
  }

  try {
    return JSON.parse(rawProject) as StoryProjectRecord;
  } catch (error) {
    console.error("Failed to parse story project", projectId, error);
    return null;
  }
};

export const saveStoryProject = async (
  payload: StoryProjectPayload,
  options?: {
    projectId?: string | null;
  },
) => {
  const projectId = options?.projectId || createProjectId();
  const index = await readLibraryIndex();
  const existing = index.projects.find((project) => project.id === projectId);
  const meta = buildProjectMeta(projectId, payload, existing);
  const record: StoryProjectRecord = {
    ...meta,
    payload,
  };

  const nextProjects = index.projects.filter((project) => project.id !== projectId);
  nextProjects.push(meta);

  await safeSetItem(getProjectStorageKey(projectId), JSON.stringify(record), false);
  await writeLibraryIndex({
    ...index,
    projects: nextProjects,
  });

  return record;
};

export const deleteStoryProject = async (projectId: string) => {
  const index = await readLibraryIndex();
  await safeRemoveItem(getProjectStorageKey(projectId));
  await writeLibraryIndex({
    ...index,
    projects: index.projects.filter((project) => project.id !== projectId),
  });

  const currentProjectId = await getCurrentStoryProjectId();
  if (currentProjectId === projectId) {
    await clearCurrentStoryProjectId();
  }
};

export const getCurrentStoryProjectId = async () => {
  const projectId = await safeGetItem(CURRENT_STORY_PROJECT_KEY);
  return projectId || null;
};

export const setCurrentStoryProjectId = async (projectId: string) => {
  await safeSetItem(CURRENT_STORY_PROJECT_KEY, projectId, false);
};

export const clearCurrentStoryProjectId = async () => {
  await safeRemoveItem(CURRENT_STORY_PROJECT_KEY);
};

export const loadStoryProjectIntoWorkspace = async (project: StoryProjectRecord) => {
  const payload = {
    ...createEmptyPayload(),
    ...project.payload,
  };

  const volumes = payload.volumes.length > 0 ? payload.volumes : createEmptyPayload().volumes;
  const activeVolumeId = payload.activeVolumeId || volumes[0].id;
  const activeVolume =
    volumes.find((volume) => volume.id === activeVolumeId) || volumes[0];
  const activeChapterId =
    payload.activeChapterId || activeVolume.chapters[0]?.id || "";
  const activeChapter =
    activeVolume.chapters.find((chapter) => chapter.id === activeChapterId) ||
    activeVolume.chapters[0];
  const expandedVolumes =
    Array.isArray(payload.expandedVolumes) && payload.expandedVolumes.length > 0
      ? payload.expandedVolumes
      : volumes.map((volume) => volume.id);

  await clearStoryDraftStorage();
  await persistStoryToIndexedStorage(volumes, { sync: true });
  await Promise.all([
    safeSetItem("activeVolumeId", activeVolume.id, true),
    safeSetItem("activeChapterId", activeChapter?.id || "", true),
    safeSetItem("expandedVolumes", JSON.stringify(expandedVolumes), true),
    safeSetItem("writingStyles", JSON.stringify(payload.writingStyles || []), true),
    safeSetItem("page1_state", JSON.stringify(payload.worldSettings || {}), true),
    safeSetItem("page2_state", JSON.stringify(payload.characterSettings || {}), true),
    safeSetItem(
      "supportingCharacters",
      JSON.stringify(Array.isArray(payload.supportingCharacters) ? payload.supportingCharacters : []),
      true,
    ),
    safeSetItem("storyRules", JSON.stringify(payload.storyRules || {}), true),
    safeSetItem("plotMap", payload.plotMap || "", true),
    safeSetItem("storyMemory", payload.storyMemory || "", true),
    safeSetItem("fanficContext", payload.fanficContext || "", true),
    safeSetItem("autoScanErrors", JSON.stringify(Boolean(payload.autoScanErrors)), true),
    safeSetItem("currentStory", activeChapter?.content || "", true),
    safeSetItem(CURRENT_STORY_PROJECT_KEY, project.id, false),
  ]);
};
