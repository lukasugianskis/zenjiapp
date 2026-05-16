import { useEffect, useMemo, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faChevronRight, faChevronLeft } from "@fortawesome/free-solid-svg-icons";
import { auth, db, onAuthStateChanged, collection, getDocs, doc, getDoc, setDoc, serverTimestamp } from "../firebase";

export default function Progress() {
  const today = new Date();
  const currentYear = today.getFullYear();
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const [currentUser, setCurrentUser] = useState(null);
  const [loadingActivity, setLoadingActivity] = useState(true);
  const [activityByDate, setActivityByDate] = useState({});
  const [dailyStatsByDate, setDailyStatsByDate] = useState({});
  const [heatmapMinutesByDate, setHeatmapMinutesByDate] = useState({});
  const [websiteMinutesToday, setWebsiteMinutesToday] = useState(0);
  const [retention, setRetention] = useState(null);
  const [tooltip, setTooltip] = useState(null);
  const lastPersistedRef = useRef("");

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setCurrentUser(u));
    return () => unsub && unsub();
  }, []);

  useEffect(() => {
    const handleClickOutside = () => setTooltip(null);
    if (tooltip) {
      document.addEventListener("click", handleClickOutside);
      return () => document.removeEventListener("click", handleClickOutside);
    }
  }, [tooltip]);

  const formatDateKey = (d) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  };

  const toDateValue = (value) => {
    if (!value) return null;
    if (typeof value.toDate === "function") return value.toDate();
    if (value instanceof Date) return value;
    return null;
  };

  const getWebsiteMsStorageKey = (uid, dateKey) => `zenji.websiteMs.${uid}.${dateKey}`;

  const readWebsiteMs = (uid, dateKey) => {
    if (!uid || typeof window === "undefined") return 0;
    const raw = window.localStorage.getItem(getWebsiteMsStorageKey(uid, dateKey));
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  };

  useEffect(() => {
    if (!currentUser?.uid || typeof window === "undefined") {
      setWebsiteMinutesToday(0);
      setHeatmapMinutesByDate({});
      return;
    }

    const uid = currentUser.uid;
    const updateMinutes = () => {
      const dateKey = formatDateKey(new Date());
      const ms = readWebsiteMs(uid, dateKey);
      const minutes = Math.max(0, Math.round((ms / 60000) * 10) / 10);
      setWebsiteMinutesToday(minutes);
      setHeatmapMinutesByDate((prev) => ({
        ...prev,
        [dateKey]: Math.max(prev[dateKey] || 0, minutes),
      }));
    };

    updateMinutes();
    const intervalId = window.setInterval(updateMinutes, 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [currentUser?.uid]);

  useEffect(() => {
    if (!currentUser?.uid) {
      setActivityByDate({});
      setDailyStatsByDate({});
      setHeatmapMinutesByDate({});
      setRetention(null);
      setLoadingActivity(false);
      return;
    }

    const loadActivity = async () => {
      setLoadingActivity(true);
      try {
        const uid = currentUser.uid;
        const dateCounts = {};
        const statsByDate = {};
        let websiteMinutesMap = {};
        let hasWebsiteMinutesData = false;

        const ensureDateBucket = (key) => {
          if (!statsByDate[key]) {
            statsByDate[key] = {
              activity: 0,
              cards: 0,
              minutes: 0,
              sessions: 0,
              quizCorrect: 0,
              quizQuestions: 0,
            };
          }
          return statsByDate[key];
        };

        const addSessionStats = ({ key, activity = 0, cards = 0, minutes = 0, sessions = 0, quizCorrect = 0, quizQuestions = 0 }) => {
          if (!key) return;
          const bucket = ensureDateBucket(key);
          bucket.activity += Math.max(0, Number(activity) || 0);
          bucket.cards += Math.max(0, Number(cards) || 0);
          bucket.minutes += Math.max(0, Number(minutes) || 0);
          bucket.sessions += Math.max(0, Number(sessions) || 0);
          bucket.quizCorrect += Math.max(0, Number(quizCorrect) || 0);
          bucket.quizQuestions += Math.max(0, Number(quizQuestions) || 0);
          dateCounts[key] = bucket.activity;
        };

        const addLegacyEventDate = (dateObj) => {
          if (!dateObj) return;
          const key = formatDateKey(dateObj);
          addSessionStats({
            key,
            activity: 1,
            cards: 1,
            minutes: 1.8,
            sessions: 1,
          });
        };

        const addEntityDates = (createdAtValue, updatedAtValue) => {
          const createdDate = toDateValue(createdAtValue);
          const updatedDate = toDateValue(updatedAtValue);

          if (createdDate) addLegacyEventDate(createdDate);

          if (
            updatedDate &&
            (!createdDate || formatDateKey(updatedDate) !== formatDateKey(createdDate))
          ) {
            addLegacyEventDate(updatedDate);
          }
        };

        // Load user profile fields (if present)
        const userDocSnap = await getDoc(doc(db, "users", uid));
        if (userDocSnap.exists()) {
          const profile = userDocSnap.data();
          if (typeof profile.retention === "number") {
            setRetention(Math.max(0, Math.min(100, Math.round(profile.retention))));
          } else {
            setRetention(null);
          }

          const persistedWebsiteByDate = profile?.websiteTimeByDate || {};
          websiteMinutesMap = Object.entries(persistedWebsiteByDate).reduce((acc, [key, ms]) => {
            const minutes = Math.max(0, Math.round(((Number(ms) || 0) / 60000) * 10) / 10);
            if (minutes > 0) acc[key] = minutes;
            return acc;
          }, {});
          hasWebsiteMinutesData = Object.keys(websiteMinutesMap).length > 0;

          const persistedWebsiteMs = Number(profile?.websiteTimeByDate?.[formatDateKey(new Date())] || 0);
          if (persistedWebsiteMs > 0) {
            setWebsiteMinutesToday((prev) => {
              const persistedMinutes = Math.round((persistedWebsiteMs / 60000) * 10) / 10;
              return Math.max(prev, persistedMinutes);
            });
          }
        } else {
          setRetention(null);
        }

        // Preferred source: recorded study sessions.
        const sessionsSnap = await getDocs(collection(db, "users", uid, "studySessions"));
        sessionsSnap.forEach((sessionDoc) => {
          const session = sessionDoc.data();
          const dateFromTimestamp = toDateValue(session.createdAt);
          const key = session.dateKey || (dateFromTimestamp ? formatDateKey(dateFromTimestamp) : null);

          const cardsStudied = Math.max(0, Number(session.cardsStudied) || 0);
          const questionsAnswered = Math.max(0, Number(session.questionsAnswered) || 0);
          const quizQuestions = Math.max(0, Number(session.quizQuestions) || questionsAnswered);
          const quizCorrect = Math.max(0, Number(session.quizCorrect) || 0);
          const activityUnits = Math.max(0, Number(session.activityUnits) || cardsStudied + questionsAnswered);
          const durationMinutes = Math.max(0, Number(session.durationMinutes) || 0);

          addSessionStats({
            key,
            activity: activityUnits > 0 ? activityUnits : 1,
            cards: cardsStudied + questionsAnswered,
            minutes: durationMinutes,
            sessions: 1,
            quizCorrect,
            quizQuestions,
          });
        });

        if (Object.keys(dateCounts).length > 0) {
          setActivityByDate(dateCounts);
          setDailyStatsByDate(statsByDate);
          if (!hasWebsiteMinutesData) {
            websiteMinutesMap = Object.entries(statsByDate).reduce((acc, [key, value]) => {
              const minutes = Math.max(0, Math.round((Number(value?.minutes) || 0) * 10) / 10);
              if (minutes > 0) acc[key] = minutes;
              return acc;
            }, {});
          }
          setHeatmapMinutesByDate(websiteMinutesMap);
          return;
        }

        // Legacy fallback for users without session docs.
        const packsSnap = await getDocs(collection(db, "users", uid, "packs"));
        const packDocs = packsSnap.docs;

        for (const packDoc of packDocs) {
          const p = packDoc.data();
          addEntityDates(p.createdAt, p.updatedAt);

          const cardsSnap = await getDocs(collection(db, "users", uid, "packs", packDoc.id, "cards"));
          cardsSnap.forEach((cardDoc) => {
            const c = cardDoc.data();
            addEntityDates(c.createdAt, c.updatedAt);
          });
        }

        setActivityByDate(dateCounts);
        setDailyStatsByDate(statsByDate);
        if (!hasWebsiteMinutesData) {
          websiteMinutesMap = Object.entries(statsByDate).reduce((acc, [key, value]) => {
            const minutes = Math.max(0, Math.round((Number(value?.minutes) || 0) * 10) / 10);
            if (minutes > 0) acc[key] = minutes;
            return acc;
          }, {});
        }
        setHeatmapMinutesByDate(websiteMinutesMap);
      } catch (err) {
        console.error("Error loading progress activity:", err);
        setActivityByDate({});
        setDailyStatsByDate({});
        setHeatmapMinutesByDate({});
      } finally {
        setLoadingActivity(false);
      }
    };

    loadActivity();
  }, [currentUser?.uid]);

  const buildYearGrid = (year, activityMap) => {
    const jan1 = new Date(year, 0, 1);
    const dec31 = new Date(year, 11, 31);

    const gridStart = new Date(jan1);
    gridStart.setDate(jan1.getDate() - jan1.getDay());

    const gridEnd = new Date(dec31);
    gridEnd.setDate(dec31.getDate() + (6 - dec31.getDay()));

    const cells = [];
    for (let d = new Date(gridStart); d <= gridEnd; d.setDate(d.getDate() + 1)) {
      const inYear = d.getFullYear() === year;
      const key = formatDateKey(d);
      const count = inYear ? (activityMap[key] || 0) : 0;
      cells.push({
        date: new Date(d),
        inYear,
        count,
      });
    }

    const weeks = [];
    for (let i = 0; i < cells.length; i += 7) {
      weeks.push(cells.slice(i, i + 7));
    }

    const months = Array.from({ length: 12 }).map((_, m) => {
      const first = new Date(year, m, 1);
      const diffDays = Math.floor((first - gridStart) / 86400000);
      const weekIndex = Math.floor(diffDays / 7);
      return {
        label: first.toLocaleString(undefined, { month: "short" }),
        weekIndex,
      };
    });

    return { weeks, months };
  };
  const { weeks, months } = useMemo(
    () => buildYearGrid(selectedYear, heatmapMinutesByDate),
    [selectedYear, heatmapMinutesByDate]
  );

  // Fixed thresholds (minutes) for heat levels.
  // Easy to tune:
  // level 0: 0 min
  // level 1: 0.1 - 14.9 min
  // level 2: 15 - 29.9 min
  // level 3: 30 - 59.9 min
  // level 4: 60+ min
  const HEAT_LEVEL_THRESHOLDS = {
    level1: 15,
    level2: 30,
    level3: 60,
  };

  const getLevelFromMinutes = (minutes) => {
    if (minutes <= 0) return 0;
    if (minutes < HEAT_LEVEL_THRESHOLDS.level1) return 1;
    if (minutes < HEAT_LEVEL_THRESHOLDS.level2) return 2;
    if (minutes < HEAT_LEVEL_THRESHOLDS.level3) return 3;
    return 4;
  };

  const todayKey = formatDateKey(today);
  const todayStats = dailyStatsByDate[todayKey] || {
    activity: 0,
    cards: 0,
    minutes: 0,
    sessions: 0,
    quizCorrect: 0,
    quizQuestions: 0,
  };
  const studiedCards = Math.max(0, Math.round((todayStats.cards || 0) * 10) / 10);
  const minutes = Math.max(0, websiteMinutesToday);
  const pace = studiedCards > 0 ? Math.round(((minutes * 60) / studiedCards) * 10) / 10 : 0;

  const computedRetention = useMemo(() => {
    if (retention !== null) return retention;

    const quizTotals = Object.values(dailyStatsByDate).reduce(
      (acc, day) => {
        acc.correct += Math.max(0, Number(day.quizCorrect) || 0);
        acc.total += Math.max(0, Number(day.quizQuestions) || 0);
        return acc;
      },
      { correct: 0, total: 0 }
    );

    if (quizTotals.total > 0) {
      return Math.max(0, Math.min(100, Math.round((quizTotals.correct / quizTotals.total) * 100)));
    }

    const allCounts = Object.values(activityByDate);
    if (allCounts.length === 0) return 0;
    const activeDays = allCounts.filter((n) => n > 0).length;
    return Math.round((activeDays / 365) * 100);
  }, [retention, activityByDate, dailyStatsByDate]);

  const streak = useMemo(() => {
    let s = 0;
    const cursor = new Date(today);
    while (true) {
      const key = formatDateKey(cursor);
      if ((heatmapMinutesByDate[key] || 0) <= 0) break;
      s += 1;
      cursor.setDate(cursor.getDate() - 1);
    }
    return s;
  }, [heatmapMinutesByDate]);

  const isTodayInSelectedYear = selectedYear === currentYear;
  const canGoNextYear = selectedYear < currentYear;

  useEffect(() => {
    if (!currentUser?.uid || loadingActivity) return;

    const snapshotKey = JSON.stringify({
      activityByDate,
      studiedCards,
      minutes,
      pace,
      computedRetention,
      streak,
      todayKey,
    });

    if (lastPersistedRef.current === snapshotKey) return;
    lastPersistedRef.current = snapshotKey;

    const persistProgress = async () => {
      try {
        await setDoc(
          doc(db, "users", currentUser.uid),
          {
            retention: computedRetention,
            streak,
            activityByDate,
            progressSummary: {
              todayKey,
              studiedCardsToday: studiedCards,
              timeMinutesToday: minutes,
              paceSecondsPerCard: pace,
              sessionsToday: Math.max(0, Number(todayStats.sessions) || 0),
              retention: computedRetention,
              streakDays: streak,
              updatedAt: serverTimestamp(),
            },
          },
          { merge: true }
        );
      } catch (err) {
        console.error("Error saving progress summary:", err);
      }
    };

    persistProgress();
  }, [
    currentUser?.uid,
    loadingActivity,
    activityByDate,
    studiedCards,
    minutes,
    pace,
    todayStats.sessions,
    computedRetention,
    streak,
    todayKey,
  ]);

  return (
    <section className="packs-page progress-page">
      <div className="packs-page__container progress-page__container">
        <div className="progress-heading-row">
          <h1 className="progress-page__title">Today's Stats</h1>
        </div>

        <div className="progress-stats-grid">
          <article className="progress-stat-card">
            <span className="progress-stat-label">Studied</span>
            <strong className="progress-stat-value">{studiedCards} cards</strong>
          </article>
          <article className="progress-stat-card">
            <span className="progress-stat-label">Time</span>
            <strong className="progress-stat-value">{minutes} min</strong>
          </article>
          <article className="progress-stat-card">
            <span className="progress-stat-label">Pace</span>
            <strong className="progress-stat-value">—</strong>
          </article>
          <article className="progress-stat-card">
            <span className="progress-stat-label">Retention</span>
            <strong className="progress-stat-value">{computedRetention}%</strong>
          </article>
        </div>

        <section className="progress-activity-card">
          <div className="progress-activity-header">
            <div className="progress-activity-left">
              <h2 className="progress-activity-title">Activity</h2>
              <div className="progress-year-nav">
                <button
                  className="progress-year-btn"
                  type="button"
                  onClick={() => setSelectedYear((prev) => prev - 1)}
                  aria-label="Previous year"
                >
                  <FontAwesomeIcon icon={faChevronLeft} />
                </button>
                <span className="progress-year-label">{selectedYear}</span>
                <button
                  className="progress-year-btn"
                  type="button"
                  onClick={() => setSelectedYear((prev) => (prev < currentYear ? prev + 1 : prev))}
                  aria-label="Next year"
                  disabled={!canGoNextYear}
                  aria-disabled={!canGoNextYear}
                >
                  <FontAwesomeIcon icon={faChevronRight} />
                </button>
              </div>
            </div>

            <div className="progress-activity-right">
              <span className="progress-streak">{streak} day streak</span>
              <div className="progress-range-tabs" aria-label="Range selector">
                <button className="range-tab is-active" type="button">Year</button>
                <button className="range-tab" type="button" disabled>Month</button>
                <button className="range-tab" type="button" disabled>Week</button>
              </div>
            </div>
          </div>

          <p className="progress-today-line">
            {isTodayInSelectedYear
              ? `Today: ${today.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}`
              : `Viewing year ${selectedYear}`}
          </p>

          <div className="progress-heatmap-shell" role="grid" aria-label="Yearly time heatmap">
            <div className="progress-month-row">
              {months.map((m) => (
                <span key={`${m.label}-${m.weekIndex}`} className="progress-month-label" style={{ gridColumnStart: m.weekIndex + 1 }}>
                  {m.label}
                </span>
              ))}
            </div>

            <div className="progress-heatmap-row">
              <div className="progress-weekday-col">
                {["S", "M", "T", "W", "T", "F", "S"].map((d, idx) => (
                  <span key={`${d}-${idx}`} className="progress-weekday-label">{d}</span>
                ))}
              </div>

              <div className="progress-year-grid" style={{ gridTemplateColumns: `repeat(${weeks.length}, minmax(0, 1fr))` }}>
                {weeks.map((week, wi) => (
                  <div className="progress-week-column" key={wi}>
                    {week.map((cell, di) => {
                      const isToday =
                        isTodayInSelectedYear &&
                        cell.inYear &&
                        cell.date.getMonth() === today.getMonth() &&
                        cell.date.getDate() === today.getDate();

                      return (
                        <div
                          key={di}
                          className={`progress-dot ${cell.inYear ? `heat-${getLevelFromMinutes(cell.count)}` : "is-empty"} ${isToday ? "is-today" : ""}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (cell.inYear) {
                              setTooltip({
                                x: e.clientX,
                                y: e.clientY,
                                date: cell.date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }),
                                minutes: Math.round((cell.count || 0) * 10) / 10,
                                level: getLevelFromMinutes(cell.count),
                              });
                            }
                          }}
                          role="gridcell"
                          style={{ cursor: cell.inYear ? "pointer" : "default" }}
                        />
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
        
        {tooltip && (
          <div 
            className="progress-heatmap-tooltip"
            style={{
              position: "fixed",
              left: `${tooltip.x + 10}px`,
              top: `${tooltip.y + 10}px`,
              pointerEvents: "auto",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="progress-heatmap-tooltip__content">
              <div className="progress-heatmap-tooltip__date">{tooltip.date}</div>
              <div className="progress-heatmap-tooltip__minutes">{tooltip.minutes} min</div>
             
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
