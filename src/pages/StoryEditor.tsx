import { useState, useRef, useEffect, useLayoutEffect } from "react";
import { Link } from "react-router-dom";
import { continueStory, rewriteStory, fixStoryErrors, scanStoryErrors, suggestCharacterNames, suggestAppearance, generatePlotMap, scanFullStoryConsistency, generateChapterTitle } from "../services/ai";
import { Loader2, PenTool, Sparkles, Wand2, Copy, CheckCircle2, Trash2, Download, ArrowLeft, ArrowRight, Image as ImageIcon, Plus, ChevronDown, ChevronRight, Book, FileText, RefreshCw, Menu, PanelLeftClose, PanelLeftOpen, Settings, Save, Brain, X, RotateCcw, Shield, User, Globe, Share2, Facebook, Twitter, MessageCircle, Maximize2, Minimize2, Lightbulb, Users, Database, Upload, Flame, Map, Search, LogIn, LogOut } from "lucide-react";
import { safeSetItem, safeGetItem, getStorageUsage } from "../utils/storage";
import { clearStoryDraftStorage, extractStoryChapterIds, persistStoryToIndexedStorage, readStoryVolumesFromStorage } from "../utils/storyStorage";
import { GEMINI_KEYS_CHANGED_EVENT, addGeminiKey, deleteGeminiKey, formatGeminiCooldown, getGeminiKeyState, maskGeminiApiKey, setActiveGeminiKey, setGeminiKeyEnabled, type GeminiKeyRecord } from "../utils/geminiKeys";
import { useAuth } from "../contexts/AuthContext";
import { db, doc, setDoc } from "../services/firebase";

type ChapterVersion = {
  id: string;
  timestamp: number;
  content: string;
  title: string;
};

type Chapter = {
  id: string;
  title: string;
  content: string;
  history?: ChapterVersion[];
};

type Volume = {
  id: string;
  title: string;
  chapters: Chapter[];
};

type StoryRecoverySnapshot = {
  version: number;
  volumeId: string;
  chapterId: string;
  title: string;
  content: string;
  updatedAt: string;
};

type StoryBackupPayload = {
  format: "storycraft-backup";
  version: string;
  app: "StoryCraft";
  backupMode: "compact" | "full";
  exportDate: string;
  meta: {
    volumeCount: number;
    chapterCount: number;
    nonEmptyChapterCount: number;
    totalCharacters: number;
    includesHistory: boolean;
  };
  data: {
    volumes: Volume[];
    activeVolumeId: string;
    activeChapterId: string;
    expandedVolumes: string[];
    writingStyles: string[];
    worldSettings: any;
    characterSettings: any;
    supportingCharacters: any[];
    storyRules: any;
    plotMap: string;
    storyMemory: string;
    fanficContext: string;
    autoScanErrors: boolean;
  };
};

const RECOVERY_SNAPSHOT_KEY = "storyEditorRecoverySnapshotV1";
const STORY_BACKUP_VERSION = "4.0";
const MAX_CHAPTER_HISTORY = 20;
const MAX_PREVIOUS_CHAPTERS_FOR_AI = 4;
const MAX_CONTEXT_CHARS_PER_CHAPTER = 16000;

const trimChapterHistory = (history?: ChapterVersion[]) => (history || []).slice(0, MAX_CHAPTER_HISTORY);

const stripChapterHistory = (sourceVolumes: Volume[]) =>
  sourceVolumes.map((volume) => ({
    ...volume,
    chapters: volume.chapters.map(({ history, ...chapter }) => chapter),
  }));

const getStoryStats = (sourceVolumes: Volume[]) => {
  const chapters = sourceVolumes.flatMap((volume) => volume.chapters);
  const nonEmptyChapters = chapters.filter((chapter) => chapter.content.trim().length > 0);

  return {
    volumeCount: sourceVolumes.length,
    chapterCount: chapters.length,
    nonEmptyChapterCount: nonEmptyChapters.length,
    totalCharacters: chapters.reduce((total, chapter) => total + chapter.content.length, 0),
  };
};

const truncateContextContent = (content: string) => {
  const trimmed = content.trim();
  if (trimmed.length <= MAX_CONTEXT_CHARS_PER_CHAPTER) {
    return trimmed;
  }

  const headLength = Math.floor(MAX_CONTEXT_CHARS_PER_CHAPTER * 0.6);
  const tailLength = MAX_CONTEXT_CHARS_PER_CHAPTER - headLength;
  return `${trimmed.slice(0, headLength)}\n\n[Phần giữa được lược bớt để tiết kiệm ngữ cảnh]\n\n${trimmed.slice(-tailLength)}`;
};

const syncDraftIntoVolumes = (
  sourceVolumes: Volume[],
  activeVolumeId: string,
  activeChapterId: string,
  draftContent: string,
) => {
  if (!activeVolumeId || !activeChapterId) {
    return sourceVolumes;
  }

  let hasChanged = false;
  const nextVolumes = sourceVolumes.map((volume) => {
    if (volume.id !== activeVolumeId) {
      return volume;
    }

    let changedInVolume = false;
    const nextChapters = volume.chapters.map((chapter) => {
      if (chapter.id !== activeChapterId || chapter.content === draftContent) {
        return chapter;
      }

      changedInVolume = true;
      hasChanged = true;
      return {
        ...chapter,
        content: draftContent,
      };
    });

    return changedInVolume
      ? {
          ...volume,
          chapters: nextChapters,
        }
      : volume;
  });

  return hasChanged ? nextVolumes : sourceVolumes;
};

