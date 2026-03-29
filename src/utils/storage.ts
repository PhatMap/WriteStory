import localforage from 'localforage';
import { db, auth, doc, setDoc, getDoc, collection, getDocs, deleteDoc } from '../services/firebase';

localforage.config({
  name: 'StoryCraft',
  storeName: 'storycraft_data',
});

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

const firestoreSyncDebounceMap = new Map<string, any>();

const CHUNK_SIZE = 800 * 1024; // 800KB chunks to be safe with Firestore 1MB limit

const syncToFirestore = async (key: string, value: string) => {
  if (!auth.currentUser) return;
  
  // Clear existing debounce for this key
  if (firestoreSyncDebounceMap.has(key)) {
    clearTimeout(firestoreSyncDebounceMap.get(key));
  }

  // Set new debounce
  const timeout = setTimeout(async () => {
    firestoreSyncDebounceMap.delete(key);
    
    if (!auth.currentUser) return;

    const userId = auth.currentUser.uid;
    const sizeInBytes = new Blob([value]).size;

    try {
      if (sizeInBytes < 1000000) {
        // Small enough for a single document
        const path = `users/${userId}/data/${key}`;
        await setDoc(doc(db, 'users', userId, 'data', key), {
          sync_id: userId,
          key,
          value,
          updated_at: new Date().toISOString(),
          is_chunked: false
        });
        
        // If it was previously chunked, we should clean up the manifest and chunks
        // But for simplicity, we'll just overwrite the main key. 
        // A more robust solution would delete _manifest_${key} and chunks.
      } else {
        // Too large, need to chunk
        console.log(`Chunking "${key}" (${(sizeInBytes / 1024 / 1024).toFixed(2)}MB) for Firestore sync...`);
        
        const chunks: string[] = [];
        for (let i = 0; i < value.length; i += CHUNK_SIZE) {
          chunks.push(value.substring(i, i + CHUNK_SIZE));
        }

        // 1. Save chunks
        for (let i = 0; i < chunks.length; i++) {
          const chunkKey = `_chunk_${key}_${i}`;
          await setDoc(doc(db, 'users', userId, 'data', chunkKey), {
            sync_id: userId,
            key: chunkKey,
            value: chunks[i],
            updated_at: new Date().toISOString()
          });
        }

        // 2. Save manifest
        const manifestKey = `_manifest_${key}`;
        await setDoc(doc(db, 'users', userId, 'data', manifestKey), {
          sync_id: userId,
          key: manifestKey,
          value: JSON.stringify({
            chunkCount: chunks.length,
            originalKey: key
          }),
          updated_at: new Date().toISOString()
        });

        // 3. Clear the main key in Firestore to avoid confusion (optional but cleaner)
        // We'll keep it for now but mark it as chunked
        await setDoc(doc(db, 'users', userId, 'data', key), {
          sync_id: userId,
          key,
          value: "__CHUNKED__",
          updated_at: new Date().toISOString(),
          is_chunked: true
        });
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes('resource-exhausted')) {
        console.warn('Firestore write stream exhausted, skipping this sync. It will retry on next change.');
      } else {
        const path = `users/${userId}/data/${key}`;
        handleFirestoreError(err, OperationType.WRITE, path);
      }
    }
  }, 3000);

  firestoreSyncDebounceMap.set(key, timeout);
};

export const safeSetItem = async (key: string, value: string, sync = true) => {
  try {
    // Local save is always immediate and full
    await localforage.setItem(key, value);
    
    // Firestore sync is debounced and chunked if necessary
    if (sync) {
      syncToFirestore(key, value);
    }
    return true;
  } catch (e: any) {
    console.error('Error saving to localforage', e);
    return false;
  }
};

export const safeGetItem = async (key: string) => {
  try {
    const localValue = await localforage.getItem<string>(key);
    
    // If it's the special chunked marker, we need to reconstruct it
    if (localValue === "__CHUNKED__") {
      const manifestStr = await localforage.getItem<string>(`_manifest_${key}`);
      if (manifestStr) {
        const manifest = JSON.parse(manifestStr);
        let reconstructed = "";
        for (let i = 0; i < manifest.chunkCount; i++) {
          const chunk = await localforage.getItem<string>(`_chunk_${key}_${i}`);
          if (chunk) reconstructed += chunk;
        }
        return reconstructed;
      }
    }
    
    return localValue;
  } catch (e) {
    console.error('Error reading from localforage', e);
    return null;
  }
};

export const safeRemoveItem = async (key: string) => {
  try {
    const value = await localforage.getItem<string>(key);
    await localforage.removeItem(key);
    
    if (auth.currentUser) {
      const userId = auth.currentUser.uid;
      await deleteDoc(doc(db, 'users', userId, 'data', key));
      
      // If it was chunked, clean up manifest and chunks
      if (value === "__CHUNKED__") {
        const manifestStr = await localforage.getItem<string>(`_manifest_${key}`);
        if (manifestStr) {
          const manifest = JSON.parse(manifestStr);
          await localforage.removeItem(`_manifest_${key}`);
          await deleteDoc(doc(db, 'users', userId, 'data', `_manifest_${key}`));
          
          for (let i = 0; i < manifest.chunkCount; i++) {
            await localforage.removeItem(`_chunk_${key}_${i}`);
            await deleteDoc(doc(db, 'users', userId, 'data', `_chunk_${key}_${i}`));
          }
        }
      }
    }
    return true;
  } catch (e) {
    console.error('Error removing from localforage or Firestore', e);
    return false;
  }
};

export const syncFromServer = async () => {
  try {
    if (!auth.currentUser) return false;
    const userId = auth.currentUser.uid;
    const path = `users/${userId}/data`;
    
    try {
      const querySnapshot = await getDocs(collection(db, 'users', userId, 'data'));
      for (const doc of querySnapshot.docs) {
        const data = doc.data();
        await localforage.setItem(data.key, data.value);
      }
      return true;
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, path);
    }
  } catch (e) {
    console.error('Sync from server failed', e);
  }
  return false;
};

export const getStorageUsage = async () => {
  if (navigator.storage && navigator.storage.estimate) {
    const estimate = await navigator.storage.estimate();
    return {
      usage: estimate.usage || 0,
      quota: estimate.quota || 0,
      percent: estimate.quota ? ((estimate.usage || 0) / estimate.quota) * 100 : 0
    };
  }
  return null;
};

export const listStorageKeys = async () => {
  try {
    return await localforage.keys();
  } catch (e) {
    console.error("Error listing localforage keys", e);
    return [];
  }
};

/**
 * StorageManager automatically handles new feature data by providing a dynamic way to register keys.
 * It ensures that as the app grows, all data is consistently saved and synced.
 */
class StorageManager {
  private keys: Set<string> = new Set();

  registerKey(key: string) {
    this.keys.add(key);
  }

  async saveAll(data: Record<string, any>) {
    for (const [key, value] of Object.entries(data)) {
      this.registerKey(key);
      const stringValue = typeof value === 'string' ? value : JSON.stringify(value);
      await safeSetItem(key, stringValue);
    }
  }

  async loadAll() {
    const data: Record<string, any> = {};
    for (const key of this.keys) {
      const value = await safeGetItem(key);
      if (value) {
        try {
          data[key] = JSON.parse(value);
        } catch {
          data[key] = value;
        }
      }
    }
    return data;
  }
}

export const storageManager = new StorageManager();
