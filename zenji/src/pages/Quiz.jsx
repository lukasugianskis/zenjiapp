import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faArrowLeft } from "@fortawesome/free-solid-svg-icons";
import { auth, db, onAuthStateChanged, doc, getDoc, getDocs, collection, addDoc, serverTimestamp } from "../firebase";

export default function Quiz() {
  const { packId, uid } = useParams();
  const navigate = useNavigate();
  const [pack, setPack] = useState(null);
  const [cards, setCards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [quizQuestions, setQuizQuestions] = useState([]);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState(null);
  const [answered, setAnswered] = useState(false);
  const [score, setScore] = useState(0);
  const [quizStarted, setQuizStarted] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const sessionStartRef = useRef(null);
  const answeredCountRef = useRef(0);
  const savedSessionRef = useRef(false);

  const MISTRAL_API_KEY = "Me5iM5ruiQSY65DVRE5xwpqofVmU6Nkg";
  const MISTRAL_API_URL = "https://api.mistral.ai/v1/chat/completions";

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

  const generateQuizQuestions = async () => {
    if (cards.length === 0) return;

    setGenerating(true);
    try {
      const cardsText = cards
        .map((card, idx) => `Q${idx + 1}: ${card.front || card.question}\nA: ${card.back || card.answer}`)
        .join("\n\n");

      const prompt = `Based on these flashcards, generate a quiz with ${Math.min(cards.length, 10)} multiple choice questions. For each question, provide 4 options with one correct answer. Return ONLY a JSON array with no additional text or markdown.

Flashcards:
${cardsText}

Return JSON in this exact format:
[{"question": "What is...?", "correct": "Option A", "options": ["Option A", "Option B", "Option C", "Option D"]}, ...]

Make sure:
1. Questions are based on the flashcard material
2. Exactly 4 options per question
3. One option is the correct answer
4. Incorrect options are plausible but wrong
5. Options are shuffled randomly`;

      const response = await fetch(MISTRAL_API_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${MISTRAL_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "pixtral-large-latest",
          messages: [{ role: "user", content: prompt }],
          max_tokens: 3000,
          temperature: 0.7,
        }),
      });

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }

      const data = await response.json();
      const responseText = data.choices?.[0]?.message?.content || "";

      // Parse JSON from response
      const jsonMatch = responseText.match(/\[[\s\S]*\]/);
      const questions = jsonMatch ? JSON.parse(jsonMatch[0]) : [];

      if (questions.length > 0) {
        setQuizQuestions(questions);
        setQuizStarted(true);
        setCurrentQuestionIndex(0);
        setScore(0);
        answeredCountRef.current = 0;
        savedSessionRef.current = false;
        sessionStartRef.current = Date.now();
      }
    } catch (error) {
      console.error("Error generating quiz:", error);
      alert("Failed to generate quiz. Please try again.");
    } finally {
      setGenerating(false);
    }
  };

  const handleAnswerSelect = (option) => {
    if (answered) return;
    setSelectedAnswer(option);
    setAnswered(true);
    answeredCountRef.current += 1;

    if (option === quizQuestions[currentQuestionIndex].correct) {
      setScore(score + 1);
    }
  };

  const nextQuestion = () => {
    if (currentQuestionIndex < quizQuestions.length - 1) {
      setCurrentQuestionIndex(currentQuestionIndex + 1);
      setSelectedAnswer(null);
      setAnswered(false);
    }
  };

  const restartQuiz = () => {
    setCurrentQuestionIndex(0);
    setSelectedAnswer(null);
    setAnswered(false);
    setScore(0);
    setQuizStarted(false);
    answeredCountRef.current = 0;
    savedSessionRef.current = false;
    sessionStartRef.current = null;
  };

  useEffect(() => {
    if (!quizStarted) return;
    if (sessionStartRef.current === null) sessionStartRef.current = Date.now();
  }, [quizStarted]);

  useEffect(() => {
    const persistQuizSession = async () => {
      if (savedSessionRef.current) return;
      if (!currentUser?.uid || !packId) return;

      const questionsAnswered = Math.max(0, answeredCountRef.current);
      if (questionsAnswered <= 0) return;

      const startedAtMs = Number(sessionStartRef.current) || Date.now();
      const elapsedMinutes = (Date.now() - startedAtMs) / 60000;
      const durationMinutes = Math.max(0.2, Math.round(elapsedMinutes * 10) / 10);
      const now = new Date();

      savedSessionRef.current = true;

      try {
        await addDoc(collection(db, "users", currentUser.uid, "studySessions"), {
          source: "quiz",
          packId,
          packOwnerUid: ownerUid || null,
          dateKey: formatDateKey(now),
          cardsStudied: questionsAnswered,
          questionsAnswered,
          quizCorrect: Math.max(0, Number(score) || 0),
          quizQuestions: questionsAnswered,
          activityUnits: questionsAnswered,
          durationMinutes,
          createdAt: serverTimestamp(),
        });
      } catch (err) {
        savedSessionRef.current = false;
        console.error("Error saving quiz session:", err);
      }
    };

    if (quizStarted && currentQuestionIndex >= quizQuestions.length && quizQuestions.length > 0) {
      persistQuizSession();
    }
  }, [quizStarted, currentQuestionIndex, quizQuestions.length, currentUser?.uid, ownerUid, packId, score]);

  useEffect(() => {
    return () => {
      const persistOnExit = async () => {
        if (savedSessionRef.current) return;
        if (!currentUser?.uid || !packId) return;

        const questionsAnswered = Math.max(0, answeredCountRef.current);
        if (questionsAnswered <= 0) return;

        const startedAtMs = Number(sessionStartRef.current) || Date.now();
        const elapsedMinutes = (Date.now() - startedAtMs) / 60000;
        const durationMinutes = Math.max(0.2, Math.round(elapsedMinutes * 10) / 10);
        const now = new Date();

        savedSessionRef.current = true;

        try {
          await addDoc(collection(db, "users", currentUser.uid, "studySessions"), {
            source: "quiz",
            packId,
            packOwnerUid: ownerUid || null,
            dateKey: formatDateKey(now),
            cardsStudied: questionsAnswered,
            questionsAnswered,
            quizCorrect: Math.max(0, Number(score) || 0),
            quizQuestions: questionsAnswered,
            activityUnits: questionsAnswered,
            durationMinutes,
            createdAt: serverTimestamp(),
          });
        } catch (err) {
          savedSessionRef.current = false;
          console.error("Error saving quiz session on exit:", err);
        }
      };

      persistOnExit();
    };
  }, [currentUser?.uid, ownerUid, packId, score]);

  if (loading) {
    return (
      <section className="quiz-page">
        <div className="spinner">
          <div className="spinner__circle"></div>
        </div>
      </section>
    );
  }

  if (!pack || cards.length === 0) {
    return (
      <section className="quiz-page">
        <div className="quiz-container">
          <button className="quiz-back" onClick={() => navigate(-1)}>
            <FontAwesomeIcon icon={faArrowLeft} />
          </button>
          <h2>No cards in this pack</h2>
          <button className="quiz-btn--primary" onClick={() => navigate(-1)}>
            Go Back
          </button>
        </div>
      </section>
    );
  }

  if (!quizStarted) {
    return (
      <section className="quiz-page">
        <div className="quiz-container">
          <button className="quiz-back" onClick={() => navigate(-1)}>
            <FontAwesomeIcon icon={faArrowLeft} />
          </button>
          <div className="quiz-start">
            <h1>{pack.name}</h1>
            <p className="quiz-start__desc">Quiz Mode</p>
            <p className="quiz-start__info">Get ready for an AI-generated multiple choice quiz based on your {cards.length} cards.</p>
            <button
              className="quiz-btn--primary"
              onClick={generateQuizQuestions}
              disabled={generating}
            >
              {generating ? "Generating Questions..." : "Start Quiz"}
            </button>
          </div>
        </div>
      </section>
    );
  }

  if (currentQuestionIndex >= quizQuestions.length) {
    return (
      <section className="quiz-page">
        <div className="quiz-container">
          <div className="quiz-results">
            <h1>Quiz Complete! 🎉</h1>
            <div className="quiz-score">
              <div className="quiz-score__value">{score}</div>
              <div className="quiz-score__label">/ {quizQuestions.length}</div>
            </div>
            <p className="quiz-percentage">
              {Math.round((score / quizQuestions.length) * 100)}% Correct
            </p>
            <div className="quiz-actions">
              <button className="quiz-btn--secondary" onClick={() => navigate(-1)}>
                Back to Pack
              </button>
              <button className="quiz-btn--primary" onClick={restartQuiz}>
                Retake Quiz
              </button>
            </div>
          </div>
        </div>
      </section>
    );
  }

  const currentQuestion = quizQuestions[currentQuestionIndex];
  const isCorrect = selectedAnswer === currentQuestion.correct;

  return (
    <section className="quiz-page">
      <div className="quiz-container">
        <header className="quiz-header">
          <button className="quiz-back" onClick={() => navigate(-1)}>
            <FontAwesomeIcon icon={faArrowLeft} />
          </button>
          <h1>{pack.name}</h1>
          <div className="quiz-progress">
            {currentQuestionIndex + 1} / {quizQuestions.length}
          </div>
        </header>

        <div className="quiz-content">
          <h2 className="quiz-question">{currentQuestion.question}</h2>

          <div className="quiz-options">
            {currentQuestion.options.map((option, idx) => {
              const isSelected = selectedAnswer === option;
              const isAnsweredCorrect = answered && isSelected && isCorrect;
              const isAnsweredWrong = answered && isSelected && !isCorrect;
              const isCorrectOption = answered && option === currentQuestion.correct;

              return (
                <button
                  key={idx}
                  className={`quiz-option ${isSelected ? "is-selected" : ""} ${
                    isAnsweredCorrect ? "is-correct" : ""
                  } ${isAnsweredWrong ? "is-wrong" : ""} ${
                    isCorrectOption && !isSelected ? "is-correct-unselected" : ""
                  }`}
                  onClick={() => handleAnswerSelect(option)}
                  disabled={answered}
                >
                  <span className="quiz-option__letter">
                    {String.fromCharCode(65 + idx)}
                  </span>
                  <span className="quiz-option__text">{option}</span>
                </button>
              );
            })}
          </div>

          {answered && (
            <div className={`quiz-feedback ${isCorrect ? "is-correct" : "is-wrong"}`}>
              {isCorrect ? "✅ Correct!" : "❌ Incorrect"}
            </div>
          )}
        </div>

        {answered && (
          <div className="quiz-actions">
            {currentQuestionIndex < quizQuestions.length - 1 ? (
              <button className="quiz-btn--primary" onClick={nextQuestion}>
                Next Question
              </button>
            ) : (
              <button className="quiz-btn--primary" onClick={nextQuestion}>
                View Results
              </button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
