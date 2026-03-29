import { useState, useRef, useEffect } from "react";
import { Link } from "react-router-dom";
import { generateStoryIdeas } from "../services/ai";
import Markdown from "react-markdown";
import { Loader2, Zap, ArrowRight, FileUp, X, FileText, Save, CheckCircle2 } from "lucide-react";
import { SavedOptions } from "../components/SavedOptions";
import { safeSetItem, safeGetItem } from "../utils/storage";
import { useAuth } from "../contexts/AuthContext";

const GENRES = [
  "1v1",
  "Biến thân",
  "Cao võ",
  "Chat group",
  "Chủ thần không gian",
  "Dị năng",
  "Dân gian",
  "Đô thị",
  "Hài hước",
  "Hậu cung",
  "Hệ thống",
  "Hồng hoang",
  "Huyền huyễn",
  "Làm ruộng",
  "Lãnh chúa",
  "Linh dị",
  "Nhẹ nhàng",
  "Nón hồng nô (vợ/người yêu nam chính chủ động đẩy nam chính vào lòng cô gái khác)",
  "Nón xanh (người yêu/vợ nam chính bị người khác chơi)",
  "Nữ tôn",
  "Phàm nhân",
  "Phản phái",
  "Phía sau màn",
  "Phế vật nghịch tập",
  "Sáng thế",
  "Sắc hiệp",
  "Tào tặc",
  "Tận thế",
  "Tây phương",
  "Thần hào",
  "Thần linh",
  "Thần thoại",
  "Thiên tài",
  "Tiến hóa",
  "Tiên hiệp",
  "Tiếng lòng",
  "Toàn dân",
  "Trực tiếp",
  "Trùng sinh",
  "Vạn giới",
  "Võ hiệp",
  "Võng du",
  "Vô hạn",
  "Xuyên không",
].sort((a, b) => a.localeCompare(b, 'vi'));

