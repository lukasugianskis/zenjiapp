import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faUser, faAngleDown, faXmark } from "@fortawesome/free-solid-svg-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { UserIcon, DiscordIcon, SentIcon, Settings01Icon, Filter } from "@hugeicons/core-free-icons";
import { auth, db, onAuthStateChanged, doc, onSnapshot, collection, query, orderBy, getDocs, updateDoc, serverTimestamp } from "../firebase";

export default function TopBar() {
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [openStreak, setOpenStreak] = useState(false);
  const [openLightning, setOpenLightning] = useState(false);
  const [openCoins, setOpenCoins] = useState(false);
  const [streak, setStreak] = useState(0);
  const [lightning, setLightning] = useState(0);
  const [coins, setCoins] = useState(0);
  const [isScrolling, setIsScrolling] = useState(false);
  const [weeklyActivity, setWeeklyActivity] = useState([false, false, false, false, false, false, false]); // M-S activity status
  const [leaderboard, setLeaderboard] = useState([]); // top 5 users by streak

  const formatLocalDate = (date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };
  
  // helper to simulate future days (dev-only)
  const simulateFutureDays = async (days) => {
    if (!import.meta.env.DEV) return;
    const uid = auth.currentUser && auth.currentUser.uid;
    if (!uid) return alert('Not signed in');
    try {
      const ref = doc(db, 'users', uid);
      const updates = {};
      for (let i = 1; i <= days; i++) {
        const d = new Date();
        d.setDate(d.getDate() + i);
        const ds = formatLocalDate(d);
        updates[`websiteTimeByDate.${ds}`] = 1;
        updates[`activityByDate.${ds}`] = 1;
      }
      await updateDoc(ref, updates);
      // refresh will happen via onSnapshot
      alert(`Simulated ${days} future day(s)`);
    } catch (err) {
      console.error('simulateFutureDays error', err);
      alert('Simulation failed');
    }
  };

  useEffect(() => {
    const onDocClick = (e) => {
      if (!e.target.closest(".topbar__profile")) setOpen(false);
      if (!e.target.closest(".topbar__stat--streak")) setOpenStreak(false);
      if (!e.target.closest(".topbar__stat--lightning")) setOpenLightning(false);
      if (!e.target.closest(".topbar__stat--coins")) setOpenCoins(false);
    };
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, []);

  // Fetch top 5 users by streak
  useEffect(() => {
    const fetchLeaderboard = async () => {
      try {
        const usersRef = collection(db, "users");
        const q = query(usersRef, orderBy("streak", "desc"));
        const snapshot = await getDocs(q);
        const top5 = [];
        snapshot.docs.slice(0, 5).forEach((doc, idx) => {
          const data = doc.data();
          top5.push({
            rank: idx + 1,
            username: data.Username || "-",
            streak: Number(data.streak || 0)
          });
        });
        setLeaderboard(top5);
      } catch (err) {
        console.error("Error fetching leaderboard:", err);
        setLeaderboard([]);
      }
    };
    fetchLeaderboard();
    const interval = setInterval(fetchLeaderboard, 30000); // refresh every 30s
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const handleScroll = () => {
      // Check if any scrollable parent has scrolled
      const mainContent = document.querySelector(".main-content") || document.querySelector("[class*='content']");
      if (mainContent) {
        setIsScrolling(mainContent.scrollTop > 10);
      } else {
        setIsScrolling(window.scrollY > 10);
      }
    };
    
    const mainContent = document.querySelector(".main-content") || document.querySelector("[class*='content']");
    if (mainContent) {
      mainContent.addEventListener("scroll", handleScroll, { passive: true });
      return () => mainContent.removeEventListener("scroll", handleScroll);
    } else {
      window.addEventListener("scroll", handleScroll, { passive: true });
      return () => window.removeEventListener("scroll", handleScroll);
    }
  }, []);

  // subscribe to user's stats in Firestore when signed in
  useEffect(() => {
    let unsubUser = null;
    const unsubAuth = onAuthStateChanged(auth, (u) => {
      if (unsubUser) {
        unsubUser();
        unsubUser = null;
      }
      if (u) {
        const ref = doc(db, "users", u.uid);
        unsubUser = onSnapshot(ref, async (snap) => {
            if (snap.exists()) {
            const data = snap.data();
            setStreak(Number(data.streak || 0));
            setLightning(Number(data.lightning || data.energy || 0));
            setCoins(Number(data.coins || 0));

            // Determine today's date and mark activity if not already marked
            const today = new Date();
            const todayStr = formatLocalDate(today);
            const activityMap = data.websiteTimeByDate || data.activityByDate || data.dailyActivity || {};
            const alreadyMarkedToday = !!activityMap[todayStr];
            if (!alreadyMarkedToday) {
              // compute whether streak continues from yesterday
              const y = new Date();
              y.setDate(y.getDate() - 1);
              const yStr = formatLocalDate(y);
              const continues = !!activityMap[yStr];
              const newStreak = continues ? (Number(data.streak || 0) + 1) : 1;
              try {
                const ref = doc(db, 'users', u.uid);
                await updateDoc(ref, {
                  [`websiteTimeByDate.${todayStr}`]: 1,
                  [`activityByDate.${todayStr}`]: 1,
                  streak: newStreak,
                  lastActivity: serverTimestamp()
                });
                // reflect change locally so UI updates immediately without waiting for another snapshot
                activityMap[todayStr] = 1;
              } catch (err) {
                console.error('Failed to mark today activity:', err);
              }
            }

            // Calculate Monday-Sunday activity for the current week.
            // Saturday and Sunday are shown again as part of the visible week row.
            const todayDow = today.getDay(); // 0=Sun, 1=Mon ... 6=Sat
            const mondayOffset = todayDow === 0 ? -6 : 1 - todayDow;
            const baseMonday = new Date(today);
            baseMonday.setHours(0, 0, 0, 0);
            baseMonday.setDate(today.getDate() + mondayOffset);

            const weekActivity = Array.from({ length: 7 }, (_, i) => {
              const d = new Date(baseMonday);
              d.setDate(baseMonday.getDate() + i);
              const ds = formatLocalDate(d);
              return !!activityMap[ds];
            });
            setWeeklyActivity(weekActivity);
          } else {
            setStreak(0);
            setLightning(0);
            setCoins(0);
            setWeeklyActivity([false, false, false, false, false, false, false]);
          }
        }, (err) => {
          // permission errors or other issues -> keep defaults
          setStreak(0);
          setLightning(0);
          setCoins(0);
          setWeeklyActivity([false, false, false, false, false, false, false]);
        });
      } else {
        setStreak(0);
        setLightning(0);
        setCoins(0);
        setWeeklyActivity([false, false, false, false, false, false, false]);
      }
    });

    return () => {
      if (unsubUser) unsubUser();
      if (unsubAuth) unsubAuth();
    };
  }, []);

  if (location.pathname === "/chat" || location.pathname.startsWith("/chat")) return null;

  return (
    <header className={`topbar ${isScrolling ? "topbar--scrolling" : ""}`}>
      <div className="topbar__items">
        <div
          className="topbar__stat topbar__stat--streak"
          role="button"
          aria-haspopup="true"
          aria-expanded={openStreak}
          onClick={() => setOpenStreak((s) => !s)}
        >
          <img src="/streak.png" alt="Streaks" className="topbar__streak" />
          <span className="topbar__stat-text">{streak}</span>

          {openStreak && (
            <div className="topbar__menu topbar__menu--streak" role="menu" onClick={(e) => e.stopPropagation()}>
              <div className="streak-card">
                <div className="streak-card__header">
                  <div className="streak-card__left">
                    <div className="streak-main">
                      <div className="streak-badge">
                        <img src="/streak.png" alt="streak" className="streak-badge-img" />
                      </div>
                      <div
                        className="streak-number" 
                        onClick={(e) => {
                          if (import.meta.env.DEV && e.altKey) {
                            const val = prompt('Simulate future days (positive integer)');
                            const n = Number(val);
                            if (Number.isInteger(n) && n > 0) simulateFutureDays(n);
                          }
                        }}
                      >{streak}</div>
                    </div>
                    
                  </div>
                 
                </div>

                <div className="streak-week-row">
                  {Array.from({ length: 7 }).map((_, idx) => {
                    const now = new Date();
                    const todayDow = now.getDay(); // 0=Sun, 1=Mon ... 6=Sat
                    const mondayOffset = todayDow === 0 ? -6 : 1 - todayDow;
                    const baseMonday = new Date(now);
                    baseMonday.setHours(0, 0, 0, 0);
                    baseMonday.setDate(now.getDate() + mondayOffset);

                    const cellDate = new Date(baseMonday);
                    cellDate.setDate(baseMonday.getDate() + idx);

                    const t0 = new Date(now);
                    t0.setHours(0, 0, 0, 0);
                    const c0 = new Date(cellDate);
                    c0.setHours(0, 0, 0, 0);
                    const isFuture = c0.getTime() > t0.getTime();
                    const hasActivity = !!weeklyActivity[idx];
                    const isCompleted = hasActivity && !isFuture;

                    const dayClass = isCompleted ? 'is-done' : isFuture ? 'is-next' : 'is-missed';
                    const weekdayLetters = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
                    const label = weekdayLetters[cellDate.getDay()];

                    return (
                      <div key={idx} className={`streak-day ${dayClass}`}>
                        {isCompleted && <img src="/streak.png" alt="done" className="streak-icon" />}
                        {!isCompleted && !isFuture && <FontAwesomeIcon icon={faXmark} className="streak-x" />}
                        {!isCompleted && isFuture && <img src="/streak.png" alt="next" className="streak-icon streak-icon--muted" />}
                        <span className="day-label">{label}</span>
                      </div>
                    );
                  })}
                </div>

               

                <div className="streak-leaderboard">
                  <ul>
                    {leaderboard.length > 0 ? (
                      leaderboard.map((user) => (
                        <li key={user.rank}>
                          <div className="streak-leaderboard__left">
                            <span className="rank">#{user.rank}</span>
                            <span className="user">@{user.username}</span>
                          </div>
                          <span className="score">{user.streak}</span>
                        </li>
                      ))
                    ) : (
                      <li style={{ justifyContent: 'center', color: '#999' }}>
                        <span>-</span>
                      </li>
                    )}
                  </ul>
                </div>

                <div className="streak-footer">
                  <button className="streak-help">Check in everyday to extend your streak!</button>
                </div>
              </div>
            </div>
          )}
        </div>

        <div
          className="topbar__stat topbar__stat--lightning"
          role="button"
          aria-haspopup="true"
          aria-expanded={openLightning}
          onClick={() => setOpenLightning((s) => !s)}
        >
          <img src="/lightning.png" alt="Lightning" className="topbar__streak" />
          <span className="topbar__stat-text">{lightning}</span>

          {openLightning && (
            <div className="topbar__menu topbar__menu--lightning" role="menu" onClick={(e) => e.stopPropagation()}>
              <button className="topbar__menu-item" role="menuitem">
                <span>Boost Power</span>
                <span className="topbar__menu-item-icon" aria-hidden="true">
                  <HugeiconsIcon icon={Filter} />
                </span>
              </button>
            </div>
          )}
        </div>

        <div
          className="topbar__stat topbar__stat--coins"
          role="button"
          aria-haspopup="true"
          aria-expanded={openCoins}
          onClick={() => setOpenCoins((s) => !s)}
        >
          <img src="/coin.png" alt="Coins" className="topbar__coin" />
          <span className="topbar__stat-text">{coins}</span>

          {openCoins && (
            <div className="topbar__menu topbar__menu--coins" role="menu" onClick={(e) => e.stopPropagation()}>
              <button className="topbar__menu-item" role="menuitem">
                <span>Shop</span>
                <span className="topbar__menu-item-icon" aria-hidden="true">
                  <HugeiconsIcon icon={UserIcon} />
                </span>
              </button>
            </div>
          )}
        </div>

        <div
          className="topbar__profile"
          role="button"
          aria-haspopup="true"
          aria-expanded={open}
          onClick={() => setOpen((s) => !s)}
        >
          <img src="/profile.png" alt="Profile" className="topbar__avatar" />
          <FontAwesomeIcon icon={faAngleDown} className="topbar__caret" />

          {open && (
            <div className="topbar__menu" role="menu" onClick={(e) => e.stopPropagation()}>
              <button className="topbar__menu-item" role="menuitem">
                <span>Profile</span>
                <span className="topbar__menu-item-icon" aria-hidden="true">
                  <HugeiconsIcon icon={UserIcon} />
                </span>
              </button>
              <div className="topbar__menu-divider" />
              <button className="topbar__menu-item" role="menuitem">
                <span>Settings</span>
                <span className="topbar__menu-item-icon" aria-hidden="true">
                  <HugeiconsIcon icon={Settings01Icon} />
                </span>
              </button>
               <div className="topbar__menu-divider" />
              <button className="topbar__menu-item" role="menuitem">
                <span>Contact Support</span>
                <span className="topbar__menu-item-icon" aria-hidden="true">
                  <HugeiconsIcon icon={SentIcon} />
                </span>
              </button>
              <div className="topbar__menu-divider" />
               <button className="topbar__menu-item" role="menuitem">
                <span>Join our Discord</span>
                <span className="topbar__menu-item-icon" aria-hidden="true">
                  <HugeiconsIcon icon={DiscordIcon} />
                </span>
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
