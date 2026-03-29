import { listStorageKeys, safeGetItem, safeRemoveItem, safeSetItem } from "./storage";

type StoredChapterVersion = {
  id: string;
  timestamp: number;
  content: string;
  title: string;
};

type StoredChapter = {
  id: string;
  title: string;
  content: string;
  history?: StoredChapterVersion[];
};

type StoredVolume = {
  id: string;
  title: string;
  chapters: StoredChapter[];
};

type StoryStorageIndexChapter = {
  id: string;
  title: string;
  contentLength: number;
  historyCount: number;
};

type StoryStorageIndexVolume = {
  id: string;
  title: string;
  chapters: StoryStorageIndexChapter[];
};

type StoryStorageIndex = {
  format: "storycraft-storage-index";
  version: 1;
  updatedAt: string;
  volumes: StoryStorageIndexVolume[];
};

type ReadStoryVolumesResult = {
  volumes: StoredVolume[] | null;
  storageMode: "none" | "legacy" | "indexed";
};

const STORY_STORAGE_INDEX_FORMAT = "storycraft-storage-index";
const STORY_STORAGE_INDEX_VERSION = 1;
const STORY_STORAGE_KEY = "storyVolumes";
const STORY_CURRENT_KEY = "currentStory";
const STORY_ACTIVE_VOLUME_KEY = "activeVolumeId";
const STORY_ACTIVE_CHAPTER_KEY = "activeChapterId";
const STORY_RECOVERY_SNAPSHOT_KEY = "storyEditorRecoverySnapshotV1";
const CHAPTER_CONTENT_KEY_PREFIX = "storyChapterContent:";
const CHAPTER_HISTORY_KEY_PREFIX = "storyChapterHistory:";

const normalizeVersion = (version: any, fallbackId: string): StoredChapterVersion => ({
  id: typeof version?.id === "string" && version.id.trim() ? version.id : fallbackId,
  timestamp: typeof version?.timestamp === "number" ? version.timestamp : Date.now(),
  content: typeof version?.content === "string" ? version.content : "",
  title: typeof version?.title === "string" ? version.title : "",
});

const normalizeVolumes = (value: any): StoredVolume[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((volume: any, volumeIndex: number) => ({
      id: typeof volume?.id === "string" && volume.id.trim() ? volume.id : `v${volumeIndex + 1}`,
      title:
        typeof volume?.title === "string" && volume.title.trim()
          ? volume.title
          : `Quyển ${volumeIndex + 1}`,
      chapters: Array.isArray(volume?.chapters)
        ? volume.chapters.map((chapter: any, chapterIndex: number) => ({
            id:
              typeof chapter?.id === "string" && chapter.id.trim()
                ? chapter.id
                : `c${volumeIndex + 1}-${chapterIndex + 1}`,
            title:
              typeof chapter?.title === "string" && chapter.title.trim()
                ? chapter.title
                : `Chương ${chapterIndex + 1}`,
            content: typeof chapter?.content === "string" ? chapter.content : "",
            history: Array.isArray(chapter?.history)
              ? chapter.history.map((version: any, versionIndex: number) =>
                  normalizeVersion(version, `${Date.now()}-${volumeIndex}-${chapterIndex}-${versionIndex}`),
                )
              : undefined,
          }))
        : [],
    }))
    .filter((volume) => volume.chapters.length > 0);
};

const buildStoryStorageIndex = (volumes: StoredVolume[]): StoryStorageIndex => ({
  format: STORY_STORAGE_INDEX_FORMAT,
  version: STORY_STORAGE_INDEX_VERSION,
  updatedAt: new Date().toISOString(),
  volumes: volumes.map((volume) => ({
    id: volume.id,
    title: volume.title,
    chapters: volume.chapters.map((chapter) => ({
      id: chapter.id,
      title: chapter.title,
      contentLength: chapter.content.length,
      historyCount: chapter.history?.length || 0,
    })),
  })),
});

export const getChapterContentStorageKey = (chapterId: string) =>
  `${CHAPTER_CONTENT_KEY_PREFIX}${chapterId}`;

export const getChapterHistoryStorageKey = (chapterId: string) =>
  `${CHAPTER_HISTORY_KEY_PREFIX}${chapterId}`;

export const extractStoryChapterIds = (volumes: StoredVolume[]) =>
  volumes.flatMap((volume) => volume.chapters.map((chapter) => chapter.id));

export const isStoryStorageIndex = (value: unknown): value is StoryStorageIndex =>
  Boolean(
    value &&
      typeof value === "object" &&
      (value as StoryStorageIndex).format === STORY_STORAGE_INDEX_FORMAT &&
      Array.isArray((value as StoryStorageIndex).volumes),
  );

