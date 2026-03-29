import localforage from "localforage";

export type GeminiKeyRecord = {
  id: string;
  label: string;
  apiKey: string;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
  lastUsedAt: number | null;
  cooldownUntil: number | null;
  failCount: number;
  lastError: string | null;
};

type GeminiKeyMeta = {
  activeKeyId: string | null;
};

const geminiKeyStore = localforage.createInstance({
  name: "StoryCraftSecrets",
  storeName: "gemini_keys",
});

const GEMINI_KEYS_STORAGE_KEY = "gemini_keys_v1";
const GEMINI_KEYS_META_STORAGE_KEY = "gemini_keys_meta_v1";
export const GEMINI_KEYS_CHANGED_EVENT = "storycraft:gemini-keys-changed";
export const GEMINI_KEY_QUOTA_COOLDOWN_MS = 30 * 60 * 1000;

const defaultMeta: GeminiKeyMeta = {
  activeKeyId: null,
};

function emitGeminiKeysChanged() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(GEMINI_KEYS_CHANGED_EVENT));
  }
}

function createGeminiKeyId() {
  return `gemini_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

async function readGeminiKeys() {
  return (await geminiKeyStore.getItem<GeminiKeyRecord[]>(GEMINI_KEYS_STORAGE_KEY)) ?? [];
}

async function writeGeminiKeys(keys: GeminiKeyRecord[]) {
  await geminiKeyStore.setItem(GEMINI_KEYS_STORAGE_KEY, keys);
  emitGeminiKeysChanged();
}

async function readGeminiKeyMeta() {
  const savedMeta = await geminiKeyStore.getItem<GeminiKeyMeta>(GEMINI_KEYS_META_STORAGE_KEY);
  return {
    ...defaultMeta,
    ...savedMeta,
  };
}

async function writeGeminiKeyMeta(meta: GeminiKeyMeta) {
  await geminiKeyStore.setItem(GEMINI_KEYS_META_STORAGE_KEY, {
    ...defaultMeta,
    ...meta,
  });
  emitGeminiKeysChanged();
}

function sanitizeGeminiKeyLabel(label: string, currentCount: number) {
  const trimmed = label.trim();
  return trimmed || `Gemini Key ${currentCount + 1}`;
}

function sortGeminiKeysForUi(keys: GeminiKeyRecord[], activeKeyId: string | null) {
  return [...keys].sort((a, b) => {
    if (a.id === activeKeyId) return -1;
    if (b.id === activeKeyId) return 1;
    if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
    return b.updatedAt - a.updatedAt;
  });
}

function isGeminiKeyCoolingDown(key: GeminiKeyRecord, now = Date.now()) {
  return Boolean(key.cooldownUntil && key.cooldownUntil > now);
}

function pickReplacementActiveKey(keys: GeminiKeyRecord[]) {
  const now = Date.now();
  const enabledReadyKeys = keys.filter((key) => key.enabled && !isGeminiKeyCoolingDown(key, now));
  if (enabledReadyKeys.length > 0) {
    return enabledReadyKeys.sort((a, b) => {
      const aLastUsed = a.lastUsedAt ?? 0;
      const bLastUsed = b.lastUsedAt ?? 0;
      return aLastUsed - bLastUsed;
    })[0].id;
  }

  const enabledKeys = keys.filter((key) => key.enabled);
  if (enabledKeys.length > 0) {
    return enabledKeys[0].id;
  }

  return keys[0]?.id ?? null;
}

export function maskGeminiApiKey(apiKey: string) {
  if (!apiKey) return "";
  if (apiKey.length <= 10) return apiKey;
  return `${apiKey.slice(0, 6)}...${apiKey.slice(-4)}`;
}

export function formatGeminiCooldown(cooldownUntil: number | null | undefined) {
  if (!cooldownUntil || cooldownUntil <= Date.now()) return null;

  const totalMinutes = Math.ceil((cooldownUntil - Date.now()) / 60000);
  if (totalMinutes >= 60) {
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return minutes > 0 ? `${hours}h ${minutes}p` : `${hours}h`;
  }

  return `${totalMinutes}p`;
}

export async function getGeminiKeyState() {
  const [keys, meta] = await Promise.all([readGeminiKeys(), readGeminiKeyMeta()]);
  const activeKeyExists = meta.activeKeyId ? keys.some((key) => key.id === meta.activeKeyId) : false;
  const activeKeyId = activeKeyExists ? meta.activeKeyId : pickReplacementActiveKey(keys);

  if (activeKeyId !== meta.activeKeyId) {
    await writeGeminiKeyMeta({ activeKeyId });
  }

  return {
    keys: sortGeminiKeysForUi(keys, activeKeyId),
    activeKeyId,
  };
}

export async function addGeminiKey(label: string, apiKey: string) {
  const trimmedKey = apiKey.trim();
  if (!trimmedKey) {
    throw new Error("Vui lòng nhập Gemini API key.");
  }

  const keys = await readGeminiKeys();
  if (keys.some((key) => key.apiKey === trimmedKey)) {
    throw new Error("Key này đã tồn tại trong trình duyệt.");
  }

  const now = Date.now();
  const newKey: GeminiKeyRecord = {
    id: createGeminiKeyId(),
    label: sanitizeGeminiKeyLabel(label, keys.length),
    apiKey: trimmedKey,
    enabled: true,
    createdAt: now,
    updatedAt: now,
    lastUsedAt: null,
    cooldownUntil: null,
    failCount: 0,
    lastError: null,
  };

  const nextKeys = [...keys, newKey];
  const meta = await readGeminiKeyMeta();

  await writeGeminiKeys(nextKeys);
  if (!meta.activeKeyId) {
    await writeGeminiKeyMeta({ activeKeyId: newKey.id });
  }

  return newKey;
}

export async function deleteGeminiKey(id: string) {
  const [keys, meta] = await Promise.all([readGeminiKeys(), readGeminiKeyMeta()]);
  const nextKeys = keys.filter((key) => key.id !== id);
  await writeGeminiKeys(nextKeys);

  if (meta.activeKeyId === id) {
    await writeGeminiKeyMeta({ activeKeyId: pickReplacementActiveKey(nextKeys) });
  }
}

export async function setGeminiKeyEnabled(id: string, enabled: boolean) {
  const [keys, meta] = await Promise.all([readGeminiKeys(), readGeminiKeyMeta()]);
  const now = Date.now();
  const nextKeys = keys.map((key) =>
    key.id === id
      ? {
          ...key,
          enabled,
          updatedAt: now,
        }
      : key,
  );

  await writeGeminiKeys(nextKeys);

  if (!enabled && meta.activeKeyId === id) {
    await writeGeminiKeyMeta({ activeKeyId: pickReplacementActiveKey(nextKeys) });
    return;
  }

  if (enabled && !meta.activeKeyId) {
    await writeGeminiKeyMeta({ activeKeyId: id });
  }
}

export async function setActiveGeminiKey(id: string) {
  const keys = await readGeminiKeys();
  const targetKey = keys.find((key) => key.id === id);

  if (!targetKey) {
    throw new Error("Không tìm thấy key đã chọn.");
  }

  if (!targetKey.enabled) {
    throw new Error("Hãy bật key này trước khi dùng.");
  }

  const now = Date.now();
  await writeGeminiKeys(
    keys.map((key) =>
      key.id === id
        ? {
            ...key,
            updatedAt: now,
            cooldownUntil: null,
            lastError: null,
          }
        : key,
    ),
  );
  await writeGeminiKeyMeta({ activeKeyId: id });
}

export async function selectGeminiKey(excludedIds: string[] = []) {
  const { keys, activeKeyId } = await getGeminiKeyState();
  const now = Date.now();

  const availableKeys = keys.filter(
    (key) => key.enabled && !excludedIds.includes(key.id) && !isGeminiKeyCoolingDown(key, now),
  );

  if (availableKeys.length === 0) {
    return null;
  }

  const selectedKey =
    availableKeys.find((key) => key.id === activeKeyId) ??
    [...availableKeys].sort((a, b) => {
      const aLastUsed = a.lastUsedAt ?? 0;
      const bLastUsed = b.lastUsedAt ?? 0;
      return aLastUsed - bLastUsed;
    })[0];

  if (selectedKey.id !== activeKeyId) {
    await writeGeminiKeyMeta({ activeKeyId: selectedKey.id });
  }

  return selectedKey;
}

export async function markGeminiKeyUsed(id: string) {
  const keys = await readGeminiKeys();
  const now = Date.now();
  const nextKeys = keys.map((key) =>
    key.id === id
      ? {
          ...key,
          lastUsedAt: now,
          updatedAt: now,
          failCount: 0,
          lastError: null,
          cooldownUntil: null,
        }
      : key,
  );

  await writeGeminiKeys(nextKeys);
  await writeGeminiKeyMeta({ activeKeyId: id });
}

export async function markGeminiKeyFailure(id: string, message?: string) {
  const keys = await readGeminiKeys();
  const now = Date.now();
  const nextKeys = keys.map((key) =>
    key.id === id
      ? {
          ...key,
          updatedAt: now,
          failCount: key.failCount + 1,
          lastError: message ?? key.lastError,
        }
      : key,
  );

  await writeGeminiKeys(nextKeys);
}

export async function markGeminiKeyQuotaExceeded(id: string, message?: string) {
  const keys = await readGeminiKeys();
  const now = Date.now();
  const nextKeys = keys.map((key) =>
    key.id === id
      ? {
          ...key,
          updatedAt: now,
          failCount: key.failCount + 1,
          lastError: message ?? "Quota đã hết, key đang nghỉ tạm.",
          cooldownUntil: now + GEMINI_KEY_QUOTA_COOLDOWN_MS,
        }
      : key,
  );

  await writeGeminiKeys(nextKeys);

  const meta = await readGeminiKeyMeta();
  if (meta.activeKeyId === id) {
    await writeGeminiKeyMeta({ activeKeyId: pickReplacementActiveKey(nextKeys) });
  }
}
