import { useEffect, useMemo, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { auth, onAuthStateChanged, signOut, db, collection, query, orderBy, onSnapshot } from "../firebase";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faEllipsisVertical, faArrowRightFromBracket, faChevronRight } from "@fortawesome/free-solid-svg-icons";

const NOTES_STORAGE_KEY = "knowji.notes.v1";
const COLORS = ["#FDE68A", "#FCA5A5", "#A7F3D0", "#BFDBFE", "#E9D5FF", "#FBCFE8", "#C7D2FE", "#FCD34D"];

const emptyDraft = () => ({
  title: "Untitled note",
  subject: "General",
  color: COLORS[0],
});

const makeUniqueTitle = (desiredTitle, notes, ignoreId = null) => {
  const baseTitle = (desiredTitle || "Untitled note").trim() || "Untitled note";
  const existing = new Set(
    notes
      .filter((note) => note.id !== ignoreId)
      .map((note) => (note.title || "").trim())
      .filter(Boolean),
  );

  if (!existing.has(baseTitle)) return baseTitle;

  let suffix = 1;
  while (existing.has(`${baseTitle} (${suffix})`)) {
    suffix += 1;
  }
  return `${baseTitle} (${suffix})`;
};

const loadNotes = () => {
  try {
    const raw = localStorage.getItem(NOTES_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

export default function Sidebar() {
  const [packs, setPacks] = useState([]);
  // useNavigate is already declared above, do not redeclare

  // Load packs from Firestore if signed in, otherwise from localStorage
  useEffect(() => {
    let unsubSnap = null;
    const unsubAuth = onAuthStateChanged(auth, (u) => {
      if (u) {
        // Firestore
        const packsCol = collection(db, "users", u.uid, "packs");
        const q = query(packsCol, orderBy("createdAt", "desc"));
        unsubSnap = onSnapshot(q, (snap) => {
          const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
          setPacks(items);
        });
      } else {
        // LocalStorage fallback
        try {
          const raw = localStorage.getItem("zenji:packs");
          if (raw) {
            const saved = JSON.parse(raw);
            if (Array.isArray(saved)) {
              setPacks(saved);
            }
          }
        } catch {}
      }
    });
    return () => {
      if (unsubSnap) unsubSnap();
      if (unsubAuth) unsubAuth();
    };
  }, []);
  const navigate = useNavigate();
  const location = useLocation();
  const [notes, setNotes] = useState(() => loadNotes());
  const [user, setUser] = useState(null);
  const [notesOpen, setNotesOpen] = useState(true);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [draft, setDraft] = useState(() => emptyDraft());

  useEffect(() => {
    const onUpdate = () => setNotes(loadNotes());
    window.addEventListener("knowji-notes-updated", onUpdate);
    return () => window.removeEventListener("knowji-notes-updated", onUpdate);
  }, []);

  useEffect(() => {
    const un = onAuthStateChanged(auth, (u) => {
      setUser(u);
    });
    return () => un();
  }, []);

  const orderedNotes = useMemo(
    () => notes.slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)),
    [notes],
  );
  const activeNoteId = location.pathname.startsWith("/notes/") ? location.pathname.split("/")[2] : null;

  const saveNotes = (next) => {
    setNotes(next);
    localStorage.setItem(NOTES_STORAGE_KEY, JSON.stringify(next));
    window.dispatchEvent(new Event("knowji-notes-updated"));
  };

  const createNote = () => {
    const next = {
      id: crypto.randomUUID(),
      title: makeUniqueTitle(draft.title, notes),
      subject: draft.subject.trim() || "General",
      color: draft.color,
      content: "",
      collapsed: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const updated = [next, ...notes];
    saveNotes(updated);
    setDraft(emptyDraft());
    setIsCreateOpen(false);
    navigate(`/notes/${next.id}`);
  };

  const deleteNote = (id) => {
    const next = notes.filter((note) => note.id !== id);
    saveNotes(next);
    navigate("/home");
  };

  const rawName = user ? (user.displayName || user.email) : null;
  const shortName = rawName ? (rawName.length > 5 ? rawName.slice(0, 11) + ".." : rawName) : null;

  return (
    <aside className="sidebar">
      <h1 className="logo">
        
        <img src="/knowji.png" alt="Knowji" style={{ objectFit: "contain" }} width="170" height="auto" />
        
      </h1>
      <nav className="nav">
        <NavLink to="/home" className={({isActive}) => `nav-link ${isActive ? 'is-active' : ''}`}>
          <span className="nav-link__icon"><img src="/house.png" alt="" width="17" height="17" /></span>
          <span className="nav-link__text">Home</span>
        </NavLink>

        <NavLink to="/progress" className={({isActive}) => `nav-link ${isActive ? 'is-active' : ''}`}>
          <span className="nav-link__icon"><img src="/streak.png" alt="" width="17" height="17" /></span>
          <span className="nav-link__text">Statistics</span>

        </NavLink>

        <div className="sidebar__divider"><span>Resources</span><hr /></div>

        <NavLink to="/packs" className={({isActive}) => `nav-link ${isActive ? 'is-active' : ''}`}> 
          <span className="nav-link__icon"><img src="/pack.png" alt="" width="17" height="17" /></span>
          <span className="nav-link__text">Personal Library</span>
        </NavLink>

        <NavLink to="/community-packs" className={({isActive}) => `nav-link ${isActive ? 'is-active' : ''}`}>
          <span className="nav-link__icon"><img src="/globe.png" alt="" style={{ scale: "0.94" }} width="15" height="15" /></span>
          <span className="nav-link__text">Community</span>
          <span className="nav-badge">Free</span>
        </NavLink>

         <NavLink to="/resources" className={({isActive}) => `nav-link ${isActive ? 'is-active' : ''}`}>
          <span className="nav-link__icon"><img src="/magnifying.png" alt="" width="17" height="17" /></span>
          <span className="nav-link__text">Resources</span>
          <span className="nav-badge nav-badge--new">Plus</span>
        </NavLink>

        <div className="sidebar__divider"><span>Top Packs</span><hr /></div>

        <div className="sidebar-top-packs-list">
          {(packs.length > 0
            ? packs.slice(0, 5)
            : [
                { name: "No packs yet", color: "#e5e7eb", id: "placeholder" }
              ]
          ).map((pack) => (
            <div
              className="sidebar-top-pack-row"
              key={pack.id || pack.name}
              style={{ cursor: pack.id ? "pointer" : "default", opacity: pack.id ? 1 : 0.6 }}
              onClick={() => pack.id && navigate(`/packs/${pack.id}`)}
            >
              <span className="sidebar-top-pack-dot" style={{ backgroundColor: pack.color || "#e5e7eb" }} />
              <span className="sidebar-top-pack-name">{pack.name.length > 14 ? pack.name.slice(0, 14) + '..' : pack.name}</span>
              {pack.id && <span className="sidebar-top-pack-arrow"><FontAwesomeIcon icon={faChevronRight} /></span>}
            </div>
          ))}
        </div>

      </nav>

      {isCreateOpen && (
        <div className="notes-modal-backdrop" onClick={() => setIsCreateOpen(false)}>
          <div className="notes-modal notes-modal--sidebar" onClick={(e) => e.stopPropagation()}>
            <h3>Create new note</h3>
            <label>
              Name
              <input
                value={draft.title}
                onChange={(e) => setDraft((prev) => ({ ...prev, title: e.target.value }))}
                placeholder="e.g. Biology Chapter 4"
              />
            </label>
            <label>
              Subject
              <input
                value={draft.subject}
                onChange={(e) => setDraft((prev) => ({ ...prev, subject: e.target.value }))}
                placeholder="e.g. Biology"
              />
            </label>
            <label>
              Color
              <div className="notes-color-row">
                {COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    className={`notes-color ${draft.color === color ? "is-selected" : ""}`}
                    style={{ background: color }}
                    onClick={() => setDraft((prev) => ({ ...prev, color }))}
                    aria-label={`Set draft color ${color}`}
                  />
                ))}
              </div>
            </label>
            <div className="notes-modal__actions">
              <button type="button" onClick={() => setIsCreateOpen(false)}>Cancel</button>
              <button type="button" onClick={createNote}>Create</button>
            </div>
          </div>
        </div>
      )}

       <NavLink to="/profile" className={({isActive}) => `nav-link ${isActive ? 'is-active' : ''}`}>
          <span className="nav-link__icon"><img src="/profile.png" alt="" width="17" height="17" /></span>
        <div className="nav-link__text">{shortName || 'Profile'}</div>
        <div style={{marginLeft:'auto'}}>
          {user ? <button onClick={() => signOut(auth)} style={{border:'none',background:'transparent',cursor:'pointer', fontSize:'1.2rem', color:'#696969ff'}}><FontAwesomeIcon icon={faArrowRightFromBracket} /></button> : null}
        </div>
      </NavLink>
    </aside>
  );
}