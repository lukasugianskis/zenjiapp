import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faArrowLeft, faChevronLeft, faChevronRight } from "@fortawesome/free-solid-svg-icons";
import { auth, db, onAuthStateChanged, doc, getDoc, getDocs, collection, addDoc, serverTimestamp } from "../firebase";

export default function Flashcard() {
  const { packId, uid } = useParams();
  const navigate = useNavigate();
  const [pack, setPack] = useState(null);
  const [cards, setCards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [currentCardIndex, setCurrentCardIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const sessionStartRef = useRef(null);
  const reviewedCardsRef = useRef(new Set());

  const ownerUid = uid || currentUser?.uid || null;

  const formatDateKey = (date) => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  };

  useEffect(() => {
    const unsubAuth = onAuthStateChanged(auth, (u) => {
      setCurrentUser(u);
    });
    return () => unsubAuth && unsubAuth();
  }, []);

  useEffect(() => {
    if (!ownerUid || !packId) return;

    setLoading(true);
    setPack(null);
    setCards([]);
    setCurrentCardIndex(0);
    setIsFlipped(false);

    let isActive = true;

    const loadPackAndCards = async () => {
      try {
        const packRef = doc(db, "users", ownerUid, "packs", packId);
        const snap = await getDoc(packRef);

        if (!snap.exists()) {
          if (isActive) setLoading(false);
          return;
        }

        if (!isActive) return;
        setPack({ id: snap.id, ...snap.data() });

        const cardsCol = collection(db, "users", ownerUid, "packs", packId, "cards");
        const cardsSnap = await getDocs(cardsCol);
        const items = cardsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setCards(items);
        if (isActive) setLoading(false);
      } catch (err) {
        console.error("Error loading pack:", err);
        if (isActive) setLoading(false);
      }
    };

    loadPackAndCards();

    return () => {
      isActive = false;
    };
  }, [packId, ownerUid]);

  useEffect(() => {
    sessionStartRef.current = Date.now();
    reviewedCardsRef.current = new Set();
  }, [packId, currentUser?.uid]);

  useEffect(() => {
    if (cards.length === 0) return;
    const currentCardId = cards[currentCardIndex]?.id;
    if (currentCardId) reviewedCardsRef.current.add(currentCardId);
  }, [cards, currentCardIndex]);

  useEffect(() => {
    return () => {
      const persistSession = async () => {
        if (!currentUser?.uid || !packId) return;

        const cardsStudied = reviewedCardsRef.current.size;
        if (cardsStudied <= 0) return;

        const startedAtMs = Number(sessionStartRef.current) || Date.now();
        const elapsedMinutes = (Date.now() - startedAtMs) / 60000;
        const durationMinutes = Math.max(0.2, Math.round(elapsedMinutes * 10) / 10);
        const now = new Date();

        try {
          await addDoc(collection(db, "users", currentUser.uid, "studySessions"), {
            source: "flashcard",
            packId,
            packOwnerUid: ownerUid || null,
            dateKey: formatDateKey(now),
            cardsStudied,
            questionsAnswered: 0,
            quizCorrect: 0,
            quizQuestions: 0,
            activityUnits: cardsStudied,
            durationMinutes,
            createdAt: serverTimestamp(),
          });
        } catch (err) {
          console.error("Error saving flashcard session:", err);
        }
      };

      persistSession();
    };
  }, [currentUser?.uid, ownerUid, packId]);

  if (loading) {
    return (
      <section className="flashcard-page">
        <div className="spinner">
          <div className="spinner__circle"></div>
        </div>
      </section>
    );
  }

  if (!pack || cards.length === 0) {
    return (
      <section className="flashcard-page">
        <div className="flashcard-container">
          <button className="flashcard-back" onClick={() => navigate(-1)}>
            <FontAwesomeIcon icon={faArrowLeft} />
          </button>
          <h2>No cards in this pack</h2>
          <button className="flashcard-btn--primary" onClick={() => navigate(-1)}>
            Go Back
          </button>
        </div>
      </section>
    );
  }

  const currentCard = cards[currentCardIndex];
  const nextCard = () => {
    if (currentCardIndex < cards.length - 1) {
      setCurrentCardIndex(currentCardIndex + 1);
      setIsFlipped(false);
    }
  };

  const prevCard = () => {
    if (currentCardIndex > 0) {
      setCurrentCardIndex(currentCardIndex - 1);
      setIsFlipped(false);
    }
  };

  return (
    <section className="flashcard-page">
      <div className="flashcard-container">
        <header className="flashcard-header">
          <button className="flashcard-back" onClick={() => navigate(-1)}>
            <FontAwesomeIcon icon={faArrowLeft} />
          </button>
          <h1>{pack.name}</h1>
          <div className="flashcard-progress">
            {currentCardIndex + 1} / {cards.length}
          </div>
        </header>

        <div className="flashcard-content">
          <div
            className={`flashcard ${isFlipped ? "is-flipped" : ""}`}
            onClick={() => setIsFlipped(!isFlipped)}
          >
            <div className="flashcard-inner">
              <div className="flashcard-front">
                <p className="flashcard-label">Question</p>
                <p className="flashcard-text">{currentCard.front ?? currentCard.question ?? "Untitled"}</p>
              </div>
              <div className="flashcard-back-side">
                <p className="flashcard-label">Answer</p>
                <p className="flashcard-text">{currentCard.back ?? currentCard.answer ?? ""}</p>
              </div>
            </div>
          </div>

          <p className="flashcard-hint">Click card to reveal answer</p>
        </div>

        <div className="flashcard-controls">
          <button
            className="flashcard-btn"
            onClick={prevCard}
            disabled={currentCardIndex === 0}
          >
            <FontAwesomeIcon icon={faChevronLeft} />
            Previous
          </button>

          <button
            className="flashcard-btn"
            onClick={nextCard}
            disabled={currentCardIndex === cards.length - 1}
          >
            Next
            <FontAwesomeIcon icon={faChevronRight} />
          </button>
        </div>
      </div>
    </section>
  );
}
