import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import Sidebar from "./components/Sidebar.jsx";
import TopBar from "./components/TopBar.jsx";
import { useEffect, useState } from "react";
import Home from "./pages/Home.jsx";
import Chat from "./pages/Chat.jsx";
import Packs from "./pages/Packs.jsx";
import PackDetail from "./pages/PackDetail.jsx";
import Flashcard from "./pages/Flashcard.jsx";
import Quiz from "./pages/Quiz.jsx";
import Login from "./pages/Login.jsx";
import Profile from "./pages/Profile.jsx";
import Progress from "./pages/Progress.jsx";
import Resources from "./pages/Resources.jsx";
import CommunityPacks from "./pages/CommunityPacks.jsx";
import Flashcards from "./pages/Flashcards.jsx";
import Notes from "./pages/Notes.jsx";
import "./App.css";
import { TOAST_EVENT } from "./utils/toast.js";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCheck } from "@fortawesome/free-solid-svg-icons";
import { auth, onAuthStateChanged, db, doc, setDoc, serverTimestamp, getDoc } from "./firebase";

import MobileSidebar from "./components/MobileSidebar.jsx";
export default function App() {
  const { pathname } = useLocation();
  const hideTopBarOn = new Set([]);
  const isPackDetailPage = pathname.startsWith("/packs/") && pathname !== "/packs";
  const showTopBar = !hideTopBarOn.has(pathname) && !isPackDetailPage;

  const [showMobileNav, setShowMobileNav] = useState(() => typeof window !== "undefined" && window.innerWidth <= 1024);
  const [toasts, setToasts] = useState([]);
  const [currentUser, setCurrentUser] = useState(null);
  const visibleToasts = [...toasts].reverse();

  const formatDateKey = (date) => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  };

  const getWebsiteMsStorageKey = (uid, dateKey) => `zenji.websiteMs.${uid}.${dateKey}`;

  const readWebsiteMs = (uid, dateKey) => {
    if (!uid || typeof window === "undefined") return 0;
    const raw = window.localStorage.getItem(getWebsiteMsStorageKey(uid, dateKey));
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  };

  const writeWebsiteMs = (uid, dateKey, ms) => {
    if (!uid || typeof window === "undefined") return;
    window.localStorage.setItem(getWebsiteMsStorageKey(uid, dateKey), String(Math.max(0, Math.floor(ms))));
  };

  useEffect(() => {
    function onResize() {
      setShowMobileNav(window.innerWidth <= 1024);
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setCurrentUser(u));
    return () => unsub && unsub();
  }, []);

  // Ensure the current user's Firestore doc has a `Username` field.
  useEffect(() => {
    if (!currentUser?.uid) return;

    const ensureUsername = async () => {
      try {
        const userRef = doc(db, "users", currentUser.uid);
        const snap = await getDoc(userRef);
        const data = snap.exists() ? snap.data() : {};
        if (!data || !data.Username) {
          // derive from auth email if available, else fallback to uid prefix
          const candidate = (currentUser.email && String(currentUser.email).split("@")[0]) || currentUser.uid.slice(0, 8);
          await setDoc(userRef, { Username: candidate }, { merge: true });
        }
      } catch (err) {
        console.error("Failed to ensure Username on user doc:", err);
      }
    };

    ensureUsername();
  }, [currentUser?.uid]);

  useEffect(() => {
    if (!currentUser?.uid || typeof document === "undefined" || typeof window === "undefined") return;

    const uid = currentUser.uid;
    let activeDateKey = formatDateKey(new Date());
    let totalMs = readWebsiteMs(uid, activeDateKey);
    let lastActiveTs = document.visibilityState === "visible" ? Date.now() : null;
    let lastPersistAt = 0;

    const persistWebsiteTime = async () => {
      const minutes = Math.round((Math.max(0, totalMs) / 60000) * 10) / 10;
      try {
        await setDoc(
          doc(db, "users", uid),
          {
            websiteTimeByDate: {
              [activeDateKey]: Math.max(0, Math.floor(totalMs)),
            },
            progressSummary: {
              todayKey: activeDateKey,
              timeMinutesToday: minutes,
              updatedAt: serverTimestamp(),
            },
          },
          { merge: true }
        );
      } catch (err) {
        console.error("Error persisting website time:", err);
      }
    };

    const tick = () => {
      const now = Date.now();
      const nowDateKey = formatDateKey(new Date(now));

      if (nowDateKey !== activeDateKey) {
        writeWebsiteMs(uid, activeDateKey, totalMs);
        activeDateKey = nowDateKey;
        totalMs = readWebsiteMs(uid, activeDateKey);
        lastActiveTs = document.visibilityState === "visible" ? now : null;
      }

      if (document.visibilityState !== "visible") return;
      if (lastActiveTs === null) {
        lastActiveTs = now;
        return;
      }

      const delta = Math.max(0, now - lastActiveTs);
      totalMs += delta;
      lastActiveTs = now;
      writeWebsiteMs(uid, activeDateKey, totalMs);

      if (now - lastPersistAt >= 30000) {
        lastPersistAt = now;
        persistWebsiteTime();
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        lastActiveTs = Date.now();
      } else {
        lastActiveTs = null;
        writeWebsiteMs(uid, activeDateKey, totalMs);
        persistWebsiteTime();
      }
    };

    const onBeforeUnload = () => {
      writeWebsiteMs(uid, activeDateKey, totalMs);
    };

    const intervalId = window.setInterval(tick, 1000);
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("beforeunload", onBeforeUnload);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("beforeunload", onBeforeUnload);
      writeWebsiteMs(uid, activeDateKey, totalMs);
      persistWebsiteTime();
    };
  }, [currentUser?.uid]);

  useEffect(() => {
    if (typeof document === "undefined") return;

    const html = document.documentElement;
    const body = document.body;

    html.style.overflowY = "auto";
    html.style.overflowX = "hidden";
    html.style.height = "auto";
    html.style.position = "static";

    body.style.overflowY = "auto";
    body.style.overflowX = "hidden";
    body.style.height = "auto";
    body.style.position = "static";

    return () => {
      html.style.overflowY = "";
      html.style.overflowX = "";
      html.style.height = "";
      html.style.position = "";
      body.style.overflowY = "";
      body.style.overflowX = "";
      body.style.height = "";
      body.style.position = "";
    };
  }, [pathname]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleToast = (event) => {
      const detail = event?.detail || {};
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const toast = {
        id,
        message: detail.message || "Done",
        type: detail.type || "success",
        leaving: false,
      };

      setToasts((prev) => [...prev, toast].slice(-3));

      window.setTimeout(() => {
        setToasts((prev) => prev.map((item) => (item.id === id ? { ...item, leaving: true } : item)));

        window.setTimeout(() => {
          setToasts((prev) => prev.filter((item) => item.id !== id));
        }, 220);
      }, 2300);
    };

    window.addEventListener(TOAST_EVENT, handleToast);
    return () => window.removeEventListener(TOAST_EVENT, handleToast);
  }, []);

  return (
    <div className={`app ${isPackDetailPage ? "is-pack-detail" : ""}`}>
      <Sidebar />
      <main className={`content ${isPackDetailPage ? "content--pack-detail" : ""}`}>
        {showTopBar && <TopBar />}
        <Routes>
          <Route path="/" element={<Navigate to="/home" replace />} />
          <Route path="/home" element={<Home />} />
          <Route path="/login" element={<Login />} />
          <Route path="/packs" element={<Packs />} />
          <Route path="/packs/:packId" element={<PackDetail />} />
          <Route path="/packs/:uid/:packId" element={<PackDetail />} />
          <Route path="/flashcard/:uid/:packId" element={<Flashcard />} />
          <Route path="/quiz/:uid/:packId" element={<Quiz />} />
          <Route path="/chat" element={<Chat />} />
          <Route path="/notes" element={<Navigate to="/home" replace />} />
          <Route path="/notes/:noteId" element={<Notes />} />
          <Route path="/flashcards" element={<Flashcards />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/progress" element={<Progress />} />
          <Route path="/resources" element={<Resources />} />
          <Route path="/community-packs" element={<CommunityPacks />} />
          <Route path="*" element={<Navigate to="/home" replace />} />
        </Routes>
      </main>
      {showMobileNav && <MobileSidebar />}
      {!showMobileNav && (
        <div className="toast-stack" aria-live="polite" aria-atomic="true">
          {visibleToasts.map((toast, index) => (
            <div
              key={toast.id}
              className={`toast toast--${toast.type} ${toast.leaving ? "is-leaving" : ""}`}
              style={{ "--toast-index": index }}
            >
              <span className="toast__dot" aria-hidden="true">
                <FontAwesomeIcon icon={faCheck} />
              </span>
              <span className="toast__message">{toast.message}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}