export default function Page1() {
  const [prompt, setPrompt] = useState("");
  const [selectedGenres, setSelectedGenres] = useState<string[]>([]);
  const [worldSetting, setWorldSetting] = useState("");
  const [resources, setResources] = useState("");
  const [races, setRaces] = useState("");
  const [powerSystem, setPowerSystem] = useState("");
  const [worldLogic, setWorldLogic] = useState("");
  const [learningFiles, setLearningFiles] = useState<{ name: string; content: string }[]>([]);
  const [result, setResult] = useState("");
  const [isLoaded, setIsLoaded] = useState(false);
  const { loading: authLoading } = useAuth();

  useEffect(() => {
    if (authLoading) return;

    safeGetItem("page1_state").then(saved => {
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          if (parsed.prompt) setPrompt(parsed.prompt);
          if (parsed.selectedGenres) setSelectedGenres(parsed.selectedGenres);
          if (parsed.worldSetting) setWorldSetting(parsed.worldSetting);
          if (parsed.resources) setResources(parsed.resources);
          if (parsed.races) setRaces(parsed.races);
          if (parsed.powerSystem) setPowerSystem(parsed.powerSystem);
          if (parsed.worldLogic) setWorldLogic(parsed.worldLogic);
          if (parsed.learningFiles) setLearningFiles(parsed.learningFiles);
          if (parsed.result) setResult(parsed.result);
        } catch (e) {}
      }
      setIsLoaded(true);
    });
  }, [authLoading]);

  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [loading, setLoading] = useState(false);
  const [savedSection, setSavedSection] = useState<string | null>(null);

  const handleAutoSave = (section: string) => {
    setSavedSection(section);
    setTimeout(() => setSavedSection(null), 2000);
  };

  const AutoSaveIndicator = ({ section }: { section: string }) => (
    <div className="text-xs flex items-center gap-1 h-5 transition-opacity duration-300">
      {savedSection === section && (
        <>
          <CheckCircle2 size={14} className="text-emerald-500" />
          <span className="text-emerald-500 font-normal">Đã tự động lưu</span>
        </>
      )}
    </div>
  );

  // Save state on change
  useEffect(() => {
    if (!isLoaded) return;
    const timer = setTimeout(() => {
      const stateToSave = {
        prompt,
        selectedGenres,
        worldSetting,
        resources,
        races,
        powerSystem,
        worldLogic,
        result,
        learningFiles
      };
      safeSetItem("page1_state", JSON.stringify(stateToSave));
    }, 3000);
    return () => clearTimeout(timer);
  }, [prompt, selectedGenres, worldSetting, resources, races, powerSystem, worldLogic, result, learningFiles, isLoaded]);

  const toggleGenre = (genre: string) => {
    setSelectedGenres((prev) =>
      prev.includes(genre) ? prev.filter((g) => g !== genre) : [...prev, genre]
    );
    handleAutoSave("genres");
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setIsUploading(true);
    const newFiles: { name: string; content: string }[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (file.size > 500 * 1024) {
        alert(`File "${file.name}" quá lớn (>500KB). Vui lòng chọn file nhỏ hơn để đảm bảo hiệu năng.`);
        continue;
      }
      const content = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = (event) => resolve(event.target?.result as string);
        reader.readAsText(file);
      });
      newFiles.push({ name: file.name, content });
    }

    setLearningFiles((prev) => [...prev, ...newFiles]);
    setIsUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
    handleAutoSave("learningFiles");
  };

  const removeFile = (index: number) => {
    setLearningFiles((prev) => prev.filter((_, i) => i !== index));
    handleAutoSave("learningFiles");
  };

  const handleGenerate = async () => {
    if (!prompt.trim() && selectedGenres.length === 0) return;
    setLoading(true);
    try {
      const learningContext = learningFiles.map(f => f.content).join("\n\n---\n\n");
      const res = await generateStoryIdeas({
        prompt,
        genres: selectedGenres,
        worldSetting,
        resources,
        races,
        powerSystem,
        worldLogic,
        learningContext,
      });
      setResult(res || "");
    } catch (error) {
      console.error(error);
      setResult("Có lỗi xảy ra khi tạo ý tưởng.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-8">
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <div className="p-2 bg-amber-100 text-amber-600 rounded-lg">
            <Zap size={20} />
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold text-stone-900">Trang 1: Ý tưởng truyện</h1>
        </div>
        <p className="text-stone-500 text-sm sm:text-base">Thiết lập các thông số chi tiết để AI tạo ra các ý tưởng cốt truyện độc đáo.</p>
      </div>

      <div className="bg-white p-4 sm:p-6 rounded-2xl border border-stone-200 shadow-sm mb-8 space-y-6">
        <div>
          <label className="flex items-center justify-between text-sm font-medium text-stone-700 mb-3">
            <span>Thể loại</span>
            <AutoSaveIndicator section="genres" />
          </label>
          <div className="flex flex-wrap gap-2">
            {GENRES.map((genre) => (
              <button
                key={genre}
                onClick={() => toggleGenre(genre)}
                className={`px-3 py-1.5 rounded-lg text-sm transition-colors text-left ${
                  selectedGenres.includes(genre)
                    ? "bg-indigo-100 text-indigo-700 border border-indigo-200 font-medium"
                    : "bg-stone-50 text-stone-600 border border-stone-200 hover:bg-stone-100"
                }`}
              >
                {genre.replace(/\s*\(.*?\)/g, "").replace(/"/g, "")}
              </button>
            ))}
          </div>
          <SavedOptions 
            storageKey="page1_genres" 
            currentValue={selectedGenres.join(", ")} 
            onSelect={(val) => {
              const genres = val.split(", ").filter(g => g.trim() !== "");
              setSelectedGenres(genres);
            }} 
            theme="indigo" 
          />
        </div>

        <div className="space-y-8">
          <div>
            <label className="flex items-center justify-between text-sm font-medium text-stone-700 mb-2">
              <span>Từ khóa / Ý tưởng chính</span>
              <AutoSaveIndicator section="prompt" />
            </label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onBlur={() => handleAutoSave("prompt")}
              placeholder="VD: Nhân vật chính trọng sinh..."
              className="w-full px-5 py-4 border border-stone-300 rounded-2xl focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-lg shadow-sm min-h-[150px] resize-y"
            />
            <SavedOptions 
              storageKey="page1_prompt" 
              currentValue={prompt} 
              onSelect={setPrompt} 
              theme="indigo" 
            />
          </div>

          <div>
            <label className="flex items-center justify-between text-sm font-medium text-stone-700 mb-2">
              <span>Thiết lập thế giới</span>
              <AutoSaveIndicator section="worldSetting" />
            </label>
            <textarea
              value={worldSetting}
              onChange={(e) => setWorldSetting(e.target.value)}
              onBlur={() => handleAutoSave("worldSetting")}
              placeholder="VD: Tu chân giới, mạt thế, tinh tế..."
              className="w-full px-5 py-4 border border-stone-300 rounded-2xl focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-lg shadow-sm min-h-[120px] resize-y"
            />
            <SavedOptions 
              storageKey="page1_worldSetting" 
              currentValue={worldSetting} 
              onSelect={setWorldSetting} 
              theme="indigo" 
            />
          </div>

          <div>
            <label className="flex items-center justify-between text-sm font-medium text-stone-700 mb-2">
              <span>Tài nguyên</span>
              <AutoSaveIndicator section="resources" />
            </label>
            <textarea
              value={resources}
              onChange={(e) => setResources(e.target.value)}
              onBlur={() => handleAutoSave("resources")}
              placeholder="VD: Linh thạch, điểm tín ngưỡng, thọ mệnh..."
              className="w-full px-5 py-4 border border-stone-300 rounded-2xl focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-lg shadow-sm min-h-[120px] resize-y"
            />
            <SavedOptions 
              storageKey="page1_resources" 
              currentValue={resources} 
              onSelect={setResources} 
              theme="indigo" 
            />
          </div>

          <div>
            <label className="flex items-center justify-between text-sm font-medium text-stone-700 mb-2">
              <span>Chủng tộc</span>
              <AutoSaveIndicator section="races" />
            </label>
            <textarea
              value={races}
              onChange={(e) => setRaces(e.target.value)}
              onBlur={() => handleAutoSave("races")}
              placeholder="VD: Nhân loại, Yêu tộc, Ma tộc, Thần linh..."
              className="w-full px-5 py-4 border border-stone-300 rounded-2xl focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-lg shadow-sm min-h-[120px] resize-y"
            />
            <SavedOptions 
              storageKey="page1_races" 
              currentValue={races} 
              onSelect={setRaces} 
              theme="indigo" 
            />
          </div>

          <div className="pt-4 border-t border-stone-100">
            <label className="flex items-center justify-between text-sm font-medium text-stone-700 mb-3">
              <span className="flex items-center gap-2">
                <FileUp size={18} className="text-indigo-500" />
                Học tập từ tài liệu (Tải lên nhiều file .txt, .md)
              </span>
              <AutoSaveIndicator section="learningFiles" />
            </label>
            <div className="flex flex-col gap-4">
              <div 
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-stone-200 rounded-2xl p-8 flex flex-col items-center justify-center gap-3 hover:border-indigo-300 hover:bg-indigo-50/30 cursor-pointer transition-all group"
              >
                <div className="p-3 bg-stone-100 text-stone-500 rounded-full group-hover:bg-indigo-100 group-hover:text-indigo-600 transition-colors">
                  {isUploading ? <Loader2 size={24} className="animate-spin" /> : <FileUp size={24} />}
                </div>
                <div className="text-center">
                  <p className="text-sm font-medium text-stone-700">Nhấn để tải lên tài liệu</p>
                  <p className="text-xs text-stone-400 mt-1">Hỗ trợ file lớn lên đến 100MB+ (.txt, .md)</p>
                </div>
                <input 
                  type="file" 
                  ref={fileInputRef} 
                  onChange={handleFileUpload} 
                  onClick={(e) => e.stopPropagation()}
                  multiple 
                  accept=".txt,.md" 
                  className="hidden" 
                />
              </div>

              {learningFiles.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {learningFiles.map((file, index) => (
                    <div key={index} className="flex items-center gap-2 bg-indigo-50 text-indigo-700 px-3 py-1.5 rounded-lg text-sm border border-indigo-100 group">
                      <FileText size={14} />
                      <span className="max-w-[150px] truncate">{file.name}</span>
                      <button 
                        onClick={() => removeFile(index)}
                        className="p-0.5 hover:bg-indigo-200 rounded-full transition-colors"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="flex justify-end pt-4 border-t border-stone-100">
          <button
            onClick={handleGenerate}
            disabled={loading || (!prompt.trim() && selectedGenres.length === 0)}
            className="px-6 py-2 bg-stone-900 text-white rounded-xl font-medium hover:bg-stone-800 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 transition-colors"
          >
            {loading ? <Loader2 size={18} className="animate-spin" /> : <Zap size={18} />}
            Tạo ý tưởng
          </button>
        </div>
      </div>

      {result && (
        <div className="bg-white p-8 rounded-2xl border border-stone-200 shadow-sm markdown-body max-w-none">
          <Markdown>{result}</Markdown>
        </div>
      )}

      <div className="mt-8 flex justify-end">
        <Link to="/page-world" className="px-6 py-3 bg-stone-900 text-white rounded-xl font-medium hover:bg-stone-800 flex items-center gap-2 transition-colors">
          Trang kế (Hệ thống & Logic) <ArrowRight size={18} />
        </Link>
      </div>
    </div>
  );
}
