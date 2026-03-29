import { FileText, Upload, PlusCircle } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useRef, useState } from "react";
import { safeSetItem, safeRemoveItem } from "../utils/storage";
import { clearStoryDraftStorage, persistStoryToIndexedStorage } from "../utils/storyStorage";

type ImportedChapterVersion = {
  id: string;
  timestamp: number;
  content: string;
  title: string;
};

type ImportedChapter = {
  id: string;
  title: string;
  content: string;
  history?: ImportedChapterVersion[];
};

type ImportedVolume = {
  id: string;
  title: string;
  chapters: ImportedChapter[];
};

type ImportedStoryData = {
  volumes: ImportedVolume[];
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

const MAX_IMPORTED_CHAPTER_HISTORY = 20;

const normalizeImportedHistory = (rawHistory: unknown): ImportedChapterVersion[] | undefined => {
  if (!Array.isArray(rawHistory) || rawHistory.length === 0) {
    return undefined;
  }

  const normalizedHistory = rawHistory
    .map((version, index) => ({
      id:
        typeof (version as ImportedChapterVersion)?.id === "string" &&
        (version as ImportedChapterVersion).id.trim()
          ? (version as ImportedChapterVersion).id
          : `${Date.now()}-history-${index}`,
      timestamp:
        typeof (version as ImportedChapterVersion)?.timestamp === "number"
          ? (version as ImportedChapterVersion).timestamp
          : Date.now(),
      content:
        typeof (version as ImportedChapterVersion)?.content === "string"
          ? (version as ImportedChapterVersion).content
          : "",
      title:
        typeof (version as ImportedChapterVersion)?.title === "string"
          ? (version as ImportedChapterVersion).title
          : "",
    }))
    .slice(0, MAX_IMPORTED_CHAPTER_HISTORY);

  return normalizedHistory.length > 0 ? normalizedHistory : undefined;
};

const normalizeImportedVolumes = (rawVolumes: unknown): ImportedVolume[] => {
  if (!Array.isArray(rawVolumes)) {
    return [];
  }

  return rawVolumes
    .map((volume, volumeIndex) => ({
      id:
        typeof (volume as ImportedVolume)?.id === "string" && (volume as ImportedVolume).id.trim()
          ? (volume as ImportedVolume).id
          : `v${volumeIndex + 1}`,
      title:
        typeof (volume as ImportedVolume)?.title === "string" && (volume as ImportedVolume).title.trim()
          ? (volume as ImportedVolume).title
          : `Quyển ${volumeIndex + 1}`,
      chapters: Array.isArray((volume as ImportedVolume)?.chapters)
        ? (volume as ImportedVolume).chapters
            .map((chapter, chapterIndex) => ({
              id:
                typeof chapter?.id === "string" && chapter.id.trim()
                  ? chapter.id
                  : `c${volumeIndex + 1}-${chapterIndex + 1}`,
              title:
                typeof chapter?.title === "string" && chapter.title.trim()
                  ? chapter.title
                  : `Chương ${chapterIndex + 1}`,
              content: typeof chapter?.content === "string" ? chapter.content : "",
              history: normalizeImportedHistory(chapter?.history),
            }))
            .filter((chapter) => Boolean(chapter.id))
        : [],
    }))
    .filter((volume) => volume.chapters.length > 0);
};

const parseImportedStoryData = (rawData: any): ImportedStoryData => {
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
      console.error("Failed to parse legacy storyVolumes string", error);
      volumesSource = null;
    }
  }

  if (!volumesSource && typeof rawData?.story === "string") {
    volumesSource = [
      {
        id: "v1",
        title: "Quyển 1",
        chapters: [{ id: "c1", title: "Chương 1", content: rawData.story }],
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

export default function Home() {
  const navigate = useNavigate();
  const fanficInputRef = useRef<HTMLInputElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const [confirmDialog, setConfirmDialog] = useState<{ isOpen: boolean; title: string; message: string; onConfirm: () => void; isAlert?: boolean } | null>(null);

  const resetProjectState = async () => {
    await clearStoryDraftStorage();
    await Promise.all([
      safeRemoveItem("storyRules"),
      safeRemoveItem("fanficContext"),
      safeRemoveItem("page1_state"),
      safeRemoveItem("page2_state"),
      safeRemoveItem("page4_state"),
      safeRemoveItem("supportingCharacters"),
      safeRemoveItem("writingStyles"),
      safeRemoveItem("plotMap"),
      safeRemoveItem("storyMemory"),
      safeRemoveItem("autoScanErrors"),
      safeRemoveItem("expandedVolumes"),
    ]);
  };

  const handleNewWorld = async () => {
    await resetProjectState();
    navigate("/page1");
  };

  const handleFanficUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (event) => {
      const text = event.target?.result as string;
      await resetProjectState();
      await safeSetItem("fanficContext", text);
      navigate("/editor");
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const handleImportUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const rawData = JSON.parse(event.target?.result as string);
        const importedData = parseImportedStoryData(rawData);

        if (!Array.isArray(importedData.volumes) || importedData.volumes.length === 0) {
          throw new Error("Missing volumes");
        }

        const fallbackVolumeId = importedData.volumes[0].id;
        const requestedVolumeId =
          typeof importedData.activeVolumeId === "string" &&
          importedData.volumes.some((volume) => volume.id === importedData.activeVolumeId)
            ? importedData.activeVolumeId
            : fallbackVolumeId;

        const activeVolume =
          importedData.volumes.find((volume) => volume.id === requestedVolumeId) || importedData.volumes[0];
        const requestedChapterId =
          typeof importedData.activeChapterId === "string" &&
          activeVolume.chapters.some((chapter) => chapter.id === importedData.activeChapterId)
            ? importedData.activeChapterId
            : activeVolume.chapters[0]?.id || "";

        const nextExpandedVolumes =
          Array.isArray(importedData.expandedVolumes) && importedData.expandedVolumes.length > 0
            ? importedData.expandedVolumes.filter((volumeId) =>
                importedData.volumes.some((volume) => volume.id === volumeId),
              )
            : importedData.volumes.map((volume) => volume.id);

        const currentChapter =
          activeVolume.chapters.find((chapter) => chapter.id === requestedChapterId) || activeVolume.chapters[0];

        await resetProjectState();
        await persistStoryToIndexedStorage(importedData.volumes);
        await Promise.all([
          safeSetItem("activeVolumeId", requestedVolumeId),
          safeSetItem("activeChapterId", requestedChapterId),
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
          safeSetItem("expandedVolumes", JSON.stringify(nextExpandedVolumes)),
        ]);

        navigate("/editor");
      } catch (err) {
        console.error("Error importing story from Home", err);
        setConfirmDialog({
          isOpen: true,
          title: "Lỗi",
          message: "File không hợp lệ!",
          isAlert: true,
          onConfirm: () => setConfirmDialog(null)
        });
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  return (
    <div className="max-w-3xl mx-auto p-4 sm:p-8 lg:p-12 mt-4 sm:mt-10">
      <div className="text-center mb-8 sm:mb-12">
        <h1 className="text-3xl sm:text-4xl font-bold text-stone-900 mb-4">Bắt đầu hành trình sáng tác</h1>
        <p className="text-stone-500 text-sm sm:text-base">Chọn một phương thức để bắt đầu câu chuyện của bạn.</p>
      </div>

      <div className="grid gap-4 sm:gap-6">
        <button onClick={handleNewWorld} className="flex flex-col sm:flex-row items-center sm:items-start gap-4 p-5 sm:p-6 bg-white rounded-2xl border border-stone-200 shadow-sm hover:border-indigo-500 hover:shadow-md transition-all text-center sm:text-left w-full">
          <div className="p-3 sm:p-4 bg-indigo-50 text-indigo-600 rounded-xl">
            <PlusCircle size={28} className="sm:w-8 sm:h-8" />
          </div>
          <div>
            <h2 className="text-lg sm:text-xl font-bold text-stone-800">Sáng tạo thế giới mới</h2>
            <p className="text-stone-500 text-xs sm:text-sm mt-1">Bắt đầu từ con số không. Lên ý tưởng, tạo nhân vật và thiết lập quy tắc.</p>
          </div>
        </button>

        <div className="flex flex-col sm:flex-row items-center sm:items-start gap-4 p-5 sm:p-6 bg-white rounded-2xl border border-stone-200 shadow-sm hover:border-blue-500 hover:shadow-md transition-all text-center sm:text-left cursor-pointer" onClick={() => fanficInputRef.current?.click()}>
          <div className="p-3 sm:p-4 bg-blue-50 text-blue-600 rounded-xl">
            <FileText size={28} className="sm:w-8 sm:h-8" />
          </div>
          <div>
            <h2 className="text-lg sm:text-xl font-bold text-stone-800">Đồng nhân (Fanfiction)</h2>
            <p className="text-stone-500 text-xs sm:text-sm mt-1">Tải lên file văn bản (.txt) chứa bối cảnh/cốt truyện gốc để AI viết tiếp.</p>
          </div>
          <input type="file" accept=".txt,.md" className="hidden" ref={fanficInputRef} onChange={handleFanficUpload} onClick={(e) => e.stopPropagation()} />
        </div>

        <div className="flex flex-col sm:flex-row items-center sm:items-start gap-4 p-5 sm:p-6 bg-white rounded-2xl border border-stone-200 shadow-sm hover:border-emerald-500 hover:shadow-md transition-all text-center sm:text-left cursor-pointer" onClick={() => importInputRef.current?.click()}>
          <div className="p-3 sm:p-4 bg-emerald-50 text-emerald-600 rounded-xl">
            <Upload size={28} className="sm:w-8 sm:h-8" />
          </div>
          <div>
            <h2 className="text-lg sm:text-xl font-bold text-stone-800">Nhập file truyện đang viết</h2>
            <p className="text-stone-500 text-xs sm:text-sm mt-1">Tải lên file (.json) đã xuất trước đó để tiếp tục công việc.</p>
          </div>
          <input type="file" accept=".json" className="hidden" ref={importInputRef} onChange={handleImportUpload} onClick={(e) => e.stopPropagation()} />
        </div>
      </div>

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
                className={`px-4 py-2 text-white rounded-xl font-medium transition-colors ${confirmDialog.isAlert ? "bg-indigo-600 hover:bg-indigo-700" : "bg-rose-600 hover:bg-rose-700"}`}
              >
                {confirmDialog.isAlert ? "Đóng" : "Xác nhận"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