export const loadIndexedStoryVolumes = async (index: StoryStorageIndex): Promise<StoredVolume[]> => {
  const hydratedVolumes = await Promise.all(
    index.volumes.map(async (volume) => ({
      id: volume.id,
      title: volume.title,
      chapters: await Promise.all(
        volume.chapters.map(async (chapter) => {
          const [content, historyRaw] = await Promise.all([
            safeGetItem(getChapterContentStorageKey(chapter.id)),
            safeGetItem(getChapterHistoryStorageKey(chapter.id)),
          ]);

          let history: StoredChapterVersion[] | undefined;
          if (historyRaw) {
            try {
              const parsedHistory = JSON.parse(historyRaw);
              if (Array.isArray(parsedHistory) && parsedHistory.length > 0) {
                history = parsedHistory.map((version, versionIndex) =>
                  normalizeVersion(version, `${chapter.id}-history-${versionIndex}`),
                );
              }
            } catch (error) {
              console.error("Failed to parse chapter history", chapter.id, error);
            }
          }

          return {
            id: chapter.id,
            title: chapter.title,
            content: content || "",
            history,
          };
        }),
      ),
    })),
  );

  return normalizeVolumes(hydratedVolumes);
};

export const readStoryVolumesFromStorage = async (): Promise<ReadStoryVolumesResult> => {
  const rawStoryVolumes = await safeGetItem(STORY_STORAGE_KEY);
  if (!rawStoryVolumes) {
    return { volumes: null, storageMode: "none" };
  }

  try {
    const parsed = JSON.parse(rawStoryVolumes);

    if (Array.isArray(parsed)) {
      return {
        volumes: normalizeVolumes(parsed),
        storageMode: "legacy",
      };
    }

    if (isStoryStorageIndex(parsed)) {
      return {
        volumes: await loadIndexedStoryVolumes(parsed),
        storageMode: "indexed",
      };
    }
  } catch (error) {
    console.error("Failed to parse stored story volumes", error);
  }

  return { volumes: null, storageMode: "none" };
};

export const persistStoryToIndexedStorage = async (
  volumes: StoredVolume[],
  options?: {
    chapterIds?: string[];
    removedChapterIds?: string[];
    sync?: boolean;
  },
) => {
  const sync = options?.sync ?? true;
  const chapterIdsToPersist = options?.chapterIds ? new Set(options.chapterIds) : null;

  await safeSetItem(STORY_STORAGE_KEY, JSON.stringify(buildStoryStorageIndex(volumes)), sync);

  const chapterWrites: Promise<boolean>[] = [];
  for (const volume of volumes) {
    for (const chapter of volume.chapters) {
      if (chapterIdsToPersist && !chapterIdsToPersist.has(chapter.id)) {
        continue;
      }

      chapterWrites.push(safeSetItem(getChapterContentStorageKey(chapter.id), chapter.content, sync));
      chapterWrites.push(
        safeSetItem(getChapterHistoryStorageKey(chapter.id), JSON.stringify(chapter.history || []), sync),
      );
    }
  }

  await Promise.all(chapterWrites);

  if (options?.removedChapterIds && options.removedChapterIds.length > 0) {
    await removeStoryChapterStorage(options.removedChapterIds);
  }
};

export const removeStoryChapterStorage = async (chapterIds: string[]) => {
  const uniqueIds = Array.from(new Set(chapterIds.filter(Boolean)));
  if (uniqueIds.length === 0) {
    return;
  }

  await Promise.all(
    uniqueIds.flatMap((chapterId) => [
      safeRemoveItem(getChapterContentStorageKey(chapterId)),
      safeRemoveItem(getChapterHistoryStorageKey(chapterId)),
    ]),
  );
};

export const clearStoryDraftStorage = async () => {
  const keys = await listStorageKeys();
  const keysToClear = keys.filter(
    (key) =>
      key === STORY_STORAGE_KEY ||
      key === STORY_CURRENT_KEY ||
      key === STORY_ACTIVE_VOLUME_KEY ||
      key === STORY_ACTIVE_CHAPTER_KEY ||
      key === STORY_RECOVERY_SNAPSHOT_KEY ||
      key.startsWith(CHAPTER_CONTENT_KEY_PREFIX) ||
      key.startsWith(CHAPTER_HISTORY_KEY_PREFIX),
  );

  await Promise.all(keysToClear.map((key) => safeRemoveItem(key)));
};