export default function StoryEditor() {
  const [volumes, setVolumes] = useState<Volume[]>([
    {
      id: "v1",
      title: "Quyển 1",
      chapters: [
        { id: "c1", title: "Chương 1", content: "" }
      ]
    }
  ]);
  const [activeVolumeId, setActiveVolumeId] = useState<string>("v1");
  const [activeChapterId, setActiveChapterId] = useState<string>("c1");
  const [expandedVolumes, setExpandedVolumes] = useState<string[]>(["v1"]);

  const [writingStyles, setWritingStyles] = useState<string[]>([]);
  const [instruction, setInstruction] = useState("");
  const [loadingContinue, setLoadingContinue] = useState(false);
  const [loadingRewrite, setLoadingRewrite] = useState(false);
  const [loadingFixErrors, setLoadingFixErrors] = useState(false);
  const [copied, setCopied] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(true);
  const [showMenu, setShowMenu] = useState(false);
  const [showInstruction, setShowInstruction] = useState(false);
  const [manualSaved, setManualSaved] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const [isLoaded, setIsLoaded] = useState(false);
  const [hasCheckedRecoverySnapshot, setHasCheckedRecoverySnapshot] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<{ isOpen: boolean; title: string; message: string; onConfirm: () => void; isAlert?: boolean; confirmText?: string; confirmColor?: string } | null>(null);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isInstructionMaximized, setIsInstructionMaximized] = useState(false);
  const [isFocusMode, setIsFocusMode] = useState(false);
  const { loading: authLoading, user, signIn, signOut } = useAuth();
  const [localContent, setLocalContent] = useState("");
  const isLocalChangeRef = useRef(false);
  const debouncedUpdateContent = useRef<NodeJS.Timeout | null>(null);
  const dirtyChapterIdsRef = useRef<Set<string>>(new Set());
  const removedChapterIdsRef = useRef<Set<string>>(new Set());

  // Close menu when clicking outside
  const getAiContextPreviousChapters = (maxChapters = MAX_PREVIOUS_CHAPTERS_FOR_AI) => {
    if (!activeVolumeId || !activeChapterId) return "";

    const allChapters = volumes.flatMap((volume) => volume.chapters);
    const currentIndex = allChapters.findIndex((chapter) => chapter.id === activeChapterId);

    if (currentIndex <= 0) return "";

    const previousChapters = allChapters
      .slice(0, currentIndex)
      .filter((chapter) => chapter.content.trim())
      .slice(-maxChapters);

    return previousChapters
      .map((chapter) => `CHƯƠNG: ${chapter.title}\n\n${truncateContextContent(chapter.content)}`)
      .join("\n\n---\n\n");
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setShowMenu(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isFocusMode) {
        setIsFocusMode(false);
      }
    };
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isFocusMode]);

  // Load initial story
  useEffect(() => {
    if (authLoading) return;

    const loadData = async () => {
      const storedStory = await readStoryVolumesFromStorage();
      if (storedStory.volumes && storedStory.volumes.length > 0) {
        const loadedVolumes = storedStory.volumes as Volume[];
        setVolumes(loadedVolumes);

        const savedVolId = await safeGetItem("activeVolumeId");
        const savedChapId = await safeGetItem("activeChapterId");
        const savedExpandedVolumes = await safeGetItem("expandedVolumes");

        let volIdToSet = loadedVolumes[0].id;
        let chapIdToSet = loadedVolumes[0].chapters.length > 0 ? loadedVolumes[0].chapters[0].id : "";

        if (savedVolId && loadedVolumes.find((v) => v.id === savedVolId)) {
          volIdToSet = savedVolId;
          const vol = loadedVolumes.find((v) => v.id === savedVolId);
          if (savedChapId && vol?.chapters.find((c) => c.id === savedChapId)) {
            chapIdToSet = savedChapId;
          } else if (vol?.chapters.length) {
            chapIdToSet = vol.chapters[0].id;
          }
        }

        setActiveVolumeId(volIdToSet);
        if (chapIdToSet) {
          setActiveChapterId(chapIdToSet);
        }

        const nextExpandedVolumes = (() => {
          if (!savedExpandedVolumes) {
            return loadedVolumes.map((v) => v.id);
          }

          try {
            const parsedExpandedVolumes = JSON.parse(savedExpandedVolumes);
            if (Array.isArray(parsedExpandedVolumes)) {
              const validExpandedVolumes = parsedExpandedVolumes.filter((volumeId) =>
                loadedVolumes.some((volume) => volume.id === volumeId),
              );
              if (validExpandedVolumes.length > 0) {
                return validExpandedVolumes;
              }
            }
          } catch (error) {
            console.error("Failed to parse expanded volume state", error);
          }

          return loadedVolumes.map((v) => v.id);
        })();

        setExpandedVolumes(nextExpandedVolumes);

        if (storedStory.storageMode === "legacy") {
          await persistStoryToIndexedStorage(loadedVolumes, { sync: true });
        }
      } else {
        const savedStory = await safeGetItem("currentStory");
        if (savedStory) {
          setVolumes([{ id: "v1", title: "Quyển 1", chapters: [{ id: "c1", title: "Chương 1", content: savedStory }] }]);
        }
      }

      const savedStyles = await safeGetItem("writingStyles");
      if (savedStyles) {
        try {
          setWritingStyles(JSON.parse(savedStyles));
        } catch (e) {
          console.error(e);
        }
      }
      setIsLoaded(true);
    };
    loadData();
  }, [authLoading]);

  const getActiveChapter = () => {
    const volume = volumes.find(v => v.id === activeVolumeId);
    if (!volume) return null;
    return volume.chapters.find(c => c.id === activeChapterId) || null;
  };

  const markChapterDirty = (chapterId?: string) => {
    if (!chapterId) return;
    dirtyChapterIdsRef.current.add(chapterId);
  };

  const queueChapterRemoval = (chapterIds: string[]) => {
    chapterIds.filter(Boolean).forEach((chapterId) => {
      removedChapterIdsRef.current.add(chapterId);
      dirtyChapterIdsRef.current.delete(chapterId);
    });
  };

  const getVolumesWithCurrentDraft = (sourceVolumes: Volume[] = volumes) =>
    syncDraftIntoVolumes(sourceVolumes, activeVolumeId, activeChapterId, localContent);

  const setStoryVolumes = (updater: (draftSafeVolumes: Volume[]) => Volume[]) => {
    setVolumes((prev) => {
      const draftSafeVolumes = syncDraftIntoVolumes(prev, activeVolumeId, activeChapterId, localContent);
      if (draftSafeVolumes !== prev) {
        markChapterDirty(activeChapterId);
      }
      return updater(draftSafeVolumes);
    });
  };

  const cancelPendingDraftSync = () => {
    if (debouncedUpdateContent.current) {
      clearTimeout(debouncedUpdateContent.current);
      debouncedUpdateContent.current = null;
    }
  };

  const flushCurrentDraftToVolumes = (sourceVolumes: Volume[] = volumes) => {
    cancelPendingDraftSync();
    const draftSafeVolumes = syncDraftIntoVolumes(
      sourceVolumes,
      activeVolumeId,
      activeChapterId,
      localContent,
    );

    if (draftSafeVolumes !== sourceVolumes) {
      markChapterDirty(activeChapterId);
      setVolumes(draftSafeVolumes);
    }

    isLocalChangeRef.current = false;
    return draftSafeVolumes;
  };

  const persistStoryState = async (
    sourceVolumes: Volume[],
    options: {
      chapterIds?: string[];
      removedChapterIds?: string[];
      sync?: boolean;
    } = {},
  ) => {
    const chapterIds = options.chapterIds
      ? Array.from(new Set(options.chapterIds.filter(Boolean)))
      : undefined;
    const removedChapterIds = Array.from(
      new Set([...(options.removedChapterIds || []), ...Array.from(removedChapterIdsRef.current)]),
    );

    await persistStoryToIndexedStorage(sourceVolumes, {
      chapterIds,
      removedChapterIds,
      sync: options.sync,
    });

    if (chapterIds) {
      chapterIds.forEach((chapterId) => dirtyChapterIdsRef.current.delete(chapterId));
    } else {
      dirtyChapterIdsRef.current.clear();
    }

    removedChapterIds.forEach((chapterId) => removedChapterIdsRef.current.delete(chapterId));
    return extractStoryChapterIds(sourceVolumes);
  };

  // Save story on change
  useEffect(() => {
    if (!isLoaded) return;
    
    const timer = setTimeout(() => {
      const volumesToPersist = getVolumesWithCurrentDraft();
      const dirtyChapterIds = Array.from(dirtyChapterIdsRef.current);

      void persistStoryState(volumesToPersist, {
        chapterIds: dirtyChapterIds.length > 0 ? dirtyChapterIds : [],
        removedChapterIds: Array.from(removedChapterIdsRef.current),
      });
      void safeSetItem("writingStyles", JSON.stringify(writingStyles));
      void safeSetItem("activeVolumeId", activeVolumeId);
      void safeSetItem("activeChapterId", activeChapterId);
      void safeSetItem("expandedVolumes", JSON.stringify(expandedVolumes));
      void safeSetItem("currentStory", localContent);
    }, 3000);
    
    return () => clearTimeout(timer);
  }, [volumes, activeVolumeId, activeChapterId, expandedVolumes, writingStyles, isLoaded, localContent]);

  const updateActiveChapterContent = (content: string) => {
    markChapterDirty(activeChapterId);
    setStoryVolumes(prev => prev.map(v => {
      if (v.id === activeVolumeId) {
        return {
          ...v,
          chapters: v.chapters.map(c => c.id === activeChapterId ? { ...c, content } : c)
        };
      }
      return v;
    }));
  };

  const updateActiveChapterTitle = (title: string) => {
    setStoryVolumes(prev => prev.map(v => {
      if (v.id === activeVolumeId) {
        return {
          ...v,
          chapters: v.chapters.map(c => c.id === activeChapterId ? { ...c, title } : c)
        };
      }
      return v;
    }));
  };

  const saveChapterVersion = () => {
    const activeChapter = getVolumesWithCurrentDraft()
      .find((volume) => volume.id === activeVolumeId)
      ?.chapters.find((chapter) => chapter.id === activeChapterId);

    if (!activeChapter || !localContent.trim()) return;

    // Don't save if the last version is identical
    if (activeChapter.history && activeChapter.history.length > 0) {
      const lastVersion = activeChapter.history[0];
      if (lastVersion.content === localContent && lastVersion.title === activeChapter.title) {
        return;
      }
    }

    const newVersion: ChapterVersion = {
      id: Date.now().toString(),
      timestamp: Date.now(),
      content: localContent,
      title: activeChapter.title
    };

    markChapterDirty(activeChapterId);
    setStoryVolumes(prev => prev.map(v => {
      if (v.id === activeVolumeId) {
        return {
          ...v,
          chapters: v.chapters.map(c => {
            if (c.id === activeChapterId) {
              const history = c.history || [];
              const newHistory = trimChapterHistory([newVersion, ...history]);
              return { ...c, history: newHistory };
            }
            return c;
          })
        };
      }
      return v;
    }));
  };

  const restoreVersion = (version: ChapterVersion) => {
    setConfirmDialog({
      isOpen: true,
      title: "Khôi phục phiên bản",
      message: `Bạn có chắc chắn muốn khôi phục về phiên bản từ ${new Date(version.timestamp).toLocaleString("vi-VN")}? Nội dung hiện tại sẽ được lưu vào lịch sử.`,
      onConfirm: () => {
        saveChapterVersion(); // Save current before restoring
        markChapterDirty(activeChapterId);
        setStoryVolumes(prev => prev.map(v => {
          if (v.id === activeVolumeId) {
            return {
              ...v,
              chapters: v.chapters.map(c => {
                if (c.id === activeChapterId) {
                  return { ...c, content: version.content, title: version.title };
                }
                return c;
              })
            };
          }
          return v;
        }));
        setIsHistoryOpen(false);
        setConfirmDialog(null);
      }
    });
  };

  const updateVolumeTitle = (volumeId: string, title: string) => {
    setStoryVolumes(prev => prev.map(v => v.id === volumeId ? { ...v, title } : v));
  };

  // Sync local content with active chapter
  useEffect(() => {
    const chapter = getActiveChapter();
    if (chapter) {
      setLocalContent(chapter.content);
    }
  }, [activeChapterId, activeVolumeId]);

  // Handle AI updates or external changes
  useEffect(() => {
    const chapter = getActiveChapter();
    if (chapter && chapter.content !== localContent && !isLocalChangeRef.current) {
      setLocalContent(chapter.content);
    }
    // Reset the local change flag after the check
    if (isLocalChangeRef.current) {
      isLocalChangeRef.current = false;
    }
  }, [volumes]);

  const handleTextareaChange = (val: string) => {
    setLocalContent(val);
    isLocalChangeRef.current = true;
    
    if (debouncedUpdateContent.current) {
      clearTimeout(debouncedUpdateContent.current);
    }
    
    debouncedUpdateContent.current = setTimeout(() => {
      updateActiveChapterContent(val);
      debouncedUpdateContent.current = null;
      isLocalChangeRef.current = false;
    }, 500);
  };

  useEffect(() => () => cancelPendingDraftSync(), []);

  useEffect(() => {
    if (!isLoaded || !activeVolumeId || !activeChapterId) return;

    const activeChapter = getActiveChapter();
    if (!activeChapter) return;

    const timer = setTimeout(() => {
      const snapshot: StoryRecoverySnapshot = {
        version: 1,
        volumeId: activeVolumeId,
        chapterId: activeChapterId,
        title: activeChapter.title,
        content: localContent,
        updatedAt: new Date().toISOString(),
      };
      void safeSetItem(RECOVERY_SNAPSHOT_KEY, JSON.stringify(snapshot), false);
    }, 1200);

    return () => clearTimeout(timer);
  }, [localContent, activeVolumeId, activeChapterId, volumes, isLoaded]);

  useEffect(() => {
    if (!isLoaded || hasCheckedRecoverySnapshot) return;

    const restoreDraftIfNeeded = async () => {
      try {
        const rawSnapshot = await safeGetItem(RECOVERY_SNAPSHOT_KEY);
        if (!rawSnapshot) {
          setHasCheckedRecoverySnapshot(true);
          return;
        }

        const snapshot = JSON.parse(rawSnapshot) as StoryRecoverySnapshot;
        const targetVolume = volumes.find((volume) => volume.id === snapshot.volumeId);
        const targetChapter = targetVolume?.chapters.find((chapter) => chapter.id === snapshot.chapterId);

        if (!targetVolume || !targetChapter) {
          setHasCheckedRecoverySnapshot(true);
          return;
        }

        const hasUnsyncedDraft =
          snapshot.title !== targetChapter.title || snapshot.content !== targetChapter.content;

        setHasCheckedRecoverySnapshot(true);

        if (!hasUnsyncedDraft || !snapshot.content.trim()) {
          return;
        }

        setConfirmDialog({
          isOpen: true,
          title: "Khôi phục bản nháp chưa đồng bộ",
          message: `Tìm thấy bản nháp gần nhất lúc ${new Date(snapshot.updatedAt).toLocaleString("vi-VN")}. Bạn có muốn khôi phục lại không?`,
          confirmText: "Khôi phục",
          onConfirm: () => {
            markChapterDirty(snapshot.chapterId);
            setVolumes((prev) =>
              prev.map((volume) =>
                volume.id === snapshot.volumeId
                  ? {
                      ...volume,
                      chapters: volume.chapters.map((chapter) =>
                        chapter.id === snapshot.chapterId
                          ? { ...chapter, title: snapshot.title, content: snapshot.content }
                          : chapter,
                      ),
                    }
                  : volume,
              ),
            );
            setExpandedVolumes((prev) =>
              prev.includes(snapshot.volumeId) ? prev : [...prev, snapshot.volumeId],
            );
            setActiveVolumeId(snapshot.volumeId);
            setActiveChapterId(snapshot.chapterId);
            setLocalContent(snapshot.content);
            setConfirmDialog(null);
          }
        });
      } catch (error) {
        console.error("Failed to restore recovery snapshot", error);
        setHasCheckedRecoverySnapshot(true);
      }
    };

    void restoreDraftIfNeeded();
  }, [isLoaded, hasCheckedRecoverySnapshot, volumes]);

  // Auto-resize textarea
  useLayoutEffect(() => {
    if (textareaRef.current) {
      const scrollContainer = document.getElementById("editor-scroll-container");
      const scrollTop = scrollContainer ? scrollContainer.scrollTop : 0;
      
      // Use a more stable resize method to avoid scroll jumps
      // We set height to auto to get the correct scrollHeight, then set it to the new height
      // useLayoutEffect ensures this happens before the browser paints
      textareaRef.current.style.height = "auto";
      const newHeight = Math.max(textareaRef.current.scrollHeight, 400);
      textareaRef.current.style.height = `${newHeight}px`;
      
      if (scrollContainer && scrollTop > 0) {
        // Restore scroll position immediately to prevent jumping
        scrollContainer.scrollTop = scrollTop;
      }
    }
  }, [localContent, activeVolumeId, activeChapterId]);

  const [storyMemory, setStoryMemory] = useState("");
  const [isMemoryOpen, setIsMemoryOpen] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [activeSettingsTab, setActiveSettingsTab] = useState<"genre" | "world" | "character" | "supporting" | "rules" | "plot" | "reference">("genre");
  const [worldSettings, setWorldSettings] = useState<any>({});
  const [characterSettings, setCharacterSettings] = useState<any>({});
  const [supportingCharacters, setSupportingCharacters] = useState<any[]>([]);
  const [storyRules, setStoryRules] = useState<any>({});
  const [plotMap, setPlotMap] = useState("");
  const [fanficContext, setFanficContext] = useState("");
  const [isSharing, setIsSharing] = useState(false);
  const [shareLink, setShareLink] = useState<string | null>(null);
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  const [shareType, setShareType] = useState<"chapter" | "story">("chapter");
  const [geminiKeys, setGeminiKeys] = useState<GeminiKeyRecord[]>([]);
  const [activeGeminiKeyId, setActiveGeminiKeyId] = useState<string | null>(null);
  const [newGeminiKeyLabel, setNewGeminiKeyLabel] = useState("");
  const [newGeminiKeyValue, setNewGeminiKeyValue] = useState("");
  const [isSavingGeminiKey, setIsSavingGeminiKey] = useState(false);
  const [visibleGeminiKeyIds, setVisibleGeminiKeyIds] = useState<string[]>([]);
  const [suggestedNames, setSuggestedNames] = useState<string | null>(null);
  const [loadingNames, setLoadingNames] = useState(false);
  const [loadingAppearance, setLoadingAppearance] = useState(false);
  const [loadingPlotMap, setLoadingPlotMap] = useState(false);
  const [loadingNSFW, setLoadingNSFW] = useState(false);
  const [loadingChapterTitle, setLoadingChapterTitle] = useState(false);
  const [loadingScan, setLoadingScan] = useState(false);
  const [loadingFullScan, setLoadingFullScan] = useState(false);
  const [autoScanErrors, setAutoScanErrors] = useState(false);
  const [storageUsage, setStorageUsage] = useState<{usage: number, quota: number, percent: number} | null>(null);
  const [scanResults, setScanResults] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const hasGeminiKey = geminiKeys.some((key) => key.enabled);
  const enabledGeminiKeyCount = geminiKeys.filter((key) => key.enabled).length;
  const activeGeminiKey = geminiKeys.find((key) => key.id === activeGeminiKeyId) || null;
  const hasApiKey = hasGeminiKey;
  const isCheckingKey = false;

  useEffect(() => {
    const loadGeminiKeyState = async () => {
      const state = await getGeminiKeyState();
      setGeminiKeys(state.keys);
      setActiveGeminiKeyId(state.activeKeyId);
    };

    void loadGeminiKeyState();

    const handleGeminiKeysChanged = () => {
      void loadGeminiKeyState();
    };

    window.addEventListener(GEMINI_KEYS_CHANGED_EVENT, handleGeminiKeysChanged);
    return () => {
      window.removeEventListener(GEMINI_KEYS_CHANGED_EVENT, handleGeminiKeysChanged);
    };
  }, []);

  useEffect(() => {
    const updateUsage = async () => {
      const usage = await getStorageUsage();
      setStorageUsage(usage);
    };
    updateUsage();
    const interval = setInterval(updateUsage, 30000); // Update every 30s
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!isLoaded) return;
    const timer = setTimeout(() => {
      safeSetItem("autoScanErrors", JSON.stringify(autoScanErrors));
    }, 1000);
    return () => clearTimeout(timer);
  }, [autoScanErrors, isLoaded]);

  const openGeminiKeyManager = () => {
    setActiveSettingsTab("reference");
    setIsSettingsModalOpen(true);
  };
  const handleOpenKeySelector = openGeminiKeyManager;

  const getReadableAiError = (error: unknown, fallback: string) => {
    if (error instanceof Error && error.message) {
      return error.message;
    }
    return fallback;
  };

  const buildStoryContext = () => {
    const storyContext: any = {
      page1: worldSettings ? { ...worldSettings } : null,
      page2: characterSettings ? { ...characterSettings } : null,
      plotMap,
      supportingCharacters,
    };

    if (storyMemory.trim()) {
      if (storyContext.page1) {
        storyContext.page1.storyMemory = storyMemory;
      } else {
        storyContext.page1 = { storyMemory };
      }
    }

    return storyContext;
  };

  const createBackupPayload = (backupMode: "compact" | "full"): StoryBackupPayload => {
    const includeHistory = backupMode === "full";
    const hydratedVolumes = getVolumesWithCurrentDraft();
    const preparedVolumes = includeHistory ? hydratedVolumes : stripChapterHistory(hydratedVolumes);
    const stats = getStoryStats(preparedVolumes);

    return {
      format: "storycraft-backup",
      version: STORY_BACKUP_VERSION,
      app: "StoryCraft",
      backupMode,
      exportDate: new Date().toISOString(),
      meta: {
        ...stats,
        includesHistory: includeHistory,
      },
      data: {
        volumes: preparedVolumes,
        activeVolumeId,
        activeChapterId,
        expandedVolumes,
        writingStyles,
        worldSettings,
        characterSettings,
        supportingCharacters,
        storyRules,
        plotMap,
        storyMemory,
        fanficContext,
        autoScanErrors,
      },
    };
  };

  const downloadJsonFile = (fileName: string, payload: unknown) => {
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const toggleGeminiKeyVisibility = (id: string) => {
    setVisibleGeminiKeyIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    );
  };

  const handleAddGeminiKey = async () => {
    if (!newGeminiKeyValue.trim()) {
      setConfirmDialog({
        isOpen: true,
        title: "Thiếu API key",
        message: "Hãy dán Gemini API key trước khi lưu.",
        isAlert: true,
        onConfirm: () => setConfirmDialog(null)
      });
      return;
    }

    setIsSavingGeminiKey(true);
    try {
      await addGeminiKey(newGeminiKeyLabel, newGeminiKeyValue);
      setNewGeminiKeyLabel("");
      setNewGeminiKeyValue("");
    } catch (error) {
      console.error(error);
      setConfirmDialog({
        isOpen: true,
        title: "Không thể lưu key",
        message: getReadableAiError(error, "Có lỗi xảy ra khi lưu Gemini API key."),
        isAlert: true,
        onConfirm: () => setConfirmDialog(null)
      });
    } finally {
      setIsSavingGeminiKey(false);
    }
  };

  const handleSetActiveGeminiKey = async (keyId: string) => {
    try {
      await setActiveGeminiKey(keyId);
    } catch (error) {
      console.error(error);
      setConfirmDialog({
        isOpen: true,
        title: "Không thể đổi key",
        message: getReadableAiError(error, "Không thể đặt key này làm key đang dùng."),
        isAlert: true,
        onConfirm: () => setConfirmDialog(null)
      });
    }
  };

  const handleToggleGeminiKeyEnabled = async (keyId: string, enabled: boolean) => {
    try {
      await setGeminiKeyEnabled(keyId, enabled);
    } catch (error) {
      console.error(error);
      setConfirmDialog({
        isOpen: true,
        title: "Không thể cập nhật key",
        message: getReadableAiError(error, "Có lỗi xảy ra khi cập nhật trạng thái key."),
        isAlert: true,
        onConfirm: () => setConfirmDialog(null)
      });
    }
  };

  const handleDeleteGeminiKey = (keyId: string, label: string) => {
    setConfirmDialog({
      isOpen: true,
      title: "Xóa Gemini API key",
      message: `Bạn có chắc muốn xóa ${label} khỏi trình duyệt này không?`,
      confirmText: "Xóa key",
      confirmColor: "rose",
      onConfirm: async () => {
        try {
          await deleteGeminiKey(keyId);
          setVisibleGeminiKeyIds((prev) => prev.filter((item) => item !== keyId));
        } catch (error) {
          console.error(error);
        } finally {
          setConfirmDialog(null);
        }
      }
    });
  };

  useEffect(() => {
    const loadSettings = async () => {
      const savedMemory = await safeGetItem("storyMemory");
      if (savedMemory) setStoryMemory(savedMemory);

      const p1 = await safeGetItem("page1_state");
      if (p1) setWorldSettings(JSON.parse(p1));
      
      const p2 = await safeGetItem("page2_state");
      let charSettings = {};
      if (p2) {
        charSettings = JSON.parse(p2);
        setCharacterSettings(charSettings);
      }
      
      const rules = await safeGetItem("storyRules");
      if (rules) setStoryRules(JSON.parse(rules));

      const savedPlotMap = await safeGetItem("plotMap");
      if (savedPlotMap) setPlotMap(savedPlotMap);

      const savedSupp = await safeGetItem("supportingCharacters");
      if (savedSupp) {
        setSupportingCharacters(JSON.parse(savedSupp));
      } else if ((charSettings as any).supportingCharacters) {
        // Fallback to page2_state if separate key is empty
        setSupportingCharacters((charSettings as any).supportingCharacters);
      }

      const savedFanfic = await safeGetItem("fanficContext");
      if (savedFanfic) setFanficContext(savedFanfic);
    };
    loadSettings();
  }, []);

  const saveWorldSettings = (val: any) => setWorldSettings(val);
  const saveCharacterSettings = (val: any) => setCharacterSettings(val);
  const saveStoryRules = (val: any) => setStoryRules(val);
  const savePlotMap = (val: string) => setPlotMap(val);
  const saveSupportingCharacters = (val: any[]) => setSupportingCharacters(val);
  const saveMemory = (val: string) => setStoryMemory(val);
  const saveFanficContext = (val: string) => setFanficContext(val);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      if (file.name.endsWith('.json')) {
        try {
          const data = JSON.parse(content);
          // If it's our export format, try to extract content
          if (data.volumes) {
            const allText = data.volumes.flatMap((v: any) => 
              v.chapters.map((c: any) => `CHƯƠNG: ${c.title}\n\n${c.content}`)
            ).join("\n\n---\n\n");
            setFanficContext(allText);
          } else {
            setFanficContext(content);
          }
        } catch (e) {
          setFanficContext(content);
        }
      } else {
        setFanficContext(content);
      }
    };
    reader.readAsText(file);
  };

  // Debounce settings save
  useEffect(() => {
    if (!isLoaded) return;
    const timer = setTimeout(() => {
      safeSetItem("page1_state", JSON.stringify(worldSettings));
    }, 1000);
    return () => clearTimeout(timer);
  }, [worldSettings, isLoaded]);

  useEffect(() => {
    if (!isLoaded) return;
    const timer = setTimeout(() => {
      safeSetItem("page2_state", JSON.stringify(characterSettings));
    }, 1000);
    return () => clearTimeout(timer);
  }, [characterSettings, isLoaded]);

  useEffect(() => {
    if (!isLoaded) return;
    const timer = setTimeout(() => {
      safeSetItem("storyRules", JSON.stringify(storyRules));
    }, 1000);
    return () => clearTimeout(timer);
  }, [storyRules, isLoaded]);

  useEffect(() => {
    if (!isLoaded) return;
    const timer = setTimeout(() => {
      safeSetItem("supportingCharacters", JSON.stringify(supportingCharacters));
    }, 1000);
    return () => clearTimeout(timer);
  }, [supportingCharacters, isLoaded]);

  useEffect(() => {
    if (!isLoaded) return;
    const timer = setTimeout(() => {
      safeSetItem("storyMemory", storyMemory);
    }, 1000);
    return () => clearTimeout(timer);
  }, [storyMemory, isLoaded]);

  const handleShare = async (type: "chapter" | "story") => {
    setShareType(type);
    setIsSharing(true);
    try {
      let title = "";
      let content: any = null;

      if (type === "chapter") {
        const chapter = getActiveChapter();
        if (!chapter) return;
        title = chapter.title;
        content = chapter.content;
      } else {
        title = "Toàn bộ truyện";
        content = volumes;
      }

      const slug = Math.random().toString(36).substring(2, 10) + Math.random().toString(36).substring(2, 10);
      const author_uid = user?.uid || "anonymous";
      
      await setDoc(doc(db, 'shared_stories', slug), {
        slug,
        title,
        content: JSON.stringify(content),
        author_uid,
        created_at: new Date().toISOString()
      });

      const link = `${window.location.origin}/share/${slug}`;
      setShareLink(link);
      setIsShareModalOpen(true);
      setShowMenu(false);
    } catch (error) {
      console.error(error);
      setConfirmDialog({
        isOpen: true,
        title: "Lỗi",
        message: "Không thể tạo link chia sẻ. Vui lòng thử lại sau.",
        isAlert: true,
        onConfirm: () => setConfirmDialog(null)
      });
    } finally {
      setIsSharing(false);
    }
  };

  const getPreviousChaptersText = () => {
    if (!activeVolumeId || !activeChapterId) return "";
    
    // Flatten all chapters to get context across volumes
    const allChapters = volumes.flatMap(v => v.chapters);
    const currentIndex = allChapters.findIndex(c => c.id === activeChapterId);
    
    if (currentIndex <= 0) return "";
    
    // Get ALL previous chapters for maximum context (Gemini 3.1 Pro has 2M token limit)
    const prevChapters = allChapters.slice(0, currentIndex);
    return prevChapters.map(c => `CHƯƠNG: ${c.title}\n\n${c.content}`).join("\n\n---\n\n");
  };

  useEffect(() => {
    if (!isLoaded) return;
    const timer = setTimeout(() => {
      safeSetItem("plotMap", plotMap);
    }, 1000);
    return () => clearTimeout(timer);
  }, [plotMap, isLoaded]);

  const handleContinue = async () => {
    const currentChapter = getActiveChapter();
    if (!currentChapter) return;

    cancelPendingDraftSync();
    setLoadingContinue(true);
    try {
      const storyContext = buildStoryContext();

      const previousChapters = getAiContextPreviousChapters();
      const allChapters = volumes.flatMap(v => v.chapters);
      const currentIndex = allChapters.findIndex(c => c.id === activeChapterId);
      const chapterInfo = {
        current: currentIndex + 1,
        total: parseInt(storyRules.plannedChapters || "0")
      };
      
      const res = await continueStory(localContent, instruction || "Viết tiếp đoạn văn một cách tự nhiên", storyRules, fanficContext || undefined, writingStyles, storyContext, previousChapters, chapterInfo);
      updateActiveChapterContent(localContent + (localContent ? "\n\n" : "") + res);
      setInstruction("");

      // Auto scan errors if enabled
      if (autoScanErrors) {
        handleScanErrors();
      }

      // Scroll to bottom after AI finishes writing
      setTimeout(() => {
        const scrollContainer = document.getElementById("editor-scroll-container");
        if (scrollContainer) {
          scrollContainer.scrollTo({
            top: scrollContainer.scrollHeight,
            behavior: 'smooth'
          });
        }
      }, 100);
    } catch (error) {
      console.error(error);
      setConfirmDialog({
        isOpen: true,
        title: "Lỗi",
        message: "Có lỗi xảy ra khi AI viết tiếp.",
        isAlert: true,
        onConfirm: () => setConfirmDialog(null)
      });
    } finally {
      setLoadingContinue(false);
    }
  };

  const handleRewrite = async () => {
    const currentChapter = getActiveChapter();
    if (!currentChapter) return;
    if (!localContent.trim()) return; // Rewrite requires existing content

    cancelPendingDraftSync();
    setLoadingRewrite(true);
    try {
      const storyContext = buildStoryContext();

      const previousChapters = getAiContextPreviousChapters();
      const allChapters = volumes.flatMap(v => v.chapters);
      const currentIndex = allChapters.findIndex(c => c.id === activeChapterId);
      const chapterInfo = {
        current: currentIndex + 1,
        total: parseInt(storyRules.plannedChapters || "0")
      };
      
      saveChapterVersion();
      const res = await rewriteStory(localContent, instruction || "Viết lại đoạn văn cho hay hơn", storyRules, fanficContext || undefined, writingStyles, storyContext, previousChapters, chapterInfo);
      updateActiveChapterContent(res);
      setInstruction("");

      // Auto scan errors if enabled
      if (autoScanErrors) {
        handleScanErrors();
      }
    } catch (error) {
      console.error(error);
      setConfirmDialog({
        isOpen: true,
        title: "Lỗi",
        message: "Có lỗi xảy ra khi AI viết lại.",
        isAlert: true,
        onConfirm: () => setConfirmDialog(null)
      });
    } finally {
      setLoadingRewrite(false);
    }
  };

  const handleAddNSFW = async () => {
    const currentChapter = getActiveChapter();
    if (!currentChapter) return;

    cancelPendingDraftSync();
    setLoadingNSFW(true);
    try {
      const storyContext = buildStoryContext();

      const previousChapters = getAiContextPreviousChapters();
      const allChapters = volumes.flatMap(v => v.chapters);
      const currentIndex = allChapters.findIndex(c => c.id === activeChapterId);
      const chapterInfo = {
        current: currentIndex + 1,
        total: parseInt(storyRules.plannedChapters || "0")
      };
      
      saveChapterVersion();
      const res = await rewriteStory(
        localContent, 
        "Hãy thêm các tình tiết 18+ (cảnh nóng) vào đoạn văn này một cách chi tiết, trần trụi nhưng phải TUYỆT ĐỐI phù hợp với bối cảnh, tính cách nhân vật và thiết lập từ phần nạp liệu. Đảm bảo mạch truyện vẫn tự nhiên và logic.", 
        { ...storyRules, nsfwLevel: "Cao" }, 
        fanficContext || undefined, 
        writingStyles, 
        storyContext, 
        previousChapters,
        chapterInfo
      );
      updateActiveChapterContent(res);

      // Auto scan errors if enabled
      if (autoScanErrors) {
        handleScanErrors();
      }
    } catch (error) {
      console.error(error);
      setConfirmDialog({
        isOpen: true,
        title: "Lỗi",
        message: "Có lỗi xảy ra khi AI thêm cảnh nóng.",
        isAlert: true,
        onConfirm: () => setConfirmDialog(null)
      });
    } finally {
      setLoadingNSFW(false);
    }
  };

  const handleGenerateChapterTitle = async () => {
    const currentChapter = getActiveChapter();
    if (!currentChapter) return;
    if (!localContent.trim()) {
      setConfirmDialog({
        isOpen: true,
        title: "Chưa có nội dung",
        message: "Hãy viết xong nội dung chương rồi mới đặt tên bằng AI.",
        isAlert: true,
        onConfirm: () => setConfirmDialog(null)
      });
      return;
    }

    setLoadingChapterTitle(true);
    try {
      const title = await generateChapterTitle({
        currentStory: localContent,
        currentTitle: currentChapter.title,
        previousChapters: getAiContextPreviousChapters(2),
        writingStyles,
        storyContext: buildStoryContext()
      });
      updateActiveChapterTitle(title);
    } catch (error) {
      console.error(error);
      setConfirmDialog({
        isOpen: true,
        title: "Không thể đặt tên chương",
        message: getReadableAiError(error, "Có lỗi xảy ra khi AI đặt tên chương."),
        isAlert: true,
        onConfirm: () => setConfirmDialog(null)
      });
    } finally {
      setLoadingChapterTitle(false);
    }
  };

  const handleSuggestNames = async () => {
    setLoadingNames(true);
    setSuggestedNames(null);
    try {
      const res = await suggestCharacterNames({
        identity: characterSettings.identity,
        personality: characterSettings.personality,
        background: characterSettings.background,
        worldSetting: worldSettings.worldSetting,
        writingStyles
      });
      setSuggestedNames(res);
    } catch (error) {
      console.error(error);
      setConfirmDialog({
        isOpen: true,
        title: "Lỗi",
        message: "Không thể gợi ý tên nhân vật.",
        isAlert: true,
        onConfirm: () => setConfirmDialog(null)
      });
    } finally {
      setLoadingNames(false);
    }
  };

  const handleSuggestAppearance = async (isMain: boolean, index?: number) => {
    setLoadingAppearance(true);
    try {
      let params;
      if (isMain) {
        params = {
          characterName: characterSettings.characterName,
          identity: characterSettings.identity,
          personality: characterSettings.personality,
          background: characterSettings.background,
          writingStyles
        };
      } else if (index !== undefined) {
        const char = supportingCharacters[index];
        params = {
          characterName: char.name,
          identity: char.identity,
          personality: char.personality,
          background: char.background,
          writingStyles
        };
      } else return;

      const res = await suggestAppearance(params);
      if (isMain) {
        saveCharacterSettings({ ...characterSettings, appearance: res });
      } else if (index !== undefined) {
        const newChars = [...supportingCharacters];
        newChars[index].appearance = res;
        saveSupportingCharacters(newChars);
      }
    } catch (error) {
      console.error(error);
    } finally {
      setLoadingAppearance(false);
    }
  };

  const handleGeneratePlotMap = async () => {
    setLoadingPlotMap(true);
    try {
      const res = await generatePlotMap({
        worldContext: worldSettings,
        characterContext: characterSettings,
        supportingCharacters,
        rules: storyRules,
        totalChapters: parseInt(storyRules.plannedChapters || "10"),
        writingStyles
      });
      setPlotMap(res);
    } catch (error) {
      console.error(error);
      setConfirmDialog({
        isOpen: true,
        title: "Lỗi",
        message: "Có lỗi xảy ra khi AI lập bản đồ cốt truyện.",
        isAlert: true,
        onConfirm: () => setConfirmDialog(null)
      });
    } finally {
      setLoadingPlotMap(false);
    }
  };

  const handleScanFullStory = async () => {
    cancelPendingDraftSync();
    setLoadingFullScan(true);
    setScanResults(null);
    try {
      const res = await scanFullStoryConsistency({
        volumes: getVolumesWithCurrentDraft(),
        worldContext: worldSettings,
        characterContext: characterSettings,
        supportingCharacters,
        plotMap,
        writingStyles
      });
      setScanResults(res);
    } catch (error) {
      console.error(error);
      setConfirmDialog({
        isOpen: true,
        title: "Lỗi",
        message: "Có lỗi xảy ra khi AI quét toàn bộ truyện.",
        isAlert: true,
        onConfirm: () => setConfirmDialog(null)
      });
    } finally {
      setLoadingFullScan(false);
    }
  };

  const handleImport = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = async (e: any) => {
      const file = e.target.files[0];
      if (!file) return;
      
      const reader = new FileReader();
      reader.onload = async (event: any) => {
        try {
          cancelPendingDraftSync();
          const rawData = JSON.parse(event.target.result);
          const importedData = rawData?.format === "storycraft-backup"
            ? rawData.data
            : {
                volumes: rawData.volumes,
                storyRules: rawData.rules,
                fanficContext: rawData.fanficContext,
              };

          if (!Array.isArray(importedData?.volumes) || importedData.volumes.length === 0) {
            throw new Error("Missing volumes");
          }

          const importedVolumes: Volume[] = importedData.volumes.map((volume: Volume) => ({
            ...volume,
            chapters: volume.chapters.map((chapter) => ({
              ...chapter,
              history: trimChapterHistory(chapter.history),
            })),
          }));

          const fallbackVolumeId = importedVolumes[0].id;
          const requestedVolumeId =
            typeof importedData.activeVolumeId === "string" &&
            importedVolumes.some((volume: Volume) => volume.id === importedData.activeVolumeId)
              ? importedData.activeVolumeId
              : fallbackVolumeId;

          const activeVolume =
            importedVolumes.find((volume) => volume.id === requestedVolumeId) || importedVolumes[0];
          const requestedChapterId =
            typeof importedData.activeChapterId === "string" &&
            activeVolume.chapters.some((chapter) => chapter.id === importedData.activeChapterId)
              ? importedData.activeChapterId
              : activeVolume.chapters[0]?.id || "";

          const nextExpandedVolumes =
            Array.isArray(importedData.expandedVolumes) && importedData.expandedVolumes.length > 0
              ? importedData.expandedVolumes.filter((volumeId: string) =>
                  importedVolumes.some((volume) => volume.id === volumeId),
                )
              : importedVolumes.map((volume) => volume.id);

          setVolumes(importedVolumes);
          setActiveVolumeId(requestedVolumeId);
          setActiveChapterId(requestedChapterId);
          setExpandedVolumes(nextExpandedVolumes.length > 0 ? nextExpandedVolumes : importedVolumes.map((volume) => volume.id));
          setWritingStyles(Array.isArray(importedData.writingStyles) ? importedData.writingStyles : []);
          setWorldSettings(importedData.worldSettings || {});
          setCharacterSettings(importedData.characterSettings || {});
          setSupportingCharacters(Array.isArray(importedData.supportingCharacters) ? importedData.supportingCharacters : []);
          setStoryRules(importedData.storyRules || {});
          setPlotMap(importedData.plotMap || "");
          setStoryMemory(importedData.storyMemory || "");
          setFanficContext(importedData.fanficContext || "");
          setAutoScanErrors(Boolean(importedData.autoScanErrors));

          const currentChapter =
            activeVolume.chapters.find((chapter) => chapter.id === requestedChapterId) || activeVolume.chapters[0];

          dirtyChapterIdsRef.current.clear();
          removedChapterIdsRef.current.clear();
          await clearStoryDraftStorage();
          await persistStoryState(importedVolumes, { sync: true });
          await Promise.all([
            safeSetItem("activeVolumeId", requestedVolumeId),
            safeSetItem("activeChapterId", requestedChapterId),
            safeSetItem("expandedVolumes", JSON.stringify(nextExpandedVolumes.length > 0 ? nextExpandedVolumes : importedVolumes.map((volume) => volume.id))),
            safeSetItem("writingStyles", JSON.stringify(Array.isArray(importedData.writingStyles) ? importedData.writingStyles : [])),
            safeSetItem("page1_state", JSON.stringify(importedData.worldSettings || {})),
            safeSetItem("page2_state", JSON.stringify(importedData.characterSettings || {})),
            safeSetItem("supportingCharacters", JSON.stringify(Array.isArray(importedData.supportingCharacters) ? importedData.supportingCharacters : [])),
            safeSetItem("storyRules", JSON.stringify(importedData.storyRules || {})),
            safeSetItem("plotMap", importedData.plotMap || ""),
            safeSetItem("storyMemory", importedData.storyMemory || ""),
            safeSetItem("fanficContext", importedData.fanficContext || ""),
            safeSetItem("autoScanErrors", JSON.stringify(Boolean(importedData.autoScanErrors))),
            safeSetItem("currentStory", currentChapter?.content || ""),
          ]);
          
          setConfirmDialog({
            isOpen: true,
            title: "Thành công",
            message: "Dữ liệu truyện đã được khôi phục thành công.",
            isAlert: true,
            onConfirm: () => setConfirmDialog(null)
          });
        } catch (error) {
          console.error("Error importing story", error);
          setConfirmDialog({
            isOpen: true,
            title: "Lỗi",
            message: "Tệp tin không hợp lệ hoặc bị hỏng.",
            isAlert: true,
            onConfirm: () => setConfirmDialog(null)
          });
        }
      };
      reader.readAsText(file);
    };
    input.click();
  };

  const handleScanErrors = async () => {
    const currentChapter = getActiveChapter();
    if (!currentChapter) return;
    if (!localContent.trim()) return;

    cancelPendingDraftSync();
    setLoadingScan(true);
    try {
      const storyContext = buildStoryContext();

      const previousChapters = getAiContextPreviousChapters();
      const res = await scanStoryErrors({
        currentStory: localContent,
        previousChapters,
        styleInstructions: writingStyles.join(", "),
        storyContext,
        writingStyles
      });
      setScanResults(res);
    } catch (error) {
      console.error(error);
      setConfirmDialog({
        isOpen: true,
        title: "Lỗi",
        message: "Có lỗi xảy ra khi AI quét lỗi truyện.",
        isAlert: true,
        onConfirm: () => setConfirmDialog(null)
      });
    } finally {
      setLoadingScan(false);
    }
  };

  const handleNextScene = () => {
    if (!activeVolumeId || !activeChapterId) return;

    const draftSafeVolumes = flushCurrentDraftToVolumes();

    const currentVolumeIndex = draftSafeVolumes.findIndex(v => v.id === activeVolumeId);
    if (currentVolumeIndex === -1) return;

    const currentVolume = draftSafeVolumes[currentVolumeIndex];
    const currentChapterIndex = currentVolume.chapters.findIndex(c => c.id === activeChapterId);
    if (currentChapterIndex === -1) return;

    // Check if there's a next chapter in the current volume
    if (currentChapterIndex < currentVolume.chapters.length - 1) {
      const nextChapter = currentVolume.chapters[currentChapterIndex + 1];
      setActiveChapterId(nextChapter.id);
      return;
    }

    // Check if there's a next volume
    if (currentVolumeIndex < draftSafeVolumes.length - 1) {
      const nextVolume = draftSafeVolumes[currentVolumeIndex + 1];
      if (nextVolume.chapters.length > 0) {
        setActiveVolumeId(nextVolume.id);
        setActiveChapterId(nextVolume.chapters[0].id);
        return;
      }
    }

    // If it's the last chapter of the last volume, prompt to create a new chapter
    setConfirmDialog({
      isOpen: true,
      title: "Hết chương",
      message: "Bạn đã đi đến cuối chương hiện tại. Bạn có muốn tạo chương mới không?",
      confirmText: "Tạo chương mới",
      confirmColor: "bg-indigo-600 hover:bg-indigo-700",
      onConfirm: () => {
        addChapter(activeVolumeId);
        setConfirmDialog(null);
      }
    });
  };

  const handleFixErrors = async () => {
    const currentChapter = getActiveChapter();
    if (!currentChapter) return;
    if (!localContent.trim()) return; // Fix errors requires existing content

    cancelPendingDraftSync();
    setLoadingFixErrors(true);
    try {
      const fanficContext = await safeGetItem("fanficContext") || "";
      const storyContext = buildStoryContext();

      const previousChapters = getAiContextPreviousChapters();

      saveChapterVersion();
      const res = await fixStoryErrors(localContent, writingStyles, storyContext, previousChapters);
      updateActiveChapterContent(res);
    } catch (error) {
      console.error(error);
      setConfirmDialog({
        isOpen: true,
        title: "Lỗi",
        message: "Có lỗi xảy ra khi AI tự động sửa lỗi.",
        isAlert: true,
        onConfirm: () => setConfirmDialog(null)
      });
    } finally {
      setLoadingFixErrors(false);
    }
  };

  const handleCopy = () => {
    const currentChapter = getActiveChapter();
    if (currentChapter) {
      navigator.clipboard.writeText(localContent);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleClear = () => {
    setConfirmDialog({
      isOpen: true,
      title: "Xóa nội dung",
      message: "Bạn có chắc chắn muốn xóa toàn bộ nội dung chương này?",
      onConfirm: () => {
        cancelPendingDraftSync();
        updateActiveChapterContent("");
        setShowMenu(false);
        setConfirmDialog(null);
      }
    });
  };

  const handleDeleteAll = () => {
    setConfirmDialog({
      isOpen: true,
      title: "Xóa toàn bộ truyện",
      message: "Bạn có chắc chắn muốn XÓA TOÀN BỘ truyện (tất cả quyển và chương)? Hành động này không thể hoàn tác.",
      onConfirm: () => {
        cancelPendingDraftSync();
        const initialVolumes = [{ id: "v1", title: "Quyển 1", chapters: [{ id: "c1", title: "Chương 1", content: "" }] }];
        setVolumes(initialVolumes);
        setActiveVolumeId("v1");
        setActiveChapterId("c1");
        setExpandedVolumes(["v1"]);
        setLocalContent("");
        dirtyChapterIdsRef.current.clear();
        removedChapterIdsRef.current.clear();
        void clearStoryDraftStorage().then(async () => {
          await persistStoryState(initialVolumes, { sync: true });
          await safeSetItem("expandedVolumes", JSON.stringify(["v1"]));
          await safeSetItem("currentStory", "");
        });
        setShowMenu(false);
        setConfirmDialog(null);
      }
    });
  };

  const handleManualSave = () => {
    cancelPendingDraftSync();
    const timestamp = Date.now();
    let latestChapter: Chapter | null = null;

    const volumesToSave = getVolumesWithCurrentDraft().map((volume) => {
      if (volume.id !== activeVolumeId) {
        return volume;
      }

      return {
        ...volume,
        chapters: volume.chapters.map((chapter) => {
          if (chapter.id !== activeChapterId) {
            return chapter;
          }

          const updatedChapter: Chapter = {
            ...chapter,
            content: localContent,
          };

          if (updatedChapter.content.trim()) {
            const lastVersion = updatedChapter.history?.[0];
            const isDuplicate =
              lastVersion?.content === updatedChapter.content &&
              lastVersion?.title === updatedChapter.title;

            if (!isDuplicate) {
              const newVersion: ChapterVersion = {
                id: timestamp.toString(),
                timestamp,
                content: updatedChapter.content,
                title: updatedChapter.title,
              };
              updatedChapter.history = trimChapterHistory([newVersion, ...(updatedChapter.history || [])]);
            }
          }

          latestChapter = updatedChapter;
          return updatedChapter;
        }),
      };
    });

    setVolumes(volumesToSave);
    markChapterDirty(activeChapterId);
    void persistStoryState(volumesToSave, { chapterIds: activeChapterId ? [activeChapterId] : [] });
    if (latestChapter) {
      void safeSetItem("currentStory", latestChapter.content);
    }
    
    setManualSaved(true);
    setTimeout(() => setManualSaved(false), 3000);
    setShowMenu(false);
  };

  const handleExport = async (backupMode: "compact" | "full" = "compact") => {
    try {
      const exportData = createBackupPayload(backupMode);
      const fileSuffix = backupMode === "full" ? "full" : "compact";
      downloadJsonFile(
        `storycraft-${fileSuffix}-backup-${new Date().toISOString().slice(0, 10)}.json`,
        exportData,
      );
      setShowMenu(false);
    } catch (error) {
      console.error("Export failed", error);
      setConfirmDialog({
        isOpen: true,
        title: "Lỗi",
        message: "Không thể xuất file. Vui lòng thử lại.",
        isAlert: true,
        onConfirm: () => setConfirmDialog(null)
      });
    }
  };

  const toggleVolume = (volumeId: string) => {
    setExpandedVolumes(prev => 
      prev.includes(volumeId) ? prev.filter(id => id !== volumeId) : [...prev, volumeId]
    );
  };

  const addVolume = () => {
    const newVolumeId = `v${Date.now()}`;
    const newChapterId = `c${Date.now()}`;
    setStoryVolumes(prev => [
      ...prev,
      {
        id: newVolumeId,
        title: `Quyển ${prev.length + 1}`,
        chapters: [{ id: newChapterId, title: "Chương 1", content: "" }]
      }
    ]);
    setExpandedVolumes(prev => [...prev, newVolumeId]);
    setActiveVolumeId(newVolumeId);
    setActiveChapterId(newChapterId);
  };

  const addChapter = (volumeId: string) => {
    const newChapterId = `c${Date.now()}`;
    setStoryVolumes(prev => prev.map(v => {
      if (v.id === volumeId) {
        return {
          ...v,
          chapters: [...v.chapters, { id: newChapterId, title: `Chương ${v.chapters.length + 1}`, content: "" }]
        };
      }
      return v;
    }));
    if (!expandedVolumes.includes(volumeId)) {
      setExpandedVolumes(prev => [...prev, volumeId]);
    }
    setActiveVolumeId(volumeId);
    setActiveChapterId(newChapterId);
  };

  const deleteChapter = (volumeId: string, chapterId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirmDialog({
      isOpen: true,
      title: "Xóa chương",
      message: "Bạn có chắc chắn muốn xóa chương này?",
      onConfirm: () => {
        queueChapterRemoval([chapterId]);
        setStoryVolumes(prev => {
          const newVolumes = prev.map(v => {
            if (v.id === volumeId) {
              return { ...v, chapters: v.chapters.filter(c => c.id !== chapterId) };
            }
            return v;
          });
          
          if (activeChapterId === chapterId) {
            const volume = newVolumes.find(v => v.id === volumeId);
            if (volume && volume.chapters.length > 0) {
              setActiveChapterId(volume.chapters[0].id);
            } else {
              setActiveChapterId("");
            }
          }
          return newVolumes;
        });
        setConfirmDialog(null);
      }
    });
  };

  const deleteVolume = (volumeId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (volumes.length <= 1) {
      setConfirmDialog({
        isOpen: true,
        title: "Không thể xóa",
        message: "Bạn phải có ít nhất một quyển truyện.",
        isAlert: true,
        onConfirm: () => setConfirmDialog(null)
      });
      return;
    }

    setConfirmDialog({
      isOpen: true,
      title: "Xóa quyển",
      message: "Bạn có chắc chắn muốn xóa toàn bộ quyển này cùng tất cả các chương bên trong?",
      onConfirm: () => {
        const volumeChapterIds = volumes
          .find((volume) => volume.id === volumeId)
          ?.chapters.map((chapter) => chapter.id) || [];
        queueChapterRemoval(volumeChapterIds);
        setStoryVolumes(prev => {
          const newVolumes = prev.filter(v => v.id !== volumeId);
          
          if (activeVolumeId === volumeId) {
            setActiveVolumeId(newVolumes[0].id);
            if (newVolumes[0].chapters.length > 0) {
              setActiveChapterId(newVolumes[0].chapters[0].id);
            } else {
              setActiveChapterId("");
            }
          }
          return newVolumes;
        });
        setConfirmDialog(null);
      }
    });
  };

  const toggleStyle = (style: string) => {
    setWritingStyles(prev => 
      prev.includes(style) ? prev.filter(s => s !== style) : [...prev, style]
    );
  };

  const handleEnterFocusMode = () => {
    setIsFocusMode(true);
    setIsSidebarCollapsed(true);
  };

  const activeChapter = getActiveChapter();
  const hasDraftContent = localContent.trim().length > 0;
  const draftCharacterCount = localContent.length;

  return (
    <div className="h-full flex flex-col relative bg-stone-50">
      {/* Top Toolbar */}
      {!isFocusMode && (
        <div className="sticky top-0 z-10 bg-white/70 backdrop-blur-xl border-b border-stone-200/60 px-4 sm:px-8 py-4 flex items-center justify-between shadow-sm">
          <div className="flex items-center gap-2 sm:gap-6">
            <Link to="/page3" className="p-2 text-stone-500 hover:text-stone-900 hover:bg-stone-100/80 rounded-xl transition-all active:scale-95" title="Trang trước">
              <ArrowLeft size={20} />
            </Link>
            <button 
              onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
              className={`p-2 rounded-xl transition-all active:scale-95 ${!isSidebarCollapsed ? "bg-indigo-600 text-white shadow-md shadow-indigo-200" : "text-stone-500 hover:bg-stone-100/80 hover:text-indigo-600"}`}
              title="Mục lục"
            >
              <Menu size={20} />
            </button>
            <div className="flex items-center gap-2 sm:gap-3 ml-1 sm:ml-2">
              <div className="p-2 bg-stone-900 text-white rounded-xl shadow-sm">
                <PenTool size={18} />
              </div>
              <h1 className="text-lg sm:text-xl font-display font-bold text-stone-900 hidden xs:block tracking-tight">Editor</h1>
            </div>
          </div>
          <div className="flex items-center gap-1 sm:gap-2">
            {!hasGeminiKey && (
              <button
                onClick={openGeminiKeyManager}
                className="hidden sm:flex items-center gap-2 px-3 py-1.5 bg-amber-50 text-amber-700 hover:bg-amber-100 border border-amber-200 rounded-xl text-[10px] sm:text-xs font-bold transition-all active:scale-95"
                title="Thêm Gemini API key cá nhân để app tự xoay key khi hết quota"
              >
                <Sparkles size={14} />
                <span className="hidden lg:inline">Thêm Gemini key</span>
              </button>
            )}
            <div className="hidden lg:flex items-center gap-1.5 text-[10px] font-bold text-stone-400 uppercase tracking-widest bg-stone-100/50 px-3 py-1.5 rounded-full border border-stone-200/50">
              <FileText size={14} />
              <span>{draftCharacterCount} ký tự</span>
            </div>
            <div className="flex items-center gap-0.5 sm:gap-1 relative" ref={menuRef}>
              <button 
                onClick={handleManualSave}
                className={`p-2 rounded-xl transition-all active:scale-95 flex items-center gap-2 ${manualSaved ? "bg-emerald-50 text-emerald-600" : "text-stone-500 hover:text-indigo-600 hover:bg-indigo-50"}`}
                title="Lưu truyện vào trình duyệt"
              >
                {manualSaved ? <CheckCircle2 size={18} className="text-emerald-500" /> : <Save size={18} />}
                <span className="hidden xl:inline text-sm font-bold">{manualSaved ? "Đã lưu" : "Lưu truyện"}</span>
              </button>

              <div className="w-px h-6 bg-stone-200 mx-1 sm:mx-2"></div>

              <button onClick={handleCopy} disabled={!hasDraftContent} className="p-2 text-stone-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-xl transition-all disabled:opacity-50 active:scale-95" title="Sao chép chương hiện tại">
                {copied ? <CheckCircle2 size={18} className="text-emerald-500" /> : <Copy size={18} />}
              </button>
              <Link to="/page4" className="p-2 text-stone-500 hover:text-emerald-600 hover:bg-emerald-50 rounded-xl transition-all active:scale-95" title="Minh họa truyện">
                <ImageIcon size={18} />
              </Link>

              <div className="w-px h-6 bg-stone-200 mx-1 sm:mx-2"></div>

              <button 
                onClick={() => setIsMemoryOpen(true)}
                className="p-2 text-stone-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-xl transition-all flex items-center gap-2 active:scale-95"
                title="Bộ nhớ AI"
              >
                <Brain size={18} />
                <span className="hidden 2xl:inline text-sm font-bold">Bộ nhớ AI</span>
              </button>

              <button 
                onClick={() => setIsHistoryOpen(true)}
                className="p-2 text-stone-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-xl transition-all flex items-center gap-2 active:scale-95"
                title="Lịch sử chỉnh sửa"
              >
                <RotateCcw size={18} />
                <span className="hidden 2xl:inline text-sm font-bold">Lịch sử</span>
              </button>

              <button 
                onClick={handleScanErrors}
                disabled={loadingScan || !hasDraftContent}
                className="p-2 text-stone-500 hover:text-amber-600 hover:bg-amber-50 rounded-xl transition-all flex items-center gap-2 active:scale-95"
                title="Quét lỗi truyện"
              >
                {loadingScan ? <Loader2 size={18} className="animate-spin" /> : <Shield size={18} />}
                <span className="hidden 2xl:inline text-sm font-bold">Quét lỗi</span>
              </button>

              <button 
                onClick={handleEnterFocusMode}
                className="p-2 text-stone-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-xl transition-all flex items-center gap-2 active:scale-95"
                title="Chế độ tập trung"
              >
                <Maximize2 size={18} />
                <span className="hidden xl:inline text-sm font-bold">Tập trung</span>
              </button>

              <button 
                onClick={handleNextScene}
                className="p-2 text-stone-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-xl transition-all flex items-center gap-2 active:scale-95"
                title="Chương tiếp theo"
              >
                <ArrowRight size={18} />
                <span className="hidden xl:inline text-sm font-bold">Chương sau</span>
              </button>

              <button 
                onClick={() => setShowMenu(!showMenu)} 
                className={`p-2 rounded-xl transition-all active:scale-95 ${showMenu ? "bg-stone-900 text-white shadow-md" : "text-stone-500 hover:bg-stone-100"}`}
                title="Menu quản lý"
              >
                <Settings size={18} />
              </button>

              {showMenu && (
                <div className="absolute top-full right-0 mt-2 w-64 bg-white rounded-xl shadow-xl border border-stone-200 py-2 z-50 animate-in fade-in slide-in-from-top-2 duration-200">
                  <button 
                    onClick={() => handleShare("chapter")}
                    disabled={isSharing}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-stone-700 hover:bg-stone-50 transition-colors disabled:opacity-50"
                  >
                    <Share2 size={18} className="text-blue-500" />
                    Chia sẻ chương hiện tại
                  </button>

                  <button 
                    onClick={() => handleShare("story")}
                    disabled={isSharing}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-stone-700 hover:bg-stone-50 transition-colors disabled:opacity-50"
                  >
                    <Globe size={18} className="text-indigo-500" />
                    Chia sẻ toàn bộ truyện
                  </button>

                  <div className="h-px bg-stone-100 my-1 mx-2"></div>

                  <button 
                    onClick={handleImport}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-stone-700 hover:bg-stone-50 transition-colors"
                  >
                    <Upload size={18} className="text-sky-500" />
                    Nhập bản sao truyện (.json)
                  </button>

                  <button 
                    onClick={() => handleExport("compact")}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-stone-700 hover:bg-stone-50 transition-colors"
                  >
                    <Download size={18} className="text-emerald-500" />
                    Xuất bản sao gọn (.json)
                  </button>

                  <button 
                    onClick={() => handleExport("full")}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-stone-700 hover:bg-stone-50 transition-colors"
                  >
                    <Download size={18} className="text-indigo-500" />
                    Xuất bản sao đầy đủ (.json)
                  </button>

                  <button 
                    onClick={() => { setIsSettingsModalOpen(true); setShowMenu(false); }}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-stone-700 hover:bg-stone-50 transition-colors"
                  >
                    <Settings size={18} className="text-stone-500" />
                    Chỉnh sửa thiết lập truyện
                  </button>

                  <div className="h-px bg-stone-100 my-1 mx-2"></div>

                  <button 
                    onClick={handleClear}
                    disabled={!hasDraftContent}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-rose-600 hover:bg-rose-50 transition-colors disabled:opacity-50"
                  >
                    <Trash2 size={18} />
                    Xóa nội dung chương
                  </button>

                  <button 
                    onClick={handleDeleteAll}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-rose-600 hover:bg-rose-50 transition-colors"
                  >
                    <Trash2 size={18} className="fill-rose-100" />
                    Xóa toàn bộ truyện
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Share Modal */}
      {isShareModalOpen && shareLink && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-stone-900/60 backdrop-blur-md">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="p-6 border-b border-stone-100 flex items-center justify-between bg-stone-50">
              <h2 className="text-xl font-bold text-stone-800">Chia sẻ truyện</h2>
              <button onClick={() => setIsShareModalOpen(false)} className="p-2 text-stone-400 hover:text-stone-600 hover:bg-stone-100 rounded-full transition-colors">
                <X size={20} />
              </button>
            </div>
            <div className="p-8 space-y-6">
              <div className="text-center space-y-2">
                <div className="w-16 h-16 bg-indigo-100 text-indigo-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
                  <Share2 size={32} />
                </div>
                <p className="text-stone-600">Link chia sẻ {shareType === "chapter" ? "chương này" : "toàn bộ truyện"} của bạn đã sẵn sàng!</p>
              </div>

              <div className="flex items-center gap-2 p-3 bg-stone-50 rounded-xl border border-stone-200">
                <input 
                  type="text" 
                  readOnly 
                  value={shareLink} 
                  className="flex-1 bg-transparent border-none focus:ring-0 text-sm text-stone-600 font-mono"
                />
                <button 
                  onClick={() => {
                    navigator.clipboard.writeText(shareLink);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  }}
                  className="p-2 text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                >
                  {copied ? <CheckCircle2 size={20} /> : <Copy size={20} />}
                </button>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <a 
                  href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareLink)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex flex-col items-center gap-2 p-3 rounded-xl hover:bg-blue-50 transition-colors group"
                >
                  <div className="w-10 h-10 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center group-hover:bg-blue-600 group-hover:text-white transition-colors">
                    <Facebook size={20} />
                  </div>
                  <span className="text-xs font-medium text-stone-500">Facebook</span>
                </a>
                <a 
                  href={`https://twitter.com/intent/tweet?url=${encodeURIComponent(shareLink)}&text=${encodeURIComponent("Xem truyện của tôi trên AI Studio!")}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex flex-col items-center gap-2 p-3 rounded-xl hover:bg-sky-50 transition-colors group"
                >
                  <div className="w-10 h-10 bg-sky-100 text-sky-600 rounded-full flex items-center justify-center group-hover:bg-sky-600 group-hover:text-white transition-colors">
                    <Twitter size={20} />
                  </div>
                  <span className="text-xs font-medium text-stone-500">Twitter</span>
                </a>
                <a 
                  href={`https://api.whatsapp.com/send?text=${encodeURIComponent("Xem truyện của tôi trên AI Studio: " + shareLink)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex flex-col items-center gap-2 p-3 rounded-xl hover:bg-emerald-50 transition-colors group"
                >
                  <div className="w-10 h-10 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center group-hover:bg-emerald-600 group-hover:text-white transition-colors">
                    <MessageCircle size={20} />
                  </div>
                  <span className="text-xs font-medium text-stone-500">WhatsApp</span>
                </a>
              </div>
            </div>
            <div className="p-6 bg-stone-50 border-t border-stone-100 flex justify-center">
              <button 
                onClick={() => setIsShareModalOpen(false)}
                className="px-8 py-2.5 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-200"
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Settings Modal */}
      {isSettingsModalOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-stone-900/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl overflow-hidden animate-in zoom-in-95 duration-200 flex flex-col max-h-[90vh]">
            <div className="p-6 border-b border-stone-100 flex items-center justify-between bg-stone-50">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-stone-200 text-stone-700 rounded-lg">
                  <Settings size={24} />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-stone-800">Thiết lập truyện</h2>
                  <p className="text-sm text-stone-500">Chỉnh sửa bối cảnh, nhân vật và quy tắc AI</p>
                </div>
              </div>
              <button onClick={() => setIsSettingsModalOpen(false)} className="p-2 text-stone-400 hover:text-stone-600 hover:bg-stone-100 rounded-full transition-colors">
                <X size={20} />
              </button>
            </div>

            <div className="px-4 sm:px-6 py-4 bg-white border-b border-stone-100 overflow-x-auto no-scrollbar">
              <div className="flex p-1 bg-stone-100 rounded-xl min-w-max">
                <button 
                  onClick={() => setActiveSettingsTab("genre")}
                  className={`flex-1 px-3 sm:px-4 py-2 text-[10px] sm:text-sm font-bold rounded-lg flex items-center justify-center gap-1.5 sm:gap-2 transition-all ${activeSettingsTab === "genre" ? "bg-white text-indigo-600 shadow-sm" : "text-stone-500 hover:text-stone-700"}`}
                >
                  <PenTool size={14} className="sm:w-4 sm:h-4" />
                  <span className="whitespace-nowrap">Thể loại</span>
                </button>
                <button 
                  onClick={() => setActiveSettingsTab("world")}
                  className={`flex-1 px-3 sm:px-4 py-2 text-[10px] sm:text-sm font-bold rounded-lg flex items-center justify-center gap-1.5 sm:gap-2 transition-all ${activeSettingsTab === "world" ? "bg-white text-indigo-600 shadow-sm" : "text-stone-500 hover:text-stone-700"}`}
                >
                  <Globe size={14} className="sm:w-4 sm:h-4" />
                  <span className="whitespace-nowrap">Thế giới</span>
                </button>
                <button 
                  onClick={() => setActiveSettingsTab("character")}
                  className={`flex-1 px-3 sm:px-4 py-2 text-[10px] sm:text-sm font-bold rounded-lg flex items-center justify-center gap-1.5 sm:gap-2 transition-all ${activeSettingsTab === "character" ? "bg-white text-indigo-600 shadow-sm" : "text-stone-500 hover:text-stone-700"}`}
                >
                  <User size={14} className="sm:w-4 sm:h-4" />
                  <span className="whitespace-nowrap">Nhân vật chính</span>
                </button>
                <button 
                  onClick={() => setActiveSettingsTab("supporting")}
                  className={`flex-1 px-3 sm:px-4 py-2 text-[10px] sm:text-sm font-bold rounded-lg flex items-center justify-center gap-1.5 sm:gap-2 transition-all ${activeSettingsTab === "supporting" ? "bg-white text-indigo-600 shadow-sm" : "text-stone-500 hover:text-stone-700"}`}
                >
                  <Users size={14} className="sm:w-4 sm:h-4" />
                  <span className="whitespace-nowrap">Nhân vật phụ</span>
                </button>
                <button 
                  onClick={() => setActiveSettingsTab("reference")}
                  className={`flex-1 px-3 sm:px-4 py-2 text-[10px] sm:text-sm font-bold rounded-lg flex items-center justify-center gap-1.5 sm:gap-2 transition-all ${activeSettingsTab === "reference" ? "bg-white text-indigo-600 shadow-sm" : "text-stone-500 hover:text-stone-700"}`}
                >
                  <Database size={14} className="sm:w-4 sm:h-4" />
                  <span className="whitespace-nowrap">Nạp liệu</span>
                </button>
                <button 
                  onClick={() => setActiveSettingsTab("rules")}
                  className={`flex-1 px-3 sm:px-4 py-2 text-[10px] sm:text-sm font-bold rounded-lg flex items-center justify-center gap-1.5 sm:gap-2 transition-all ${activeSettingsTab === "rules" ? "bg-white text-indigo-600 shadow-sm" : "text-stone-500 hover:text-stone-700"}`}
                >
                  <Shield size={14} className="sm:w-4 sm:h-4" />
                  <span className="whitespace-nowrap">Quy tắc</span>
                </button>
                <button 
                  onClick={() => setActiveSettingsTab("plot")}
                  className={`flex-1 px-3 sm:px-4 py-2 text-[10px] sm:text-sm font-bold rounded-lg flex items-center justify-center gap-1.5 sm:gap-2 transition-all ${activeSettingsTab === "plot" ? "bg-white text-indigo-600 shadow-sm" : "text-stone-500 hover:text-stone-700"}`}
                >
                  <Map size={14} className="sm:w-4 sm:h-4" />
                  <span className="whitespace-nowrap">Bản đồ</span>
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {activeSettingsTab === "genre" && (
                <div className="space-y-6">
                  <div className="bg-stone-50 p-4 rounded-2xl border border-stone-100">
                    <label className="block text-xs font-bold text-stone-500 uppercase tracking-wider mb-2">Thể loại truyện</label>
                    <input 
                      type="text"
                      value={worldSettings.selectedGenres?.join(", ") || ""} 
                      onChange={(e) => saveWorldSettings({...worldSettings, selectedGenres: e.target.value.split(",").map(s => s.trim())})}
                      placeholder="Ví dụ: Tiên hiệp, Huyền huyễn, Đô thị, Hệ thống..."
                      className="w-full p-3 rounded-xl border border-stone-200 focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm bg-white"
                    />
                    <p className="mt-2 text-[10px] text-stone-400 italic">Phân cách các thể loại bằng dấu phẩy.</p>
                  </div>
                  
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="p-4 bg-stone-50 rounded-2xl border border-stone-100">
                      <label className="block text-xs font-bold text-stone-500 uppercase tracking-wider mb-2">Phong cách viết</label>
                      <div className="flex flex-wrap gap-2">
                        {["Thuần Việt", "Hán Việt", "Kịch tính", "Miêu tả", "Hài hước", "U tối"].map(style => (
                          <button
                            key={style}
                            onClick={() => toggleStyle(style)}
                            className={`px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all ${
                              writingStyles.includes(style)
                                ? "bg-stone-900 text-white shadow-sm"
                                : "bg-white text-stone-500 border border-stone-200 hover:border-stone-400"
                            }`}
                          >
                            {style}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="p-4 bg-stone-50 rounded-2xl border border-stone-100">
                      <label className="block text-xs font-bold text-stone-500 uppercase tracking-wider mb-2">Đối tượng độc giả</label>
                      <input 
                        type="text"
                        value={worldSettings.targetAudience || ""} 
                        onChange={(e) => saveWorldSettings({...worldSettings, targetAudience: e.target.value})}
                        placeholder="Ví dụ: Nam giới, 18-35 tuổi..."
                        className="w-full p-3 rounded-xl border border-stone-200 focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm bg-white"
                      />
                    </div>
                  </div>

                  <div className="pt-4 border-t border-stone-100 flex justify-end">
                    <button 
                      onClick={() => {
                        safeSetItem("page1_state", JSON.stringify(worldSettings));
                        safeSetItem("writingStyles", JSON.stringify(writingStyles));
                        setManualSaved(true);
                        setTimeout(() => setManualSaved(false), 2000);
                      }}
                      className="flex items-center gap-2 px-6 py-2 bg-stone-900 text-white rounded-xl text-sm font-bold hover:bg-stone-800 transition-all shadow-lg active:scale-95"
                    >
                      {manualSaved ? <CheckCircle2 size={16} /> : <Save size={16} />}
                      {manualSaved ? "Đã lưu" : "Lưu thiết lập"}
                    </button>
                  </div>
                </div>
              )}

              {activeSettingsTab === "world" && (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-stone-500 uppercase tracking-wider mb-1">Thiết lập thế giới</label>
                      <input 
                        type="text"
                        value={worldSettings.worldSetting || ""} 
                        onChange={(e) => saveWorldSettings({...worldSettings, worldSetting: e.target.value})}
                        className="w-full p-3 rounded-xl border border-stone-200 focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm"
                        placeholder="Ví dụ: Thế giới tu tiên, Ma pháp trung cổ..."
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-stone-500 uppercase tracking-wider mb-1">Ý tưởng chính</label>
                    <textarea 
                      value={worldSettings.prompt || ""} 
                      onChange={(e) => saveWorldSettings({...worldSettings, prompt: e.target.value})}
                      className="w-full p-3 rounded-xl border border-stone-200 focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm min-h-[80px]"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-stone-500 uppercase tracking-wider mb-1">Tài nguyên</label>
                      <input 
                        type="text"
                        value={worldSettings.resources || ""} 
                        onChange={(e) => saveWorldSettings({...worldSettings, resources: e.target.value})}
                        className="w-full p-3 rounded-xl border border-stone-200 focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-stone-500 uppercase tracking-wider mb-1">Chủng tộc</label>
                      <input 
                        type="text"
                        value={worldSettings.races || ""} 
                        onChange={(e) => saveWorldSettings({...worldSettings, races: e.target.value})}
                        className="w-full p-3 rounded-xl border border-stone-200 focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-stone-500 uppercase tracking-wider mb-1">Hệ thống sức mạnh</label>
                    <input 
                      type="text"
                      value={worldSettings.powerSystem || ""} 
                      onChange={(e) => saveWorldSettings({...worldSettings, powerSystem: e.target.value})}
                      className="w-full p-3 rounded-xl border border-stone-200 focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-stone-500 uppercase tracking-wider mb-1">Logic vận hành thế giới</label>
                    <textarea 
                      value={worldSettings.worldLogic || ""} 
                      onChange={(e) => saveWorldSettings({...worldSettings, worldLogic: e.target.value})}
                      className="w-full p-3 rounded-xl border border-stone-200 focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm min-h-[80px]"
                    />
                  </div>
                  <div className="pt-4 border-t border-stone-100 flex justify-end">
                    <button 
                      onClick={() => {
                        safeSetItem("page1_state", JSON.stringify(worldSettings));
                        setManualSaved(true);
                        setTimeout(() => setManualSaved(false), 2000);
                      }}
                      className="flex items-center gap-2 px-6 py-2 bg-stone-900 text-white rounded-xl text-sm font-bold hover:bg-stone-800 transition-all shadow-lg active:scale-95"
                    >
                      {manualSaved ? <CheckCircle2 size={16} /> : <Save size={16} />}
                      {manualSaved ? "Đã lưu" : "Lưu thiết lập"}
                    </button>
                  </div>
                </div>
              )}

              {activeSettingsTab === "character" && (
                <div className="space-y-6">
                  <div className="bg-indigo-50/50 p-4 rounded-2xl border border-indigo-100 flex items-start gap-3">
                    <div className="p-2 bg-indigo-100 text-indigo-600 rounded-lg">
                      <Lightbulb size={20} />
                    </div>
                    <div className="flex-1">
                      <h4 className="text-sm font-bold text-indigo-900">Gợi ý tên nhân vật</h4>
                      <p className="text-xs text-indigo-700 mb-3">Nhập danh tính, tính cách và gia cảnh để AI gợi ý những cái tên phù hợp nhất.</p>
                      <button 
                        onClick={handleSuggestNames}
                        disabled={loadingNames || (!characterSettings.identity && !characterSettings.personality && !characterSettings.background)}
                        className="px-4 py-2 bg-indigo-600 text-white rounded-xl text-xs font-bold hover:bg-indigo-700 transition-all disabled:opacity-50 flex items-center gap-2 shadow-sm shadow-indigo-200"
                      >
                        {loadingNames ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                        Gợi ý tên ngay
                      </button>
                    </div>
                  </div>

                  {suggestedNames && (
                    <div className="p-4 bg-white rounded-2xl border border-stone-200 shadow-sm animate-in fade-in slide-in-from-top-2 duration-300">
                      <div className="flex items-center justify-between mb-3">
                        <h4 className="text-xs font-bold text-stone-500 uppercase tracking-wider">Kết quả gợi ý</h4>
                        <button onClick={() => setSuggestedNames(null)} className="text-stone-400 hover:text-stone-600">
                          <X size={14} />
                        </button>
                      </div>
                      <div className="text-sm text-stone-700 whitespace-pre-wrap font-serif leading-relaxed bg-stone-50 p-3 rounded-xl border border-stone-100">
                        {suggestedNames}
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-stone-500 uppercase tracking-wider mb-1.5">Tên nhân vật chính</label>
                      <input 
                        type="text"
                        value={characterSettings.characterName || ""} 
                        onChange={(e) => saveCharacterSettings({...characterSettings, characterName: e.target.value})}
                        className="w-full p-3 rounded-xl border border-stone-200 focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm bg-stone-50/50 transition-all focus:bg-white"
                        placeholder="Ví dụ: Tiêu Viêm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-stone-500 uppercase tracking-wider mb-1.5">Danh tính</label>
                      <input 
                        type="text"
                        value={characterSettings.identity || ""} 
                        onChange={(e) => saveCharacterSettings({...characterSettings, identity: e.target.value})}
                        className="w-full p-3 rounded-xl border border-stone-200 focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm bg-stone-50/50 transition-all focus:bg-white"
                        placeholder="Ví dụ: Thiếu gia phế vật, Luyện dược sư..."
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-stone-500 uppercase tracking-wider mb-1.5">Mô tả nhân vật</label>
                    <textarea 
                      value={characterSettings.prompt || ""} 
                      onChange={(e) => saveCharacterSettings({...characterSettings, prompt: e.target.value})}
                      className="w-full p-3 rounded-xl border border-stone-200 focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm min-h-[80px] bg-stone-50/50 transition-all focus:bg-white"
                      placeholder="Mô tả chi tiết về phong thái, vai trò..."
                    />
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="block text-xs font-bold text-stone-500 uppercase tracking-wider">Ngoại hình</label>
                      <button 
                        onClick={() => handleSuggestAppearance(true)}
                        disabled={loadingAppearance || (!characterSettings.characterName && !characterSettings.identity)}
                        className="text-[10px] font-bold text-indigo-600 hover:text-indigo-700 flex items-center gap-1 disabled:opacity-50"
                      >
                        {loadingAppearance ? <Loader2 size={10} className="animate-spin" /> : <Sparkles size={10} />}
                        Gợi ý ngoại hình
                      </button>
                    </div>
                    <textarea 
                      value={characterSettings.appearance || ""} 
                      onChange={(e) => saveCharacterSettings({...characterSettings, appearance: e.target.value})}
                      className="w-full p-3 rounded-xl border border-stone-200 focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm min-h-[80px] bg-stone-50/50 transition-all focus:bg-white"
                      placeholder="Mô tả chi tiết về khuôn mặt, trang phục, đặc điểm nhận dạng..."
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-stone-500 uppercase tracking-wider mb-1.5">Tính cách</label>
                      <input 
                        type="text"
                        value={characterSettings.personality || ""} 
                        onChange={(e) => saveCharacterSettings({...characterSettings, personality: e.target.value})}
                        className="w-full p-3 rounded-xl border border-stone-200 focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm bg-stone-50/50 transition-all focus:bg-white"
                        placeholder="Ví dụ: Kiên cường, trầm ổn, có thù tất báo"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-stone-500 uppercase tracking-wider mb-1.5">Thiên phú</label>
                      <input 
                        type="text"
                        value={characterSettings.talent || ""} 
                        onChange={(e) => saveCharacterSettings({...characterSettings, talent: e.target.value})}
                        className="w-full p-3 rounded-xl border border-stone-200 focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm bg-stone-50/50 transition-all focus:bg-white"
                        placeholder="Ví dụ: Linh hồn lực mạnh mẽ"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-stone-500 uppercase tracking-wider mb-1.5">Gia cảnh</label>
                      <input 
                        type="text"
                        value={characterSettings.background || ""} 
                        onChange={(e) => saveCharacterSettings({...characterSettings, background: e.target.value})}
                        className="w-full p-3 rounded-xl border border-stone-200 focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm bg-stone-50/50 transition-all focus:bg-white"
                        placeholder="Ví dụ: Con trai tộc trưởng Tiêu gia"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-stone-500 uppercase tracking-wider mb-1.5">Kim thủ chỉ (Cheat)</label>
                      <input 
                        type="text"
                        value={characterSettings.cheat || ""} 
                        onChange={(e) => saveCharacterSettings({...characterSettings, cheat: e.target.value})}
                        className="w-full p-3 rounded-xl border border-stone-200 focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm bg-stone-50/50 transition-all focus:bg-white"
                        placeholder="Ví dụ: Dược lão trong nhẫn"
                      />
                    </div>
                  </div>
                  <div className="pt-4 border-t border-stone-100 flex justify-end">
                    <button 
                      onClick={() => {
                        safeSetItem("page2_state", JSON.stringify(characterSettings));
                        setManualSaved(true);
                        setTimeout(() => setManualSaved(false), 2000);
                      }}
                      className="flex items-center gap-2 px-6 py-2 bg-stone-900 text-white rounded-xl text-sm font-bold hover:bg-stone-800 transition-all shadow-lg active:scale-95"
                    >
                      {manualSaved ? <CheckCircle2 size={16} /> : <Save size={16} />}
                      {manualSaved ? "Đã lưu" : "Lưu thiết lập"}
                    </button>
                  </div>
                </div>
              )}

              {activeSettingsTab === "supporting" && (
                <div className="space-y-6">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold text-stone-800">Danh sách nhân vật phụ</h3>
                    <button 
                      onClick={() => saveSupportingCharacters([...supportingCharacters, { id: Date.now().toString(), name: "", identity: "", personality: "", appearance: "", talent: "", background: "" }])}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-50 text-indigo-600 rounded-lg text-xs font-bold hover:bg-indigo-100 transition-colors"
                    >
                      <Plus size={14} />
                      Thêm nhân vật
                    </button>
                  </div>

                  {supportingCharacters.length === 0 ? (
                    <div className="text-center py-12 bg-stone-50 rounded-2xl border-2 border-dashed border-stone-200">
                      <User size={32} className="mx-auto text-stone-300 mb-2" />
                      <p className="text-sm text-stone-500">Chưa có nhân vật phụ nào được thêm.</p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {supportingCharacters.map((char, index) => (
                        <div key={char.id} className="p-4 bg-stone-50 rounded-2xl border border-stone-200 relative group">
                          <button 
                            onClick={() => saveSupportingCharacters(supportingCharacters.filter(c => c.id !== char.id))}
                            className="absolute top-2 right-2 p-1.5 text-stone-400 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
                          >
                            <Trash2 size={16} />
                          </button>
                          
                          <div className="grid grid-cols-2 gap-4 mb-4">
                            <div>
                              <label className="block text-[10px] font-bold text-stone-400 uppercase tracking-wider mb-1">Tên nhân vật</label>
                              <input 
                                type="text"
                                value={char.name} 
                                onChange={(e) => {
                                  const newChars = [...supportingCharacters];
                                  newChars[index].name = e.target.value;
                                  saveSupportingCharacters(newChars);
                                }}
                                placeholder="Ví dụ: Lâm Tuyết"
                                className="w-full p-2 rounded-lg border border-stone-200 focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm"
                              />
                            </div>
                            <div>
                              <label className="block text-[10px] font-bold text-stone-400 uppercase tracking-wider mb-1">Danh tính</label>
                              <input 
                                type="text"
                                value={char.identity} 
                                onChange={(e) => {
                                  const newChars = [...supportingCharacters];
                                  newChars[index].identity = e.target.value;
                                  saveSupportingCharacters(newChars);
                                }}
                                placeholder="Ví dụ: Sư tỷ, Công chúa..."
                                className="w-full p-2 rounded-lg border border-stone-200 focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm"
                              />
                            </div>
                          </div>

                          <div className="mb-4">
                            <div className="flex items-center justify-between mb-1">
                              <label className="block text-[10px] font-bold text-stone-400 uppercase tracking-wider">Ngoại hình</label>
                              <button 
                                onClick={() => handleSuggestAppearance(false, index)}
                                disabled={loadingAppearance || (!char.name && !char.identity)}
                                className="text-[9px] font-bold text-indigo-600 hover:text-indigo-700 flex items-center gap-1 disabled:opacity-50"
                              >
                                {loadingAppearance ? <Loader2 size={10} className="animate-spin" /> : <Sparkles size={10} />}
                                Gợi ý ngoại hình
                              </button>
                            </div>
                            <textarea 
                              value={char.appearance || ""} 
                              onChange={(e) => {
                                const newChars = [...supportingCharacters];
                                newChars[index].appearance = e.target.value;
                                saveSupportingCharacters(newChars);
                              }}
                              placeholder="Mô tả ngoại hình nhân vật phụ..."
                              className="w-full p-2 rounded-lg border border-stone-200 focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm min-h-[60px]"
                            />
                          </div>

                          <div className="grid grid-cols-3 gap-3">
                            <div>
                              <label className="block text-[10px] font-bold text-stone-400 uppercase tracking-wider mb-1">Tính cách</label>
                              <input 
                                type="text"
                                value={char.personality} 
                                onChange={(e) => {
                                  const newChars = [...supportingCharacters];
                                  newChars[index].personality = e.target.value;
                                  saveSupportingCharacters(newChars);
                                }}
                                className="w-full p-2 rounded-lg border border-stone-200 focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm"
                              />
                            </div>
                            <div>
                              <label className="block text-[10px] font-bold text-stone-400 uppercase tracking-wider mb-1">Thiên phú</label>
                              <input 
                                type="text"
                                value={char.talent} 
                                onChange={(e) => {
                                  const newChars = [...supportingCharacters];
                                  newChars[index].talent = e.target.value;
                                  saveSupportingCharacters(newChars);
                                }}
                                className="w-full p-2 rounded-lg border border-stone-200 focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm"
                              />
                            </div>
                            <div>
                              <label className="block text-[10px] font-bold text-stone-400 uppercase tracking-wider mb-1">Gia cảnh</label>
                              <input 
                                type="text"
                                value={char.background} 
                                onChange={(e) => {
                                  const newChars = [...supportingCharacters];
                                  newChars[index].background = e.target.value;
                                  saveSupportingCharacters(newChars);
                                }}
                                className="w-full p-2 rounded-lg border border-stone-200 focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm"
                              />
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="pt-4 border-t border-stone-100 flex justify-end">
                    <button 
                      onClick={() => {
                        safeSetItem("supportingCharacters", JSON.stringify(supportingCharacters));
                        setManualSaved(true);
                        setTimeout(() => setManualSaved(false), 2000);
                      }}
                      className="flex items-center gap-2 px-6 py-2 bg-stone-900 text-white rounded-xl text-sm font-bold hover:bg-stone-800 transition-all shadow-lg active:scale-95"
                    >
                      {manualSaved ? <CheckCircle2 size={16} /> : <Save size={16} />}
                      {manualSaved ? "Đã lưu" : "Lưu thiết lập"}
                    </button>
                  </div>
                </div>
              )}

              {activeSettingsTab === "reference" && (
                <div className="space-y-6">
                  <div className="p-4 bg-amber-50 border border-amber-100 rounded-xl text-sm text-amber-800 leading-relaxed">
                    <div className="flex items-center gap-2 mb-2">
                      <Shield size={18} className="text-amber-600" />
                      <strong className="text-amber-900">Gemini API key cá nhân</strong>
                    </div>
                    <p className="mb-3">
                      Key được lưu cục bộ trong trình duyệt này, tách riêng khỏi dữ liệu truyện và không đi theo file backup `.json`.
                      Khi một key báo hết quota, app sẽ tự đổi sang key đang khả dụng tiếp theo.
                    </p>
                    <div className="grid gap-2 md:grid-cols-[220px_1fr_auto]">
                      <input
                        value={newGeminiKeyLabel}
                        onChange={(e) => setNewGeminiKeyLabel(e.target.value)}
                        placeholder="Tên gợi nhớ: Key 1, Acc phụ..."
                        className="w-full px-3 py-2 rounded-xl border border-amber-200 bg-white text-sm focus:ring-2 focus:ring-amber-400 focus:border-transparent"
                      />
                      <input
                        value={newGeminiKeyValue}
                        onChange={(e) => setNewGeminiKeyValue(e.target.value)}
                        placeholder="Dán Gemini API key vào đây"
                        className="w-full px-3 py-2 rounded-xl border border-amber-200 bg-white text-sm focus:ring-2 focus:ring-amber-400 focus:border-transparent"
                      />
                      <button
                        onClick={handleAddGeminiKey}
                        disabled={isSavingGeminiKey || !newGeminiKeyValue.trim()}
                        className="flex items-center justify-center gap-2 px-4 py-2 bg-white text-amber-700 border border-amber-200 rounded-xl text-xs font-bold hover:bg-amber-100 transition-all shadow-sm disabled:opacity-50"
                      >
                        {isSavingGeminiKey ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                        Lưu key
                      </button>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
                      <span className="px-2.5 py-1 rounded-full bg-white border border-amber-200 text-amber-700 font-semibold">
                        {enabledGeminiKeyCount}/{geminiKeys.length} key đang bật
                      </span>
                      {activeGeminiKey && (
                        <span className="px-2.5 py-1 rounded-full bg-white border border-amber-200 text-amber-700 font-semibold">
                          Đang dùng: {activeGeminiKey.label}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="space-y-3">
                    {geminiKeys.length === 0 ? (
                      <div className="p-4 rounded-xl border border-dashed border-stone-300 bg-stone-50 text-sm text-stone-500">
                        Chưa có Gemini API key nào trong trình duyệt này.
                      </div>
                    ) : (
                      geminiKeys.map((key) => {
                        const cooldownLabel = formatGeminiCooldown(key.cooldownUntil);
                        const isVisible = visibleGeminiKeyIds.includes(key.id);
                        const isActiveKey = key.id === activeGeminiKeyId;

                        return (
                          <div key={key.id} className="p-4 rounded-2xl border border-stone-200 bg-white/90 shadow-sm">
                            <div className="flex flex-wrap items-center gap-2">
                              <strong className="text-stone-900">{key.label}</strong>
                              {isActiveKey && (
                                <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 text-[11px] font-bold border border-emerald-200">
                                  Đang dùng
                                </span>
                              )}
                              {!key.enabled && (
                                <span className="px-2 py-0.5 rounded-full bg-stone-100 text-stone-600 text-[11px] font-bold border border-stone-200">
                                  Đã tắt
                                </span>
                              )}
                              {cooldownLabel && (
                                <span className="px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 text-[11px] font-bold border border-amber-200">
                                  Nghỉ {cooldownLabel}
                                </span>
                              )}
                            </div>

                            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                              <input
                                readOnly
                                value={isVisible ? key.apiKey : maskGeminiApiKey(key.apiKey)}
                                className="flex-1 px-3 py-2 rounded-xl border border-stone-200 bg-stone-50 text-sm text-stone-700"
                              />
                              <div className="flex gap-2">
                                <button
                                  onClick={() => toggleGeminiKeyVisibility(key.id)}
                                  className="px-3 py-2 rounded-xl border border-stone-200 text-xs font-bold text-stone-600 hover:bg-stone-50 transition-all"
                                >
                                  {isVisible ? "Ẩn" : "Hiện"}
                                </button>
                                <button
                                  onClick={() => {
                                    void navigator.clipboard.writeText(key.apiKey).catch(() => undefined);
                                  }}
                                  className="flex items-center justify-center gap-1 px-3 py-2 rounded-xl border border-stone-200 text-xs font-bold text-stone-600 hover:bg-stone-50 transition-all"
                                  title="Sao chép key"
                                >
                                  <Copy size={14} />
                                  Copy
                                </button>
                              </div>
                            </div>

                            {key.lastError && (
                              <p className="mt-2 text-[11px] text-stone-500 break-words">
                                Lỗi gần nhất: {key.lastError}
                              </p>
                            )}

                            <div className="mt-3 flex flex-wrap gap-2">
                              {!isActiveKey && key.enabled && (
                                <button
                                  onClick={() => handleSetActiveGeminiKey(key.id)}
                                  className="px-3 py-2 rounded-xl bg-emerald-50 text-emerald-700 text-xs font-bold border border-emerald-200 hover:bg-emerald-100 transition-all"
                                >
                                  Dùng key này
                                </button>
                              )}
                              <button
                                onClick={() => handleToggleGeminiKeyEnabled(key.id, !key.enabled)}
                                className="px-3 py-2 rounded-xl bg-stone-100 text-stone-700 text-xs font-bold border border-stone-200 hover:bg-stone-200 transition-all"
                              >
                                {key.enabled ? "Tạm tắt" : "Bật lại"}
                              </button>
                              <button
                                onClick={() => handleDeleteGeminiKey(key.id, key.label)}
                                className="px-3 py-2 rounded-xl bg-rose-50 text-rose-700 text-xs font-bold border border-rose-200 hover:bg-rose-100 transition-all"
                              >
                                Xóa key
                              </button>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>

                  <div className="hidden p-4 bg-amber-50 border border-amber-100 rounded-xl text-sm text-amber-800 leading-relaxed">
                    <div className="flex items-center gap-2 mb-2">
                      <Shield size={18} className="text-amber-600" />
                      <strong className="text-amber-900">Cấu hình API Key</strong>
                    </div>
                    <p className="mb-3">Để sử dụng các mô hình AI nâng cao hoặc tránh giới hạn lượt dùng, bạn nên cấu hình API Key cá nhân. Key sẽ được lưu trữ an toàn bởi hệ thống.</p>
                    <button 
                      onClick={handleOpenKeySelector}
                      disabled={isCheckingKey}
                      className="flex items-center gap-2 px-4 py-2 bg-white text-amber-700 border border-amber-200 rounded-xl text-xs font-bold hover:bg-amber-100 transition-all shadow-sm disabled:opacity-50"
                    >
                      {isCheckingKey ? <Loader2 size={14} className="animate-spin" /> : <Settings size={14} />}
                      {hasApiKey ? "Thay đổi / Cập nhật API Key" : "Thiết lập API Key cá nhân"}
                    </button>
                    {!hasApiKey && (
                      <p className="mt-2 text-[10px] text-amber-600 italic">* Bạn hiện đang sử dụng Key mặc định của hệ thống (có giới hạn).</p>
                    )}
                  </div>

                  <div className="p-4 bg-indigo-50 border border-indigo-100 rounded-xl text-sm text-indigo-800 leading-relaxed">
                    <div className="flex items-center gap-2 mb-2">
                      <Database size={18} className="text-indigo-600" />
                      <strong className="text-indigo-900">Chế độ nạp liệu nâng cao</strong>
                    </div>
                    <p className="mb-3">Hãy tải lên file truyện hoặc dán nội dung vào đây. AI sẽ học tập bối cảnh và thiết lập của truyện này để thêm các nội dung 18+ một cách chính xác nhất. (Hỗ trợ file lên đến 100MB+)</p>
                    <div className="flex gap-2">
                      <button 
                        onClick={() => fileInputRef.current?.click()}
                        className="flex items-center gap-2 px-4 py-2 bg-white text-indigo-600 border border-indigo-200 rounded-xl text-xs font-bold hover:bg-indigo-50 transition-all shadow-sm"
                      >
                        <Upload size={14} />
                        Tải file truyện (.txt, .json)
                      </button>
                      <input 
                        type="file" 
                        ref={fileInputRef} 
                        onChange={handleFileUpload} 
                        accept=".txt,.json" 
                        className="hidden" 
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-stone-500 uppercase tracking-wider mb-1">Nội dung nạp liệu (Văn mẫu/Bối cảnh)</label>
                    <textarea 
                      value={fanficContext} 
                      onChange={(e) => saveFanficContext(e.target.value)}
                      placeholder="Nội dung truyện sẽ được hiển thị ở đây sau khi tải file hoặc dán thủ công..."
                      className="w-full p-4 rounded-xl border border-stone-200 focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm min-h-[300px] leading-relaxed font-serif bg-stone-50/30"
                    />
                  </div>
                  <div className="pt-4 border-t border-stone-100 flex justify-end">
                    <button 
                      onClick={() => {
                        safeSetItem("fanficContext", fanficContext);
                        setManualSaved(true);
                        setTimeout(() => setManualSaved(false), 2000);
                      }}
                      className="flex items-center gap-2 px-6 py-2 bg-stone-900 text-white rounded-xl text-sm font-bold hover:bg-stone-800 transition-all shadow-lg active:scale-95"
                    >
                      {manualSaved ? <CheckCircle2 size={16} /> : <Save size={16} />}
                      {manualSaved ? "Đã lưu" : "Lưu thiết lập"}
                    </button>
                  </div>
                </div>
              )}

              {activeSettingsTab === "rules" && (
                <div className="space-y-6">
                  <div className="p-4 bg-indigo-50 border border-indigo-100 rounded-xl text-sm text-indigo-800 leading-relaxed">
                    <div className="flex items-center gap-2 mb-2">
                      <Shield size={18} className="text-indigo-600" />
                      <strong className="text-indigo-900">Tự động quét lỗi</strong>
                    </div>
                    <div className="flex items-center justify-between">
                      <p className="text-xs text-indigo-700">Tự động quét lỗi logic, chính tả và bối cảnh sau mỗi lần AI viết xong.</p>
                      <div className="flex items-center gap-4">
                        <button 
                          onClick={handleScanErrors}
                          disabled={loadingScan}
                          className="flex items-center gap-2 px-3 py-1.5 bg-white text-indigo-600 border border-indigo-200 rounded-lg text-xs font-bold hover:bg-indigo-50 transition-all disabled:opacity-50 shadow-sm"
                        >
                          {loadingScan ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                          Quét lỗi ngay
                        </button>
                        <button 
                          onClick={() => setAutoScanErrors(!autoScanErrors)}
                          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 ${autoScanErrors ? "bg-indigo-600" : "bg-stone-300"}`}
                        >
                          <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${autoScanErrors ? "translate-x-6" : "translate-x-1"}`} />
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div>
                      <label className="block text-xs font-bold text-stone-500 uppercase tracking-wider mb-1">Số chương dự định</label>
                      <div className="flex items-center gap-4">
                        <input 
                          type="number"
                          min="1"
                          max="500"
                          value={storyRules.plannedChapters || "10"} 
                          onChange={(e) => saveStoryRules({...storyRules, plannedChapters: e.target.value})}
                          className="w-24 px-4 py-2 border border-stone-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        />
                        <span className="text-xs text-stone-400 italic">AI sẽ dựa vào đây để phân bổ cốt truyện và tiết tấu.</span>
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-stone-500 uppercase tracking-wider mb-1">Mệnh lệnh (TUYỆT ĐỐI TUÂN THỦ)</label>
                      <textarea 
                        value={storyRules.commands || ""} 
                        onChange={(e) => saveStoryRules({...storyRules, commands: e.target.value})}
                        placeholder="Ví dụ: Luôn gọi nhân vật chính là 'Lão đại'..."
                        className="w-full p-3 rounded-xl border border-stone-200 focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm min-h-[80px]"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-bold text-stone-500 uppercase tracking-wider mb-1">Điều cấm</label>
                        <textarea 
                          value={storyRules.forbidden || ""} 
                          onChange={(e) => saveStoryRules({...storyRules, forbidden: e.target.value})}
                          className="w-full p-3 rounded-xl border border-stone-200 focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm min-h-[80px]"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-stone-500 uppercase tracking-wider mb-1">Điều khuyến khích</label>
                        <textarea 
                          value={storyRules.encouraged || ""} 
                          onChange={(e) => saveStoryRules({...storyRules, encouraged: e.target.value})}
                          className="w-full p-3 rounded-xl border border-stone-200 focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm min-h-[80px]"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-stone-500 uppercase tracking-wider mb-1">Mức độ NSFW (18+)</label>
                      <select 
                        value={storyRules.nsfwLevel || "Không"} 
                        onChange={(e) => saveStoryRules({...storyRules, nsfwLevel: e.target.value})}
                        className="w-full p-3 rounded-xl border border-stone-200 focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm"
                      >
                        <option value="Không">Không</option>
                        <option value="Thấp">Thấp (Gợi ý)</option>
                        <option value="Trung bình">Trung bình (Chi tiết vừa phải)</option>
                        <option value="Cao">Cao (Trực diện, trần trụi)</option>
                      </select>
                    </div>
                  </div>

                  <div className="pt-4 border-t border-stone-100 space-y-4">
                    {storageUsage && (
                      <div className="bg-stone-50 p-4 rounded-xl border border-stone-200">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <Database size={14} className="text-stone-400" />
                            <span className="text-xs font-bold text-stone-500 uppercase tracking-wider">Dung lượng lưu trữ</span>
                          </div>
                          <span className="text-xs font-bold text-stone-600">{(storageUsage.usage / 1024 / 1024).toFixed(2)} MB / {(storageUsage.quota / 1024 / 1024).toFixed(0)} MB</span>
                        </div>
                        <div className="w-full bg-stone-200 rounded-full h-1.5 overflow-hidden">
                          <div 
                            className={`h-full transition-all duration-500 ${storageUsage.percent > 90 ? "bg-rose-500" : storageUsage.percent > 70 ? "bg-amber-500" : "bg-indigo-500"}`}
                            style={{ width: `${storageUsage.percent}%` }}
                          />
                        </div>
                        <p className="mt-2 text-[10px] text-stone-400 italic">Hệ thống tự động mở rộng lưu trữ cục bộ khi cần thiết.</p>
                      </div>
                    )}

                    <div className="flex justify-end">
                      <button 
                        onClick={() => {
                          safeSetItem("storyRules", JSON.stringify(storyRules));
                          setManualSaved(true);
                          setTimeout(() => setManualSaved(false), 2000);
                        }}
                        className="flex items-center gap-2 px-6 py-2 bg-stone-900 text-white rounded-xl text-sm font-bold hover:bg-stone-800 transition-all shadow-lg active:scale-95"
                      >
                        {manualSaved ? <CheckCircle2 size={16} /> : <Save size={16} />}
                        {manualSaved ? "Đã lưu" : "Lưu thiết lập"}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {activeSettingsTab === "plot" && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <label className="block text-xs font-bold text-stone-500 uppercase tracking-wider">Bản đồ cốt truyện (Plot Map)</label>
                    <button 
                      onClick={handleGeneratePlotMap}
                      disabled={loadingPlotMap}
                      className="flex items-center gap-2 px-3 py-1.5 bg-indigo-50 text-indigo-600 rounded-lg text-xs font-bold hover:bg-indigo-100 transition-all disabled:opacity-50"
                    >
                      {loadingPlotMap ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                      Lập bản đồ bằng AI
                    </button>
                  </div>
                  <div className="relative">
                    <textarea 
                      value={plotMap} 
                      onChange={(e) => savePlotMap(e.target.value)}
                      className="w-full h-96 px-4 py-3 border border-stone-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm font-mono leading-relaxed"
                      placeholder="AI sẽ lập đề cương chi tiết cho từng chương dựa trên số lượng chương bạn đã thiết lập..."
                    />
                    {!plotMap && !loadingPlotMap && (
                      <div className="absolute inset-0 flex flex-col items-center justify-center text-stone-400 pointer-events-none p-8 text-center">
                        <Map size={48} className="mb-4 opacity-20" />
                        <p className="text-sm">Chưa có bản đồ cốt truyện.</p>
                        <p className="text-xs mt-1">Hãy nhấn nút "Lập bản đồ bằng AI" để bắt đầu.</p>
                      </div>
                    )}
                  </div>
                  <div className="p-4 bg-amber-50 border border-amber-100 rounded-xl">
                    <div className="flex gap-3">
                      <Lightbulb size={18} className="text-amber-500 shrink-0" />
                      <p className="text-xs text-amber-700 leading-relaxed">
                        <strong>Mẹo:</strong> Bạn có thể tự tay chỉnh sửa bản đồ này. AI sẽ tham khảo bản đồ này khi viết tiếp các chương để đảm bảo mạch truyện đúng như bạn mong muốn.
                      </p>
                    </div>
                  </div>
                  <div className="pt-4 border-t border-stone-100 flex justify-end">
                    <button 
                      onClick={() => {
                        safeSetItem("plotMap", plotMap);
                        setManualSaved(true);
                        setTimeout(() => setManualSaved(false), 2000);
                      }}
                      className="flex items-center gap-2 px-6 py-2 bg-stone-900 text-white rounded-xl text-sm font-bold hover:bg-stone-800 transition-all shadow-lg active:scale-95"
                    >
                      {manualSaved ? <CheckCircle2 size={16} /> : <Save size={16} />}
                      {manualSaved ? "Đã lưu" : "Lưu thiết lập"}
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="p-6 bg-stone-50 border-t border-stone-100 flex justify-end">
              <button 
                onClick={() => setIsSettingsModalOpen(false)}
                className="px-6 py-2.5 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-200 active:scale-95"
              >
                Hoàn tất
              </button>
            </div>
          </div>
        </div>
      )}

      {/* AI Memory Modal */}
      {isMemoryOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-stone-900/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="p-6 border-b border-stone-100 flex items-center justify-between bg-indigo-50/50">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-indigo-100 text-indigo-600 rounded-lg">
                  <Brain size={24} />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-stone-800">Bộ nhớ AI</h2>
                  <p className="text-sm text-stone-500">Ghi lại các tình tiết quan trọng để AI luôn ghi nhớ</p>
                </div>
              </div>
              <button onClick={() => setIsMemoryOpen(false)} className="p-2 text-stone-400 hover:text-stone-600 hover:bg-stone-100 rounded-full transition-colors">
                <X size={20} />
              </button>
            </div>
            <div className="p-6">
              <div className="mb-4 p-4 bg-amber-50 border border-amber-100 rounded-xl text-sm text-amber-800 leading-relaxed">
                <strong>Mẹo:</strong> Hãy ghi lại các sự kiện chính, trạng thái nhân vật, hoặc các bí mật mà AI cần biết để duy trì tính nhất quán xuyên suốt các chương.
              </div>
              <textarea
                value={storyMemory}
                onChange={(e) => saveMemory(e.target.value)}
                placeholder="Ví dụ: Nhân vật chính đang bị thương ở tay trái. Hắn đang giữ một mảnh ngọc bội bí ẩn có khả năng hấp thụ linh khí..."
                className="w-full h-64 p-4 rounded-xl border border-stone-200 focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none text-stone-700 leading-relaxed"
              />
            </div>
            <div className="p-6 bg-stone-50 border-t border-stone-100 flex justify-end">
              <button 
                onClick={() => setIsMemoryOpen(false)}
                className="px-6 py-2.5 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-200 active:scale-95"
              >
                Hoàn tất
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit History Modal */}
      {isHistoryOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-stone-900/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden animate-in zoom-in-95 duration-200 flex flex-col max-h-[80vh]">
            <div className="p-6 border-b border-stone-100 flex items-center justify-between bg-stone-50">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-stone-200 text-stone-700 rounded-lg">
                  <RotateCcw size={24} />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-stone-800">Lịch sử chỉnh sửa</h2>
                  <p className="text-sm text-stone-500">Xem lại và khôi phục các phiên bản trước của chương này</p>
                </div>
              </div>
              <button onClick={() => setIsHistoryOpen(false)} className="p-2 text-stone-400 hover:text-stone-600 hover:bg-stone-100 rounded-full transition-colors">
                <X size={20} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-6">
              {activeChapter?.history && activeChapter.history.length > 0 ? (
                <div className="space-y-4">
                  {activeChapter.history.map((version) => (
                    <div key={version.id} className="p-4 bg-stone-50 rounded-xl border border-stone-200 hover:border-indigo-300 transition-colors group">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-stone-700">{new Date(version.timestamp).toLocaleString("vi-VN")}</span>
                          <span className="text-xs text-stone-400">({version.content.length} ký tự)</span>
                        </div>
                        <button 
                          onClick={() => restoreVersion(version)}
                          className="px-3 py-1 bg-indigo-100 text-indigo-600 rounded-lg text-xs font-bold hover:bg-indigo-600 hover:text-white transition-all"
                        >
                          Khôi phục
                        </button>
                      </div>
                      <p className="text-xs text-stone-500 line-clamp-3 italic">
                        {version.content.substring(0, 200)}...
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-12">
                  <RotateCcw size={48} className="mx-auto text-stone-200 mb-4" />
                  <p className="text-stone-500">Chưa có lịch sử chỉnh sửa cho chương này.</p>
                  <p className="text-xs text-stone-400 mt-1">Lịch sử sẽ được lưu tự động sau mỗi lần AI viết hoặc khi bạn lưu thủ công.</p>
                </div>
              )}
            </div>
            <div className="p-6 bg-stone-50 border-t border-stone-100 flex justify-end">
              <button 
                onClick={() => setIsHistoryOpen(false)}
                className="px-6 py-2.5 bg-stone-200 text-stone-700 rounded-xl font-bold hover:bg-stone-300 transition-all"
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Expanded Instruction Modal */}
      {isInstructionMaximized && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-stone-900/60 backdrop-blur-md">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-3xl overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="p-6 border-b border-stone-100 flex items-center justify-between bg-indigo-50/50">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-indigo-100 text-indigo-600 rounded-lg">
                  <Sparkles size={24} />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-stone-800">Chỉ dẫn chi tiết cho AI</h2>
                  <p className="text-sm text-stone-500">Nhập các yêu cầu cụ thể để AI viết đúng ý bạn hơn</p>
                </div>
              </div>
              <button onClick={() => setIsInstructionMaximized(false)} className="p-2 text-stone-400 hover:text-stone-600 hover:bg-stone-100 rounded-full transition-colors">
                <PanelLeftClose size={20} />
              </button>
            </div>
            <div className="p-6">
              <textarea
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                placeholder="Ví dụ: Viết một cảnh chiến đấu kịch tính giữa nhân vật chính và phản diện. Sử dụng nhiều từ ngữ miêu tả nội tâm và không khí căng thẳng..."
                className="w-full h-80 p-6 rounded-2xl border border-stone-200 focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none text-stone-700 leading-relaxed text-lg"
                autoFocus
              />
            </div>
            <div className="p-6 bg-stone-50 border-t border-stone-100 flex justify-between items-center">
              <p className="text-xs text-stone-400">Nhấn ESC hoặc nút thu gọn để quay lại</p>
              <div className="flex gap-3">
                <button 
                  onClick={() => setIsInstructionMaximized(false)}
                  className="px-6 py-2.5 bg-stone-200 text-stone-700 rounded-xl font-bold hover:bg-stone-300 transition-all"
                >
                  Thu gọn
                </button>
                <button 
                  onClick={() => { setIsInstructionMaximized(false); handleContinue(); }}
                  disabled={loadingContinue || !activeChapter}
                  className="px-8 py-2.5 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-200 flex items-center gap-2"
                >
                  {loadingContinue ? <Loader2 size={18} className="animate-spin" /> : <Wand2 size={18} />}
                  Bắt đầu viết
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Manual Save Notification */}
      {manualSaved && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 bg-indigo-600 text-white px-4 py-2 rounded-full shadow-lg flex items-center gap-2 animate-in fade-in slide-in-from-top-4 duration-300">
          <CheckCircle2 size={18} />
          <span className="text-sm font-medium">Đã lưu truyện vào trình duyệt!</span>
        </div>
      )}

      <div className="flex-1 flex overflow-hidden relative">
        {/* Sidebar Drawer */}
        {!isFocusMode && (
          <div className={`fixed lg:absolute top-0 bottom-0 left-0 z-[60] lg:z-30 bg-white/95 backdrop-blur-xl border-r border-stone-200/60 flex flex-col transition-all duration-500 ease-in-out shadow-2xl w-[85vw] sm:w-80 ${isSidebarCollapsed ? "-translate-x-full" : "translate-x-0"}`}>
            <div className="p-4 sm:p-6 border-b border-stone-100 flex items-center justify-between bg-white/50">
              <div className="flex items-center gap-2">
                <div className="w-2 h-6 bg-indigo-600 rounded-full"></div>
                <h2 className="font-display font-bold text-stone-900 text-lg">Mục lục</h2>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={addVolume} className="p-2 text-stone-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-xl transition-all active:scale-95" title="Thêm quyển mới">
                  <Plus size={20} />
                </button>
                <button onClick={() => setIsSidebarCollapsed(true)} className="p-2 text-stone-500 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-all" title="Đóng">
                  <PanelLeftClose size={20} />
                </button>
              </div>
            </div>
            <div className="p-3 sm:p-4 space-y-2 overflow-y-auto flex-1 custom-scrollbar">
              {volumes.map(volume => (
                <div key={volume.id} className="mb-2">
                  <div 
                    className={`flex items-center justify-between p-3 rounded-2xl cursor-pointer group transition-all ${expandedVolumes.includes(volume.id) ? "bg-stone-50" : "hover:bg-stone-50"}`}
                    onClick={() => toggleVolume(volume.id)}
                  >
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <div className={`transition-transform duration-300 ${expandedVolumes.includes(volume.id) ? "rotate-0" : "-rotate-90"}`}>
                        <ChevronDown size={16} className="text-stone-400" />
                      </div>
                      <Book size={18} className="text-indigo-500 shrink-0" />
                      <input 
                        type="text" 
                        value={volume.title}
                        onChange={(e) => updateVolumeTitle(volume.id, e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                        className="bg-transparent border-none focus:ring-0 p-0 text-sm font-bold text-stone-800 w-full truncate placeholder:text-stone-300"
                      />
                    </div>
                    <div className="flex items-center gap-1">
                      <button 
                        onClick={(e) => { e.stopPropagation(); addChapter(volume.id); }}
                        className="opacity-100 lg:opacity-0 lg:group-hover:opacity-100 p-1.5 text-stone-400 hover:text-indigo-600 hover:bg-white rounded-lg transition-all shadow-sm"
                        title="Thêm chương"
                      >
                        <Plus size={16} />
                      </button>
                      <button 
                        onClick={(e) => { e.stopPropagation(); deleteVolume(volume.id, e); }}
                        className="opacity-100 lg:opacity-0 lg:group-hover:opacity-100 p-1.5 text-stone-400 hover:text-rose-600 hover:bg-white rounded-lg transition-all shadow-sm"
                        title="Xóa quyển"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                  
                  {expandedVolumes.includes(volume.id) && (
                    <div className="ml-6 mt-1 space-y-1 border-l-2 border-stone-100 pl-4 animate-in slide-in-from-left-2 duration-300">
                      {volume.chapters.map(chapter => (
                        <div 
                          key={chapter.id}
                          onClick={() => { flushCurrentDraftToVolumes(); setActiveVolumeId(volume.id); setActiveChapterId(chapter.id); }}
                          className={`flex items-center justify-between p-2.5 rounded-xl cursor-pointer group text-sm transition-all ${
                            activeVolumeId === volume.id && activeChapterId === chapter.id 
                              ? "bg-indigo-600 text-white shadow-md shadow-indigo-100 font-bold" 
                              : "text-stone-600 hover:bg-stone-100 hover:text-stone-900"
                          }`}
                        >
                          <div className="flex items-center gap-3 truncate">
                            <FileText size={14} className={activeVolumeId === volume.id && activeChapterId === chapter.id ? "text-indigo-200" : "text-stone-400"} />
                            <span className="truncate">{chapter.title}</span>
                          </div>
                          <button 
                            onClick={(e) => deleteChapter(volume.id, chapter.id, e)}
                            className={`opacity-100 lg:opacity-0 lg:group-hover:opacity-100 p-1 rounded-lg transition-all ${
                              activeVolumeId === volume.id && activeChapterId === chapter.id 
                                ? "text-indigo-200 hover:text-white hover:bg-indigo-500" 
                                : "text-stone-400 hover:text-rose-600 hover:bg-white shadow-sm"
                            }`}
                            title="Xóa chương"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Backdrop for mobile/drawer */}
        {!isSidebarCollapsed && !isFocusMode && (
          <div 
            className="fixed lg:absolute inset-0 bg-stone-900/40 z-[50] lg:z-20 transition-opacity backdrop-blur-sm"
            onClick={() => setIsSidebarCollapsed(true)}
          />
        )}

        {/* Editor Area - Maximized */}
        <div 
          id="editor-scroll-container"
          className={`flex-1 overflow-y-auto relative w-full transition-all duration-500 no-scrollbar ${
            isFocusMode ? "bg-white pt-12 pb-32" : "bg-[#F8F7F4] pt-4 sm:pt-8 pb-64 sm:pb-96 px-2 sm:px-8"
          }`}
        >
        {isFocusMode && (
          <div className="fixed top-4 right-4 sm:top-8 sm:right-8 z-[100] flex gap-2">
            <button 
              onClick={handleNextScene}
              className="p-3 sm:p-4 bg-stone-900 text-white hover:bg-stone-800 rounded-full shadow-2xl transition-all hover:scale-110 active:scale-95 group"
              title="Chương tiếp theo"
            >
              <ArrowRight size={20} className="sm:w-6 sm:h-6" />
              <span className="absolute right-full mr-4 top-1/2 -translate-y-1/2 bg-stone-900 text-white text-xs font-bold px-3 py-1.5 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none hidden sm:block">Chương sau</span>
            </button>
            <button 
              onClick={() => setIsFocusMode(false)}
              className="p-3 sm:p-4 bg-stone-900 text-white hover:bg-stone-800 rounded-full shadow-2xl transition-all hover:scale-110 active:scale-95 group"
              title="Thoát chế độ tập trung (ESC)"
            >
              <Minimize2 size={20} className="sm:w-6 sm:h-6" />
              <span className="absolute right-full mr-4 top-1/2 -translate-y-1/2 bg-stone-900 text-white text-xs font-bold px-3 py-1.5 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none hidden sm:block">Thoát chế độ tập trung</span>
            </button>
          </div>
        )}

        {activeChapter ? (
          <div className={`max-w-4xl mx-auto transition-all duration-700 ease-in-out ${
            isFocusMode 
              ? "bg-transparent border-none shadow-none p-4 sm:p-0" 
              : "bg-white rounded-3xl sm:rounded-[2.5rem] shadow-[0_20px_50px_rgba(0,0,0,0.04)] border border-stone-200/50 p-5 sm:p-16 min-h-[85vh] relative"
          }`}>
            {!isFocusMode && (
              <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center gap-2 px-4 py-2 bg-stone-900 text-white rounded-full text-[10px] font-bold uppercase tracking-[0.2em] shadow-lg whitespace-nowrap">
                <Book size={12} />
                <span>Bản thảo</span>
              </div>
            )}
            <div className={isFocusMode ? "mb-12 sm:mb-20" : "mb-6 sm:mb-8"}>
              <div className={`flex gap-3 ${isFocusMode ? "flex-col items-center" : "flex-col sm:flex-row sm:items-start"}`}>
                <input 
                  type="text"
                  value={activeChapter.title}
                  onChange={(e) => updateActiveChapterTitle(e.target.value)}
                  className={`w-full flex-1 font-display font-bold text-stone-900 bg-transparent border-none focus:outline-none focus:ring-0 p-0 placeholder:text-stone-200 ${
                    isFocusMode ? "text-3xl sm:text-5xl text-center opacity-40 hover:opacity-100 focus:opacity-100" : "text-2xl sm:text-4xl"
                  }`}
                  placeholder="Tên chương..."
                />
                <button
                  onClick={handleGenerateChapterTitle}
                  disabled={loadingChapterTitle || !localContent.trim()}
                  className={`inline-flex items-center justify-center gap-2 rounded-2xl border px-4 py-2.5 text-xs font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
                    isFocusMode
                      ? "border-stone-300/80 bg-white/80 text-stone-700 backdrop-blur hover:bg-white"
                      : "border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100"
                  }`}
                  title="Đặt tên chương theo nội dung hiện tại"
                >
                  {loadingChapterTitle ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                  {loadingChapterTitle ? "Đang đặt tên..." : "Đặt tên bằng AI"}
                </button>
              </div>
            </div>
            <textarea
              ref={textareaRef}
              value={localContent}
              onChange={(e) => handleTextareaChange(e.target.value)}
              placeholder="Bắt đầu viết câu chuyện của bạn ở đây... Hoặc nhập chỉ dẫn ở dưới để AI bắt đầu viết."
              className={`w-full resize-none overflow-hidden focus:outline-none focus:ring-0 text-stone-800 leading-[1.8] font-serif bg-transparent selection:bg-indigo-100 ${
                isFocusMode ? "text-lg sm:text-2xl" : "text-base sm:text-xl"
              }`}
              style={{ minHeight: "60vh" }}
            />
          </div>
          ) : (
            <div className="max-w-4xl mx-auto flex items-center justify-center h-full text-stone-400">
              Chọn hoặc tạo một chương để bắt đầu viết.
            </div>
          )}
        </div>
      </div>

      {/* AI Control Panel - Floating at bottom */}
      {!isFocusMode && (
        <div className="fixed bottom-4 sm:bottom-8 left-1/2 -translate-x-1/2 z-40 w-full max-w-4xl px-2 sm:px-4 transition-all duration-500">
          <div className="glass-panel p-1.5 sm:p-2 rounded-3xl sm:rounded-[2.5rem] shadow-[0_20px_50px_rgba(0,0,0,0.1)] flex flex-col gap-1.5 sm:gap-2 border border-white/40">
            {/* Instruction Input */}
            <div className="relative group px-1">
              <textarea
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                placeholder="Nhập chỉ dẫn cho AI..."
                className="w-full bg-stone-50/50 hover:bg-white focus:bg-white border-none rounded-xl sm:rounded-2xl py-2.5 sm:py-3 px-4 sm:px-5 pr-10 sm:pr-12 text-xs sm:text-sm text-stone-800 placeholder:text-stone-400 focus:ring-2 focus:ring-indigo-500/20 transition-all resize-none h-[42px] sm:h-[48px] leading-relaxed"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleContinue();
                  }
                }}
              />
              <button 
                onClick={() => setIsInstructionMaximized(true)}
                className="absolute right-3 sm:right-4 top-1/2 -translate-y-1/2 p-1 text-stone-400 hover:text-indigo-600 transition-colors"
                title="Mở rộng chỉ dẫn"
              >
                <Maximize2 size={14} className="sm:w-4 sm:h-4" />
              </button>
            </div>

            <div className="flex items-center justify-between gap-1 sm:gap-2 px-1 pb-0.5 sm:pb-1">
              {/* Left: Styles */}
              <div className="flex items-center bg-stone-100/80 p-0.5 sm:p-1 rounded-lg sm:rounded-xl border border-stone-200/50 overflow-x-auto no-scrollbar flex-1 min-w-0 max-w-[120px] sm:max-w-none">
                {["Thuần Việt", "Hán Việt", "Kịch tính", "Miêu tả"].map(style => (
                  <button
                    key={style}
                    onClick={() => toggleStyle(style)}
                    className={`px-2 sm:px-3 py-1 sm:py-1.5 rounded-md sm:rounded-lg text-[8px] sm:text-[10px] font-bold uppercase tracking-wider transition-all whitespace-nowrap ${
                      writingStyles.includes(style)
                        ? "bg-stone-900 text-white shadow-sm"
                        : "text-stone-500 hover:text-stone-800"
                    }`}
                  >
                    {style}
                  </button>
                ))}
              </div>

              {/* Right: Actions */}
              <div className="flex items-center gap-1 sm:gap-2 flex-shrink-0">
                {hasDraftContent && (
                  <div className="flex items-center gap-0.5 sm:gap-1">
                    <button
                      onClick={handleScanErrors}
                      disabled={loadingScan || loadingFixErrors || loadingRewrite || loadingContinue || !hasDraftContent}
                      className="p-1.5 sm:p-2.5 bg-stone-100 text-stone-600 hover:bg-stone-200 rounded-lg sm:rounded-xl transition-all disabled:opacity-50 active:scale-95"
                      title="Quét lỗi"
                    >
                      {loadingScan ? <Loader2 size={14} className="animate-spin sm:w-[18px] sm:h-[18px]" /> : <Search size={14} className="sm:w-[18px] sm:h-[18px]" />}
                    </button>
                    <button
                      onClick={handleFixErrors}
                      disabled={loadingFixErrors || loadingRewrite || loadingContinue || !hasDraftContent}
                      className="p-1.5 sm:p-2.5 bg-stone-100 text-stone-600 hover:bg-stone-200 rounded-lg sm:rounded-xl transition-all disabled:opacity-50 active:scale-95"
                      title="Sửa lỗi"
                    >
                      {loadingFixErrors ? <Loader2 size={14} className="animate-spin sm:w-[18px] sm:h-[18px]" /> : <Sparkles size={14} className="sm:w-[18px] sm:h-[18px]" />}
                    </button>
                    <button
                      onClick={handleRewrite}
                      disabled={loadingFixErrors || loadingRewrite || loadingContinue || loadingNSFW || !hasDraftContent}
                      className="p-1.5 sm:p-2.5 bg-stone-100 text-stone-600 hover:bg-stone-200 rounded-lg sm:rounded-xl transition-all disabled:opacity-50 active:scale-95"
                      title="Viết lại"
                    >
                      {loadingRewrite ? <Loader2 size={14} className="animate-spin sm:w-[18px] sm:h-[18px]" /> : <RefreshCw size={14} className="sm:w-[18px] sm:h-[18px]" />}
                    </button>
                    <button
                      onClick={handleAddNSFW}
                      disabled={loadingFixErrors || loadingRewrite || loadingContinue || loadingNSFW || !hasDraftContent}
                      className="p-1.5 sm:p-2.5 bg-rose-50 text-rose-600 hover:bg-rose-100 rounded-lg sm:rounded-xl transition-all disabled:opacity-50 active:scale-95 border border-rose-100"
                      title="18+"
                    >
                      {loadingNSFW ? <Loader2 size={14} className="animate-spin sm:w-[18px] sm:h-[18px]" /> : <Flame size={14} className="sm:w-[18px] sm:h-[18px]" />}
                    </button>
                  </div>
                )}
                <button 
                  onClick={handleContinue}
                  disabled={loadingContinue || loadingNSFW || !activeChapter}
                  className="bg-stone-900 text-white h-[32px] sm:h-[44px] px-2.5 sm:px-6 rounded-lg sm:rounded-2xl flex items-center gap-1 sm:gap-2 shadow-lg shadow-indigo-200 transition-all active:scale-95 disabled:opacity-50"
                >
                  {loadingContinue ? <Loader2 size={14} className="animate-spin sm:w-[18px] sm:h-[18px]" /> : <Wand2 size={14} className="sm:w-[18px] sm:h-[18px]" />}
                  <span className="font-bold text-[10px] sm:text-sm hidden xs:inline">
                    {hasDraftContent ? "Viết tiếp" : "Bắt đầu"}
                  </span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Scan Results Modal */}
      {scanResults && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-stone-900/60 backdrop-blur-md">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl overflow-hidden animate-in zoom-in-95 duration-200 flex flex-col max-h-[80vh]">
            <div className="p-6 border-b border-stone-100 flex items-center justify-between bg-amber-50">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-amber-100 text-amber-600 rounded-lg">
                  <Shield size={24} />
                </div>
                <h2 className="text-xl font-bold text-stone-800">Kết quả quét lỗi</h2>
              </div>
              <button onClick={() => setScanResults(null)} className="p-2 text-stone-400 hover:text-stone-600 hover:bg-stone-100 rounded-full transition-colors">
                <X size={20} />
              </button>
            </div>
            <div className="p-8 overflow-y-auto flex-1">
              <div className="prose prose-stone max-w-none">
                <div className="whitespace-pre-wrap font-serif text-stone-700 leading-relaxed bg-stone-50 p-6 rounded-2xl border border-stone-100">
                  {scanResults}
                </div>
              </div>
            </div>
            <div className="p-6 bg-stone-50 border-t border-stone-100 flex justify-center gap-4">
              <button 
                onClick={() => setScanResults(null)}
                className="px-8 py-2.5 bg-stone-200 text-stone-700 rounded-xl font-bold hover:bg-stone-300 transition-all"
              >
                Đóng
              </button>
              <button 
                onClick={() => {
                  setScanResults(null);
                  handleFixErrors();
                }}
                className="px-8 py-2.5 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-200 flex items-center gap-2"
              >
                <Wand2 size={18} />
                Sửa lỗi tự động
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm Dialog */}
      {confirmDialog && confirmDialog.isOpen && (
        <div className="fixed inset-0 bg-stone-900/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-xl">
            <h3 className="text-lg font-bold text-stone-900 mb-2">{confirmDialog.title}</h3>
            <p className="text-stone-500 mb-6">{confirmDialog.message}</p>
            <div className="flex justify-end gap-3">
              {!confirmDialog.isAlert && (
                <button
                  onClick={() => setConfirmDialog(null)}
                  className="px-4 py-2 text-stone-600 hover:bg-stone-100 rounded-xl font-medium transition-colors"
                >
                  Hủy
                </button>
              )}
              <button
                onClick={confirmDialog.onConfirm}
                className={`px-4 py-2 text-white rounded-xl font-medium transition-colors ${
                  confirmDialog.confirmColor 
                    ? confirmDialog.confirmColor 
                    : confirmDialog.isAlert 
                      ? "bg-indigo-600 hover:bg-indigo-700" 
                      : "bg-rose-600 hover:bg-rose-700"
                }`}
              >
                {confirmDialog.confirmText || (confirmDialog.isAlert ? "Đóng" : "Xác nhận")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}




