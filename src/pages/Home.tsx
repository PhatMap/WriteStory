import { FileText, FolderOpen, PlusCircle, Upload } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useRef, useState } from "react";
import { safeSetItem, safeRemoveItem } from "../utils/storage";
import { clearStoryDraftStorage } from "../utils/storyStorage";
import {
  createEmptyStoryProjectPayload,
  loadStoryProjectIntoWorkspace,
  parseImportedStoryData,
  saveStoryProject,
} from "../utils/storyLibrary";

export default function Home() {
  const navigate = useNavigate();
  const fanficInputRef = useRef<HTMLInputElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const [confirmDialog, setConfirmDialog] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
    isAlert?: boolean;
  } | null>(null);

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
    const project = await saveStoryProject(createEmptyStoryProjectPayload());
    await loadStoryProjectIntoWorkspace(project);
    navigate("/page1");
  };

  const handleFanficUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (loadEvent) => {
      const text = loadEvent.target?.result as string;
      await resetProjectState();
      await safeSetItem("fanficContext", text);
      const project = await saveStoryProject({
        ...createEmptyStoryProjectPayload(),
        fanficContext: text,
      });
      await loadStoryProjectIntoWorkspace(project);
      navigate("/editor");
    };

    reader.readAsText(file);
    event.target.value = "";
  };

  const handleImportUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (loadEvent) => {
      try {
        const rawData = JSON.parse(loadEvent.target?.result as string);
        const importedData = parseImportedStoryData(rawData);

        if (
          !Array.isArray(importedData.volumes) ||
          importedData.volumes.length === 0
        ) {
          throw new Error("Missing volumes");
        }

        await resetProjectState();
        const project = await saveStoryProject(importedData);
        await loadStoryProjectIntoWorkspace(project);
        navigate("/editor");
      } catch (error) {
        console.error("Error importing story from Home", error);
        setConfirmDialog({
          isOpen: true,
          title: "Loi",
          message: "File khong hop le!",
          isAlert: true,
          onConfirm: () => setConfirmDialog(null),
        });
      } finally {
        event.target.value = "";
      }
    };

    reader.readAsText(file);
  };

  return (
    <div className="max-w-3xl mx-auto p-4 sm:p-8 lg:p-12 mt-4 sm:mt-10">
      <div className="text-center mb-8 sm:mb-12">
        <h1 className="text-3xl sm:text-4xl font-bold text-stone-900 mb-4">
          Bắt đầu hành trình sáng tác
        </h1>
        <p className="text-stone-500 text-sm sm:text-base">
          Chọn một phương thức để bắt đầu câu chuyện của bạn.
        </p>
      </div>

      <div className="grid gap-4 sm:gap-6">
        <button
          onClick={() => navigate("/library")}
          className="flex flex-col sm:flex-row items-center sm:items-start gap-4 p-5 sm:p-6 bg-white rounded-2xl border border-stone-200 shadow-sm hover:border-amber-500 hover:shadow-md transition-all text-center sm:text-left w-full"
        >
          <div className="p-3 sm:p-4 bg-amber-50 text-amber-600 rounded-xl">
            <FolderOpen size={28} className="sm:w-8 sm:h-8" />
          </div>
          <div>
            <h2 className="text-lg sm:text-xl font-bold text-stone-800">
              Kho truyện
            </h2>
            <p className="text-stone-500 text-xs sm:text-sm mt-1">
              Mở lại truyện đã lưu trong máy, đọc nhanh, viết tiếp hoặc nhập
              JSON vào kho.
            </p>
          </div>
        </button>

        <button
          onClick={handleNewWorld}
          className="flex flex-col sm:flex-row items-center sm:items-start gap-4 p-5 sm:p-6 bg-white rounded-2xl border border-stone-200 shadow-sm hover:border-indigo-500 hover:shadow-md transition-all text-center sm:text-left w-full"
        >
          <div className="p-3 sm:p-4 bg-indigo-50 text-indigo-600 rounded-xl">
            <PlusCircle size={28} className="sm:w-8 sm:h-8" />
          </div>
          <div>
            <h2 className="text-lg sm:text-xl font-bold text-stone-800">
              Sáng tạo thế giới mới
            </h2>
            <p className="text-stone-500 text-xs sm:text-sm mt-1">
              Bắt đầu từ con số không. Lên ý tưởng, tạo nhân vật và thiết lập
              quy tắc.
            </p>
          </div>
        </button>

        <div
          className="flex flex-col sm:flex-row items-center sm:items-start gap-4 p-5 sm:p-6 bg-white rounded-2xl border border-stone-200 shadow-sm hover:border-blue-500 hover:shadow-md transition-all text-center sm:text-left cursor-pointer"
          onClick={() => fanficInputRef.current?.click()}
        >
          <div className="p-3 sm:p-4 bg-blue-50 text-blue-600 rounded-xl">
            <FileText size={28} className="sm:w-8 sm:h-8" />
          </div>
          <div>
            <h2 className="text-lg sm:text-xl font-bold text-stone-800">
              Đồng nhân (Fanfiction)
            </h2>
            <p className="text-stone-500 text-xs sm:text-sm mt-1">
              Tải lên file văn bản (.txt) chứa bối cảnh/cốt truyện gốc để AI
              viết tiếp.
            </p>
          </div>
          <input
            type="file"
            accept=".txt,.md"
            className="hidden"
            ref={fanficInputRef}
            onChange={handleFanficUpload}
            onClick={(e) => e.stopPropagation()}
          />
        </div>

        <div
          className="flex flex-col sm:flex-row items-center sm:items-start gap-4 p-5 sm:p-6 bg-white rounded-2xl border border-stone-200 shadow-sm hover:border-emerald-500 hover:shadow-md transition-all text-center sm:text-left cursor-pointer"
          onClick={() => importInputRef.current?.click()}
        >
          <div className="p-3 sm:p-4 bg-emerald-50 text-emerald-600 rounded-xl">
            <Upload size={28} className="sm:w-8 sm:h-8" />
          </div>
          <div>
            <h2 className="text-lg sm:text-xl font-bold text-stone-800">
              Nhập file truyện đang viết
            </h2>
            <p className="text-stone-500 text-xs sm:text-sm mt-1">
              Tải lên file (.json) đã xuất trước đó để tiếp tục công việc.
            </p>
          </div>
          <input
            type="file"
            accept=".json"
            className="hidden"
            ref={importInputRef}
            onChange={handleImportUpload}
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      </div>

      {confirmDialog && confirmDialog.isOpen && (
        <div className="fixed inset-0 bg-stone-900/50 z-[70] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-xl">
            <h3 className="text-lg font-bold text-stone-900 mb-2">
              {confirmDialog.title}
            </h3>
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
                  confirmDialog.isAlert
                    ? "bg-indigo-600 hover:bg-indigo-700"
                    : "bg-rose-600 hover:bg-rose-700"
                }`}
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
