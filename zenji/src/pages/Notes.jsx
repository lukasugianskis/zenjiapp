import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

const NOTES_STORAGE_KEY = "knowji.notes.v1";
const COLORS = ["#FDE68A", "#FCA5A5", "#A7F3D0", "#BFDBFE", "#E9D5FF", "#FBCFE8", "#C7D2FE", "#FCD34D"];

const loadNotes = () => {
  try {
    const raw = localStorage.getItem(NOTES_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

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

const saveNotes = (notes) => {
  localStorage.setItem(NOTES_STORAGE_KEY, JSON.stringify(notes));
  window.dispatchEvent(new Event("knowji-notes-updated"));
};

export default function Notes() {
  const navigate = useNavigate();
  const { noteId } = useParams();
  const editorRef = useRef(null);
  const lastSyncedNoteIdRef = useRef(null);
  const [notes, setNotes] = useState(() => loadNotes());
  const [selectionToolbar, setSelectionToolbar] = useState({ visible: false, x: 0, y: 0 });

  const activeNote = useMemo(() => notes.find((n) => n.id === noteId) || null, [notes, noteId]);

  useEffect(() => {
    const onUpdate = () => setNotes(loadNotes());
    window.addEventListener("knowji-notes-updated", onUpdate);
    return () => window.removeEventListener("knowji-notes-updated", onUpdate);
  }, []);

  useEffect(() => {
    if (!activeNote) {
      navigate("/home", { replace: true });
      return;
    }

    if (editorRef.current && lastSyncedNoteIdRef.current !== activeNote.id) {
      editorRef.current.innerHTML = activeNote.content || "";
      lastSyncedNoteIdRef.current = activeNote.id;
    }
  }, [activeNote, navigate]);

  const updateNotes = (next) => {
    setNotes(next);
    saveNotes(next);
  };

  const updateActiveNote = (patch) => {
    if (!activeNote) return;
    const next = notes.map((note) => {
      if (note.id !== activeNote.id) return note;
      const nextPatch = { ...patch, updatedAt: Date.now() };
      if (typeof patch.title === "string") {
        nextPatch.title = makeUniqueTitle(patch.title, notes, activeNote.id);
      }
      return { ...note, ...nextPatch };
    });
    updateNotes(next);
  };

  const updateEditorContent = () => {
    if (!activeNote || !editorRef.current) return;
    updateActiveNote({ content: editorRef.current.innerHTML });
  };

  const normalizeSelectionPopup = () => {
    const editor = editorRef.current;
    const selection = window.getSelection();
    if (!editor || !selection || selection.rangeCount === 0) {
      setSelectionToolbar((prev) => ({ ...prev, visible: false }));
      return;
    }

    const range = selection.getRangeAt(0);
    const selectedText = selection.toString().trim();
    if (!selectedText || !editor.contains(range.commonAncestorContainer)) {
      setSelectionToolbar((prev) => ({ ...prev, visible: false }));
      return;
    }

    const rect = range.getBoundingClientRect();
    setSelectionToolbar({
      visible: true,
      x: Math.max(12, rect.left + rect.width / 2),
      y: Math.max(12, rect.top - 12),
    });
  };

  const applyFontSize = (sizePx) => {
    const editor = editorRef.current;
    if (!editor) return;

    editor.focus();
    document.execCommand("styleWithCSS", false, true);
    document.execCommand("fontSize", false, "7");

    const nodes = editor.querySelectorAll('font[size="7"]');
    nodes.forEach((node) => {
      const span = document.createElement("span");
      span.style.fontSize = `${sizePx}px`;
      span.innerHTML = node.innerHTML;
      node.replaceWith(span);
    });

    document.execCommand("styleWithCSS", false, false);
    updateEditorContent();
  };

  const exec = (command, value = null) => {
    document.execCommand(command, false, value);
    updateEditorContent();
    editorRef.current?.focus();
  };

  const deleteNote = (id) => {
    const next = notes.filter((note) => note.id !== id);
    updateNotes(next);
    navigate("/home");
  };

  if (!activeNote) return null;

  return (
    <div className="notes-page">
      <section className="notes-main notes-main--full">
        <article className="notes-doc">
          <header className="notes-doc__header">
            <div className="notes-doc__meta">
              <input
                className="notes-doc__title"
                value={activeNote.title}
                onChange={(e) => updateActiveNote({ title: e.target.value })}
                placeholder="Untitled note"
              />
              <input
                className="notes-doc__subject"
                value={activeNote.subject}
                onChange={(e) => updateActiveNote({ subject: e.target.value })}
                placeholder="Subject"
              />
            </div>
          </header>

          <div className="notes-toolbar">
            <button type="button" onClick={() => exec("bold")}>Bold</button>
            <button type="button" onClick={() => exec("italic")}>Italic</button>
            <button type="button" onClick={() => exec("underline")}>Underline</button>
            <button type="button" onClick={() => exec("insertUnorderedList")}>Bullet list</button>
            <button type="button" onClick={() => exec("formatBlock", "H2")}>Heading</button>
          </div>

          {selectionToolbar.visible && (
            <div
              className="notes-selection-toolbar"
              style={{ left: `${selectionToolbar.x}px`, top: `${selectionToolbar.y}px` }}
              onMouseDown={(e) => e.preventDefault()}
            >
              <button type="button" onClick={() => exec("bold")}>B</button>
              <button type="button" onClick={() => exec("italic")}>I</button>
              <button type="button" onClick={() => exec("underline")}>U</button>
              <button type="button" onClick={() => applyFontSize(14)}>14</button>
              <button type="button" onClick={() => applyFontSize(18)}>18</button>
              <button type="button" onClick={() => applyFontSize(24)}>24</button>
            </div>
          )}

          <div
            ref={editorRef}
            className="notes-editor"
            contentEditable
            suppressContentEditableWarning
            onInput={updateEditorContent}
            onBlur={updateEditorContent}
            onMouseUp={normalizeSelectionPopup}
            onKeyUp={normalizeSelectionPopup}
            onKeyDown={() => setSelectionToolbar((prev) => ({ ...prev, visible: false }))}
            role="textbox"
            aria-label="Note editor"
            spellCheck
          />
        </article>
      </section>
    </div>
  );
}
