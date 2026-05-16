import { useEffect, useState } from "react";
import { auth, onAuthStateChanged } from "../firebase";
import { useNavigate } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faAngleDown, faMagnifyingGlass, faCheck, faHeart } from "@fortawesome/free-solid-svg-icons";
import { db, collection, getDocs, doc, setDoc, deleteDoc, serverTimestamp } from "../firebase";

export default function CommunityPacks() {
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedTags, setSelectedTags] = useState([]);
  const [openDropdown, setOpenDropdown] = useState(null);
  const [allPacks, setAllPacks] = useState([]);
  const [topPacks, setTopPacks] = useState([]);
  const [searchResults, setSearchResults] = useState(null);
  const [loading, setLoading] = useState(true);
  const [availableTags, setAvailableTags] = useState([]);
  const [isScrolled, setIsScrolled] = useState(false);
  const [isDesktop, setIsDesktop] = useState(() => typeof window !== "undefined" ? window.innerWidth >= 1025 : true);
  const [currentUser, setCurrentUser] = useState(null);
  const [animatedLikeKey, setAnimatedLikeKey] = useState(null);

  const isCurriculumTag = (tag) =>
    /^\d{4}$/.test(tag) ||
    /^grade\s?\d{1,2}$/i.test(tag) ||
    /^(igcse|gcse|a-level|ib|ap|sat|act)$/i.test(tag);

  const subjectTags = availableTags.filter((tag) => !isCurriculumTag(tag));
  const curriculumTags = availableTags.filter((tag) => isCurriculumTag(tag));

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (!e.target.closest(".community-filter-dropdown")) {
        setOpenDropdown(null);
      }
    };

    const scrollContainer = document.querySelector(".content");
    const handleScroll = () => {
      const scrollTop = scrollContainer ? scrollContainer.scrollTop : window.scrollY;
      setIsScrolled(scrollTop > 0);
    };

    document.addEventListener("click", handleClickOutside);
    handleScroll();
    if (scrollContainer) {
      scrollContainer.addEventListener("scroll", handleScroll, { passive: true });
    } else {
      window.addEventListener("scroll", handleScroll, { passive: true });
    }
    return () => {
      document.removeEventListener("click", handleClickOutside);
      if (scrollContainer) {
        scrollContainer.removeEventListener("scroll", handleScroll);
      } else {
        window.removeEventListener("scroll", handleScroll);
      }
    };
  }, []);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setCurrentUser(u));
    return () => unsub && unsub();
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    const handleResize = () => {
      const desktop = window.innerWidth >= 1025;
      setIsDesktop(desktop);
      if (!desktop) setIsScrolled(false);
    };

    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // Keep normal page scrolling enabled.

  // Fetch all packs on mount
  useEffect(() => {
    let cancelled = false;

    const fetchAllPacks = async () => {
      try {
        const usersSnapshot = await getDocs(collection(db, "users"));
        const packs = [];

        for (const userDoc of usersSnapshot.docs) {
          const userData = userDoc.data() || {};
          const ownerName = userData.displayName || userData.name || null;
          const ownerEmail =
            userData.email ||
            userData.contactEmail ||
            (userData.profile && userData.profile.email) ||
            (userData.owner && userData.owner.email) ||
            null;
          const ownerUsername = userData.Username || null;

          // Ensure a `Username` field exists on user docs. Default to email prefix if available.
          try {
            if (!userData.Username) {
              const emailForUsername = ownerEmail || userData.email || null;
              if (emailForUsername) {
                const usernameDefault = String(emailForUsername).split("@")[0];
                // write back to Firestore (merge)
                await setDoc(doc(db, "users", userDoc.id), { Username: usernameDefault }, { merge: true });
                // reflect in local userData for immediate use
                userData.Username = usernameDefault;
              }
            }
          } catch (err) {
            console.error("Error setting default Username for user", userDoc.id, err);
          }
          const packsSnapshot = await getDocs(
            collection(db, "users", userDoc.id, "packs")
          );
          for (const packDoc of packsSnapshot.docs) {
            const packData = packDoc.data() || {};
            const likesSnapshot = await getDocs(collection(db, "users", userDoc.id, "packs", packDoc.id, "likes"));
            const likesCount = likesSnapshot.size;
            const likedByMe = !!currentUser?.uid && likesSnapshot.docs.some((likeDoc) => likeDoc.id === currentUser.uid);
            packs.push({
              id: packDoc.id,
              uid: userDoc.id,
              ownerName,
              ownerEmail: ownerEmail || packData.ownerEmail || null,
              ownerUsername: ownerUsername || packData.ownerUsername || null,
              ...packData,
              likes: likesCount || Number(packData.likes ?? packData.hearts ?? 0),
              views: Number(packData.views ?? 0),
              likedByMe,
            });
          }
        }

        if (cancelled) return;
        setAllPacks(packs);
        // Show top packs by most cards
        setTopPacks(packs.sort((a, b) => (b.cards || 0) - (a.cards || 0)).slice(0, 12));
        
        // Extract all unique tags from packs
        const tags = new Set();
        packs.forEach((pack) => {
          if (pack.tags && Array.isArray(pack.tags)) {
            pack.tags.forEach(tag => tags.add(tag));
          }
        });
        setAvailableTags(Array.from(tags).sort());
      } catch (err) {
        console.error("Error fetching community packs:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchAllPacks();
    return () => {
      cancelled = true;
    };
  }, [currentUser?.uid]);

  // Prevent page scrolling while community packs are loading.
  // Also disable scrolling on the main `.content` container if present.
  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    const body = document.body;
    const contentEls = Array.from(document.querySelectorAll(".content, .content--pack-detail"));

    const prevBodyOverflow = body.style.overflow;
    const prevContentOverflows = contentEls.map((el) => el.style.overflow);

    if (loading) {
      body.style.overflow = "hidden";
      contentEls.forEach((el) => (el.style.overflow = "hidden"));
    } else {
      body.style.overflow = prevBodyOverflow || "";
      contentEls.forEach((el, i) => (el.style.overflow = prevContentOverflows[i] || ""));
    }

    return () => {
      body.style.overflow = prevBodyOverflow || "";
      contentEls.forEach((el, i) => (el.style.overflow = prevContentOverflows[i] || ""));
    };
  }, [loading]);

  // Real-time search as user types
  useEffect(() => {
    if (searchTerm.trim()) {
      const stopWords = new Set(["the", "and", "for", "with", "about", "make", "create", "give", "me", "a", "an", "pack", "study", "show", "find", "search"]);
      const tokenize = (value) =>
        String(value || "")
          .toLowerCase()
          .replace(/[^a-z0-9\s]/g, " ")
          .split(/\s+/)
          .filter((token) => (token.length > 1 || /^\d+$/.test(token)) && !stopWords.has(token));

      const queryTokens = tokenize(searchTerm);
      const numericTokens = queryTokens.filter((t) => /\d+/.test(t));

      const scorePack = (pack) => {
        const packTokens = tokenize([pack.name, pack.subject, ...(pack.tags || [])].flat().join(" "));
        const packText = packTokens.join(" ");

        let score = 0;
        for (const token of queryTokens) {
          if (packTokens.includes(token)) score += 3;
          else if (packTokens.some((word) => word.startsWith(token) || token.startsWith(word))) score += 2;
          else if (packText.includes(token)) score += 1;
        }

        // bonus for multiple overlapping words in any order
        score += queryTokens.filter((token) => packText.includes(token)).length * 0.5;
        return score;
      };

      // Helper to check whether a token matches a pack (words or text)
      const tokenMatchesPack = (token, packTokens, packText) => {
        if (!token) return false;
        // numeric tokens must match whole word (avoid '3' matching '13')
        if (/^\d+$/.test(token)) {
          return packText.split(/\s+/).some((w) => w === token);
        }
        if (packTokens.includes(token)) return true;
        if (packTokens.some((word) => word.startsWith(token) || token.startsWith(word))) return true;
        if (packText.includes(token)) return true;
        return false;
      };

      // If the query contains numeric tokens, first narrow by those exact numbers, otherwise start with all packs
      const candidatePacks = numericTokens.length > 0
        ? allPacks.filter((pack) => {
            const hay = [pack.name, pack.subject, ...(pack.tags || [])].join(" ").toLowerCase();
            const digitSeqs = (hay.match(/\d+/g) || []);
            return numericTokens.every((nt) => digitSeqs.some((seq) => seq === nt));
          })
        : allPacks;

      // Require that every query token matches the pack (AND semantics)
      const filteredByAllTokens = candidatePacks.filter((pack) => {
        const packTokens = tokenize([pack.name, pack.subject, ...(pack.tags || [])].flat().join(" "));
        const packText = packTokens.join(" ");
        return queryTokens.every((token) => tokenMatchesPack(token, packTokens, packText));
      });

      const scored = filteredByAllTokens
        .map((pack) => ({ pack, score: scorePack(pack) }))
        .sort((a, b) => b.score - a.score);

      const exactHits = scored.filter(({ score }) => score > 0).map(({ pack }) => pack);
      setSearchResults(exactHits.length > 0 ? exactHits : scored.slice(0, 3).map(({ pack }) => pack));
    } else {
      setSearchResults(null);
    }
  }, [searchTerm, allPacks]);

  const handleSearch = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
    }
  };

  const handleClearSearch = () => {
    setSearchTerm("");
    setSearchResults(null);
  };

  const toggleTag = (tag) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  };

  const renderDropdown = (label, tags, dropdownKey) => (
    <div className="community-filter-dropdown" style={{ position: "relative" }}>
      <button
        type="button"
        className="community-filter-dropdown__button"
        onClick={() => setOpenDropdown((prev) => (prev === dropdownKey ? null : dropdownKey))}
        aria-haspopup="menu"
        aria-expanded={openDropdown === dropdownKey}
      >
        <span>{label}</span>
        <FontAwesomeIcon icon={faAngleDown} />
      </button>

      {openDropdown === dropdownKey && (
        <div className="community-filter-dropdown__menu" role="menu">
          {tags.length > 0 ? (
            tags.map((tag) => {
              const selected = selectedTags.includes(tag);
              return (
                <button
                  key={tag}
                  type="button"
                  className={`community-filter-dropdown__item ${selected ? "is-selected" : ""}`}
                  role="menuitem"
                  onClick={() => {
                    toggleTag(tag);
                  }}
                >
                  <span>{tag}</span>
                  <span className="community-filter-dropdown__check" aria-hidden="true">
                    {selected ? <FontAwesomeIcon icon={faCheck} /> : ""}
                  </span>
                </button>
              );
            })
          ) : (
            <div className="community-filter-dropdown__empty">No options available</div>
          )}
        </div>
      )}
    </div>
  );

  const getFilteredPacks = () => {
    let filtered = searchResults !== null ? searchResults : topPacks;
    
    if (selectedTags.length > 0) {
      filtered = filtered.filter((pack) => {
        const packTags = pack.tags || [];
        return selectedTags.some((tag) => packTags.includes(tag));
      });
    }
    // Exclude packs created by the signed-in user
    if (currentUser?.uid) {
      filtered = filtered.filter((pack) => pack.uid !== currentUser.uid);
    }

    return filtered;
  };

  const displayPacks = getFilteredPacks();
  const showScrollBlur = isDesktop && isScrolled;

  return (
    <section className="packs-page">
      <div className="packs-page__container">
        <div className="community-packs-header">
          <h1 className="community-pack__title">Community Library</h1>
          <div
            className="community-packs-search" style={{ marginBottom: 0 }}
          >
            <FontAwesomeIcon icon={faMagnifyingGlass} style={{ color: "#000000ff", fontSize: "20px" }} />
            <input
              type="text"
              placeholder="Search packs by name..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              onKeyDown={handleSearch}
              style={{
                flex: 1,
                border: "none",
                background: "transparent",
                fontSize: 16,
                fontFamily: "Sora, sans-serif",
                fontWeight: 400,
                outline: "none",
              }}
            />
          </div>
            

        </div>

        {/* Always render filter dropdowns so controls are available immediately.
            Show skeleton cards at the top-right while loading. */}
        <div style={{ marginBottom: 20, display: "flex", gap: 12, alignItems: "flex-start", justifyContent: "space-between" }}>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            {renderDropdown("Subject", subjectTags, "subject")}
            {renderDropdown("Curriculum", curriculumTags, "curriculum")}
          </div>
        </div>

        <div className="community-packs-list">
          {loading ? (
            <>
              <div className="skeleton-cards">
                {[1,2,3].map((n) => (
                  <div className="skeleton-community-card" key={n} aria-hidden>
                    <div className="skeleton-community-card__color skeleton-animate" />
                    <div className="skeleton-community-card__content">
                      <div className="skeleton-line skeleton-animate" style={{ width: '60%', height: 14, borderRadius: 8 }} />
                      <div className="skeleton-line skeleton-animate" style={{ width: '30%', height: 12, borderRadius: 6, marginTop: 8 }} />
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : displayPacks.length > 0 ? (
            displayPacks.map((pack, idx) => (
              <div
                key={`${pack.uid}-${pack.id}`}
                className="community-pack-card"
                style={{ position: 'relative', ['--i']: idx }}
                role="button"
                tabIndex={0}
                onClick={() => navigate(`/packs/${pack.uid}/${pack.id}`)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    navigate(`/packs/${pack.uid}/${pack.id}`);
                  }
                }}
              >
                <div
                  className="community-pack-card__color"
                  style={{
                    background: `linear-gradient(135deg, ${pack.color}cc 0%, ${pack.color} 100%)`,
                  }}
                ></div>
                <div className="community-pack-card__content">
                  <h3 className="community-pack-card__title">{pack.name}</h3>
                  <p className="community-pack-card__count">
                    {pack.cards} {pack.cards === 1 ? "card" : "cards"}
                  </p>
                  <div className="community-pack-card__meta">
                    <div>
                      <div className="community-pack-card__madeby">Made by {pack.ownerUsername || pack.ownerEmail || pack.ownerName || 'unknown'}</div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <div className="community-pack-card__mini">{(pack.views || 0).toLocaleString()} studies</div>
                      <div className="community-pack-card__heart-wrap" onClick={(e) => e.stopPropagation()}>
                        <label className={`heart-container ${pack.likedByMe ? "is-liked" : ""} ${animatedLikeKey === `${pack.uid}-${pack.id}` ? "is-animating" : ""}`} title={pack.likedByMe ? "Unlike" : "Like"}>
                          <input
                            type="checkbox"
                            className="checkbox"
                            id={`like-${pack.uid}-${pack.id}`}
                            checked={!!pack.likedByMe}
                            onChange={async (e) => {
                              if (!currentUser) {
                                alert("Please sign in to like a pack.");
                                return;
                              }

                              const likeKey = `${pack.uid}-${pack.id}`;
                              const prevCount = Number(pack.likes ?? pack.hearts ?? 0);
                              const nextLiked = e.target.checked;
                              const nextCount = nextLiked ? prevCount + 1 : Math.max(0, prevCount - 1);
                              const likeRef = doc(db, "users", pack.uid, "packs", pack.id, "likes", currentUser.uid);

                              e.stopPropagation();
                              if (nextLiked) {
                                setAnimatedLikeKey(likeKey);
                                window.setTimeout(() => setAnimatedLikeKey((current) => (current === likeKey ? null : current)), 500);
                              } else {
                                setAnimatedLikeKey(null);
                              }

                              setAllPacks((prev) => prev.map((p) => (p.uid === pack.uid && p.id === pack.id ? { ...p, likes: nextCount, likedByMe: nextLiked } : p)));
                              setTopPacks((prev) => prev.map((p) => (p.uid === pack.uid && p.id === pack.id ? { ...p, likes: nextCount, likedByMe: nextLiked } : p)));

                              try {
                                if (nextLiked) {
                                  await setDoc(likeRef, {
                                    likerUid: currentUser.uid,
                                    packOwnerUid: pack.uid,
                                    packId: pack.id,
                                    createdAt: serverTimestamp(),
                                  });
                                } else {
                                  await deleteDoc(likeRef);
                                }
                              } catch (err) {
                                console.error("Error updating likes:", err);
                                setAllPacks((prev) => prev.map((p) => (p.uid === pack.uid && p.id === pack.id ? { ...p, likes: prevCount, likedByMe: !nextLiked } : p)));
                                setTopPacks((prev) => prev.map((p) => (p.uid === pack.uid && p.id === pack.id ? { ...p, likes: prevCount, likedByMe: !nextLiked } : p)));
                                alert(err?.message || "Could not update like state. Try again later.");
                              }
                            }}
                          />
                          <div className="svg-container">
                            <svg viewBox="0 0 24 24" className="svg-outline" xmlns="http://www.w3.org/2000/svg">
                              <path d="M17.5,1.917a6.4,6.4,0,0,0-5.5,3.3,6.4,6.4,0,0,0-5.5-3.3A6.8,6.8,0,0,0,0,8.967c0,4.547,4.786,9.513,8.8,12.88a4.974,4.974,0,0,0,6.4,0C19.214,18.48,24,13.514,24,8.967A6.8,6.8,0,0,0,17.5,1.917Zm-3.585,18.4a2.973,2.973,0,0,1-3.83,0C4.947,16.006,2,11.87,2,8.967a4.8,4.8,0,0,1,4.5-5.05A4.8,4.8,0,0,1,11,8.967a1,1,0,0,0,2,0,4.8,4.8,0,0,1,4.5-5.05A4.8,4.8,0,0,1,22,8.967C22,11.87,19.053,16.006,13.915,20.313Z" />
                            </svg>
                            <svg viewBox="0 0 24 24" className="svg-filled" xmlns="http://www.w3.org/2000/svg">
                              <path d="M17.5,1.917a6.4,6.4,0,0,0-5.5,3.3,6.4,6.4,0,0,0-5.5-3.3A6.8,6.8,0,0,0,0,8.967c0,4.547,4.786,9.513,8.8,12.88a4.974,4.974,0,0,0,6.4,0C19.214,18.48,24,13.514,24,8.967A6.8,6.8,0,0,0,17.5,1.917Z" />
                            </svg>
                            <svg className="svg-celebrate" width="40" height="40" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
                              <polygon points="10,10 20,20"></polygon>
                              <polygon points="10,50 20,50"></polygon>
                              <polygon points="20,80 30,70"></polygon>
                              <polygon points="90,10 80,20"></polygon>
                              <polygon points="90,50 80,50"></polygon>
                              <polygon points="80,80 70,70"></polygon>
                            </svg>
                          </div>
                        </label>
                        <span className="community-pack-card__heart-count">{pack.likes ?? pack.hearts ?? 0}</span>
                      </div>
                    </div>
                  </div>
                  {/* tags removed from card display per request */}
                </div>
              </div>
            ))
          ) : (
            <p style={{ marginLeft: "5px", fontSize: 17, fontWeight: 500, color: "#000000ff" }}>No packs found.</p>
          )}
        </div>
      </div>
    </section>
  );
}
