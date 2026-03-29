import { ArrowLeft, BookOpen, Loader2, PenTool } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  getStoryProject,
  loadStoryProjectIntoWorkspace,
  type StoryProjectChapter,
  type StoryProjectRecord,
} from "../utils/storyLibrary";

export default function StoryReader() {
  const { projectId = "" } = useParams();
  const navigate = useNavigate();
  const [project, setProject] = useState<StoryProjectRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedChapterId, setSelectedChapterId] = useState<string>("");
  const [opening, setOpening] = useState(false);

  useEffect(() => {
    const loadProject = async () => {
      setLoading(true);
      const nextProject = await getStoryProject(projectId);
      setProject(nextProject);
      const firstChapter = nextProject?.payload.volumes[0]?.chapters[0];
      setSelectedChapterId(nextProject?.payload.activeChapterId || firstChapter?.id || "");
      setLoading(false);
    };

    void loadProject();
  }, [projectId]);

  const chapters = useMemo(
    () => project?.payload.volumes.flatMap((volume) => volume.chapters) || [],
    [project],
  );

  const activeChapter: StoryProjectChapter | null =
    chapters.find((chapter) => chapter.id === selectedChapterId) || chapters[0] || null;

  const handleOpenEditor = async () => {
    if (!project) return;
    setOpening(true);
    try {
      await loadStoryProjectIntoWorkspace(project);
      navigate("/editor");
    } finally {
      setOpening(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center text-stone-500">
        <Loader2 size={22} className="animate-spin mr-3" />
        Dang mo truyen...
      </div>
    );
  }

  if (!project) {
    return (
      <div className="max-w-3xl mx-auto p-6 sm:p-10 mt-8">
        <div className="bg-white border border-stone-200 rounded-3xl p-8 text-center">
          <h1 className="text-2xl font-bold text-stone-900">Khong tim thay truyen</h1>
          <p className="text-stone-500 mt-3">
            Truyen nay co the da bi xoa hoac chua duoc luu dung cach.
          </p>
          <Link
            to="/library"
            className="inline-flex items-center gap-2 mt-6 px-4 py-3 rounded-xl bg-indigo-600 text-white font-semibold hover:bg-indigo-700 transition-colors"
          >
            <ArrowLeft size={16} />
            Quay lai kho truyen
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto p-4 sm:p-8 lg:p-12 mt-4 sm:mt-8">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between mb-8">
        <div>
          <Link
            to="/library"
            className="inline-flex items-center gap-2 text-sm font-medium text-stone-500 hover:text-indigo-600 transition-colors"
          >
            <ArrowLeft size={16} />
            Ve kho truyen
          </Link>
          <h1 className="text-3xl sm:text-4xl font-bold text-stone-900 mt-3">
            {project.title}
          </h1>
          <p className="text-stone-500 mt-2">
            {project.volumeCount} quyen, {project.chapterCount} chuong, cap nhat {new Date(project.updatedAt).toLocaleString("vi-VN")}
          </p>
        </div>

        <button
          onClick={() => void handleOpenEditor()}
          disabled={opening}
          className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-indigo-600 text-white font-semibold hover:bg-indigo-700 transition-colors disabled:opacity-70"
        >
          {opening ? <Loader2 size={18} className="animate-spin" /> : <PenTool size={18} />}
          Mo trong trinh soan thao
        </button>
      </div>

      <div className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="bg-white border border-stone-200 rounded-3xl p-4 sm:p-5 h-fit">
          <div className="flex items-center gap-2 text-stone-900 font-semibold mb-4">
            <BookOpen size={18} />
            Danh sach chuong
          </div>
          <div className="space-y-4">
            {project.payload.volumes.map((volume) => (
              <div key={volume.id}>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-stone-400 mb-2">
                  {volume.title}
                </p>
                <div className="space-y-1.5">
                  {volume.chapters.map((chapter) => {
                    const isActive = chapter.id === activeChapter?.id;
                    return (
                      <button
                        key={chapter.id}
                        onClick={() => setSelectedChapterId(chapter.id)}
                        className={`w-full text-left px-3 py-2.5 rounded-xl transition-colors ${
                          isActive ? "bg-indigo-50 text-indigo-700" : "text-stone-600 hover:bg-stone-100"
                        }`}
                      >
                        {chapter.title}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </aside>

        <section className="bg-white border border-stone-200 rounded-3xl p-5 sm:p-8">
          {activeChapter ? (
            <>
              <h2 className="text-2xl font-bold text-stone-900">{activeChapter.title}</h2>
              <div className="mt-6 whitespace-pre-wrap leading-8 text-stone-700 break-words">
                {activeChapter.content.trim() || "Chuong nay chua co noi dung."}
              </div>
            </>
          ) : (
            <p className="text-stone-500">Truyen nay chua co chuong nao de hien thi.</p>
          )}
        </section>
      </div>
    </div>
  );
}
