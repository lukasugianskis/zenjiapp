import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faArrowLeft, faMagnifyingGlass, faPlus, faArrowUpFromBracket, faEllipsisVertical, faBook, faArrowDownAZ, faBullseye } from "@fortawesome/free-solid-svg-icons";
import { createPortal } from "react-dom";
import { auth, db, onAuthStateChanged, doc, getDoc, getDocs, collection, addDoc, updateDoc, deleteDoc, serverTimestamp, runTransaction } from "../firebase";

import { showToast } from "../utils/toast.js";

// Utility: format a timestamp as relative time (e.g., '2m ago', '1h ago')
function timeAgo(date) {
  if (!date) return '';
  let d = date;
  if (typeof d === 'object' && typeof d.toDate === 'function') d = d.toDate();
  if (typeof d === 'string' || typeof d === 'number') d = new Date(d);
  const now = new Date();
  const diff = Math.floor((now - d) / 1000);
  if (isNaN(diff)) return '';
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return d.toLocaleDateString();
}

export default function PackDetail() {
  const { packId, uid } = useParams();
  const navigate = useNavigate();
  const [pack, setPack] = useState(null);
  const [cards, setCards] = useState([]);
  const [cardLoadError, setCardLoadError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [showCardModal, setShowCardModal] = useState(false);
  const [editingCard, setEditingCard] = useState(null);
  const [cardForm, setCardForm] = useState({ front: "", back: "" });
  const [savingCard, setSavingCard] = useState(false);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editedTitle, setEditedTitle] = useState("");
  const [savingTitle, setSavingTitle] = useState(false);
  const [showAddOptions, setShowAddOptions] = useState(false);
  const [showAIModal, setShowAIModal] = useState(false);
  const [aiNotes, setAiNotes] = useState("");
  const [generatedCards, setGeneratedCards] = useState([]);
  const [aiGenerating, setAiGenerating] = useState(false);
  const [showFlashPackOptions, setShowFlashPackOptions] = useState(false);
  const countedViewRef = useRef(null);

  const MISTRAL_API_KEY = "Me5iM5ruiQSY65DVRE5xwpqofVmU6Nkg";
  const MISTRAL_API_URL = "https://api.mistral.ai/v1/chat/completions";

  const ownerUid = uid || currentUser?.uid || null;
  const canEdit = !!currentUser && (!!uid ? currentUser.uid === uid : true);
  const isEmptyPack = !loading && !!pack && cards.length === 0 && !cardLoadError;

  useEffect(() => {
    const unsubAuth = onAuthStateChanged(auth, (u) => {
      setCurrentUser(u);
      setAuthReady(true);
    });

    return () => unsubAuth && unsubAuth();
  }, []);

  useEffect(() => {
    if (!authReady && !uid) return;

    setLoading(true);
    setPack(null);
    setCards([]);

    let isActive = true;

    const loadPackAndCards = async (packOwnerUid) => {
      if (!packOwnerUid) {
        if (isActive) setLoading(false);
        return;
      }

      try {
        const packRef = doc(db, "users", packOwnerUid, "packs", packId);
        const snap = await getDoc(packRef);

        if (!snap.exists()) {
          if (isActive) setLoading(false);
          return;
        }

        if (!isActive) return;
        setPack({ id: snap.id, ...snap.data() });

        const viewKey = `${packOwnerUid}-${packId}`;
        if (countedViewRef.current !== viewKey) {
          countedViewRef.current = viewKey;
          try {
            const viewsCol = collection(db, "users", packOwnerUid, "packs", packId, "views");
            await addDoc(viewsCol, {
              viewerUid: currentUser?.uid || null,
              createdAt: serverTimestamp(),
            });
            
            // Increment views counter directly on the pack using a transaction
            const packRef = doc(db, "users", packOwnerUid, "packs", packId);
            await runTransaction(db, async (transaction) => {
              const packSnap = await transaction.get(packRef);
              if (packSnap.exists()) {
                const currentViews = packSnap.data()?.views || 0;
                transaction.update(packRef, {
                  views: currentViews + 1,
                });
              }
            });
          } catch (err) {
            // ignore view tracking failures
          }
        }

        // Always fetch cards for the pack so community packs are viewable by others.
        const cardsCol = collection(db, "users", packOwnerUid, "packs", packId, "cards");
        try {
          const cardsSnap = await getDocs(cardsCol);
          const items = cardsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
          setCards(items);
          setCardLoadError(null);
        } catch (err) {
          console.error("Error loading cards:", err);
          setCards([]);
          setCardLoadError(err?.code || err?.message || "failed_to_load_cards");
        }

        // Only update the pack's stored card count when the owner is viewing (to avoid permission errors).
        if (currentUser && currentUser.uid === packOwnerUid) {
          try {
            await updateDoc(packRef, { cards: items.length });
          } catch (err) {
            // ignore count sync errors
          }
        }

        if (isActive) setLoading(false);
      } catch (err) {
        if (isActive) setLoading(false);
      }
    };

    loadPackAndCards(ownerUid);

    return () => {
      isActive = false;
    };
  }, [packId, uid, authReady, ownerUid, currentUser]);

  // Keep normal page scrolling enabled.

  const openNewCardModal = () => {
    if (!canEdit) return;
    setEditingCard(null);
    setCardForm({ front: "", back: "" });
    setShowAddOptions(true);
  };

  const handleTitleClick = () => {
    if (!canEdit) return;
    setIsEditingTitle(true);
    setEditedTitle(pack.name);
  };

  const handleSaveTitle = async () => {
    const trimmedTitle = String(editedTitle || "").trim().slice(0, 20);
    if (!trimmedTitle || !canEdit || !ownerUid) {
      setIsEditingTitle(false);
      return;
    }

    if (trimmedTitle === pack.name) {
      setIsEditingTitle(false);
      return;
    }

    setSavingTitle(true);
    try {
      const packRef = doc(db, "users", ownerUid, "packs", packId);
      await updateDoc(packRef, { name: trimmedTitle });
      setPack((prev) => ({ ...prev, name: trimmedTitle }));
      setIsEditingTitle(false);
    } catch (err) {
      console.error("Error updating pack name:", err);
    } finally {
      setSavingTitle(false);
    }
  };

  const handleCancelTitleEdit = () => {
    setIsEditingTitle(false);
    setEditedTitle("");
  };

  const handleTitleKeyDown = (e) => {
    if (e.key === "Enter") {
      handleSaveTitle();
    } else if (e.key === "Escape") {
      handleCancelTitleEdit();
    }
  };

  const generateCardsFromNotes = async () => {
    if (!aiNotes.trim() || !canEdit || !ownerUid) return;

    setAiGenerating(true);
    try {
      const prompt = `You are a study card generator. Based on the following notes, generate up to 10 flashcard pairs. Return ONLY a JSON array with no additional text or markdown. Each card should have "front" and "back" fields. The front should be a concise, short question or prompt, and the back should be a clear, complete, short answer.

Notes:
${aiNotes}

Return ONLY valid JSON like this format:
[{"front": "Question 1?", "back": "Answer 1"}, {"front": "Question 2?", "back": "Answer 2"}]`;

      const response = await fetch(MISTRAL_API_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${MISTRAL_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "pixtral-large-latest",
          messages: [{ role: "user", content: prompt }],
          max_tokens: 2048,
          temperature: 0.5,
        }),
      });

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }

      const data = await response.json();
      const responseText = data.choices?.[0]?.message?.content || "";

      // Parse JSON from response
      const jsonMatch = responseText.match(/\[[\s\S]*\]/);
      const cards = jsonMatch ? JSON.parse(jsonMatch[0]) : [];

      // Limit to 10 cards
      const limitedCards = cards.slice(0, 10).map((card) => ({
        front: card.front || "",
        back: card.back || "",
      }));

      setGeneratedCards(limitedCards);
    } catch (error) {
      console.error("Error generating cards:", error);
      setGeneratedCards([]);
    } finally {
      setAiGenerating(false);
    }
  };

  const handleImportGeneratedCards = async () => {
    if (generatedCards.length === 0 || !canEdit || !ownerUid) return;

    try {
      const cardsCol = collection(db, "users", ownerUid, "packs", packId, "cards");
      const packRef = doc(db, "users", ownerUid, "packs", packId);
      for (const card of generatedCards) {
        const newCardRef = await addDoc(cardsCol, {
          front: card.front,
          back: card.back,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });

        setCards((prev) => [
          ...prev,
          {
            id: newCardRef.id,
            front: card.front,
            back: card.back,
          },
        ]);

        setPack((prev) =>
          prev
            ? {
                ...prev,
                cards: Number(prev.cards || 0) + 1,
              }
            : prev,
        );
      }

      await updateDoc(packRef, {
        cards: Math.max(0, Number(pack?.cards || 0) + generatedCards.length),
        updatedAt: serverTimestamp(),
      });

      showToast("Cards added successfully.");

      setGeneratedCards([]);
      setAiNotes("");
      setShowAIModal(false);
    } catch (err) {
      console.error("Error importing cards:", err);
    }
  };

  const closeAIModal = () => {
    setShowAIModal(false);
    setAiNotes("");
    setGeneratedCards([]);
    setShowAddOptions(false);
  };

  const handleFlashPackClick = () => {
    setShowFlashPackOptions(true);
  };

  const handleFlashcardMode = () => {
    navigate(`/flashcard/${ownerUid}/${packId}`);
  };

  const handleQuizMode = () => {
    navigate(`/quiz/${ownerUid}/${packId}`);
  };

  const closeFlashPackModal = () => {
    setShowFlashPackOptions(false);
  };

  const openEditCardModal = (card) => {
    if (!canEdit) return;
    setEditingCard(card);
    setCardForm({
      front: card.front ?? card.question ?? "",
      back: card.back ?? card.answer ?? "",
    });
    setShowCardModal(true);
  };

  const closeCardModal = () => {
    setShowCardModal(false);
    setEditingCard(null);
    setCardForm({ front: "", back: "" });
  };

  const handleSaveCard = async (e) => {
    e.preventDefault();
    if (!canEdit || !ownerUid) return;

    const front = cardForm.front.trim();
    const back = cardForm.back.trim();
    if (!front || !back) return;

    setSavingCard(true);

    try {
      const cardsCol = collection(db, "users", ownerUid, "packs", packId, "cards");
      const packRef = doc(db, "users", ownerUid, "packs", packId);

      if (editingCard) {
        await updateDoc(doc(cardsCol, editingCard.id), {
          front,
          back,
          updatedAt: serverTimestamp(),
        });
        setCards((prev) =>
          prev.map((card) =>
            card.id === editingCard.id
              ? { ...card, front, back }
              : card,
          ),
        );
          showToast("Card updated successfully.");
      } else {
        const newCardRef = await addDoc(cardsCol, {
          front,
          back,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });

        setCards((prev) => [
          {
            id: newCardRef.id,
            front,
            back,
          },
          ...prev,
        ]);
        setPack((prev) =>
          prev
            ? {
                ...prev,
                cards: Number(prev.cards || 0) + 1,
              }
            : prev,
        );

        showToast("Card created successfully.");

        await updateDoc(packRef, {
          cards: Math.max(0, Number(pack?.cards || 0) + 1),
          updatedAt: serverTimestamp(),
        });
      }

      closeCardModal();
    } catch (err) {
      console.error("Error saving card:", err);
    } finally {
      setSavingCard(false);
    }
  };

  const handleDeleteCard = async () => {
    if (!canEdit || !ownerUid || !editingCard) return;

    setSavingCard(true);
    try {
      const packRef = doc(db, "users", ownerUid, "packs", packId);
      await deleteDoc(doc(db, "users", ownerUid, "packs", packId, "cards", editingCard.id));
      setCards((prev) => prev.filter((card) => card.id !== editingCard.id));
      setPack((prev) =>
        prev
          ? {
              ...prev,
              cards: Math.max(0, Number(prev.cards || 0) - 1),
            }
          : prev,
      );

      await updateDoc(packRef, {
        cards: Math.max(0, Number(pack?.cards || 0) - 1),
        updatedAt: serverTimestamp(),
      });

      closeCardModal();
    } catch (err) {
      console.error("Error deleting card:", err);
    } finally {
      setSavingCard(false);
    }
  };

  if (loading) {
    return (
      <section className="packs-page">
        <div className="spinner">
          <div className="spinner__circle"></div>
        </div>
      </section>
    );
  }

  if (!pack) {
    return (
      <section className="packs-page">
        <div className="packs-page__container">
          <button className="packs-modal__button packs-modal__button--secondary" onClick={() => navigate(-1)}>
            Back
          </button>
          <h2 className="packs-page__title">Pack not found</h2>
          <p>Could not find the requested pack.</p>
        </div>
      </section>
    );
  }

  const cardsCount = cards.length > 0 ? cards.length : Number(pack.cards || 0);

  return (
    <section className={`pack-detail-page ${isEmptyPack ? "is-empty" : ""}`}>
      <div className="pack-detail-shell">
        <div className="pack-detail-header-modern">
          <div className="pack-detail-header-row">
            
            <div className="pack-detail-actions">
              <button className="pack-detail-back" type="button" onClick={() => navigate(-1)} aria-label="Go back">
                <FontAwesomeIcon icon={faArrowLeft} style={{ fontSize: 20 }} />
              </button>
              <div className="pack-detail-actions-new">
                <button className="pack-detail-icon pack-detail-icon--search" type="button" aria-label="Search">
                  <FontAwesomeIcon icon={faMagnifyingGlass} style={{ fontSize: 16 }} />
                </button>
                <button className="pack-detail-icon pack-detail-icon--share" type="button" aria-label="Share">
                  <FontAwesomeIcon icon={faArrowUpFromBracket} style={{ fontSize: 16 }} />
                </button>
                <button className="pack-detail-icon pack-detail-icon--more" type="button" aria-label="More">
                  <FontAwesomeIcon icon={faEllipsisVertical} style={{ fontSize: 16 }} />
                </button>
              </div>
            </div>
          </div>
          
          <div className="pack-detail-header-content">
            <div className="pack-detail-header-title-row" style={{ marginBottom: 15 }}>
              <span className="pack-detail-brand__color" style={{ background: pack.color, display: 'inline-block', width: 22, height: 22, borderRadius: '8px', marginRight: 10, verticalAlign: 'middle' }} />
              {isEditingTitle ? (
                <input
                  type="text"
                  className="pack-detail-brand__input"
                  value={editedTitle}
                  onChange={(e) => setEditedTitle(String(e.target.value).slice(0, 20))}
                  onInput={(e) => {
                    const v = String(e.currentTarget.value).slice(0, 20);
                    if (v !== e.currentTarget.value) e.currentTarget.value = v;
                    setEditedTitle(v);
                  }}
                  onPaste={(e) => {
                    const pasted = (e.clipboardData || window.clipboardData).getData('text') || '';
                    const clamped = (editedTitle + pasted).slice(0, 20);
                    if (clamped.length < (editedTitle + pasted).length) e.preventDefault();
                    setEditedTitle(clamped);
                  }}
                  onBlur={handleSaveTitle}
                  onKeyDown={handleTitleKeyDown}
                  autoFocus
                  disabled={savingTitle}
                />
              ) : (
                <h1 
                  className={`pack-detail-brand__title ${canEdit ? "is-editable" : ""}`}
                  onClick={handleTitleClick}
                  style={{ display: 'inline-block', verticalAlign: 'middle' }}
                >
                  {pack.name}
                </h1>
              )}
            </div>
            <div className="pack-detail-header-desc-row">
              <span className="pack-detail-header-desc">{pack.description || "No description available"}</span>
            </div>
            <div className="pack-detail-header-stats-row">
              <span className="pack-detail-header-stat"><FontAwesomeIcon icon={faBullseye} style={{ marginRight: 4, opacity: 0.7 }} /> {cards.filter(card => !card.learned).length}/{cards.length} open to learn</span>
              <span className="pack-detail-header-stat"><FontAwesomeIcon icon={faMagnifyingGlass} style={{ marginRight: 4, opacity: 0.7 }} /> Last: {pack.updatedAt ? timeAgo(pack.updatedAt) : '0m ago'}</span>
            </div>
            <div className="pack-detail-header-progress-bar" style={{ width: '100%', height: '15px', background: '#f3f3f3ff', borderRadius: '6px', margin: '25px 0 0 0', marginBottom: '25px', overflow: 'hidden' }}>
              <div
                className="pack-detail-header-progress-bar-inner"
                style={{
                boxShadow: "inset 0 4px 10px #efefef55",
                  width: '50%',
                  height: '100%',
                  backgroundColor: pack.color || '#2563eb',
                  borderRadius: '6px',
                  transition: 'width 0.4s cubic-bezier(.4,1.3,.6,1)',
                }}
              />
            </div>
            <div className="pack-detail-header-progress-row">
              <div className="pack-detail-header-progress-bar">
                <div className="pack-detail-header-progress-bar-inner" style={{ width: `${cards.length ? Math.round(((cards.length - cards.filter(card => !card.learned).length) / cards.length) * 100) : 0}%`, background: pack.color }} />
              </div>
            </div>
          </div>
        </div>

        <nav className="pack-detail-tabs" aria-label="Pack sections">
        </nav>

        <div className="pack-detail-content">
          <div className="pack-detail-section-header">
            <h2>Cards ({cardsCount})</h2>
            <button className="pack-detail-sort" type="button" aria-label="Sort cards">
              <FontAwesomeIcon icon={faArrowDownAZ} />
            </button>
          </div>
          {/* Search bar under section header */}
          <div className="pack-detail-search-bar" style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '12px 0 18px 0', maxWidth: 400 }}>
            <span style={{ color: '#64748b', fontSize: 18, marginRight: 6 }}>
              <FontAwesomeIcon icon={faMagnifyingGlass} />
            </span>
            <input
              type="text"
              className="pack-detail-search-input"
              placeholder="Search cards..."
              style={{
                flex: 1,
                border: '1.5px solid #e5e7eb',
                borderRadius: 16,
                padding: '10px 14px',
                fontSize: 16,
                outline: 'none',
                background: '#fff',
                color: '#111827',
                boxShadow: '0 1px 4px rgba(68, 77, 94, 0.04)',
                fontFamily: 'Sora, sans-serif',
                transition: 'border-color 0.2s',
              }}
              // onChange={...} // Add search logic if needed
            />
          </div>

          <div className="pack-detail-card-list">
            {cardLoadError ? (
              <div className="pack-detail-empty">
                <p>Unable to load cards ({cardLoadError}). This pack may be restricted — try signing in or contact the owner.</p>
              </div>
            ) : cards.length > 0 ? (
              cards.map((card, idx) => (
                <article
                  key={card.id}
                  className={`pack-detail-card${canEdit ? " is-editable" : ""} pack-detail-card-animate`}
                  style={{
                    animationDelay: `${idx * 80}ms`,
                  }}
                >
                  <div className="pack-detail-card__question">{card.front ?? card.question ?? "Untitled card"}</div>
                  <div className="pack-detail-card__divider" />
                  <div className="pack-detail-card__answer">{card.back ?? card.answer ?? ""}</div>
                  {canEdit && (
                    <button className="pack-detail-card__menu" type="button" aria-label="Edit card" onClick={() => openEditCardModal(card)}>
                      <FontAwesomeIcon icon={faEllipsisVertical} />
                    </button>
                  )}
                </article>
              ))
            ) : (
              <div className="pack-detail-empty">
                {canEdit && (
                  <button type="button" className="pack-detail-action pack-detail-action--primary" onClick={openNewCardModal}>
                    <FontAwesomeIcon icon={faPlus} />
                    <span>Add first card</span>
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {showCardModal && createPortal(
        <div className="packs-modal-backdrop" onClick={closeCardModal}>
          <div className="packs-modal" onClick={(e) => e.stopPropagation()}>
            <h2 className="packs-modal__title">{editingCard ? "Edit Card" : "Add Card"}</h2>

            <form onSubmit={handleSaveCard}>
              <div className="packs-modal__field">
                <label htmlFor="card-front">Question</label>
                <textarea
                  id="card-front"
                  value={cardForm.front}
                  onChange={(e) => setCardForm((prev) => ({ ...prev, front: e.target.value }))}
                  placeholder="Enter the front of the card"
                  rows={3}
                  style={{ width: "100%", resize: "vertical" }}
                />
              </div>

              <div className="packs-modal__field">
                <label htmlFor="card-back">Answer</label>
                <textarea
                  id="card-back"
                  value={cardForm.back}
                  onChange={(e) => setCardForm((prev) => ({ ...prev, back: e.target.value }))}
                  placeholder="Enter the back of the card"
                  rows={3}
                  style={{ width: "100%", resize: "vertical" }}
                />
              </div>

              <div className="packs-modal__actions">
                {editingCard && (
                  <button type="button" className="packs-modal__button packs-modal__button--secondary" onClick={handleDeleteCard} disabled={savingCard}>
                    Delete
                  </button>
                )}
                <button type="button" className="packs-modal__button packs-modal__button--secondary" onClick={closeCardModal} disabled={savingCard}>
                  Cancel
                </button>
                <button type="submit" className="packs-modal__button packs-modal__button--primary" disabled={savingCard}>
                  {editingCard ? "Save Card" : "Add Card"}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {showAddOptions && createPortal(
        <div className="packs-modal-backdrop" onClick={closeAIModal}>
          <div className="packs-modal" onClick={(e) => e.stopPropagation()}>
            <h2 className="packs-modal__title">Add Cards</h2>
            <p className="packs-modal__subtitle">Choose how you'd like to add cards to this pack</p>
            <div className="packs-modal__options">
              {/* ...modal options here... */}
            </div>
            {/* ...modal actions here... */}
          </div>
        </div>,
        document.body
      )}

      {showFlashPackOptions && createPortal(
        <div className="packs-modal-backdrop" onClick={closeFlashPackModal}>
          <div className="packs-modal" onClick={(e) => e.stopPropagation()}>
            <h2 className="packs-modal__title">Study Mode</h2>
            <p className="packs-modal__subtitle">Choose how you'd like to study this pack</p>

            <div className="packs-modal__options">
              <button
                type="button"
                className="packs-modal__option-btn"
                onClick={handleFlashcardMode}
              >
                <span className="packs-modal__option-icon">🃏</span>
                <span className="packs-modal__option-title">Flashcards</span>
                <span className="packs-modal__option-desc">Flip through your cards</span>
              </button>

              <button
                type="button"
                className="packs-modal__option-btn"
                onClick={handleQuizMode}
              >
                <span className="packs-modal__option-icon">🎯</span>
                <span className="packs-modal__option-title">Quiz Mode</span>
                <span className="packs-modal__option-desc">Multiple choice questions</span>
              </button>
            </div>

            <div className="packs-modal__actions">
              <button type="button" className="packs-modal__button packs-modal__button--secondary" onClick={closeFlashPackModal}>
                Cancel
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Bottom action buttons: Learn Pack + Add Card */}
      <div
        className="pack-detail-bottom-actions"
        aria-hidden={false}
        style={pack && pack.color ? { '--pack-color': pack.color } : undefined}
      >
        <button
          type="button"
          className="pack-detail-cta pack-detail-cta--primary"
          onClick={handleFlashPackClick}
          aria-label="Learn Pack"
        >
          <FontAwesomeIcon icon={faBullseye} /> Learn Pack
        </button>
        <button
          type="button"
          className="pack-detail-cta pack-detail-cta--secondary"
          onClick={openNewCardModal}
          aria-label="Add Card"
        >
         <FontAwesomeIcon icon={faPlus} /> Add Card
        </button>

        
      </div>
    </section>
  );
}
