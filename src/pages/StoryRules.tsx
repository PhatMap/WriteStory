import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { ShieldAlert, Save, CheckCircle2, ArrowRight, ArrowLeft } from "lucide-react";
import { SavedOptions } from "../components/SavedOptions";
import { safeSetItem, safeGetItem } from "../utils/storage";
import { useAuth } from "../contexts/AuthContext";
import { texts } from "../constants/texts";

export default function StoryRules() {
  const [forbidden, setForbidden] = useState("");
  const [encouraged, setEncouraged] = useState("");
  const [commands, setCommands] = useState("");
  const [nsfwLevel, setNsfwLevel] = useState("Không");
  const [plannedChapters, setPlannedChapters] = useState<string>("10");
  const [savedSection, setSavedSection] = useState<string | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const { loading: authLoading } = useAuth();

  useEffect(() => {
    if (authLoading) return;

    safeGetItem("storyRules").then(saved => {
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          if (parsed.forbidden) setForbidden(parsed.forbidden);
          if (parsed.encouraged) setEncouraged(parsed.encouraged);
          if (parsed.commands) setCommands(parsed.commands);
          if (parsed.nsfwLevel) setNsfwLevel(parsed.nsfwLevel);
          if (parsed.plannedChapters) setPlannedChapters(parsed.plannedChapters);
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
          <span className="text-emerald-500 font-normal">{texts.common.autoSaved}</span>
        </>
      )}
    </div>
  );

  // Auto-save on change
  useEffect(() => {
    if (!isLoaded) return;
    const timer = setTimeout(() => {
      const rules = {
        forbidden,
        encouraged,
        commands,
        nsfwLevel,
        plannedChapters,
      };
      safeSetItem("storyRules", JSON.stringify(rules));
    }, 1000);
    return () => clearTimeout(timer);
  }, [forbidden, encouraged, commands, nsfwLevel, plannedChapters, isLoaded]);

  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-8">
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <div className="p-2 bg-rose-100 text-rose-600 rounded-lg">
            <ShieldAlert size={20} />
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold text-stone-900">{texts.storyRules.title}</h1>
        </div>
        <p className="text-stone-500 text-sm sm:text-base">{texts.storyRules.description}</p>
      </div>

      <div className="bg-white p-4 sm:p-6 rounded-2xl border border-stone-200 shadow-sm mb-8 space-y-6">
        <div>
          <label className="flex items-center justify-between text-sm font-medium text-stone-700 mb-2">
            <span>{texts.storyRules.plannedChaptersLabel}</span>
            <AutoSaveIndicator section="plannedChapters" />
          </label>
          <div className="flex items-center gap-4">
            <input
              type="number"
              min="1"
              max="500"
              value={plannedChapters}
              onChange={(e) => setPlannedChapters(e.target.value)}
              onBlur={() => handleAutoSave("plannedChapters")}
              className="w-32 px-5 py-3 border border-stone-300 rounded-2xl focus:outline-none focus:ring-2 focus:ring-rose-500 focus:border-transparent text-lg shadow-sm"
            />
            <span className="text-stone-500 text-sm">{texts.storyRules.plannedChaptersHint}</span>
          </div>
        </div>

        <div>
          <label className="flex items-center justify-between text-sm font-medium text-stone-700 mb-2">
            <span>{texts.storyRules.forbiddenLabel}</span>
            <AutoSaveIndicator section="forbidden" />
          </label>
          <textarea
            value={forbidden}
            onChange={(e) => setForbidden(e.target.value)}
            onBlur={() => handleAutoSave("forbidden")}
            placeholder={texts.storyRules.forbiddenPlaceholder}
            className="w-full px-5 py-4 border border-stone-300 rounded-2xl focus:outline-none focus:ring-2 focus:ring-rose-500 focus:border-transparent min-h-[150px] resize-y text-lg shadow-sm"
          />
          <SavedOptions 
            storageKey="page3_forbidden" 
            currentValue={forbidden} 
            onSelect={setForbidden} 
            theme="rose" 
          />
        </div>

        <div>
          <label className="flex items-center justify-between text-sm font-medium text-stone-700 mb-2">
            <span>{texts.storyRules.encouragedLabel}</span>
            <AutoSaveIndicator section="encouraged" />
          </label>
          <textarea
            value={encouraged}
            onChange={(e) => setEncouraged(e.target.value)}
            onBlur={() => handleAutoSave("encouraged")}
            placeholder={texts.storyRules.encouragedPlaceholder}
            className="w-full px-5 py-4 border border-stone-300 rounded-2xl focus:outline-none focus:ring-2 focus:ring-rose-500 focus:border-transparent min-h-[150px] resize-y text-lg shadow-sm"
          />
          <SavedOptions 
            storageKey="page3_encouraged" 
            currentValue={encouraged} 
            onSelect={setEncouraged} 
            theme="rose" 
          />
        </div>

        <div>
          <label className="flex items-center justify-between text-sm font-medium text-stone-700 mb-2">
            <span>{texts.storyRules.commandsLabel}</span>
            <AutoSaveIndicator section="commands" />
          </label>
          <textarea
            value={commands}
            onChange={(e) => setCommands(e.target.value)}
            onBlur={() => handleAutoSave("commands")}
            placeholder={texts.storyRules.commandsPlaceholder}
            className="w-full px-5 py-4 border border-stone-300 rounded-2xl focus:outline-none focus:ring-2 focus:ring-rose-500 focus:border-transparent min-h-[150px] resize-y text-lg shadow-sm"
          />
          <SavedOptions 
            storageKey="page3_commands" 
            currentValue={commands} 
            onSelect={setCommands} 
            theme="rose" 
          />
        </div>

        <div>
          <label className="flex items-center justify-between text-sm font-medium text-stone-700 mb-3">
            <span>{texts.storyRules.nsfwLabel}</span>
            <AutoSaveIndicator section="nsfwLevel" />
          </label>
          <div className="space-y-3">
            {texts.storyRules.nsfwLevels.map((level) => (
              <label key={level.id} className={`flex items-start gap-3 p-4 rounded-xl border cursor-pointer transition-colors ${nsfwLevel === level.id ? "border-rose-500 bg-rose-50" : "border-stone-200 hover:bg-stone-50"}`}>
                <input
                  type="radio"
                  name="nsfwLevel"
                  value={level.id}
                  checked={nsfwLevel === level.id}
                  onChange={(e) => { setNsfwLevel(e.target.value); handleAutoSave("nsfwLevel"); }}
                  className="mt-1 text-rose-600 focus:ring-rose-500"
                />
                <div>
                  <div className={`font-medium ${nsfwLevel === level.id ? "text-rose-700" : "text-stone-900"}`}>
                    {level.label.replace(/\s*\(.*?\)/g, "").replace(/"/g, "")}
                  </div>
                </div>
              </label>
            ))}
          </div>
        </div>

      </div>

      <div className="mt-8 flex justify-between">
        <Link to="/page2" className="px-6 py-3 bg-white border border-stone-300 text-stone-700 rounded-xl font-medium hover:bg-stone-50 flex items-center gap-2 transition-colors">
          <ArrowLeft size={18} /> {texts.common.previousPage}
        </Link>
        <Link to="/editor" className="px-6 py-3 bg-indigo-600 text-white rounded-xl font-medium hover:bg-indigo-700 flex items-center gap-2 transition-colors">
          {texts.storyRules.startWriting} <ArrowRight size={18} />
        </Link>
      </div>
    </div>
  );
}
