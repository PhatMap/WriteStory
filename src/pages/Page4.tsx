import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { generateStoryImage } from "../services/ai";
import { Loader2, Image as ImageIcon, Download, ArrowLeft } from "lucide-react";
import { safeSetItem, safeGetItem } from "../utils/storage";
import { useAuth } from "../contexts/AuthContext";

export default function Page4() {
  const [prompt, setPrompt] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [isLoaded, setIsLoaded] = useState(false);
  const { loading: authLoading } = useAuth();

  // Load saved state on mount
  useEffect(() => {
    if (authLoading) return;

    safeGetItem("page4_state").then(savedState => {
      if (savedState) {
        try {
          const parsed = JSON.parse(savedState);
          if (parsed.prompt) setPrompt(parsed.prompt);
          if (parsed.imageUrl) setImageUrl(parsed.imageUrl);
        } catch (e) {
          console.error("Failed to parse saved state for Page 4", e);
        }
      }
      setIsLoaded(true);
    });
  }, [authLoading]);

  // Save state on change
  useEffect(() => {
    if (!isLoaded) return;
    const timer = setTimeout(() => {
      const stateToSave = {
        prompt,
        imageUrl
      };
      safeSetItem("page4_state", JSON.stringify(stateToSave));
    }, 1000);
    return () => clearTimeout(timer);
  }, [prompt, imageUrl, isLoaded]);

  const handleGenerate = async () => {
    if (!prompt.trim()) return;
    setLoading(true);
    setError("");
    setImageUrl("");
    try {
      const url = await generateStoryImage(prompt);
      setImageUrl(url || "");
    } catch (err: any) {
      console.error(err);
      const msg = err.message || String(err);
      if (msg.includes("Quota")) {
        setError("Bạn đã hết lượt sử dụng AI hôm nay. Vui lòng thử lại vào ngày mai.");
      } else if (msg.includes("an toàn") || msg.includes("safety") || msg.includes("PROHIBITED_CONTENT")) {
        setError("Mô tả của bạn bị bộ lọc an toàn từ chối hoặc vi phạm chính sách nội dung. Vui lòng thử mô tả khác lành mạnh, đơn giản hơn.");
      } else {
        setError(`Lỗi: ${msg}. Vui lòng thử lại sau.`);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-8">
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <div className="p-2 bg-emerald-100 text-emerald-600 rounded-lg">
            <ImageIcon size={20} />
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold text-stone-900">Trang 6: Minh họa truyện</h1>
        </div>
        <p className="text-stone-500 text-sm sm:text-base">Tạo hình ảnh minh họa chất lượng cao cho câu chuyện của bạn bằng AI.</p>
      </div>

      <div className="bg-white p-4 sm:p-6 rounded-2xl border border-stone-200 shadow-sm mb-8">
        <label className="block text-sm font-medium text-stone-700 mb-2">Mô tả hình ảnh</label>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="VD: Một khu rừng phát sáng kỳ ảo vào ban đêm, với những cây nấm khổng lồ..."
          className="w-full px-4 py-3 border border-stone-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent min-h-[100px] resize-y mb-4"
        />
        <div className="flex justify-end">
          <button
            onClick={handleGenerate}
            disabled={loading || !prompt.trim()}
            className="px-6 py-2 bg-emerald-600 text-white rounded-xl font-medium hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 transition-colors"
          >
            {loading ? <Loader2 size={18} className="animate-spin" /> : <ImageIcon size={18} />}
            Tạo ảnh minh họa
          </button>
        </div>
      </div>

      {error && (
        <div className="p-4 bg-red-50 text-red-600 rounded-xl border border-red-100 mb-8">
          {error}
        </div>
      )}

      {loading && (
        <div className="flex flex-col items-center justify-center py-20 bg-stone-100 rounded-2xl border border-stone-200 border-dashed">
          <Loader2 size={40} className="animate-spin text-emerald-500 mb-4" />
          <p className="text-stone-500 font-medium">Đang vẽ tranh... (có thể mất vài chục giây)</p>
        </div>
      )}

      {imageUrl && !loading && (
        <div className="bg-white p-4 rounded-2xl border border-stone-200 shadow-sm">
          <div className="relative group rounded-xl overflow-hidden">
            <img src={imageUrl} alt="Generated illustration" className="w-full h-auto object-cover" referrerPolicy="no-referrer" />
            <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
              <a
                href={imageUrl}
                download="illustration.png"
                className="px-4 py-2 bg-white text-stone-900 rounded-lg font-medium flex items-center gap-2 hover:bg-stone-100"
              >
                <Download size={18} />
                Tải xuống
              </a>
            </div>
          </div>
        </div>
      )}

      <div className="mt-8 flex justify-start">
        <Link to="/editor" className="px-6 py-3 bg-white border border-stone-300 text-stone-700 rounded-xl font-medium hover:bg-stone-50 flex items-center gap-2 transition-colors">
          <ArrowLeft size={18} /> Về trang viết truyện
        </Link>
      </div>
    </div>
  );
}
