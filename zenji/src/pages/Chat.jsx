import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { auth, db, collection, getDocs, addDoc, updateDoc, doc, serverTimestamp, onAuthStateChanged } from "../firebase";
import { generateTags } from "../utils/generateTags";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Upload01Icon,
  Clipboard,
  YoutubeIcon,
  Mic02Icon,
  Layer,
  ThumbsUpIcon,
  ThumbsDownIcon,
  Folder,
} from "@hugeicons/core-free-icons";

import { faPlus, faMicrophone, faPen, faFileLines, faU } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { showToast } from "../utils/toast.js";


export default function Chat() {
  const location = useLocation();
  const navigate = useNavigate();
  const [messages, setMessages] = useState([]);
  const [inputValue, setInputValue] = useState("");
  const [attachedImage, setAttachedImage] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [lastMessageTime, setLastMessageTime] = useState(null);
  const [voiceMode, setVoiceMode] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const [packCreationProgress, setPackCreationProgress] = useState(null);
  const [recommendedPacks, setRecommendedPacks] = useState([]);
  const [sessionDividerIndex, setSessionDividerIndex] = useState(null);
  const messagesEndRef = useRef(null);
  const sendingRef = useRef(false);
  const imageInputRef = useRef(null);
  const recognitionRef = useRef(null);
  const currentAbortRef = useRef(null);
  const pendingVoiceFollowupRef = useRef(false);
  const shouldResumeListeningRef = useRef(false);
  const spokenMessageIdsRef = useRef(new Set());
  const messageIdCounterRef = useRef(0);
  const SESSION_TIMEOUT_MS = 5 * 60 * 1000;

  const nextMessageId = () => {
    messageIdCounterRef.current = (messageIdCounterRef.current + 1) % 1000;
    return Date.now() * 1000 + messageIdCounterRef.current;
  };

  const MISTRAL_API_KEY = "Me5iM5ruiQSY65DVRE5xwpqofVmU6Nkg";
  const MISTRAL_API_URL = "https://api.mistral.ai/v1/chat/completions";
  const SYSTEM_PROMPT =
    "You are Knowji, the user's personal tutor and study companion. Keep every reply short, simple, sweet, and direct. Do not write stories, long explanations, or rambling text. Avoid using too many emoji's per message. Use at most 3-5 short sentences even if the user explicitly asks for way too much detail. If the user asks what AI you are, say you are Knowji, the user's personal tutor. When there are 2 or more related items, especially recall lists, comparisons, tests, or 'X → Y' notes, format them as a clean markdown table with clear headers instead of plain lines. Use headings and dividers to keep answers neat. Prefer concise bullets or a short table when helpful. Ensure spaces are correctly added for a clean visual message. IMPORTANT: Never offer 'Quick Options' or present menu-style options. Never suggest options like 🎯 Quick Options, 🧠 Study, 💬 Chat, 🔍 Research. Always respond directly to the user's query without offering choices or menus.";

  // Track current user
  useEffect(() => {
    const unsubAuth = onAuthStateChanged(auth, (user) => {
      setCurrentUser(user);
    });
    return () => unsubAuth && unsubAuth();
  }, []);

  const getSpeechRecognition = () => window.SpeechRecognition || window.webkitSpeechRecognition || null;

  const stopVoiceListening = () => {
    const recognition = recognitionRef.current;
    if (recognition) {
      try {
        recognition.onresult = null;
        recognition.onend = null;
        recognition.onerror = null;
        recognition.stop();
      } catch {
        // ignore stop errors
      }
    }
    recognitionRef.current = null;
    setIsListening(false);
  };

  const stopSpeaking = () => {
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
  };

  const pickNaturalVoice = () => {
    if (typeof window === "undefined" || !window.speechSynthesis) return null;

    const voices = window.speechSynthesis.getVoices?.() || [];
    if (!voices.length) return null;

    const preferredNames = [
      /Samantha/i,
      /Google (US|UK) English/i,
      /Microsoft (Aria|Jenny|Guy)/i,
      /Apple/i,
      /Natural/i,
      /Daniel/i,
      /Karen/i,
      /Siri/i,
      /Zira/i,
      /Hazel/i,
    ];

    const matchByPattern = (voice) => preferredNames.some((pattern) => pattern.test(voice.name || ""));

    return (
      voices.find((voice) => voice.lang?.toLowerCase().startsWith("en") && matchByPattern(voice)) ||
      voices.find((voice) => voice.lang?.toLowerCase().startsWith("en")) ||
      voices[0] ||
      null
    );
  };

  const interruptActiveResponse = () => {
    if (currentAbortRef.current) {
      currentAbortRef.current.abort();
      currentAbortRef.current = null;
    }
    stopSpeaking();
    sendingRef.current = false;
    setIsLoading(false);
  };

  const speakText = (text) => {
    if (!voiceMode || !text?.trim() || !window.speechSynthesis) return;

    stopSpeaking();

    const utterance = new SpeechSynthesisUtterance(text);
    const voice = pickNaturalVoice();
    if (voice) utterance.voice = voice;
    utterance.rate = 0.97;
    utterance.pitch = 1.05;
    utterance.volume = 1;

    utterance.onstart = () => {
      shouldResumeListeningRef.current = true;
    };

    utterance.onend = () => {
      if (voiceMode) {
        shouldResumeListeningRef.current = false;
        startVoiceListening();
      }
    };

    utterance.onerror = () => {
      if (voiceMode) startVoiceListening();
    };

    window.speechSynthesis.speak(utterance);
  };

  const startVoiceListening = () => {
    const SpeechRecognition = getSpeechRecognition();
    if (!SpeechRecognition || !voiceMode) return;
    if (isLoading || sendingRef.current) return;
    if (recognitionRef.current) return;

    const recognition = new SpeechRecognition();
    recognition.lang = "en-US";
    recognition.interimResults = false;
    recognition.continuous = false;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      setIsListening(true);
    };

    recognition.onresult = (event) => {
      const transcript = Array.from(event.results)
        .map((result) => result[0]?.transcript || "")
        .join(" ")
        .trim();

      if (!transcript) return;

      interruptActiveResponse();
      pendingVoiceFollowupRef.current = true;
      setInputValue(transcript);

      setTimeout(() => {
        handleSendMessage(transcript);
      }, 0);
    };

    recognition.onerror = (event) => {
      if (event.error !== "aborted" && event.error !== "no-speech") {
        console.error("Speech recognition error:", event.error);
      }
      recognitionRef.current = null;
      setIsListening(false);
      if (voiceMode && !isLoading && !sendingRef.current) {
        setTimeout(() => startVoiceListening(), 400);
      }
    };

    recognition.onend = () => {
      recognitionRef.current = null;
      setIsListening(false);
      if (voiceMode && !isLoading && !sendingRef.current) {
        setTimeout(() => startVoiceListening(), 250);
      }
    };

    recognitionRef.current = recognition;

    try {
      recognition.start();
    } catch (error) {
      console.error("Could not start voice recognition:", error);
      recognitionRef.current = null;
      setIsListening(false);
    }
  };

  // Render formatted text with simple markdown + table support
  const renderFormattedText = (text) => {
    const raw = String(text || "");
    const lines = raw.split("\n");
    const items = [];

    const parseInline = (input, lineIndex) => {
      const parts = [];
      let lastIndex = 0;

      // Process LaTeX and markdown in order
      const matches = [];

      // Find all LaTeX patterns: $$...$$, $...$, \[...\], \(...\)
      const displayMathDollar = /\$\$([\s\S]*?)\$\$/g;
      let m;
      while ((m = displayMathDollar.exec(input)) !== null) {
        matches.push({ start: m.index, end: m.index + m[0].length, type: "math-display", content: m[1] });
      }

      const inlineMathDollar = /\$([^\n$]+)\$/g;
      while ((m = inlineMathDollar.exec(input)) !== null) {
        matches.push({ start: m.index, end: m.index + m[0].length, type: "math-inline", content: m[1] });
      }

      const displayMathBracket = /\\\[([\s\S]*?)\\\]/g;
      while ((m = displayMathBracket.exec(input)) !== null) {
        matches.push({ start: m.index, end: m.index + m[0].length, type: "math-display", content: m[1] });
      }

      const inlineMathBracket = /\\\(([\s\S]*?)\\\)/g;
      while ((m = inlineMathBracket.exec(input)) !== null) {
        matches.push({ start: m.index, end: m.index + m[0].length, type: "math-inline", content: m[1] });
      }

      // Find markdown patterns
      const boldPattern = /\*\*([^*]+)\*\*/g;
      while ((m = boldPattern.exec(input)) !== null) {
        matches.push({ start: m.index, end: m.index + m[0].length, type: "bold", content: m[1] });
      }

      const italicPattern = /\*([^*]+)\*/g;
      while ((m = italicPattern.exec(input)) !== null) {
        matches.push({ start: m.index, end: m.index + m[0].length, type: "italic", content: m[1] });
      }

      const codePattern = /`([^`]+)`/g;
      while ((m = codePattern.exec(input)) !== null) {
        matches.push({ start: m.index, end: m.index + m[0].length, type: "code", content: m[1] });
      }

      const linkPattern = /\[([^\]]+)\]\(([^)]+)\)/g;
      while ((m = linkPattern.exec(input)) !== null) {
        matches.push({ start: m.index, end: m.index + m[0].length, type: "link", text: m[1], url: m[2] });
      }

      // Sort matches by position and remove overlaps (prefer earlier matches)
      matches.sort((a, b) => a.start - b.start);
      const filtered = [];
      for (const match of matches) {
        if (!filtered.some(f => (match.start >= f.start && match.start < f.end) || (match.end > f.start && match.end <= f.end))) {
          filtered.push(match);
        }
      }

      // Build the parts array
      for (const match of filtered) {
        if (match.start > lastIndex) {
          parts.push(input.slice(lastIndex, match.start));
        }

        const key = `${lineIndex}-${match.start}`;
        switch (match.type) {
          case "math-display":
            parts.push(
              <span key={key} className="latex-display">
                {renderMath(match.content, true)}
              </span>
            );
            break;
          case "math-inline":
            parts.push(
              <span key={key} className="latex-inline">
                {renderMath(match.content, false)}
              </span>
            );
            break;
          case "bold":
            parts.push(<strong key={key}>{match.content}</strong>);
            break;
          case "italic":
            parts.push(<em key={key}>{match.content}</em>);
            break;
          case "code":
            parts.push(<code key={key}>{match.content}</code>);
            break;
          case "link":
            parts.push(
              <a key={key} href={match.url} target="_blank" rel="noreferrer">
                {match.text}
              </a>
            );
            break;
          default:
            break;
        }

        lastIndex = match.end;
      }

      if (lastIndex < input.length) {
        parts.push(input.slice(lastIndex));
      }

      return parts;
    };

    const splitRow = (row) =>
      row
        .split("|")
        .map((c) => c.trim())
        .filter((c, idx, arr) => !(c === "" && (idx === 0 || idx === arr.length - 1)));

    for (let i = 0; i < lines.length; i++) {
      const rawLine = lines[i];
      const trimmed = rawLine.trim();

      if (!trimmed) {
        items.push(<br key={`br-${i}`} />);
        continue;
      }

      if (trimmed.startsWith("|") && i + 1 < lines.length) {
        const next = lines[i + 1].trim();
        if (/^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(next)) {
          const headerCells = splitRow(trimmed);
          const rows = [];
          i += 2;
          while (i < lines.length && lines[i].trim().startsWith("|")) {
            rows.push(splitRow(lines[i].trim()));
            i++;
          }
          i--;

          items.push(
            <div key={`table-wrap-${i}`} className="chat-table-wrap">
              <table className="chat-table">
                <thead>
                  <tr>
                    {headerCells.map((h, idx) => (
                      <th key={idx}>{parseInline(h, `h-${i}-${idx}`)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, ridx) => (
                    <tr key={ridx}>
                      {headerCells.map((_, cidx) => (
                        <td key={cidx}>{parseInline(r[cidx] ?? "", `r-${ridx}-${cidx}`)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>,
          );
          continue;
        }
      }

      const isHeading = /^#{1,6}\s+/.test(trimmed);
      const isDivider = /^(---|\*\*\*|___)\s*$/.test(trimmed);
      const isListItem = /^[-*]\s+/.test(trimmed);
      const content = trimmed.replace(/^#{1,6}\s+|^[-*]\s+/, "");

      if (isDivider) {
        items.push(<hr key={`hr-${i}`} className="chat-divider" />);
      } else if (isHeading) {
        const level = (trimmed.match(/^#{1,6}/) || [""])[0].length;
        items.push(
          <div key={`h-${i}`} className={`chat-message__markdown-heading chat-message__markdown-h${level}`}>
            {parseInline(content, i)}
          </div>,
        );
      } else if (isListItem) {
        items.push(
          <div key={`li-${i}`} className="chat-message__markdown-list-item">
            <span className="chat-bullet" aria-hidden="true" />
            <span className="chat-list-text">{parseInline(content, i)}</span>
          </div>,
        );
      } else {
        items.push(
          <div key={`p-${i}`} className="chat-message__markdown-paragraph">
            {parseInline(content, i)}
          </div>,
        );
      }
    }

    return items;
  };

  const renderMath = (tex, displayMode = false) => {
    try {
      if (typeof window !== "undefined" && window.katex?.renderToString) {
        const html = window.katex.renderToString(tex, { throwOnError: false, displayMode });
        return <span className="chat-math" dangerouslySetInnerHTML={{ __html: html }} />;
      }
    } catch (e) {
      console.error("KaTeX render error", e);
    }
    return <code>{displayMode ? `$$${tex}$$` : `$${tex}$`}</code>;
  };

  const getFeatureCount = (seed) => {
    const n = Number(seed);
    if (Number.isFinite(n)) return (Math.abs(n) % 3) + 1;
    return Math.floor(Math.random() * 3) + 1;
  };

  const copyMessageText = async (text) => {
    try {
      await navigator.clipboard.writeText(String(text || ""));
      showToast("Message copied.");
    } catch (error) {
      console.error("Copy failed:", error);
    }
  };

  const readFileAsDataUrl = (file) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });

  const handleAttachImageClick = () => {
    imageInputRef.current?.click();
  };

  const handleImageChange = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      return;
    }

    try {
      const dataUrl = await readFileAsDataUrl(file);
      setAttachedImage({
        name: file.name,
        type: file.type,
        dataUrl,
      });
    } catch (error) {
      console.error("Image attachment failed:", error);
    }
  };

  const clearAttachedImage = () => {
    setAttachedImage(null);
  };

  const setFeedback = (messageId, feedback) => {
    const currentMessage = messages.find((message) => message.id === messageId);
    const nextFeedback = currentMessage?.feedback === feedback ? null : feedback;

    setMessages((prev) =>
      prev.map((message) => {
        if (message.id !== messageId) return message;
        return { ...message, feedback: nextFeedback };
      }),
    );

    if (nextFeedback) {
      showToast(nextFeedback === "up" ? "Liked successfully." : "Disliked successfully.");
    }
  };

  useEffect(() => {
    const topic = location.state?.topic?.trim();
    if (!topic) return;

    const timer = setTimeout(() => {
      handleSendMessage(topic);
      // clear navigation state so reload/back doesn't resubmit
      navigate(location.pathname, { replace: true, state: null });
    }, 0);

    return () => clearTimeout(timer);
  }, [location.key, location.state?.topic]);

  useEffect(() => {
    // If navigation provided an initial topic, the other effect will merge and set messages.
    // Skip loading here to avoid overwriting that initial conversation.
    if (location.state?.topic) return;

    const savedMessages = localStorage.getItem("chat_messages");
    const savedFeedback = localStorage.getItem("chat_message_feedback");
    const savedLastMessageTime = localStorage.getItem("chat_last_message_time");
    const savedLastUnloadTime = Number(localStorage.getItem("chat_last_unload_time") || 0);
    let feedbackById = {};

    if (savedFeedback) {
      try {
        feedbackById = JSON.parse(savedFeedback) || {};
      } catch (error) {
        console.error("Failed to load feedback from localStorage:", error);
      }
    }
    
    if (savedMessages) {
      try {
        const parsed = JSON.parse(savedMessages);
        setMessages(
          parsed.map((message) =>
            feedbackById[message.id] ? { ...message, feedback: feedbackById[message.id] } : message,
          ),
        );
        if (savedLastMessageTime) {
          setLastMessageTime(Number(savedLastMessageTime));
        }
        if (savedLastUnloadTime && Date.now() - savedLastUnloadTime > SESSION_TIMEOUT_MS) {
          setSessionDividerIndex(parsed.length);
        } else {
          setSessionDividerIndex(null);
        }
      } catch (error) {
        console.error("Failed to load messages from localStorage:", error);
      }
    } else {
      setSessionDividerIndex(null);
    }
  }, [location.state?.topic]);

  useEffect(() => {
    const persistUnloadTime = () => {
      localStorage.setItem("chat_last_unload_time", String(Date.now()));
    };

    window.addEventListener("beforeunload", persistUnloadTime);
    window.addEventListener("pagehide", persistUnloadTime);
    return () => {
      persistUnloadTime();
      window.removeEventListener("beforeunload", persistUnloadTime);
      window.removeEventListener("pagehide", persistUnloadTime);
    };
  }, []);

  useEffect(() => {
    if (messages.length > 0) {
      localStorage.setItem("chat_messages", JSON.stringify(messages));
    }

    const feedbackMap = messages.reduce((acc, message) => {
      if (message.sender === "ai" && message.feedback) {
        acc[message.id] = message.feedback;
      }
      return acc;
    }, {});

    if (Object.keys(feedbackMap).length > 0) {
      localStorage.setItem("chat_message_feedback", JSON.stringify(feedbackMap));
    } else {
      localStorage.removeItem("chat_message_feedback");
    }

    if (lastMessageTime) {
      localStorage.setItem("chat_last_message_time", String(lastMessageTime));
    }
  }, [messages, lastMessageTime]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Keep normal page scrolling enabled.

  // Search community packs by keywords
  const searchCommunityPacks = async (keywords) => {
    try {
      const usersSnapshot = await getDocs(collection(db, "users"));
      const packs = [];

      for (const userDoc of usersSnapshot.docs) {
        const packsSnapshot = await getDocs(collection(db, "users", userDoc.id, "packs"));
        for (const packDoc of packsSnapshot.docs) {
          packs.push({
            id: packDoc.id,
            uid: userDoc.id,
            ...packDoc.data(),
          });
        }
      }

      // Filter by tokens, not exact order, so mixed-up wording still matches.
      const searchTokens = String(keywords || "")
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((token) => (token.length > 1 || /^\d+$/.test(token)) && !["the", "and", "for", "with", "about", "make", "create", "give", "me", "a", "an", "pack"].includes(token));

      if (searchTokens.length === 0) return [];

      const numericTokens = searchTokens.filter((t) => /\d+/.test(t));

      const tokenize = (value) =>
        String(value || "")
          .toLowerCase()
          .replace(/[^a-z0-9\s]/g, " ")
          .split(/\s+/)
          .filter(Boolean);

      const approxMatch = (query, word) => {
        if (!query || !word) return false;
        if (word.includes(query) || query.includes(word)) return true;
        const q = query.slice(0, 4);
        const w = word.slice(0, 4);
        return q.length >= 3 && q === w;
      };

      const scorePack = (pack) => {
        const words = tokenize([pack.name, pack.subject, ...(pack.tags || [])].flat().join(" "));

        let score = 0;
        for (const token of searchTokens) {
          if (words.some((word) => word === token)) {
            score += 3;
          } else if (words.some((word) => word.startsWith(token) || token.startsWith(word))) {
            score += 2;
          } else if (words.some((word) => approxMatch(token, word))) {
            score += 1;
          }
        }

        // Small bonus for packs that have multiple overlapping words even in different order.
        const packText = words.join(" ");
        const sharedCount = searchTokens.filter((token) => packText.includes(token)).length;
        score += sharedCount * 0.5;
        return score;
      };

      // Helper: require every query token to match a pack (AND semantics)
      const tokenMatchesPack = (token, packWords, packText) => {
        if (!token) return false;
        if (/^\d+$/.test(token)) {
          // numeric token must match whole word
          return packText.split(/\s+/).some((w) => w === token);
        }
        if (packWords.includes(token)) return true;
        if (packWords.some((w) => w.startsWith(token) || token.startsWith(w))) return true;
        if (packText.includes(token)) return true;
        return false;
      };

      // Narrow by numeric tokens first (exact-word match), otherwise consider all packs
      const candidatePacks = numericTokens.length > 0
        ? packs.filter((pack) => {
            const hay = [pack.name, pack.subject, ...(pack.tags || [])].join(" ").toLowerCase();
            const digitSeqs = (hay.match(/\d+/g) || []);
            return numericTokens.every((nt) => digitSeqs.some((seq) => seq === nt));
          })
        : packs;

      const filteredByAllTokens = candidatePacks.filter((pack) => {
        const packWords = tokenize([pack.name, pack.subject, ...(pack.tags || [])].flat().join(" "));
        const packText = packWords.join(" ");
        return searchTokens.every((token) => tokenMatchesPack(token, packWords, packText));
      });

      return filteredByAllTokens
        .map((pack) => ({ pack, score: scorePack(pack) }))
        .filter(({ score }) => score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 3)
        .map(({ pack }) => pack);
    } catch (err) {
      console.error("Error searching packs:", err);
      return [];
    }
  };

  // Detect if user wants to create a pack from message
  const detectPackCreationIntent = (text) => {
    // More flexible: allow words between verb and "pack" (e.g., "generate me a pack", "create a study pack")
    const createKeywords = /\b(create|make|generate|build|add)\b.{0,30}\b(pack|deck|set|bundle|collection)\b/i;
    const matches = createKeywords.test(text);
    console.log("🔍 detectPackCreationIntent('"+text+"'):", matches);
    return matches;
  };

  // Detect if user is asking for a topic/subject
  const detectTopicIntent = (text) => {
    const topicKeywords = /\b(explain|tell|teach|about|what is|learn|study)\b/i;
    return topicKeywords.test(text);
  };

  const extractJsonBlock = (text, openChar, closeChar) => {
    const start = text.indexOf(openChar);
    if (start === -1) return null;

    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = start; i < text.length; i++) {
      const ch = text[i];

      if (escaped) {
        escaped = false;
        continue;
      }

      if (ch === "\\") {
        escaped = true;
        continue;
      }

      if (ch === '"') {
        inString = !inString;
        continue;
      }

      if (inString) continue;

      if (ch === openChar) depth += 1;
      if (ch === closeChar) {
        depth -= 1;
        if (depth === 0) return text.slice(start, i + 1);
      }
    }

    return null;
  };

  const parseAiJson = (text, fallbackValue) => {
    const cleaned = String(text || "").replace(/```json|```/gi, "").trim();
    const block = extractJsonBlock(cleaned, fallbackValue.openChar, fallbackValue.closeChar);
    if (!block) return fallbackValue.value;

    const attempts = [
      block,
      block.replace(/\\(?!["\\/bfnrtu])/g, ""),
      block.replace(/\n/g, "\\n"),
      block.replace(/\r/g, "\\r"),
    ];

    for (const attempt of attempts) {
      try {
        return JSON.parse(attempt);
      } catch {
        // keep trying
      }
    }

    return fallbackValue.value;
  };

  // Create a pack with AI-generated cards
  const createPackWithAI = async (topic, user) => {
    if (!user) {
      console.error("User not authenticated");
      return null;
    }

    try {
      // Step 1: Generate pack title and color
      setPackCreationProgress("Choosing name and color...");
      const titleColorPrompt = `Generate ONE pack title for studying: ${topic}. Also choose a color hex code (#000000-#FFFFFF). Return ONLY valid JSON: {"title": "Pack Title", "color": "#hexcode"}`;

      const titleColorRes = await fetch(MISTRAL_API_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${MISTRAL_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "pixtral-large-latest",
          messages: [{ role: "user", content: titleColorPrompt }],
          max_tokens: 256,
          temperature: 0.6,
        }),
      });

      const titleColorData = await titleColorRes.json();
      const titleColorText = titleColorData.choices?.[0]?.message?.content || "{}";
  const titleColorJson = parseAiJson(titleColorText, { openChar: "{", closeChar: "}", value: {} });
      const packTitle = titleColorJson.title || `Learn ${topic}`;
      const packColor = titleColorJson.color || "#3b82f6";

      // Step 2: Generate 10 cards
      setPackCreationProgress("Generating 10 study cards...");
      const cardsPrompt = `Generate 10 flashcard pairs for learning about: ${topic}. Return ONLY a JSON array with no additional text: [{"front": "Question?", "back": "Answer"}]`;

      const cardsRes = await fetch(MISTRAL_API_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${MISTRAL_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "pixtral-large-latest",
          messages: [{ role: "user", content: cardsPrompt }],
          max_tokens: 2048,
          temperature: 0.5,
        }),
      });

      const cardsData = await cardsRes.json();
      const cardsText = cardsData.choices?.[0]?.message?.content || "[]";
  const cardsJson = parseAiJson(cardsText, { openChar: "[", closeChar: "]", value: [] });
      const cards = cardsJson.slice(0, 10);

      // Step 3: Derive tags from title and card content (no AI tag-making)
      const candidateTexts = [packTitle, ...cards.map((c) => `${c.front} ${c.back}`)];
      const tagSet = new Set();
      // generateTags looks for subject keywords and years
      generateTags(packTitle).forEach((t) => tagSet.add(t));
      for (const txt of candidateTexts) {
        const extra = generateTags(txt || "");
        extra.forEach((t) => tagSet.add(t));
      }

      // Also extract numeric sequences from topic (e.g., paper numbers) and include them
      const numMatches = (topic.match(/\d+/g) || []);
      numMatches.forEach((n) => tagSet.add(n));

      const tags = Array.from(tagSet).slice(0, 6);

      // Step 4: Create the pack in Firestore with extracted tags
      setPackCreationProgress("Creating pack...");
      const packsCol = collection(db, "users", user.uid, "packs");
      const packRef = await addDoc(packsCol, {
        name: packTitle,
        color: packColor,
        cards: 0,
        likes: 0,
        views: 0,
        tags: tags,
        subject: topic,
        createdAt: serverTimestamp(),
      });

      // Step 5: Add cards one by one
      setPackCreationProgress(`Adding 0 of ${cards.length} cards...`);
      const cardsCol = collection(db, "users", user.uid, "packs", packRef.id, "cards");

      for (let i = 0; i < cards.length; i++) {
        const card = cards[i];
        await addDoc(cardsCol, {
          front: card.front || "",
          back: card.back || "",
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        setPackCreationProgress(`Adding ${i + 1} of ${cards.length} cards...`);
      }

      // Keep pack-level card count in sync for My Packs list.
      await updateDoc(doc(db, "users", user.uid, "packs", packRef.id), {
        cards: cards.length,
        updatedAt: serverTimestamp(),
      });

      setPackCreationProgress("Pack created!");
      return {
        id: packRef.id,
        name: packTitle,
        color: packColor,
        cards: cards.length,
      };
    } catch (err) {
      console.error("Error creating pack:", err);
      setPackCreationProgress(null);
      return null;
    }
  };

  const fetchMistralResponse = async (conversationHistory) => {
    if (sendingRef.current) return;
    sendingRef.current = true;
    setIsLoading(true);
    const abortController = new AbortController();
    currentAbortRef.current = abortController;
    try {
      const apiMessages = conversationHistory.map((message) => {
        if (message.sender === "ai") {
          return {
            role: "assistant",
            content: message.text,
          };
        }

        if (message.image?.dataUrl) {
          return {
            role: "user",
            content: [
              {
                type: "text",
                text: message.text?.trim() || "Describe this image.",
              },
              {
                type: "image_url",
                image_url: {
                  url: message.image.dataUrl,
                },
              },
            ],
          };
        }

        return {
          role: "user",
          content: message.text,
        };
      });

      const messagesForApi = [{ role: "system", content: SYSTEM_PROMPT }, ...apiMessages];

      const payload = {
        model: "pixtral-large-latest",
        messages: messagesForApi,
        max_tokens: 2048, // allow longer responses
        temperature: 0.4,
      };

      const response = await fetch(MISTRAL_API_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${MISTRAL_API_KEY}`,
          "Content-Type": "application/json",
        },
        signal: abortController.signal,
        body: JSON.stringify(payload),
      });

      if (response.status === 429) {
        throw new Error("You have been rate limited. Please try again later.");
      }

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }

      // If the response is a stream (server-sent events or chunked text), consume progressively
      const contentType = response.headers.get("content-type") || "";

      const aiId = nextMessageId();
      // insert placeholder AI message so UI can show typing and be updated
      setMessages((prev) => [...prev, { id: aiId, timestamp: Date.now(), text: "", sender: "ai" }]);

      if (response.body && contentType.includes("text/")) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let done = false;
        let fullText = "";
        while (!done) {
          const { value, done: d } = await reader.read();
          done = d;
          if (value) {
            const chunk = decoder.decode(value, { stream: true });
            fullText += chunk;
            setMessages((prev) => prev.map((m) => (m.id === aiId ? { ...m, text: fullText } : m)));
            // keep scrolling as content arrives
            messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
          }
        }
        if (voiceMode) {
          spokenMessageIdsRef.current.add(aiId);
          speakText(fullText);
        }
      } else {
        // fallback: parse JSON body
        const data = await response.json();
        const fullText = data.choices?.[0]?.message?.content || data.choices?.[0]?.text || "No response";
        setMessages((prev) => prev.map((m) => (m.id === aiId ? { ...m, text: fullText } : m)));
        if (voiceMode) {
          spokenMessageIdsRef.current.add(aiId);
          speakText(fullText);
        }
      }
    } catch (error) {
      if (error.name === "AbortError") {
        return;
      }
      console.error("Mistral API error:", error);
      const friendlyMessage =
        error.message === "You have been rate limited. Please try again later."
          ? error.message
          : "Knowji hit an error. Please try again later.";
      const errorId = nextMessageId();
      const errorMessage = {
        id: errorId,
        timestamp: Date.now(),
        text: friendlyMessage,
        sender: "ai",
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
      sendingRef.current = false;
      currentAbortRef.current = null;

      if (voiceMode && pendingVoiceFollowupRef.current) {
        pendingVoiceFollowupRef.current = false;
      }
    }
  };

  const handleSendMessage = async (overrideText = null) => {
    const isEventObject = !!overrideText && typeof overrideText === "object" && typeof overrideText.preventDefault === "function";
    const rawText = isEventObject ? inputValue : (typeof overrideText === "string" ? overrideText : inputValue);
    const text = String(rawText || "").trim();
    console.log("📨 Message sent:", text);
    
    if ((!text && !attachedImage) || sendingRef.current || isLoading) {
      console.log("⚠️ Early return - text empty or already sending");
      return;
    }

    const now = Date.now();
    const userMessage = {
      id: nextMessageId(),
      timestamp: now,
      text,
      sender: "user",
      image: attachedImage,
    };

    const conversationHistory = [...messages, userMessage];
    setMessages(conversationHistory);
    setLastMessageTime(now);
    setInputValue("");
    setAttachedImage(null);

    // Detect if user wants to create a pack
    if (detectPackCreationIntent(text)) {
      console.log("✓ Pack creation intent detected:", text);
      
      const activeUser = currentUser || auth.currentUser;
      if (!activeUser) {
        console.error("❌ User not authenticated");
        const errorMsg = {
          id: nextMessageId(),
          timestamp: Date.now(),
          text: "Please sign in to create a pack.",
          sender: "ai",
        };
        setMessages((prev) => [...prev, errorMsg]);
        return;
      }

      // Extract topic from text - look for "about", "on", "for", or take everything after the verb
      let topic = "General Knowledge";
      
      // Try to find topic after keywords like "about", "on", "for"
      const topicAfterKeyword = text.match(/(?:about|on|for|of|:)\s+(.+?)(?:\s*\.|$)/i);
      if (topicAfterKeyword?.[1]) {
        topic = topicAfterKeyword[1].trim();
      } else {
        // Fallback: take everything after the pack verb
        const afterVerb = text.split(/(?:create|make|generate|build|add)/i)[1];
        if (afterVerb) {
          topic = afterVerb.replace(/^[\s\w]*(pack|deck|set|bundle|collection)[\s]*/i, "").trim();
          if (!topic) topic = "General Knowledge";
        }
      }

      console.log("📦 Creating pack for topic:", topic);

      // Set loading to show progress
      setIsLoading(true);
      sendingRef.current = true;

      try {
        // Create pack with progress updates
        const newPack = await createPackWithAI(topic, activeUser);
        setPackCreationProgress(null);

        if (newPack) {
          console.log("✅ Pack created successfully:", newPack);
          showToast("Pack created successfully.");
          const successMsg = {
            id: nextMessageId(),
            timestamp: Date.now(),
            text: `✅ Pack created! **${newPack.name}** with ${newPack.cards} cards.`,
            sender: "ai",
            packId: newPack.id,
            uid: activeUser.uid,
          };
          setMessages((prev) => [...prev, successMsg]);
        } else {
          console.error("❌ Pack creation returned null");
          const errorMsg = {
            id: nextMessageId(),
            timestamp: Date.now(),
            text: "Failed to create pack. Please try again.",
            sender: "ai",
          };
          setMessages((prev) => [...prev, errorMsg]);
        }
      } catch (err) {
        console.error("❌ Error during pack creation:", err);
        const errorMsg = {
          id: nextMessageId(),
          timestamp: Date.now(),
          text: `Error: ${err.message || "Failed to create pack"}`,
          sender: "ai",
        };
        setMessages((prev) => [...prev, errorMsg]);
      } finally {
        setIsLoading(false);
        sendingRef.current = false;
      }
      return;
    }

    // Search relevant packs for any non-pack creation message.
    // This makes mixed-up queries like "0607 maths" still surface the right packs.
    if (!detectPackCreationIntent(text)) {
      const topicMatch = text.match(/(?:explain|tell|teach|about|what is|learn|study)\s+(.+?)\.?$/i);
      const searchText = topicMatch?.[1] || text;
      const packs = await searchCommunityPacks(searchText);
      setRecommendedPacks(packs);
    }

    await fetchMistralResponse(conversationHistory);
  };

  const handleMicClick = () => {
    if (voiceMode) {
      const isSpeaking = typeof window !== "undefined" && window.speechSynthesis?.speaking;
      if (isLoading || isSpeaking) {
        interruptActiveResponse();
        setTimeout(() => startVoiceListening(), 100);
        return;
      }

      setVoiceMode(false);
      return;
    }

    setVoiceMode(true);
  };

  useEffect(() => {
    const SpeechRecognition = getSpeechRecognition();
    if (!SpeechRecognition) return;

    if (voiceMode) {
      startVoiceListening();
    } else {
      stopVoiceListening();
      stopSpeaking();
      interruptActiveResponse();
    }

    return () => {
      stopVoiceListening();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceMode]);

  useEffect(() => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;

    const loadVoices = () => {
      window.speechSynthesis.getVoices();
    };

    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;

    return () => {
      if (window.speechSynthesis) {
        window.speechSynthesis.onvoiceschanged = null;
      }
    };
  }, []);

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  return (
    <div className="chat-shell">
      <div className="chat-thread">
        <div className="chat-messages">
          {messages.length === 0 && (
            <div className="chat-empty-placeholder">
              <h2>How can I help you today?</h2>
              <p>Start a new chat with <strong>Knowji AI</strong></p>
            </div>
          )}

          {messages.map((msg, index) => (
            <div key={msg.id}>
              {sessionDividerIndex === index && (
                <div className="chat-session-divider">
                  New Session | Knowji
                </div>
              )}
              <div className={`chat-message chat-message--${msg.sender}`}>
                {msg.sender === "ai" ? (
                  <div className="chat-message__stack chat-message__stack--ai">
                    <div className="chat-message__identity">
                      <img className="chat-message__icon" src="/favicon.png" alt="Knowji" />
                      <span className="chat-message__name">Knowji</span>
                    </div>
                    {String(msg.text || "").trim() && (
                      <div className="chat-message__features" aria-label="Detected site features">
                          <span className="chat-message__features-icon" aria-hidden="true">
                            <FontAwesomeIcon icon={faFileLines} />
                          </span>
                          <span>Found {getFeatureCount(msg.id)} site features</span>
                        </div>
                    )}
                    <div className="chat-ai-block">
                      <div className="chat-message__bubble chat-message__bubble--ai">
                        {renderFormattedText(msg.text)}
                        {msg.packId && (
                          <button
                            className="chat-pack-button"
                            onClick={() => navigate(`/packs/${msg.uid}/${msg.packId}`)}
                          >
                            📚 Study this pack
                          </button>
                        )}
                      </div>
                      <div className="chat-message__actions" aria-label="Message actions">
                        <button className="chat-message__action" type="button" aria-label="Copy message" onClick={() => copyMessageText(msg.text)}>
                          <HugeiconsIcon icon={Clipboard} />
                        </button>
                        <button
                          className={`chat-message__action ${msg.feedback === "up" ? "is-up" : ""}`}
                          type="button"
                          aria-label="Thumbs up"
                          onClick={() => setFeedback(msg.id, "up")}
                        >
                          <HugeiconsIcon icon={ThumbsUpIcon} />
                        </button>
                        <button
                          className={`chat-message__action ${msg.feedback === "down" ? "is-down" : ""}`}
                          type="button"
                          aria-label="Thumbs down"
                          onClick={() => setFeedback(msg.id, "down")}
                        >
                          <HugeiconsIcon icon={ThumbsDownIcon} />
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="chat-message__bubble chat-message__bubble--user">
                    {msg.image?.dataUrl && (
                      <img className="chat-message__image" src={msg.image.dataUrl} alt={msg.image.name || "Attached image"} />
                    )}
                    {renderFormattedText(msg.text)}
                  </div>
                )}
              </div>
            </div>
          ))}

          {isLoading && (
            <div className="chat-message chat-message--ai">
              <div className="chat-message__stack chat-message__stack--ai">
                <div className="chat-message__identity">
                  <img className="chat-message__icon" src="/favicon.png" alt="Knowji" />
                  <span className="chat-message__name">Knowji</span>
                </div>
                <div className="chat-ai-block">
                  <div className="chat-message__bubble chat-message__bubble--loading">
                    <span className="chat-thinking shine-text">{packCreationProgress || "Knowji is thinking..."}</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {recommendedPacks.length > 0 && (
            <div className="chat-recommended-packs">
              <p className="chat-recommended-packs__title">📚 Recommended packs:</p>
              <div className="chat-recommended-packs__list">
                {recommendedPacks.map((pack) => (
                  <button
                    key={`${pack.uid}-${pack.id}`}
                    className="chat-recommended-pack-card"
                    onClick={() => navigate(`/packs/${pack.uid}/${pack.id}`)}
                  >
                    <div
                      className="chat-recommended-pack-card__color"
                      style={{ background: pack.color }}
                    />
                    <div className="chat-recommended-pack-card__content">
                      <h4 className="chat-recommended-pack-card__title">{pack.name}</h4>
                      <p className="chat-recommended-pack-card__count">{pack.cards} cards</p>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        <div className="chat-input-area">
          <div className="chat-input-wrap">
            <textarea
              className="chat-input"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask me anything..."
              rows={2}
            />
            <button
              className="chat-send"
              onClick={handleSendMessage}
              disabled={isLoading || (!inputValue.trim() && !attachedImage)}
              aria-label="Send"
            >
              ➤
            </button>
            <div className="chat-input-tools">
              <button className="chat-tool" type="button" aria-label="Attach image" onClick={handleAttachImageClick}>
                <FontAwesomeIcon icon={faPlus} />
              </button>
              <button
                className={`chat-tool ${voiceMode ? "is-active" : ""}`}
                type="button"
                aria-label={voiceMode ? "Interrupt or disable voice mode" : "Enable voice mode"}
                onClick={handleMicClick}
              >
                <FontAwesomeIcon icon={faMicrophone} />
              </button>
              {voiceMode && <span className="chat-voice-status">{isListening ? "Listening..." : isLoading ? "Responding..." : "Voice mode on"}</span>}
              <button className="chat-tool" type="button">
                <FontAwesomeIcon icon={faPen} />
                <span>Sketch</span>
              </button>
            </div>
            {attachedImage && (
              <div className="chat-attachment-preview">
                <img className="chat-attachment-preview__image" src={attachedImage.dataUrl} alt={attachedImage.name} />
                <div className="chat-attachment-preview__meta">
                  <strong>1 image attached</strong>
                  <small>{attachedImage.name}</small>
                </div>
                <button className="chat-attachment-preview__remove" type="button" onClick={clearAttachedImage} aria-label="Remove image attachment">
                  ×
                </button>
              </div>
            )}
            <input ref={imageInputRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handleImageChange} />
          </div>
        </div>
      </div>
    </div>
  );
}

