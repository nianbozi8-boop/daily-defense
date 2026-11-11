import React, { createContext, useContext, useEffect, useState } from "react";
import { Achievement, AppStats, AuthUser, Note, Profile, SavedTopic, ChatSession } from "../types";
import { ACHIEVEMENT_DEFINITIONS } from "../data/achievementsData";
import {
  auth,
  subscribeToAuth,
  syncUserProfile,
  updateFirestoreUserProfile,
  fetchFirestoreNotes,
  saveFirestoreNote,
  deleteFirestoreNote,
  fetchFirestoreChatSessions,
  saveFirestoreChatSession,
  deleteFirestoreChatSession,
  logOut,
} from "../services/firebase";

export interface AppContextType {
  notes: Note[];
  savedTopics: SavedTopic[];
  achievements: Achievement[];
  profile: Profile;
  stats: AppStats;
  currentUser: AuthUser | null;
  isAuthLoading: boolean;
  isGuest: boolean;
  continueAsGuest: () => void;
  authModalOpen: boolean;
  authModalTab: "login" | "register";
  openAuthModal: (tab?: "login" | "register") => void;
  closeAuthModal: () => void;
  logout: () => Promise<void>;
  addNote: (note: Omit<Note, "id" | "createdAt">) => void;
  updateNote: (id: string, note: Partial<Omit<Note, "id" | "createdAt">>) => void;
  deleteNote: (id: string) => void;
  saveTopic: (topic: Omit<SavedTopic, "id" | "savedAt">) => void;
  deleteSavedTopic: (id: string) => void;
  chatSessions: ChatSession[];
  activeSessionId: string | null;
  setActiveSessionId: (id: string | null) => void;
  saveChatSession: (session: ChatSession) => void;
  deleteChatSession: (id: string) => void;
  renameChatSession: (id: string, newTitle: string) => void;
  clearAllChatSessions: () => void;
  updateProfile: (updates: Partial<Profile>) => void;
  incrementStat: (stat: keyof AppStats, amount?: number) => void;
  resetAllData: () => void;
}

const defaultProfile: Profile = {
  name: "Catholic Defender",
  bio: "Seeking truth through Scripture, Tradition, and Reason.",
  avatarUri: null,
  level: 1,
  xp: 0,
};

const defaultStats: AppStats = {
  debatesCompleted: 0,
  topicsStudied: 0,
  sessionsFinished: 0,
  prayersGenerated: 0,
  versesStudied: 0,
  notesCreated: 0,
  topicsGenerated: 0,
};

