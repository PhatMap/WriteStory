import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, ArrowLeft, Globe, CheckCircle2 } from "lucide-react";
import { SavedOptions } from "../components/SavedOptions";
import { safeSetItem, safeGetItem } from "../utils/storage";
import { useAuth } from "../contexts/AuthContext";

export default function PageWorld() {
  const [powerSystem, setPowerSystem] = useState("");
  const [worldLogic, setWorldLogic] = useState("");
  const [savedSection, setSavedSection] = useState<string | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const { loading: authLoading } = useAuth();

  useEffect(() => {
    if (authLoading) return;

    safeGetItem("page1_state").then(saved => {
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          if (parsed.powerSystem) setPowerSystem(parsed.powerSystem);
          if (parsed.worldLogic) setWorldLogic(parsed.worldLogic);
        } catch (e) {}
      }
      setIsLoaded(true);
    });
  }, [authLoading]);

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
      safeGetItem("page1_state").then(saved => {
        let state = {};
        if (saved) {
          try {
            state = JSON.parse(saved);
          } catch (e) {}
        }
        const newState = {
          ...state,
          powerSystem,
          worldLogic
        };
        safeSetItem("page1_state", JSON.stringify(newState));
      });
    }, 1000);
    return () => clearTimeout(timer);
  }, [powerSystem, worldLogic, isLoaded]);

  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-8">
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <div className="p-2 bg-indigo-100 text-indigo-600 rounded-lg">
            <Globe size={20} />
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold text-stone-900">Trang 2: Hệ thống & Logic thế giới</h1>
        </div>
        <p className="text-stone-500 text-sm sm:text-base">Thiết lập chi tiết về cách thế giới vận hành và hệ thống sức mạnh của các nhân vật.</p>
      </div>

      <div className="bg-white p-4 sm:p-6 rounded-2xl border border-stone-200 shadow-sm mb-8 space-y-8">
        <div>
          <label className="flex items-center justify-between text-sm font-medium text-stone-700 mb-3">
            <span className="text-lg">Hệ thống sức mạnh</span>
            <AutoSaveIndicator section="powerSystem" />
          </label>
          <textarea
            value={powerSystem}
            onChange={(e) => setPowerSystem(e.target.value)}
            onBlur={() => handleAutoSave("powerSystem")}
            placeholder="VD: Luyện khí - Trúc cơ - Kim đan... Hoặc hệ thống dị năng cấp bậc S, A, B... Hãy mô tả chi tiết các cấp bậc và sự chênh lệch sức mạnh giữa chúng."
            className="w-full px-5 py-4 border border-stone-300 rounded-2xl focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-lg shadow-sm min-h-[250px] resize-y"
          />
          <SavedOptions 
            storageKey="page1_powerSystem" 
            currentValue={powerSystem} 
            onSelect={setPowerSystem} 
            theme="indigo" 
          />
        </div>

        <div>
          <label className="flex items-center justify-between text-sm font-medium text-stone-700 mb-3">
            <span className="text-lg">Logic vận hành thế giới</span>
            <AutoSaveIndicator section="worldLogic" />
          </label>
          <textarea
            value={worldLogic}
            onChange={(e) => setWorldLogic(e.target.value)}
            onBlur={() => handleAutoSave("worldLogic")}
            placeholder="VD: Cá lớn nuốt cá bé, Thiên đạo vô tình, quy tắc bảo toàn năng lượng... Các quy luật vật lý, xã hội hoặc tâm linh chi phối thế giới này."
            className="w-full px-5 py-4 border border-stone-300 rounded-2xl focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-lg shadow-sm min-h-[250px] resize-y"
          />
          <SavedOptions 
            storageKey="page1_worldLogic" 
            currentValue={worldLogic} 
            onSelect={setWorldLogic} 
            theme="indigo" 
          />
        </div>
      </div>

      <div className="mt-8 flex justify-between">
        <Link to="/page1" className="px-6 py-3 bg-white border border-stone-300 text-stone-700 rounded-xl font-medium hover:bg-stone-50 flex items-center gap-2 transition-colors">
          <ArrowLeft size={18} /> Trang trước
        </Link>
        <Link to="/page2" className="px-6 py-3 bg-stone-900 text-white rounded-xl font-medium hover:bg-stone-800 flex items-center gap-2 transition-colors">
          Trang kế (Nhân vật) <ArrowRight size={18} />
        </Link>
      </div>
    </div>
  );
}
