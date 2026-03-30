import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { developCharacter } from "../services/ai";
import Markdown from "react-markdown";
import { Loader2, Sparkles, ArrowRight, ArrowLeft, Save, CheckCircle2, Plus, Trash2 } from "lucide-react";
import { SavedOptions } from "../components/SavedOptions";
import { safeSetItem, safeGetItem } from "../utils/storage";
import { useAuth } from "../contexts/AuthContext";
import { texts } from "../constants/texts";

export default function CharacterStep() {
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
          <span className="text-emerald-500 font-normal">{texts.common.autoSaved}</span>
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
      setResult(texts.characterStep.generateError);
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
          <h1 className="text-2xl sm:text-3xl font-bold text-stone-900">{texts.characterStep.title}</h1>
        </div>
        <p className="text-stone-500 text-sm sm:text-base">{texts.characterStep.description}</p>
      </div>

      <div className="bg-white p-4 sm:p-6 rounded-2xl border border-stone-200 shadow-sm mb-8 space-y-6">
        <div className="space-y-8">
          <div>
            <label className="flex items-center justify-between text-sm font-medium text-stone-700 mb-2">
              <span>{texts.characterStep.mainCharacterLabel}</span>
              <AutoSaveIndicator section="characterName" />
            </label>
            <textarea
              value={characterName}
              onChange={(e) => setCharacterName(e.target.value)}
              onBlur={() => handleAutoSave("characterName")}
              placeholder={texts.characterStep.mainCharacterPlaceholder}
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
              <span>{texts.characterStep.promptLabel}</span>
              <AutoSaveIndicator section="prompt" />
            </label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onBlur={() => handleAutoSave("prompt")}
              placeholder={texts.characterStep.promptPlaceholder}
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
              <span>{texts.characterStep.identityLabel}</span>
              <AutoSaveIndicator section="identity" />
            </label>
            <textarea
              value={identity}
              onChange={(e) => setIdentity(e.target.value)}
              onBlur={() => handleAutoSave("identity")}
              placeholder={texts.characterStep.identityPlaceholder}
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
              <span>{texts.characterStep.personalityLabel}</span>
              <AutoSaveIndicator section="personality" />
            </label>
            <textarea
              value={personality}
              onChange={(e) => setPersonality(e.target.value)}
              onBlur={() => handleAutoSave("personality")}
              placeholder={texts.characterStep.personalityPlaceholder}
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
              <span>{texts.characterStep.appearanceLabel}</span>
              <AutoSaveIndicator section="appearance" />
            </label>
            <textarea
              value={appearance}
              onChange={(e) => setAppearance(e.target.value)}
              onBlur={() => handleAutoSave("appearance")}
              placeholder={texts.characterStep.appearancePlaceholder}
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
              <span>{texts.characterStep.talentLabel}</span>
              <AutoSaveIndicator section="talent" />
            </label>
            <textarea
              value={talent}
              onChange={(e) => setTalent(e.target.value)}
              onBlur={() => handleAutoSave("talent")}
              placeholder={texts.characterStep.talentPlaceholder}
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
              <span>{texts.characterStep.backgroundLabel}</span>
              <AutoSaveIndicator section="background" />
            </label>
            <textarea
              value={background}
              onChange={(e) => setBackground(e.target.value)}
              onBlur={() => handleAutoSave("background")}
              placeholder={texts.characterStep.backgroundPlaceholder}
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
              <span>{texts.characterStep.cheatLabel}</span>
              <AutoSaveIndicator section="cheat" />
            </label>
            <textarea
              value={cheat}
              onChange={(e) => setCheat(e.target.value)}
              onBlur={() => handleAutoSave("cheat")}
              placeholder={texts.characterStep.cheatPlaceholder}
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
                <h2 className="text-xl font-bold text-stone-900">{texts.characterStep.supportingCharactersTitle}</h2>
                <p className="text-sm text-stone-500">{texts.characterStep.supportingCharactersDescription}</p>
              </div>
              <div className="flex items-center gap-4">
                <AutoSaveIndicator section="supportingCharacters" />
                <button 
                  onClick={addSupportingCharacter}
                  className="px-4 py-2 bg-stone-100 text-stone-700 rounded-xl text-sm font-bold hover:bg-stone-200 transition-all flex items-center gap-2"
                >
                  <Plus size={16} /> {texts.characterStep.addSupportingCharacter}
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
                      <label className="block text-xs font-bold text-stone-500 uppercase tracking-wider mb-1">{texts.characterStep.supportingCharacterName}</label>
                      <input 
                        type="text"
                        value={char.name}
                        onChange={(e) => updateSupportingCharacter(index, "name", e.target.value)}
                        onBlur={() => handleAutoSave("supportingCharacters")}
                        placeholder={texts.characterStep.supportingCharacterNamePlaceholder}
                        className="w-full p-3 rounded-xl border border-stone-200 focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-stone-500 uppercase tracking-wider mb-1">{texts.characterStep.supportingCharacterIdentity}</label>
                      <input 
                        type="text"
                        value={char.identity}
                        onChange={(e) => updateSupportingCharacter(index, "identity", e.target.value)}
                        onBlur={() => handleAutoSave("supportingCharacters")}
                        placeholder={texts.characterStep.supportingCharacterIdentityPlaceholder}
                        className="w-full p-3 rounded-xl border border-stone-200 focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-stone-500 uppercase tracking-wider mb-1">{texts.characterStep.supportingCharacterPersonality}</label>
                      <input 
                        type="text"
                        value={char.personality}
                        onChange={(e) => updateSupportingCharacter(index, "personality", e.target.value)}
                        onBlur={() => handleAutoSave("supportingCharacters")}
                        placeholder={texts.characterStep.supportingCharacterPersonalityPlaceholder}
                        className="w-full p-3 rounded-xl border border-stone-200 focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-stone-500 uppercase tracking-wider mb-1">{texts.characterStep.supportingCharacterAppearance}</label>
                      <input 
                        type="text"
                        value={char.appearance}
                        onChange={(e) => updateSupportingCharacter(index, "appearance", e.target.value)}
                        onBlur={() => handleAutoSave("supportingCharacters")}
                        placeholder={texts.characterStep.supportingCharacterAppearancePlaceholder}
                        className="w-full p-3 rounded-xl border border-stone-200 focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-stone-500 uppercase tracking-wider mb-1">{texts.characterStep.supportingCharacterTalent}</label>
                      <input 
                        type="text"
                        value={char.talent}
                        onChange={(e) => updateSupportingCharacter(index, "talent", e.target.value)}
                        onBlur={() => handleAutoSave("supportingCharacters")}
                        placeholder={texts.characterStep.supportingCharacterTalentPlaceholder}
                        className="w-full p-3 rounded-xl border border-stone-200 focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-stone-500 uppercase tracking-wider mb-1">{texts.characterStep.supportingCharacterBackground}</label>
                      <input 
                        type="text"
                        value={char.background}
                        onChange={(e) => updateSupportingCharacter(index, "background", e.target.value)}
                        onBlur={() => handleAutoSave("supportingCharacters")}
                        placeholder={texts.characterStep.supportingCharacterBackgroundPlaceholder}
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
                  <p className="text-stone-400 text-sm">{texts.characterStep.noSupportingCharacters}</p>
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
            {texts.characterStep.generateButton}
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
          <ArrowLeft size={18} /> {texts.common.previousPage}
        </Link>
        <Link to="/page3" className="px-6 py-3 bg-stone-900 text-white rounded-xl font-medium hover:bg-stone-800 flex items-center gap-2 transition-colors">
          {texts.characterStep.nextButton} <ArrowRight size={18} />
        </Link>
      </div>
    </div>
  );
}
