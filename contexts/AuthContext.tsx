import React, { createContext, useContext, useEffect, useState } from 'react';
import { User, onAuthStateChanged, signOut, signInAnonymously } from 'firebase/auth';
import { auth, db, handleFirestoreError } from '../services/firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  logout: () => Promise<void>;
  userData: any;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [userData, setUserData] = useState<any>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user && user.isAnonymous) {
        // If the user has a lingering anonymous session from the previous fallback,
        // sign them out so they go back to the AuthScreen for Google login.
        signOut(auth);
        return;
      }
      
      setUser(user);
      
      if (user) {
        // Sync user profile to Firestore
        const userRef = doc(db, 'users', user.uid);
        
        try {
          const userSnap = await getDoc(userRef);
          
          if (!userSnap.exists()) {
            const profile = {
              uid: user.uid,
              email: user.email,
              displayName: user.displayName || 'Collector_' + user.uid.substring(0, 4),
              photoURL: user.photoURL || '',
              createdAt: new Date().toISOString(),
            };
            await setDoc(userRef, profile);
            setUserData(profile);
          } else {
            setUserData(userSnap.data());
          }
        } catch (e) {
            handleFirestoreError(e, 'get', `users/${user.uid}`);
        }
      } else {
        setUserData(null);
      }
      
      setLoading(false);
    });

    return unsubscribe;
  }, []);

  const logout = () => signOut(auth);

  return (
    <AuthContext.Provider value={{ user, loading, logout, userData }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
