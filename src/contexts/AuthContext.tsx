import React, { createContext, useContext, useState, useEffect } from 'react';
import { auth, signInWithGoogle, logout, onAuthStateChanged, User } from '../services/firebase';
import { syncFromServer } from '../utils/storage';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  syncId: string | null;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const initialSyncDone = React.useRef(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        // Only sync from server if it's the first time we see this user in this session
        // This prevents token refreshes from overwriting local un-synced changes
        if (!initialSyncDone.current) {
          await syncFromServer();
          initialSyncDone.current = true;
        }
      } else {
        initialSyncDone.current = false;
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const signIn = async () => {
    try {
      setLoading(true);
      await signInWithGoogle();
      // onAuthStateChanged will handle the rest
    } catch (error) {
      console.error('Sign in failed', error);
      setLoading(false);
    }
  };

  const signOut = async () => {
    try {
      setLoading(true);
      await logout();
      // Clear local data when signing out to prevent data leaks between accounts
      const localforage = (await import('localforage')).default;
      await localforage.clear();
      // onAuthStateChanged will handle the rest
    } catch (error) {
      console.error('Sign out failed', error);
      setLoading(false);
    }
  };

  const syncId = user?.uid || null;

  return (
    <AuthContext.Provider value={{ user, loading, syncId, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
