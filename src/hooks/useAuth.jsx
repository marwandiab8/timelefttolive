import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { auth, db, isFirebaseConfigured } from '../services/firebase.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isFirebaseConfigured) {
      setLoading(false);
      return undefined;
    }

    let settled = false;
    const timeoutId = window.setTimeout(() => {
      if (!settled) setLoading(false);
    }, 5000);

    const unsubscribe = onAuthStateChanged(auth, async (nextUser) => {
      settled = true;
      window.clearTimeout(timeoutId);
      setUser(nextUser);
      setLoading(false);
      if (nextUser) {
        try {
          await setDoc(doc(db, 'users', nextUser.uid), {
            displayName: nextUser.displayName || '',
            email: nextUser.email || '',
            updatedAt: serverTimestamp(),
            createdAt: serverTimestamp()
          }, { merge: true });
        } catch (error) {
          console.error('Failed to sync user profile', error);
        }
      }
    });

    return () => {
      window.clearTimeout(timeoutId);
      unsubscribe();
    };
  }, []);

  const value = useMemo(() => ({ user, loading }), [user, loading]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
