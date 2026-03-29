import { useState, useEffect } from 'react';
import { Save, X } from 'lucide-react';
import { safeSetItem, safeGetItem } from '../utils/storage';

interface SavedOptionsProps {
  storageKey: string;
  currentValue: string;
  onSelect: (value: string) => void;
  theme?: 'indigo' | 'blue' | 'rose';
}

export function SavedOptions({ storageKey, currentValue, onSelect, theme = 'indigo' }: SavedOptionsProps) {
  const [options, setOptions] = useState<string[]>([]);

  useEffect(() => {
    safeGetItem(`saved_options_${storageKey}`).then(saved => {
      if (saved) {
        try {
          setOptions(JSON.parse(saved));
        } catch (e) {}
      }
    });
  }, [storageKey]);

  const handleSave = () => {
    if (!currentValue.trim()) return;
    if (options.includes(currentValue)) return;
    
    const newOptions = [...options, currentValue];
    setOptions(newOptions);
    safeSetItem(`saved_options_${storageKey}`, JSON.stringify(newOptions));
  };

  const handleRemove = (optionToRemove: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const newOptions = options.filter(opt => opt !== optionToRemove);
    setOptions(newOptions);
    safeSetItem(`saved_options_${storageKey}`, JSON.stringify(newOptions));
  };

  const themeClasses = {
    indigo: "text-indigo-600 bg-indigo-50 hover:bg-indigo-100",
    blue: "text-blue-600 bg-blue-50 hover:bg-blue-100",
    rose: "text-rose-600 bg-rose-50 hover:bg-rose-100"
  };

  return (
    <div className="mt-2 flex flex-col gap-2">
      <div className="flex items-center">
        <button
          onClick={handleSave}
          disabled={!currentValue.trim() || options.includes(currentValue)}
          className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${themeClasses[theme]}`}
        >
          <Save size={14} />
          Lưu thành lựa chọn
        </button>
      </div>
      
      {options.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-1">
          {options.map((opt, idx) => (
            <div 
              key={idx}
              onClick={() => onSelect(opt)}
              className="group flex items-center gap-1.5 text-xs bg-stone-100 hover:bg-stone-200 text-stone-700 px-2.5 py-1.5 rounded-lg cursor-pointer transition-colors max-w-full border border-stone-200"
              title={opt}
            >
              <span className="truncate max-w-[250px]">{opt}</span>
              <button 
                onClick={(e) => handleRemove(opt, e)}
                className="text-stone-400 hover:text-rose-500 md:opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded-full hover:bg-stone-300"
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
