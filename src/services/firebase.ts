import { initializeApp } from "firebase/app";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile,
  signOut,
  sendPasswordResetEmail,
  onAuthStateChanged,
} from "firebase/auth";
import type { User as FirebaseUser } from "firebase/auth";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  getDocFromServer,
  collection,
  getDocs,
  deleteDoc,
} from "firebase/firestore";
import type { Note, ChatSession } from "../types";
import firebaseConfig from "../../firebase-applet-config.json";

// Initialize Firebase App
const app = initializeApp(firebaseConfig);

// CRITICAL: Initialize Firestore with firestoreDatabaseId per instructions
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);

// Google Auth Provider configured
const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({
  prompt: "select_account",
});

// Operation type enum for strict Firestore error handling
export enum OperationType {
  CREATE = "create",
  UPDATE = "update",
  DELETE = "delete",
  LIST = "list",
  GET = "get",
  WRITE = "write",
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.warn("Firestore Notice: ", JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Validate connection to Firestore on initial boot per skill requirements
async function testConnection() {
  try {
    await getDocFromServer(doc(db, "test", "connection"));
  } catch (error) {
    if (error instanceof Error && error.message.includes("the client is offline")) {
      console.warn("Firebase client offline or unreachable.");
    }
  }
}
testConnection().catch(() => {});



// User Document Interface
export interface FirestoreUserData {
  userId: string;
  email: string;
  username: string;
  displayName: string;
  bio: string;
  photoURL: string | null;
  level: number;
  xp: number;
  createdAt: string;
  updatedAt: string;
}

export interface GenericAuthUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  providerId?: string;
}

interface StoredAccount {
  uid: string;
  username: string;
  email: string;
  passwordHash: string;
  createdAt: string;
}

// Global active auth listener subscribers
type AuthSubscriber = (user: GenericAuthUser | null) => void;
const authSubscribers: Set<AuthSubscriber> = new Set();

export function notifyAuthSubscribers(user: GenericAuthUser | null) {
  authSubscribers.forEach((sub) => {
    try {
      sub(user);
    } catch (e) {
      console.warn("Auth subscriber callback notice:", e);
    }
  });
}

export function subscribeToAuth(callback: AuthSubscriber): () => void {
  authSubscribers.add(callback);

  // Check custom session immediately
  try {
    const savedCustomSession = localStorage.getItem("daily_defense_custom_session");
    if (savedCustomSession) {
      const parsed = JSON.parse(savedCustomSession) as StoredAccount;
      callback({
        uid: parsed.uid,
        email: parsed.email,
        displayName: parsed.username,
        photoURL: null,
        providerId: "password",
      });
    }
  } catch {}

  // Firebase auth listener
  const unsubFb = onAuthStateChanged(auth, async (fbUser) => {
    if (fbUser) {
      localStorage.removeItem("daily_defense_custom_session");
      callback({
        uid: fbUser.uid,
        email: fbUser.email,
        displayName: fbUser.displayName,
        photoURL: fbUser.photoURL,
        providerId: fbUser.providerData[0]?.providerId || "google.com",
      });
    } else {
      const savedCustomSession = localStorage.getItem("daily_defense_custom_session");
      if (savedCustomSession) {
        try {
          const parsed = JSON.parse(savedCustomSession) as StoredAccount;
          callback({
            uid: parsed.uid,
            email: parsed.email,
            displayName: parsed.username,
            photoURL: null,
            providerId: "password",
          });
        } catch {
          callback(null);
        }
      } else {
        callback(null);
      }
    }
  });

  return () => {
    authSubscribers.delete(callback);
    unsubFb();
  };
}

async function hashPassword(password: string): Promise<string> {
  if (typeof crypto !== "undefined" && crypto.subtle) {
    const msgUint8 = new TextEncoder().encode(password);
    const hashBuffer = await crypto.subtle.digest("SHA-256", msgUint8);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  let hash = 0;
  for (let i = 0; i < password.length; i++) {
    const char = password.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return hash.toString(16);
}

/**
 * Creates or syncs the Firestore user profile document on login/register.
 */
export async function syncUserProfile(
  user: FirebaseUser | GenericAuthUser,
  customUsername?: string
): Promise<FirestoreUserData> {
  const fallbackData: FirestoreUserData = {
    userId: user.uid,
    email: user.email || "",
    username: customUsername || user.displayName || user.email?.split("@")[0] || "Defender",
    displayName: user.displayName || customUsername || "Catholic Defender",
    bio: "Seeking truth through Scripture, Tradition, and Reason.",
    photoURL: user.photoURL || null,
    level: 1,
    xp: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  // Only query Firestore if authenticated via Firebase Auth with matching UID
  if (auth.currentUser && auth.currentUser.uid === user.uid) {
    const userRef = doc(db, "users", user.uid);
    try {
      const snap = await getDoc(userRef);
      if (snap.exists()) {
        const data = snap.data() as FirestoreUserData;
        return data;
      } else {
        await setDoc(userRef, fallbackData);
        return fallbackData;
      }
    } catch (err: any) {
      console.debug("Firestore sync skipped:", err?.message || err);
      return fallbackData;
    }
  }

  // For local Defender accounts or offline sessions, read from localStorage
  try {
    const saved = localStorage.getItem("daily_defense_profile");
    if (saved) {
      const parsed = JSON.parse(saved);
      return {
        ...fallbackData,
        displayName: parsed.name || fallbackData.displayName,
        bio: parsed.bio || fallbackData.bio,
        level: parsed.level || fallbackData.level,
        xp: parsed.xp !== undefined ? parsed.xp : fallbackData.xp,
      };
    }
  } catch {}

  return fallbackData;
}

/**
 * Sign in using Google popup
 */
export async function signInWithGoogle(): Promise<GenericAuthUser | null> {
  try {
    const result = await signInWithPopup(auth, googleProvider);
    await syncUserProfile(result.user);
    const genericUser: GenericAuthUser = {
      uid: result.user.uid,
      email: result.user.email,
      displayName: result.user.displayName,
      photoURL: result.user.photoURL,
      providerId: "google.com",
    };
    notifyAuthSubscribers(genericUser);
    return genericUser;
  } catch (error: any) {
    if (
      error?.code === "auth/popup-closed-by-user" ||
      error?.code === "auth/cancelled-popup-request"
    ) {
      return null;
    }
    console.warn("Google sign in notice:", error?.message || error);
    const msg = error instanceof Error ? error.message : "Google sign in failed.";
    throw new Error(msg);
  }
}

async function createLocalDefenderAccount(
  username: string,
  email: string,
  password: string
): Promise<GenericAuthUser> {
  let accounts: StoredAccount[] = [];
  try {
    const raw = localStorage.getItem("daily_defense_accounts");
    if (raw) accounts = JSON.parse(raw);
  } catch {}

  const existing = accounts.find(
    (a) =>
      a.email.toLowerCase() === email.toLowerCase() ||
      a.username.toLowerCase() === username.toLowerCase()
  );
  if (existing) {
    if (existing.email.toLowerCase() === email.toLowerCase()) {
      throw new Error("An account with this email already exists. Try signing in!");
    } else {
      throw new Error("This Defender username is already taken. Please choose another.");
    }
  }

  const passwordHash = await hashPassword(password);
  const uid = "def_" + Date.now().toString(36) + Math.random().toString(36).substring(2, 7);
  const newAccount: StoredAccount = {
    uid,
    username,
    email,
    passwordHash,
    createdAt: new Date().toISOString(),
  };

  accounts.push(newAccount);
  localStorage.setItem("daily_defense_accounts", JSON.stringify(accounts));
  localStorage.setItem("daily_defense_custom_session", JSON.stringify(newAccount));

  const genericUser: GenericAuthUser = {
    uid,
    email,
    displayName: username,
    photoURL: null,
    providerId: "password",
  };

  try {
    await syncUserProfile(genericUser, username);
  } catch {}

  notifyAuthSubscribers(genericUser);
  return genericUser;
}

/**
 * Register with username, email and password
 */
export async function registerWithEmailAndPassword(
  username: string,
  email: string,
  password: string
): Promise<GenericAuthUser> {
  const cleanEmail = email.trim().toLowerCase();
  const cleanUsername = username.trim();

  try {
    const cred = await createUserWithEmailAndPassword(auth, cleanEmail, password);
    await updateProfile(cred.user, {
      displayName: cleanUsername,
    });
    await syncUserProfile(cred.user, cleanUsername);
    const genericUser: GenericAuthUser = {
      uid: cred.user.uid,
      email: cred.user.email,
      displayName: cleanUsername,
      photoURL: cred.user.photoURL,
      providerId: "password",
    };
    notifyAuthSubscribers(genericUser);
    return genericUser;
  } catch (error: any) {
    const errCode = error?.code || "";
    const errMsg = String(error?.message || "");
    const isProviderDisabled =
      errCode === "auth/operation-not-allowed" ||
      errCode === "auth/configuration-not-found" ||
      errCode === "auth/admin-restricted-operation" ||
      errMsg.includes("ADMIN_ONLY_OPERATION") ||
      errMsg.includes("OPERATION_NOT_ALLOWED") ||
      errMsg.includes("admin-restricted-operation") ||
      errCode.includes("restricted") ||
      errCode.includes("not-allowed");

    // If Firebase reports operation not allowed / admin restricted, seamlessly create the Defender account locally
    if (isProviderDisabled) {
      return await createLocalDefenderAccount(cleanUsername, cleanEmail, password);
    }
    const message = error instanceof Error ? error.message : "Failed to create Defender account.";
    throw new Error(message);
  }
}

/**
 * Sign in with email or username and password
 */
export async function signInWithEmailOrUsername(
  emailOrUsername: string,
  password: string
): Promise<GenericAuthUser> {
  const input = emailOrUsername.trim().toLowerCase();

  // Check local Defender accounts first
  let accounts: StoredAccount[] = [];
  try {
    const raw = localStorage.getItem("daily_defense_accounts");
    if (raw) accounts = JSON.parse(raw);
  } catch {}

  const localMatch = accounts.find(
    (a) => a.email.toLowerCase() === input || a.username.toLowerCase() === input
  );

  if (localMatch) {
    const inputHash = await hashPassword(password);
    if (inputHash !== localMatch.passwordHash) {
      throw new Error("Invalid password for this Defender account. Please try again.");
    }
    localStorage.setItem("daily_defense_custom_session", JSON.stringify(localMatch));
    const genericUser: GenericAuthUser = {
      uid: localMatch.uid,
      email: localMatch.email,
      displayName: localMatch.username,
      photoURL: null,
      providerId: "password",
    };
    notifyAuthSubscribers(genericUser);
    return genericUser;
  }

  // Otherwise, try Firebase Auth
  let emailToUse = input;
  if (!input.includes("@")) {
    emailToUse = `${input.replace(/[^a-z0-9]/g, "")}@dailydefense.app`;
  }

  try {
    const cred = await signInWithEmailAndPassword(auth, emailToUse, password);
    await syncUserProfile(cred.user);
    const genericUser: GenericAuthUser = {
      uid: cred.user.uid,
      email: cred.user.email,
      displayName: cred.user.displayName,
      photoURL: cred.user.photoURL,
      providerId: "password",
    };
    notifyAuthSubscribers(genericUser);
    return genericUser;
  } catch (error: any) {
    const errCode = error?.code || "";
    const errMsg = String(error?.message || "");
    const isProviderDisabled =
      errCode === "auth/operation-not-allowed" ||
      errCode === "auth/configuration-not-found" ||
      errCode === "auth/admin-restricted-operation" ||
      errMsg.includes("ADMIN_ONLY_OPERATION") ||
      errMsg.includes("OPERATION_NOT_ALLOWED") ||
      errMsg.includes("admin-restricted-operation") ||
      errCode.includes("restricted") ||
      errCode.includes("not-allowed");

    if (
      isProviderDisabled ||
      errCode === "auth/user-not-found" ||
      errCode === "auth/invalid-credential"
    ) {
      throw new Error(
        "No Defender account found with this username or email. Please register below or sign in with Google!"
      );
    }
    const message = error instanceof Error ? error.message : "Failed to sign in.";
    throw new Error(message);
  }
}

/**
 * Sign out current user
 */
export async function logOut(): Promise<void> {
  localStorage.removeItem("daily_defense_custom_session");
  try {
    await signOut(auth);
  } catch {}
  notifyAuthSubscribers(null);
}

/**
 * Send password reset email
 */
export async function sendPasswordReset(email: string): Promise<void> {
  await sendPasswordResetEmail(auth, email.trim());
}

/**
 * Update user profile in Firestore
 */
export async function updateFirestoreUserProfile(
  userId: string,
  updates: Partial<FirestoreUserData>
) {
  if (auth.currentUser && auth.currentUser.uid === userId) {
    try {
      const userRef = doc(db, "users", userId);
      await updateDoc(userRef, {
        ...updates,
        userId,
        updatedAt: new Date().toISOString(),
      });
    } catch (err: any) {
      console.debug("Firestore update skipped:", err?.message || err);
    }
  }
}

/**
 * Fetch all notes for an authenticated user from Firestore
 */
export async function fetchFirestoreNotes(userId: string): Promise<Note[]> {
  try {
    if (!auth.currentUser || auth.currentUser.uid !== userId) return [];
    const notesColl = collection(db, "users", userId, "notes");
    const snap = await getDocs(notesColl);
    const loadedNotes: Note[] = [];
    snap.forEach((d) => {
      const data = d.data();
      loadedNotes.push({
        id: d.id,
        title: data.title || "Untitled Note",
        content: data.content || "",
        category: data.category || "General",
        createdAt: data.createdAt || new Date().toLocaleDateString(),
      });
    });
    return loadedNotes;
  } catch (err: any) {
    console.debug("Could not fetch notes from Firestore, using local store:", err?.message || err);
    return [];
  }
}

/**
 * Save or update note in Firestore for authenticated user
 */
export async function saveFirestoreNote(userId: string, note: Note): Promise<void> {
  try {
    if (!auth.currentUser || auth.currentUser.uid !== userId) return;
    const noteRef = doc(db, "users", userId, "notes", note.id);
    await setDoc(noteRef, {
      id: note.id,
      title: note.title,
      content: note.content,
      category: note.category,
      createdAt: note.createdAt,
      updatedAt: new Date().toISOString(),
    }, { merge: true });
  } catch (err: any) {
    console.debug("Could not save note to Firestore:", err?.message || err);
  }
}

/**
 * Delete note in Firestore for authenticated user
 */
export async function deleteFirestoreNote(userId: string, noteId: string): Promise<void> {
  try {
    if (!auth.currentUser || auth.currentUser.uid !== userId) return;
    const noteRef = doc(db, "users", userId, "notes", noteId);
    await deleteDoc(noteRef);
  } catch (err: any) {
    console.debug("Could not delete note from Firestore:", err?.message || err);
  }
}

/**
 * Fetch all chat sessions for an authenticated user from Firestore
 */
export async function fetchFirestoreChatSessions(userId: string): Promise<ChatSession[]> {
  try {
    if (!auth.currentUser || auth.currentUser.uid !== userId) return [];
    const sessionsColl = collection(db, "users", userId, "chatSessions");
    const snap = await getDocs(sessionsColl);
    const sessions: ChatSession[] = [];
    snap.forEach((d) => {
      const data = d.data();
      sessions.push({
        id: d.id,
        userId,
        title: data.title || "Apologetics Discussion",
        createdAt: data.createdAt || new Date().toISOString(),
        updatedAt: data.updatedAt || data.createdAt || new Date().toISOString(),
        messages: Array.isArray(data.messages) ? data.messages : [],
      });
    });
    // Sort reverse chronological by updatedAt
    sessions.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    return sessions;
  } catch (err: any) {
    console.debug("Could not fetch chat sessions from Firestore:", err?.message || err);
    return [];
  }
}

/**
 * Save or update a chat session in Firestore
 */
export async function saveFirestoreChatSession(userId: string, session: ChatSession): Promise<void> {
  try {
    if (!auth.currentUser || auth.currentUser.uid !== userId) return;
    const sessionRef = doc(db, "users", userId, "chatSessions", session.id);
    await setDoc(
      sessionRef,
      {
        id: session.id,
        userId,
        title: session.title,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt || new Date().toISOString(),
        messages: session.messages,
      },
      { merge: true }
    );
  } catch (err: any) {
    console.debug("Could not save chat session to Firestore:", err?.message || err);
  }
}

/**
 * Delete a chat session from Firestore
 */
export async function deleteFirestoreChatSession(userId: string, sessionId: string): Promise<void> {
  try {
    if (!auth.currentUser || auth.currentUser.uid !== userId) return;
    const sessionRef = doc(db, "users", userId, "chatSessions", sessionId);
    await deleteDoc(sessionRef);
  } catch (err: any) {
    console.debug("Could not delete chat session from Firestore:", err?.message || err);
  }
}

export { onAuthStateChanged };
export type { FirebaseUser };