const AppContext = createContext<AppContextType | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  // Auth state
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [isGuest, setIsGuest] = useState(false);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authModalTab, setAuthModalTab] = useState<"login" | "register">("login");

  const [notes, setNotes] = useState<Note[]>(() => {
    try {
      const saved = localStorage.getItem("daily_defense_notes");
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const [savedTopics, setSavedTopics] = useState<SavedTopic[]>(() => {
    try {
      const saved = localStorage.getItem("daily_defense_saved_topics");
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const [chatSessions, setChatSessions] = useState<ChatSession[]>(() => {
    try {
      const saved = localStorage.getItem("daily_defense_chat_sessions");
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  const [profile, setProfile] = useState<Profile>(() => {
    try {
      const saved = localStorage.getItem("daily_defense_profile");
      return saved ? JSON.parse(saved) : defaultProfile;
    } catch {
      return defaultProfile;
    }
  });

  const [stats, setStats] = useState<AppStats>(() => {
    try {
      const saved = localStorage.getItem("daily_defense_stats");
      return saved ? JSON.parse(saved) : defaultStats;
    } catch {
      return defaultStats;
    }
  });

  const [achievements, setAchievements] = useState<Achievement[]>(() => {
    try {
      const saved = localStorage.getItem("daily_defense_achievements");
      if (saved) return JSON.parse(saved);
    } catch {}

    return ACHIEVEMENT_DEFINITIONS.map((def) => ({
      ...def,
      unlocked: false,
      progress: 0,
    }));
  });

  // Listen to Auth state (Google Auth and Username/Password accounts)
  useEffect(() => {
    const unsubscribe = subscribeToAuth(async (authUser) => {
      if (authUser) {
        const authData: AuthUser = {
          uid: authUser.uid,
          email: authUser.email,
          displayName: authUser.displayName,
          photoURL: authUser.photoURL,
          providerId: authUser.providerId || "password",
        };
        setCurrentUser(authData);

        // Fetch or sync Firestore profile
        try {
          const docData = await syncUserProfile(authUser);
          if (docData) {
            setProfile((prev) => ({
              ...prev,
              name: docData.displayName || authUser.displayName || prev.name,
              bio: docData.bio || prev.bio,
              level: docData.level || prev.level,
              xp: docData.xp !== undefined ? docData.xp : prev.xp,
            }));
          }

          // Fetch user's saved notes from Firestore and merge with local notes
          const cloudNotes = await fetchFirestoreNotes(authUser.uid);
          if (cloudNotes.length > 0) {
            setNotes((prev) => {
              const map = new Map<string, Note>();
              cloudNotes.forEach((n) => map.set(n.id, n));
              prev.forEach((n) => {
                if (!map.has(n.id)) map.set(n.id, n);
              });
              return Array.from(map.values());
            });
          }

          // Fetch user's saved chat sessions from Firestore and merge with local
          const cloudSessions = await fetchFirestoreChatSessions(authUser.uid);
          if (cloudSessions.length > 0) {
            setChatSessions((prev) => {
              const map = new Map<string, ChatSession>();
              cloudSessions.forEach((s) => map.set(s.id, s));
              prev.forEach((s) => {
                if (!map.has(s.id)) map.set(s.id, s);
              });
              const merged = Array.from(map.values());
              merged.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
              return merged;
            });
          }
        } catch (e) {
          console.warn("Notice syncing user data:", e);
        }
      } else {
        setCurrentUser(null);
      }
      setIsAuthLoading(false);
    });

    return () => unsubscribe();
  }, []);

  // Sync to localStorage
  useEffect(() => {
    try {
      localStorage.setItem("daily_defense_notes", JSON.stringify(notes));
    } catch (e) {
      console.warn("Local storage sync notice (notes):", e);
    }
  }, [notes]);

  useEffect(() => {
    try {
      localStorage.setItem("daily_defense_saved_topics", JSON.stringify(savedTopics));
    } catch (e) {
      console.warn("Local storage sync notice (savedTopics):", e);
    }
  }, [savedTopics]);

  useEffect(() => {
    try {
      localStorage.setItem("daily_defense_profile", JSON.stringify(profile));
    } catch (e) {
      console.warn("Local storage sync notice (profile):", e);
    }
  }, [profile]);

  useEffect(() => {
    try {
      localStorage.setItem("daily_defense_stats", JSON.stringify(stats));
    } catch (e) {
      console.warn("Local storage sync notice (stats):", e);
    }
  }, [stats]);

  useEffect(() => {
    try {
      localStorage.setItem("daily_defense_achievements", JSON.stringify(achievements));
    } catch (e) {
      console.warn("Local storage sync notice (achievements):", e);
    }
  }, [achievements]);

  useEffect(() => {
    try {
      localStorage.setItem("daily_defense_chat_sessions", JSON.stringify(chatSessions));
    } catch (e) {
      console.warn("Local storage sync notice (chatSessions):", e);
    }
  }, [chatSessions]);

  const openAuthModal = (tab: "login" | "register" = "login") => {
    setAuthModalTab(tab);
    setAuthModalOpen(true);
  };

  const closeAuthModal = () => {
    setAuthModalOpen(false);
  };

  const continueAsGuest = () => {
    setIsGuest(true);
  };

  const logout = async () => {
    try {
      await logOut();
      setCurrentUser(null);
      setIsGuest(false);
    } catch (e) {
      console.warn("Logout notice:", e);
    }
  };

  const addNote = (note: Omit<Note, "id" | "createdAt">) => {
    const newNote: Note = {
      ...note,
      id: "note_" + Date.now().toString(36) + Math.random().toString(36).substring(2, 6),
      createdAt: new Date().toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      }),
    };
    setNotes((prev) => [newNote, ...prev]);
    incrementStat("notesCreated", 1);
    if (currentUser?.uid) {
      saveFirestoreNote(currentUser.uid, newNote);
    }
  };

  const updateNote = (id: string, noteUpdates: Partial<Omit<Note, "id" | "createdAt">>) => {
    setNotes((prev) => {
      const updated = prev.map((n) => (n.id === id ? { ...n, ...noteUpdates } : n));
      const target = updated.find((n) => n.id === id);
      if (target && currentUser?.uid) {
        saveFirestoreNote(currentUser.uid, target);
      }
      return updated;
    });
  };

  const deleteNote = (id: string) => {
    setNotes((prev) => prev.filter((n) => n.id !== id));
    if (currentUser?.uid) {
      deleteFirestoreNote(currentUser.uid, id);
    }
  };

  const saveTopic = (topic: Omit<SavedTopic, "id" | "savedAt">) => {
    const newTopic: SavedTopic = {
      ...topic,
      id: "topic_" + Date.now().toString(36) + Math.random().toString(36).substring(2, 6),
      savedAt: new Date().toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      }),
    };
    setSavedTopics((prev) => [newTopic, ...prev]);
    incrementStat("topicsGenerated", 1);
  };

  const deleteSavedTopic = (id: string) => {
    setSavedTopics((prev) => prev.filter((t) => t.id !== id));
  };

  const saveChatSession = (session: ChatSession) => {
    setChatSessions((prev) => {
      const existingIdx = prev.findIndex((s) => s.id === session.id);
      let updated: ChatSession[];
      if (existingIdx >= 0) {
        updated = [...prev];
        updated[existingIdx] = session;
      } else {
        updated = [session, ...prev];
      }
      updated.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
      return updated;
    });

    if (currentUser?.uid) {
      saveFirestoreChatSession(currentUser.uid, session);
    }
  };

  const deleteChatSession = (id: string) => {
    setChatSessions((prev) => prev.filter((s) => s.id !== id));
    if (activeSessionId === id) {
      setActiveSessionId(null);
    }
    if (currentUser?.uid) {
      deleteFirestoreChatSession(currentUser.uid, id);
    }
  };

  const renameChatSession = (id: string, newTitle: string) => {
    const trimmed = newTitle.trim();
    if (!trimmed) return;
    setChatSessions((prev) => {
      const updated = prev.map((s) =>
        s.id === id ? { ...s, title: trimmed, updatedAt: new Date().toISOString() } : s
      );
      const target = updated.find((s) => s.id === id);
      if (target && currentUser?.uid) {
        saveFirestoreChatSession(currentUser.uid, target);
      }
      return updated;
    });
  };

  const clearAllChatSessions = () => {
    if (currentUser?.uid) {
      chatSessions.forEach((s) => {
        deleteFirestoreChatSession(currentUser.uid, s.id);
      });
    }
    setChatSessions([]);
    setActiveSessionId(null);
    try {
      localStorage.removeItem("daily_defense_chat_sessions");
    } catch {}
  };

  const updateProfile = (updates: Partial<Profile>) => {
    setProfile((prev) => {
      const next = { ...prev, ...updates };
      if (currentUser?.uid) {
        updateFirestoreUserProfile(currentUser.uid, {
          displayName: next.name,
          bio: next.bio,
          level: next.level,
          xp: next.xp,
        });
      }
      return next;
    });
  };

  const checkAchievementsForStats = (updatedStats: AppStats) => {
    const achievementMap: Record<string, keyof AppStats> = {
      first_debate: "debatesCompleted",
      five_debates: "debatesCompleted",
      twenty_debates: "debatesCompleted",
      first_opponent: "sessionsFinished",
      five_opponents: "sessionsFinished",
      topics_studied_5: "topicsStudied",
      topics_studied_20: "topicsStudied",
      first_prayer: "prayersGenerated",
      ten_prayers: "prayersGenerated",
      first_verse: "versesStudied",
      ten_verses: "versesStudied",
      first_note: "notesCreated",
      ten_notes: "notesCreated",
      topic_generator: "topicsGenerated",
      five_topics_generated: "topicsGenerated",
    };

    setAchievements((prev) =>
      prev.map((ach) => {
        const statKey = achievementMap[ach.id];
        if (!statKey) return ach;
        const currentCount = updatedStats[statKey] || 0;
        const isUnlocked = currentCount >= ach.threshold;
        const progress = Math.min(currentCount, ach.threshold);

        return {
          ...ach,
          progress,
          unlocked: isUnlocked,
          unlockedAt: isUnlocked && !ach.unlocked ? new Date().toLocaleDateString() : ach.unlockedAt,
        };
      })
    );
  };

  const incrementStat = (stat: keyof AppStats, amount = 1) => {
    const updatedStats = {
      ...stats,
      [stat]: (stats[stat] || 0) + amount,
    };
    setStats(updatedStats);
    checkAchievementsForStats(updatedStats);

    // Gain XP: 15 XP per action
    const xpGained = amount * 15;
    const newXp = profile.xp + xpGained;
    const newLevel = Math.floor(newXp / 100) + 1;

    setProfile((prev) => {
      const next = {
        ...prev,
        xp: newXp,
        level: newLevel,
      };
      if (currentUser?.uid) {
        updateFirestoreUserProfile(currentUser.uid, {
          xp: newXp,
          level: newLevel,
        });
      }
      return next;
    });
  };

  const resetAllData = () => {
    localStorage.removeItem("daily_defense_notes");
    localStorage.removeItem("daily_defense_saved_topics");
    localStorage.removeItem("daily_defense_chat_sessions");
    localStorage.removeItem("daily_defense_profile");
    localStorage.removeItem("daily_defense_stats");
    localStorage.removeItem("daily_defense_achievements");
    setNotes([]);
    setSavedTopics([]);
    setChatSessions([]);
    setActiveSessionId(null);
    setProfile(defaultProfile);
    setStats(defaultStats);
    setAchievements(
      ACHIEVEMENT_DEFINITIONS.map((def) => ({
        ...def,
        unlocked: false,
        progress: 0,
      }))
    );
  };

  return (
    <AppContext.Provider
      value={{
        notes,
        savedTopics,
        achievements,
        profile,
        stats,
        currentUser,
        isAuthLoading,
        isGuest,
        continueAsGuest,
        authModalOpen,
        authModalTab,
        openAuthModal,
        closeAuthModal,
        logout,
        addNote,
        updateNote,
        deleteNote,
        saveTopic,
        deleteSavedTopic,
        chatSessions,
        activeSessionId,
        setActiveSessionId,
        saveChatSession,
        deleteChatSession,
        renameChatSession,
        clearAllChatSessions,
        updateProfile,
        incrementStat,
        resetAllData,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error("useApp must be used within an AppProvider");
  }
  return context;
}
