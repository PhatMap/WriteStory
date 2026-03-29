import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { developCharacter } from "../services/ai";
import Markdown from "react-markdown";
import { Loader2, Sparkles, ArrowRight, ArrowLeft, Save, CheckCircle2, Plus, Trash2 } from "lucide-react";
import { SavedOptions } from "../components/SavedOptions";
import { safeSetItem, safeGetItem } from "../utils/storage";
import { useAuth } from "../contexts/AuthContext";

export default function Page2() {
  const [characterName, setCharacterName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [identity, setIdentity] = useState("");
  const [personality, setPersonality] = useState("");
  const [appearance, setAppearance] = useState("");
  const [talent, setTalent] = useState("");
  const [background, setBackground] = useState("");
  const [cheat, setCheat] = useState("");
  const [supportingCharacters, setSupportingCharacters] = useState<any[]>([]);
  const [writingStyles, setWritingStyles] = useState<string[]>([]);

  const [result, setResult] = useState("");
  const [loading, setLoading] = useState(false);
  const [savedSection, setSavedSection] = useState<string | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const { loading: authLoading } = useAuth();

  useEffect(() => {
    if (authLoading) return;

    const loadState = async () => {
      const saved = await safeGetItem("page2_state");
      let charSettings: any = {};
      if (saved) {
        try {
          charSettings = JSON.parse(saved);
          if (charSettings.characterName) setCharacterName(charSettings.characterName);
          if (charSettings.prompt) setPrompt(charSettings.prompt);
          if (charSettings.identity) setIdentity(charSettings.identity);
          if (charSettings.personality) setPersonality(charSettings.personality);
          if (charSettings.appearance) setAppearance(charSettings.appearance);
          if (charSettings.talent) setTalent(charSettings.talent);
          if (charSettings.background) setBackground(charSettings.background);
          if (charSettings.cheat) setCheat(charSettings.cheat);
          if (charSettings.result) setResult(charSettings.result);
        } catch (e) {}
      }

      // Load supporting characters from separate key or fallback
      const savedSupp = await safeGetItem("supportingCharacters");
      if (savedSupp) {
        try {
          const parsed = JSON.parse(savedSupp);
          const withIds = parsed.map((c: any, idx: number) => ({
            ...c,
            id: c.id || `legacy-${idx}-${Date.now()}`
          }));
          setSupportingCharacters(withIds);
        } catch (e) {
          setSupportingCharacters([]);
        }
      } else if (charSettings.supportingCharacters) {
        const withIds = charSettings.supportingCharacters.map((c: any, idx: number) => ({
          ...c,
          id: c.id || `legacy-${idx}-${Date.now()}`
        }));
        setSupportingCharacters(withIds);
      }
      
      const savedStyles = await safeGetItem("writingStyles");
      if (savedStyles) {
        try {
          setWritingStyles(JSON.parse(savedStyles));
        } catch (e) {}
      }
      
      setIsLoaded(true);
    };

    loadState();
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
      const stateToSave = {
        characterName,
        prompt,
        identity,
        personality,
        appearance,
        talent,
        background,
        cheat,
        result
      };
      safeSetItem("page2_state", JSON.stringify(stateToSave));
      // Save supporting characters separately
      safeSetItem("supportingCharacters", JSON.stringify(supportingCharacters));
    }, 1000);
    return () => clearTimeout(timer);
  }, [characterName, prompt, identity, personality, appearance, talent, background, cheat, supportingCharacters, result, isLoaded]);

  const addSupportingCharacter = () => {
    setSupportingCharacters([...supportingCharacters, { id: Date.now().toString(), name: "", identity: "", personality: "", appearance: "", talent: "", background: "" }]);
    handleAutoSave("supportingCharacters");
  };

  const updateSupportingCharacter = (index: number, field: string, value: string) => {
    const newChars = [...supportingCharacters];
    newChars[index] = { ...newChars[index], [field]: value };
    setSupportingCharacters(newChars);
  };

  const removeSupportingCharacter = (id: string) => {
    setSupportingCharacters(supportingCharacters.filter((c) => c.id !== id));
    handleAutoSave("supportingCharacters");
  };

  const handleGenerate = async () => {
    if (!characterName.trim() && !prompt.trim() && !identity.trim() && !personality.trim() && !talent.trim() && !background.trim() && !cheat.trim()) return;
    setLoading(true);
    try {
      const res = await developCharacter({
        characterName,
        prompt,
        identity,
        personality,
        appearance,
        talent,
        background,
        cheat,
        writingStyles,
      });
      setResult(res || "");
    } catch (error) {
      console.error(error);
      setResult("Có lỗi xảy ra khi phát triển nhân vật.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-8">
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <div className="p-2 bg-blue-100 text-blue-600 rounded-lg">
            <Sparkles size={20} />
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold text-stone-900">Trang 3: Phát triển nhân vật</h1>
        </div>
        <p className="text-stone-500 text-sm sm:text-base">Thiết lập các thông số chi tiết để AI xây dựng hồ sơ nhân vật có chiều sâu.</p>
      </div>

      <div className="bg-white p-4 sm:p-6 rounded-2xl border border-stone-200 shadow-sm mb-8 space-y-6">
        <div className="space-y-8">
          <div>
            <label className="flex items-center justify-between text-sm font-medium text-stone-700 mb-2">
              <span>Tên nhân vật chính</span>
              <AutoSaveIndicator section="characterName" />
            </label>
            <textarea
              value={characterName}
              onChange={(e) => setCharacterName(e.target.value)}
              onBlur={() => handleAutoSave("characterName")}
              placeholder="VD: Tiêu Viêm, Hàn Lập, Đường Tam..."
              className="w-full px-5 py-4 border border-stone-300 rounded-2xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-lg shadow-sm min-h-[80px] resize-y"
            />
            <SavedOptions 
              storageKey="page2_characterName" 
              currentValue={characterName} 
              onSelect={setCharacterName} 
              theme="blue" 
            />
          </div>

          <div>
            <label className="flex items-center justify-between text-sm font-medium text-stone-700 mb-2">
              <span>Mô tả ngắn / Ý tưởng chung</span>
              <AutoSaveIndicator section="prompt" />
            </label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onBlur={() => handleAutoSave("prompt")}
              placeholder="VD: Một nữ sát thủ bị mất trí nhớ, luôn mang theo một chiếc đồng hồ quả quýt hỏng..."
              className="w-full px-5 py-4 border border-stone-300 rounded-2xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent min-h-[200px] resize-y text-lg shadow-sm"
            />
            <SavedOptions 
              storageKey="page2_prompt" 
              currentValue={prompt} 
              onSelect={setPrompt} 
              theme="blue" 
            />
          </div>

          <div>
            <label className="flex items-center justify-between text-sm font-medium text-stone-700 mb-2">
              <span>Danh tính</span>
              <AutoSaveIndicator section="identity" />
            </label>
            <textarea
              value={identity}
              onChange={(e) => setIdentity(e.target.value)}
              onBlur={() => handleAutoSave("identity")}
              placeholder="VD: Thánh nữ ma giáo, Phế vật thiếu gia..."
              className="w-full px-5 py-4 border border-stone-300 rounded-2xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-lg shadow-sm min-h-[120px] resize-y"
            />
            <SavedOptions 
              storageKey="page2_identity" 
              currentValue={identity} 
              onSelect={setIdentity} 
              theme="blue" 
            />
          </div>

          <div>
            <label className="flex items-center justify-between text-sm font-medium text-stone-700 mb-2">
              <span>Tính cách</span>
              <AutoSaveIndicator section="personality" />
            </label>
            <textarea
              value={personality}
              onChange={(e) => setPersonality(e.target.value)}
              onBlur={() => handleAutoSave("personality")}
              placeholder="VD: Lãnh khốc, sát phạt quả đoán, cẩn thận..."
              className="w-full px-5 py-4 border border-stone-300 rounded-2xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-lg shadow-sm min-h-[120px] resize-y"
            />
            <SavedOptions 
              storageKey="page2_personality" 
              currentValue={personality} 
              onSelect={setPersonality} 
              theme="blue" 
            />
          </div>

          <div>
            <label className="flex items-center justify-between text-sm font-medium text-stone-700 mb-2">
              <span>Ngoại hình</span>
              <AutoSaveIndicator section="appearance" />
            </label>
            <textarea
              value={appearance}
              onChange={(e) => setAppearance(e.target.value)}
              onBlur={() => handleAutoSave("appearance")}
              placeholder="VD: Cao 1m8, tóc đen dài, mắt xanh, thường mặc áo bào trắng..."
              className="w-full px-5 py-4 border border-stone-300 rounded-2xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-lg shadow-sm min-h-[120px] resize-y"
            />
            <SavedOptions 
              storageKey="page2_appearance" 
              currentValue={appearance} 
              onSelect={setAppearance} 
              theme="blue" 
            />
          </div>

          <div>
            <label className="flex items-center justify-between text-sm font-medium text-stone-700 mb-2">
              <span>Thiên phú</span>
              <AutoSaveIndicator section="talent" />
            </label>
            <textarea
              value={talent}
              onChange={(e) => setTalent(e.target.value)}
              onBlur={() => handleAutoSave("talent")}
              placeholder="VD: Thần cấp kiếm cốt, Ngũ hành linh căn..."
              className="w-full px-5 py-4 border border-stone-300 rounded-2xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-lg shadow-sm min-h-[120px] resize-y"
            />
            <SavedOptions 
              storageKey="page2_talent" 
              currentValue={talent} 
              onSelect={setTalent} 
              theme="blue" 
            />
          </div>

          <div>
            <label className="flex items-center justify-between text-sm font-medium text-stone-700 mb-2">
              <span>Gia cảnh</span>
              <AutoSaveIndicator section="background" />
            </label>
            <textarea
              value={background}
              onChange={(e) => setBackground(e.target.value)}
              onBlur={() => handleAutoSave("background")}
              placeholder="VD: Cô nhi, Gia tộc sa sút, Hoàng tử thất sủng..."
              className="w-full px-5 py-4 border border-stone-300 rounded-2xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-lg shadow-sm min-h-[120px] resize-y"
            />
            <SavedOptions 
              storageKey="page2_background" 
              currentValue={background} 
              onSelect={setBackground} 
              theme="blue" 
            />
          </div>

          <div>
            <label className="flex items-center justify-between text-sm font-medium text-stone-700 mb-2">
              <span>Kim thủ chỉ (Cheat)</span>
              <AutoSaveIndicator section="cheat" />
            </label>
            <textarea
              value={cheat}
              onChange={(e) => setCheat(e.target.value)}
              onBlur={() => handleAutoSave("cheat")}
              placeholder="VD: Hệ thống đánh dấu, Lão gia gia trong nhẫn, Bảng panel thuộc tính..."
              className="w-full px-5 py-4 border border-stone-300 rounded-2xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-lg shadow-sm min-h-[150px] resize-y"
            />
            <SavedOptions 
              storageKey="page2_cheat" 
              currentValue={cheat} 
              onSelect={setCheat} 
              theme="blue" 
            />
          </div>

          <div className="pt-8 border-t border-stone-100">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-xl font-bold text-stone-900">Nhân vật phụ</h2>
                <p className="text-sm text-stone-500">Thêm các nhân vật quan trọng khác trong truyện.</p>
              </div>
              <div className="flex items-center gap-4">
                <AutoSaveIndicator section="supportingCharacters" />
                <button 
                  onClick={addSupportingCharacter}
                  className="px-4 py-2 bg-stone-100 text-stone-700 rounded-xl text-sm font-bold hover:bg-stone-200 transition-all flex items-center gap-2"
                >
                  <Plus size={16} /> Thêm nhân vật phụ
                </button>
              </div>
            </div>

            <div className="space-y-6">
              {supportingCharacters.map((char, index) => (
                <div key={char.id || index} className="p-6 bg-stone-50 rounded-2xl border border-stone-200 relative group">
                  <button 
                    onClick={() => removeSupportingCharacter(char.id)}
                    className="absolute top-4 right-4 p-2 text-stone-400 hover:text-rose-500 hover:bg-rose-50 rounded-full transition-all opacity-0 group-hover:opacity-100"
                  >
                    <Trash2 size={18} />
                  </button>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="md:col-span-2">
                      <label className="block text-xs font-bold text-stone-500 uppercase tracking-wider mb-1">Tên nhân vật</label>
                      <input 
                        type="text"
                        value={char.name}
                        onChange={(e) => updateSupportingCharacter(index, "name", e.target.value)}
                        onBlur={() => handleAutoSave("supportingCharacters")}
                        placeholder="Tên nhân vật phụ..."
                        className="w-full p-3 rounded-xl border border-stone-200 focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-stone-500 uppercase tracking-wider mb-1">Danh tính</label>
                      <input 
                        type="text"
                        value={char.identity}
                        onChange={(e) => updateSupportingCharacter(index, "identity", e.target.value)}
                        onBlur={() => handleAutoSave("supportingCharacters")}
                        placeholder="VD: Sư phụ, đối thủ, thanh mai trúc mã..."
                        className="w-full p-3 rounded-xl border border-stone-200 focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-stone-500 uppercase tracking-wider mb-1">Tính cách</label>
                      <input 
                        type="text"
                        value={char.personality}
                        onChange={(e) => updateSupportingCharacter(index, "personality", e.target.value)}
                        onBlur={() => handleAutoSave("supportingCharacters")}
                        placeholder="VD: Hiền lành, mưu mô, trung thành..."
                        className="w-full p-3 rounded-xl border border-stone-200 focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-stone-500 uppercase tracking-wider mb-1">Ngoại hình</label>
                      <input 
                        type="text"
                        value={char.appearance}
                        onChange={(e) => updateSupportingCharacter(index, "appearance", e.target.value)}
                        onBlur={() => handleAutoSave("supportingCharacters")}
                        placeholder="VD: Xinh đẹp, lạnh lùng, mang theo kiếm..."
                        className="w-full p-3 rounded-xl border border-stone-200 focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-stone-500 uppercase tracking-wider mb-1">Thiên phú</label>
                      <input 
                        type="text"
                        value={char.talent}
                        onChange={(e) => updateSupportingCharacter(index, "talent", e.target.value)}
                        onBlur={() => handleAutoSave("supportingCharacters")}
                        placeholder="VD: Kiếm đạo thiên tài, luyện đan sư..."
                        className="w-full p-3 rounded-xl border border-stone-200 focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-stone-500 uppercase tracking-wider mb-1">Gia cảnh</label>
                      <input 
                        type="text"
                        value={char.background}
                        onChange={(e) => updateSupportingCharacter(index, "background", e.target.value)}
                        onBlur={() => handleAutoSave("supportingCharacters")}
                        placeholder="VD: Xuất thân hoàng tộc, tán tu..."
                        className="w-full p-3 rounded-xl border border-stone-200 focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                      />
                    </div>
                  </div>
                </div>
              ))}

              {supportingCharacters.length > 0 && (
                <SavedOptions 
                  storageKey="page2_supportingCharacters" 
                  currentValue={JSON.stringify(supportingCharacters)} 
                  onSelect={(val) => {
                    try {
                      setSupportingCharacters(JSON.parse(val));
                    } catch (e) {}
                  }} 
                  theme="blue" 
                />
              )}

              {supportingCharacters.length === 0 && (
                <div className="text-center py-12 border-2 border-dashed border-stone-200 rounded-2xl bg-stone-50/50">
                  <p className="text-stone-400 text-sm">Chưa có nhân vật phụ nào được thêm.</p>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="flex justify-end pt-4 border-t border-stone-100">
          <button
            onClick={handleGenerate}
            disabled={loading || (!characterName.trim() && !prompt.trim() && !identity.trim() && !personality.trim() && !talent.trim() && !background.trim() && !cheat.trim())}
            className="px-6 py-2 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 transition-colors"
          >
            {loading ? <Loader2 size={18} className="animate-spin" /> : <Sparkles size={18} />}
            Phân tích & Xây dựng
          </button>
        </div>
      </div>

      {result && (
        <div className="bg-white p-8 rounded-2xl border border-stone-200 shadow-sm markdown-body max-w-none">
          <Markdown>{result}</Markdown>
        </div>
      )}

      <div className="mt-8 flex justify-between">
        <Link to="/page-world" className="px-6 py-3 bg-white border border-stone-300 text-stone-700 rounded-xl font-medium hover:bg-stone-50 flex items-center gap-2 transition-colors">
          <ArrowLeft size={18} /> Trang trước
        </Link>
        <Link to="/page3" className="px-6 py-3 bg-stone-900 text-white rounded-xl font-medium hover:bg-stone-800 flex items-center gap-2 transition-colors">
          Trang kế (Quy tắc) <ArrowRight size={18} />
        </Link>
      </div>
    </div>
  );
}
