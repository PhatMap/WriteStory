import { useEffect, useState } from "react";
import { Copy, Loader2, Plus, Shield, Sparkles, X } from "lucide-react";
import { createPortal } from "react-dom";
import { texts } from "../constants/texts";
import {
  AI_MODEL_PREFERENCE_CHANGED_EVENT,
  DEFAULT_TEXT_MODEL_PREFERENCE,
  QUICK_TEXT_MODEL_PREFERENCES,
  STABLE_FLASH_LITE_MODEL,
  STABLE_FLASH_MODEL,
  getPreferredTextModelPreference,
  isQuickTextModelPreference,
  setPreferredTextModelPreference,
  type TextModelPreference,
} from "../utils/aiModels";
import {
  GEMINI_KEYS_CHANGED_EVENT,
  addGeminiKey,
  deleteGeminiKey,
  formatGeminiCooldown,
  getGeminiKeyState,
  maskGeminiApiKey,
  setActiveGeminiKey,
  setGeminiKeyEnabled,
  type GeminiKeyRecord,
} from "../utils/geminiKeys";

type NoticeDialog = {
  title: string;
  message: string;
};

type DeleteDialog = {
  id: string;
  label: string;
};

const geminiTexts = texts.geminiKeyManager;

function getQuickModelCopy(model: string) {
  return model === STABLE_FLASH_MODEL
    ? geminiTexts.textModelQuickOptions.gemini31
    : geminiTexts.textModelQuickOptions.gemini25;
}

