import {
  BookOpen,
  FolderOpen,
  Loader2,
  PlusCircle,
  Trash2,
  Upload,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  createEmptyStoryProjectPayload,
  deleteStoryProject,
  getStoryProject,
  listStoryProjects,
  loadStoryProjectIntoWorkspace,
  parseImportedStoryData,
  saveStoryProject,
  type StoryProjectMeta,
} from "../utils/storyLibrary";

export default function StoryLibrary() {
  const navigate = useNavigate();
  const importInputRef = useRef<HTMLInputElement>(null);
  const [projects, setProjects] = useState<StoryProjectMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyProjectId, setBusyProjectId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const refreshProjects = async () => {
    setLoading(true);
    try {
      setProjects(await listStoryProjects());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refreshProjects();
  }, []);

  const handleCreateProject = async () => {
    setBusyProjectId("creating");
    try {
      const project = await saveStoryProject(createEmptyStoryProjectPayload());
      await loadStoryProjectIntoWorkspace(project);
      navigate("/page1");
    } catch (error) {
      console.error("Failed to create story project", error);
      setErrorMessage("Khong the tao truyen moi. Vui long thu lai.");
    } finally {
      setBusyProjectId(null);
    }
  };

  const handleOpenProject = async (projectId: string) => {
    setBusyProjectId(projectId);
    try {
      const project = await getStoryProject(projectId);
      if (!project) {
        throw new Error("Project payload missing");
      }
      await loadStoryProjectIntoWorkspace(project);
      navigate("/editor");
    } catch (error) {
      console.error("Failed to open story project", error);
      setErrorMessage("Khong mo duoc truyen nay.");
    } finally {
      setBusyProjectId(null);
    }
  };

  const handleDeleteProject = async (projectId: string) => {
    const confirmed = window.confirm(
      "Ban co chac muon xoa truyen nay khoi kho truyen?",
    );
    if (!confirmed) return;

    setBusyProjectId(projectId);
    try {
      await deleteStoryProject(projectId);
      await refreshProjects();
    } catch (error) {
      console.error("Failed to delete story project", error);
      setErrorMessage("Khong xoa duoc truyen.");
    } finally {
      setBusyProjectId(null);
    }
  };

  const handleImportUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (loadEvent) => {
      try {
        const rawData = JSON.parse(loadEvent.target?.result as string);
        const payload = parseImportedStoryData(rawData);
        if (!Array.isArray(payload.volumes) || payload.volumes.length === 0) {
          throw new Error("Missing volumes");
        }

        const project = await saveStoryProject(payload);
        await loadStoryProjectIntoWorkspace(project);
        navigate("/editor");
      } catch (error) {
        console.error("Failed to import story project", error);
        setErrorMessage("File JSON khong hop le hoac da bi hong.");
      } finally {
        event.target.value = "";
      }
    };

    reader.readAsText(file);
  };

  return (
    <div className="max-w-5xl mx-auto p-4 sm:p-8 lg:p-12 mt-4 sm:mt-10 pb-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between mb-8">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-indigo-600">
            Kho truyện
          </p>
          <h1 className="text-3xl sm:text-4xl font-bold text-stone-900 mt-2">
            Thư viện truyện local của bạn
          </h1>
          <p className="text-stone-500 mt-3 max-w-2xl">
            Mỗi truyện được lưu sẵn trong máy. Lần sau mở app, bạn chỉ cần vào
            kho và chọn truyện để đọc hoặc viết tiếp.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-end">
          <button
            onClick={() => importInputRef.current?.click()}
            className="inline-flex w-full sm:w-auto items-center justify-center gap-2 px-4 py-3 bg-white border border-stone-200 rounded-xl font-medium text-stone-700 hover:border-emerald-500 hover:text-emerald-600 transition-colors"
          >
            <Upload size={18} />
            Nhập JSON
          </button>
          <button
            onClick={handleCreateProject}
            disabled={busyProjectId === "creating"}
            className="inline-flex w-full sm:w-auto items-center justify-center gap-2 px-4 py-3 bg-indigo-600 text-white rounded-xl font-semibold hover:bg-indigo-700 transition-colors disabled:opacity-70"
          >
            {busyProjectId === "creating" ? (
              <Loader2 size={18} className="animate-spin" />
            ) : (
              <PlusCircle size={18} />
            )}
            Thêm truyện mới
          </button>
        </div>
      </div>

      <input
        ref={importInputRef}
        type="file"
        accept=".json"
        className="hidden"
        onChange={handleImportUpload}
      />

      {errorMessage && (
        <div className="mb-6 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-rose-700">
          {errorMessage}
        </div>
      )}

      {loading ? (
        <div className="min-h-[220px] flex items-center justify-center text-stone-500">
          <Loader2 size={22} className="animate-spin mr-3" />
          Đang tải kho truyện...
        </div>
      ) : projects.length === 0 ? (
        <div className="bg-white border border-dashed border-stone-300 rounded-3xl p-8 sm:p-12 text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-indigo-50 text-indigo-600 mb-5">
            <BookOpen size={30} />
          </div>
          <h2 className="text-2xl font-bold text-stone-900">
            Kho truyện còn trống
          </h2>
          <p className="text-stone-500 mt-3 max-w-xl mx-auto">
            Bạn có thể tạo truyện mới hoặc nhập file JSON đã xuất trước đó. Sau
            khi viết, mỗi lần lưu sẽ tự động cập nhật vào đây.
          </p>
        </div>
      ) : (
        <div className="grid gap-4">
          {projects.map((project) => (
            <article
              key={project.id}
              className="bg-white border border-stone-200 rounded-3xl p-5 sm:p-6 shadow-sm"
            >
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-stone-400">
                    <span>{project.volumeCount} quyển</span>
                    <span className="text-stone-300">/</span>
                    <span>{project.chapterCount} chương</span>
                    <span className="text-stone-300">/</span>
                    <span>
                      {project.totalCharacters.toLocaleString("vi-VN")} ký tự
                    </span>
                  </div>

                  <h2 className="text-xl sm:text-2xl font-bold text-stone-900 mt-2 break-words">
                    {project.title}
                  </h2>
                  <p className="text-sm text-stone-500 mt-1">
                    Cập nhật lúc{" "}
                    {new Date(project.updatedAt).toLocaleString("vi-VN")}
                  </p>
                  <p className="text-stone-600 mt-4 whitespace-pre-wrap break-words">
                    {project.excerpt ||
                      "Chưa có nội dung tóm tắt. Mở truyện để bắt đầu viết."}
                  </p>
                </div>

                <div className="flex flex-col sm:flex-row gap-3 shrink-0 w-full lg:w-auto">
                  <Link
                    to={`/library/${project.id}`}
                    className="inline-flex w-full sm:w-auto items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-stone-200 text-stone-700 font-medium hover:border-sky-500 hover:text-sky-600 transition-colors"
                  >
                    <BookOpen size={16} />
                    Đọc
                  </Link>
                  <button
                    onClick={() => void handleOpenProject(project.id)}
                    disabled={busyProjectId === project.id}
                    className="inline-flex w-full sm:w-auto items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 text-white font-semibold hover:bg-indigo-700 transition-colors disabled:opacity-70"
                  >
                    {busyProjectId === project.id ? (
                      <Loader2 size={16} className="animate-spin" />
                    ) : (
                      <FolderOpen size={16} />
                    )}
                    Mở và viết tiếp
                  </button>
                  <button
                    onClick={() => void handleDeleteProject(project.id)}
                    disabled={busyProjectId === project.id}
                    className="inline-flex w-full sm:w-auto items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-rose-200 text-rose-600 font-medium hover:bg-rose-50 transition-colors disabled:opacity-70"
                  >
                    <Trash2 size={16} />
                    Xóa
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