export default function GeminiKeyManagerButton() {
  const initialTextModelPreference = getPreferredTextModelPreference();
  const [isOpen, setIsOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [textModelPreference, setTextModelPreference] =
    useState<TextModelPreference>(initialTextModelPreference);
  const [customTextModelInput, setCustomTextModelInput] = useState(
    isQuickTextModelPreference(initialTextModelPreference)
      ? ""
      : initialTextModelPreference,
  );
  const [geminiKeys, setGeminiKeys] = useState<GeminiKeyRecord[]>([]);
  const [activeGeminiKeyId, setActiveGeminiKeyId] = useState<string | null>(
    null,
  );
  const [newGeminiKeyLabel, setNewGeminiKeyLabel] = useState("");
  const [newGeminiKeyValue, setNewGeminiKeyValue] = useState("");
  const [isSavingGeminiKey, setIsSavingGeminiKey] = useState(false);
  const [visibleGeminiKeyIds, setVisibleGeminiKeyIds] = useState<string[]>([]);
  const [copiedGeminiKeyId, setCopiedGeminiKeyId] = useState<string | null>(
    null,
  );
  const [noticeDialog, setNoticeDialog] = useState<NoticeDialog | null>(null);
  const [deleteDialog, setDeleteDialog] = useState<DeleteDialog | null>(null);

  const enabledGeminiKeyCount = geminiKeys.filter((key) => key.enabled).length;
  const activeGeminiKey =
    geminiKeys.find((key) => key.id === activeGeminiKeyId) || null;

  const currentTextModelLabel =
    textModelPreference === DEFAULT_TEXT_MODEL_PREFERENCE
      ? geminiTexts.textModelAutoLabel
      : isQuickTextModelPreference(textModelPreference)
        ? getQuickModelCopy(textModelPreference).label
        : textModelPreference;

  const currentTextModelDescription =
    textModelPreference === DEFAULT_TEXT_MODEL_PREFERENCE
      ? geminiTexts.textModelDescription
      : isQuickTextModelPreference(textModelPreference)
        ? getQuickModelCopy(textModelPreference).description
        : customTextModelInput.trim() || textModelPreference;

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    const loadGeminiKeyState = async () => {
      const state = await getGeminiKeyState();
      setGeminiKeys(state.keys);
      setActiveGeminiKeyId(state.activeKeyId);
    };

    void loadGeminiKeyState();

    const handleGeminiKeysChanged = () => {
      void loadGeminiKeyState();
    };

    window.addEventListener(GEMINI_KEYS_CHANGED_EVENT, handleGeminiKeysChanged);
    return () => {
      window.removeEventListener(
        GEMINI_KEYS_CHANGED_EVENT,
        handleGeminiKeysChanged,
      );
    };
  }, []);

  useEffect(() => {
    if (!isOpen && !noticeDialog && !deleteDialog) {
      return;
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;

      if (deleteDialog) {
        setDeleteDialog(null);
        return;
      }

      if (noticeDialog) {
        setNoticeDialog(null);
        return;
      }

      setIsOpen(false);
    };

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [deleteDialog, isOpen, noticeDialog]);

  useEffect(() => {
    const syncTextModelPreference = () => {
      const nextPreference = getPreferredTextModelPreference();
      setTextModelPreference(nextPreference);
      setCustomTextModelInput(
        isQuickTextModelPreference(nextPreference)
          ? ""
          : nextPreference || "",
      );
    };

    window.addEventListener(
      AI_MODEL_PREFERENCE_CHANGED_EVENT,
      syncTextModelPreference,
    );
    return () => {
      window.removeEventListener(
        AI_MODEL_PREFERENCE_CHANGED_EVENT,
        syncTextModelPreference,
      );
    };
  }, []);

  const getReadableAiError = (error: unknown, fallback: string) => {
    if (error instanceof Error && error.message) {
      return error.message;
    }
    return fallback;
  };

  const toggleGeminiKeyVisibility = (id: string) => {
    setVisibleGeminiKeyIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    );
  };

  const handleAddGeminiKey = async () => {
    if (!newGeminiKeyValue.trim()) {
      setNoticeDialog({
        title: geminiTexts.addMissingTitle,
        message: geminiTexts.addMissingMessage,
      });
      return;
    }

    setIsSavingGeminiKey(true);
    try {
      await addGeminiKey(newGeminiKeyLabel, newGeminiKeyValue);
      setNewGeminiKeyLabel("");
      setNewGeminiKeyValue("");
    } catch (error) {
      console.error(error);
      setNoticeDialog({
        title: geminiTexts.saveErrorTitle,
        message: getReadableAiError(error, geminiTexts.saveErrorMessage),
      });
    } finally {
      setIsSavingGeminiKey(false);
    }
  };

  const handleSetActiveGeminiKey = async (keyId: string) => {
    try {
      await setActiveGeminiKey(keyId);
    } catch (error) {
      console.error(error);
      setNoticeDialog({
        title: geminiTexts.switchErrorTitle,
        message: getReadableAiError(error, geminiTexts.switchErrorMessage),
      });
    }
  };

  const handleToggleGeminiKeyEnabled = async (
    keyId: string,
    enabled: boolean,
  ) => {
    try {
      await setGeminiKeyEnabled(keyId, enabled);
    } catch (error) {
      console.error(error);
      setNoticeDialog({
        title: geminiTexts.toggleErrorTitle,
        message: getReadableAiError(error, geminiTexts.toggleErrorMessage),
      });
    }
  };

  const handleConfirmDeleteGeminiKey = async () => {
    if (!deleteDialog) return;

    const { id } = deleteDialog;

    try {
      await deleteGeminiKey(id);
      setVisibleGeminiKeyIds((prev) => prev.filter((item) => item !== id));
      setCopiedGeminiKeyId((prev) => (prev === id ? null : prev));
    } catch (error) {
      console.error(error);
      setNoticeDialog({
        title: geminiTexts.toggleErrorTitle,
        message: getReadableAiError(error, geminiTexts.toggleErrorMessage),
      });
    } finally {
      setDeleteDialog(null);
    }
  };

  const handleCopyGeminiKey = (keyId: string, apiKey: string) => {
    void navigator.clipboard.writeText(apiKey).then(() => {
      setCopiedGeminiKeyId(keyId);
      window.setTimeout(() => {
        setCopiedGeminiKeyId((prev) => (prev === keyId ? null : prev));
      }, 1600);
    });
  };

  const handleQuickTextModelChange = (nextModel: TextModelPreference) => {
    setPreferredTextModelPreference(nextModel);
    setTextModelPreference(nextModel);
    setCustomTextModelInput("");
  };

  const handleApplyCustomTextModel = () => {
    const trimmedModel = customTextModelInput.trim();
    if (!trimmedModel) return;

    setPreferredTextModelPreference(trimmedModel);
    setTextModelPreference(trimmedModel);
    setCustomTextModelInput(trimmedModel);
  };

  const handleResetTextModel = () => {
    setPreferredTextModelPreference(DEFAULT_TEXT_MODEL_PREFERENCE);
    setTextModelPreference(DEFAULT_TEXT_MODEL_PREFERENCE);
    setCustomTextModelInput("");
  };

  const modalContent = isOpen ? (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-stone-900/60 p-4 backdrop-blur-sm"
      onClick={() => setIsOpen(false)}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-[2rem] border border-stone-200 bg-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-stone-100 px-5 py-4 sm:px-6">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-amber-700">
              <Shield size={18} />
              <span className="text-xs font-bold uppercase tracking-[0.2em]">
                {texts.layout.apiKeyLink}
              </span>
            </div>
            <h2 className="mt-2 text-xl font-bold text-stone-900 sm:text-2xl">
              {geminiTexts.modalTitle}
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-stone-600">
              {geminiTexts.modalDescription}
            </p>
          </div>
          <button
            onClick={() => setIsOpen(false)}
            className="rounded-xl p-2 text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-900"
            title={texts.common.close}
          >
            <X size={18} />
          </button>
        </div>

        <div className="space-y-6 overflow-y-auto px-5 py-5 sm:px-6">
          <div className="rounded-2xl border border-indigo-100 bg-indigo-50 p-4 text-sm text-indigo-800">
            <div className="mb-2 flex items-center gap-2">
              <Sparkles size={18} className="text-indigo-600" />
              <strong className="text-indigo-900">
                {geminiTexts.textModelTitle}
              </strong>
            </div>
            <p className="mb-4 leading-relaxed text-indigo-800">
              {geminiTexts.textModelDescription}
            </p>

            <div>
              <label className="mb-2 block text-xs font-bold uppercase tracking-wider text-indigo-700">
                {geminiTexts.textModelQuickLabel}
              </label>
              <div className="flex flex-wrap gap-2">
                {QUICK_TEXT_MODEL_PREFERENCES.map((model) => {
                  const optionCopy = getQuickModelCopy(model);
                  const isActive = textModelPreference === model;

                  return (
                    <button
                      key={model}
                      onClick={() => handleQuickTextModelChange(model)}
                      className={`rounded-xl border px-3 py-2 text-xs font-bold transition-all ${
                        isActive
                          ? "border-indigo-300 bg-indigo-600 text-white"
                          : "border-indigo-200 bg-white text-indigo-700 hover:bg-indigo-100"
                      }`}
                      title={optionCopy.description}
                    >
                      {optionCopy.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="mt-4">
              <label className="mb-2 block text-xs font-bold uppercase tracking-wider text-indigo-700">
                {geminiTexts.textModelCustomLabel}
              </label>
              <div className="grid gap-2 md:grid-cols-[1fr_auto_auto]">
                <input
                  value={customTextModelInput}
                  onChange={(event) =>
                    setCustomTextModelInput(event.target.value)
                  }
                  placeholder={geminiTexts.textModelCustomPlaceholder}
                  className="w-full rounded-xl border border-indigo-200 bg-white px-3 py-2 text-sm text-stone-800 focus:border-transparent focus:ring-2 focus:ring-indigo-400"
                />
                <button
                  onClick={handleApplyCustomTextModel}
                  disabled={!customTextModelInput.trim()}
                  className="rounded-xl border border-indigo-200 bg-white px-4 py-2 text-xs font-bold text-indigo-700 transition-all hover:bg-indigo-100 disabled:opacity-50"
                >
                  {geminiTexts.textModelApplyButton}
                </button>
                <button
                  onClick={handleResetTextModel}
                  className="rounded-xl border border-stone-200 bg-white px-4 py-2 text-xs font-bold text-stone-700 transition-all hover:bg-stone-100"
                >
                  {geminiTexts.textModelResetButton}
                </button>
              </div>
            </div>

            <p className="mt-3 text-[11px] font-semibold text-indigo-700">
              {geminiTexts.textModelCurrentPrefix} {currentTextModelLabel}
            </p>
            <p className="mt-1 text-sm leading-relaxed text-indigo-800">
              {currentTextModelDescription}
            </p>
          </div>

          <div className="rounded-2xl border border-amber-100 bg-amber-50 p-4 text-sm text-amber-800">
            <div className="grid gap-2 md:grid-cols-[220px_1fr_auto]">
              <input
                value={newGeminiKeyLabel}
                onChange={(event) => setNewGeminiKeyLabel(event.target.value)}
                placeholder={geminiTexts.labelPlaceholder}
                className="w-full rounded-xl border border-amber-200 bg-white px-3 py-2 text-sm focus:border-transparent focus:ring-2 focus:ring-amber-400"
              />
              <input
                value={newGeminiKeyValue}
                onChange={(event) => setNewGeminiKeyValue(event.target.value)}
                placeholder={geminiTexts.valuePlaceholder}
                className="w-full rounded-xl border border-amber-200 bg-white px-3 py-2 text-sm focus:border-transparent focus:ring-2 focus:ring-amber-400"
              />
              <button
                onClick={handleAddGeminiKey}
                disabled={isSavingGeminiKey || !newGeminiKeyValue.trim()}
                className="flex items-center justify-center gap-2 rounded-xl border border-amber-200 bg-white px-4 py-2 text-xs font-bold text-amber-700 transition-all hover:bg-amber-100 disabled:opacity-50"
              >
                {isSavingGeminiKey ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Plus size={14} />
                )}
                {geminiTexts.saveButton}
              </button>
            </div>

            <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
              <span className="rounded-full border border-amber-200 bg-white px-2.5 py-1 font-semibold text-amber-700">
                {geminiTexts.enabledSummary(
                  enabledGeminiKeyCount,
                  geminiKeys.length,
                )}
              </span>
              {activeGeminiKey && (
                <span className="rounded-full border border-amber-200 bg-white px-2.5 py-1 font-semibold text-amber-700">
                  {geminiTexts.activeSummary(activeGeminiKey.label)}
                </span>
              )}
            </div>
          </div>

          <div className="space-y-3">
            {geminiKeys.length === 0 ? (
              <div className="rounded-xl border border-dashed border-stone-300 bg-stone-50 p-4 text-sm text-stone-500">
                {geminiTexts.emptyState}
              </div>
            ) : (
              geminiKeys.map((key) => {
                const cooldownLabel = formatGeminiCooldown(key.cooldownUntil);
                const isVisible = visibleGeminiKeyIds.includes(key.id);
                const isActiveKey = key.id === activeGeminiKeyId;
                const isCopied = copiedGeminiKeyId === key.id;

                return (
                  <div
                    key={key.id}
                    className="rounded-2xl border border-stone-200 bg-white/90 p-4 shadow-sm"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <strong className="text-stone-900">{key.label}</strong>
                      {isActiveKey && (
                        <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700">
                          {geminiTexts.activeBadge}
                        </span>
                      )}
                      {!key.enabled && (
                        <span className="rounded-full border border-stone-200 bg-stone-100 px-2 py-0.5 text-[11px] font-bold text-stone-600">
                          {geminiTexts.disabledBadge}
                        </span>
                      )}
                      {cooldownLabel && (
                        <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-amber-700">
                          {geminiTexts.cooldownBadge(cooldownLabel)}
                        </span>
                      )}
                    </div>

                    <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                      <input
                        readOnly
                        value={
                          isVisible ? key.apiKey : maskGeminiApiKey(key.apiKey)
                        }
                        className="flex-1 rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-stone-700"
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={() => toggleGeminiKeyVisibility(key.id)}
                          className="rounded-xl border border-stone-200 px-3 py-2 text-xs font-bold text-stone-600 transition-all hover:bg-stone-50"
                        >
                          {isVisible
                            ? geminiTexts.hideButton
                            : geminiTexts.showButton}
                        </button>
                        <button
                          onClick={() =>
                            handleCopyGeminiKey(key.id, key.apiKey)
                          }
                          className="flex items-center justify-center gap-1 rounded-xl border border-stone-200 px-3 py-2 text-xs font-bold text-stone-600 transition-all hover:bg-stone-50"
                          title={geminiTexts.copyTitle}
                        >
                          <Copy size={14} />
                          {isCopied
                            ? geminiTexts.copiedButton
                            : geminiTexts.copyButton}
                        </button>
                      </div>
                    </div>

                    {key.lastError && (
                      <p className="mt-2 break-words text-[11px] text-stone-500">
                        {geminiTexts.lastErrorPrefix} {key.lastError}
                      </p>
                    )}

                    <div className="mt-3 flex flex-wrap gap-2">
                      {cooldownLabel && key.enabled && (
                        <button
                          onClick={() => handleSetActiveGeminiKey(key.id)}
                          className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-700 transition-all hover:bg-amber-100"
                        >
                          {geminiTexts.retryNowButton}
                        </button>
                      )}
                      {!isActiveKey && key.enabled && (
                        <button
                          onClick={() => handleSetActiveGeminiKey(key.id)}
                          className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700 transition-all hover:bg-emerald-100"
                        >
                          {geminiTexts.useThisKeyButton}
                        </button>
                      )}
                      <button
                        onClick={() =>
                          handleToggleGeminiKeyEnabled(key.id, !key.enabled)
                        }
                        className="rounded-xl border border-stone-200 bg-stone-100 px-3 py-2 text-xs font-bold text-stone-700 transition-all hover:bg-stone-200"
                      >
                        {key.enabled
                          ? geminiTexts.disableButton
                          : geminiTexts.enableButton}
                      </button>
                      <button
                        onClick={() =>
                          setDeleteDialog({
                            id: key.id,
                            label: key.label,
                          })
                        }
                        className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700 transition-all hover:bg-rose-100"
                      >
                        {geminiTexts.deleteButton}
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  ) : null;

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-700 transition-colors hover:bg-amber-100"
        title={geminiTexts.buttonTitle}
      >
        <Sparkles size={16} />
        <span className="hidden sm:inline">{texts.layout.apiKeyLink}</span>
        {enabledGeminiKeyCount > 0 && (
          <span className="inline-flex min-w-5 items-center justify-center rounded-full border border-amber-200 bg-white px-1.5 py-0.5 text-[11px] font-bold text-amber-700">
            {enabledGeminiKeyCount}
          </span>
        )}
      </button>

      {mounted && createPortal(modalContent, document.body)}

      {noticeDialog && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-stone-900/50 p-4"
          onClick={() => setNoticeDialog(null)}
        >
          <div
            className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 className="text-lg font-bold text-stone-900">
              {noticeDialog.title}
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-stone-600">
              {noticeDialog.message}
            </p>
            <div className="mt-5 flex justify-end">
              <button
                onClick={() => setNoticeDialog(null)}
                className="rounded-xl bg-stone-900 px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-stone-800"
              >
                {texts.common.confirm}
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteDialog && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-stone-900/50 p-4"
          onClick={() => setDeleteDialog(null)}
        >
          <div
            className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 className="text-lg font-bold text-stone-900">
              {geminiTexts.deleteConfirmTitle}
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-stone-600">
              {geminiTexts.deleteConfirmMessage(deleteDialog.label)}
            </p>
            <div className="mt-5 flex justify-end gap-3">
              <button
                onClick={() => setDeleteDialog(null)}
                className="rounded-xl border border-stone-200 px-4 py-2 text-sm font-bold text-stone-700 transition-colors hover:bg-stone-50"
              >
                {texts.common.cancel}
              </button>
              <button
                onClick={handleConfirmDeleteGeminiKey}
                className="rounded-xl bg-rose-600 px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-rose-700"
              >
                {geminiTexts.deleteConfirmButton}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
