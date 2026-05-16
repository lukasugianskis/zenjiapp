import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { HugeiconsIcon } from "@hugeicons/react";
import { Upload01Icon, Clipboard, YoutubeIcon, Mic02Icon, Layer, Folder } from "@hugeicons/core-free-icons";

export default function Home() {
  const navigate = useNavigate();
  const studyInputRef = useRef(null);
  const fileInputRef = useRef(null);
  const recognitionRef = useRef(null);
  const voiceBaseRef = useRef("");
  const listeningRef = useRef(false);
  const [isPhone, setIsPhone] = useState(false);
  const [studyText, setStudyText] = useState("");
  const [autoText, setAutoText] = useState("");
  const [isFocused, setIsFocused] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isAutoTyping, setIsAutoTyping] = useState(false);
  const autoRef = useRef({ phraseIndex: 0, charIndex: 0, deleting: false, timer: null });

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 640px)");

    const update = () => setIsPhone(mq.matches);
    update();

    if (mq.addEventListener) {
      mq.addEventListener("change", update);
      return () => mq.removeEventListener("change", update);
    }

    mq.addListener(update);
    return () => mq.removeListener(update);
  }, []);

  useLayoutEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  }, []);

  const getGreeting = () => {
    const hour = new Date().getHours();
    const prompt = isPhone ? "Ready to learn something?" : "Ready to learn something cool?";
    if (hour >= 5 && hour < 12) return `Rise and shine! ${prompt}`;
    if (hour >= 12 && hour < 17) return `Keep it going! ${prompt}`;
    if (hour >= 17 && hour < 21) return `Evening focus! ${prompt}`;
    return `Late-night boost! ${prompt}`;
  };

  const resizeInput = () => {
    const el = studyInputRef.current;
    if (!el) return;
    el.style.height = "auto";
    const nextHeight = Math.min(el.scrollHeight, 200);
    el.style.height = `${nextHeight}px`;
    el.style.overflowY = el.scrollHeight > 200 ? "auto" : "hidden";
  };

  const handleStudyInputChange = (event) => {
    const nextValue = event.target.value;
    setStudyText(nextValue);
    if (isListening) {
      voiceBaseRef.current = nextValue;
    }
    resizeInput();
  };

  const handleFocus = () => {
    setIsFocused(true);
    // stop auto-typing when user focuses
    const af = autoRef.current;
    if (af.timer) {
      clearTimeout(af.timer);
      af.timer = null;
    }
    setAutoText("");
  };

  const handleBlur = () => {
    setIsFocused(false);
  };

  const handleStudyKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey && studyText.trim()) {
      e.preventDefault();
      navigate("/chat", { state: { topic: studyText } });
      setStudyText("");
    }
  };

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  // Load PDF.js from CDN when needed
  const loadPdfJs = () => {
    if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.min.js";
      s.onload = () => {
        try {
          if (window.pdfjsLib) {
            // set worker from CDN
            window.pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js";
          }
          resolve(window.pdfjsLib);
        } catch (err) {
          reject(err);
        }
      };
      s.onerror = reject;
      document.head.appendChild(s);
    });
  };

  const extractPdfText = async (file) => {
    try {
      const buffer = await file.arrayBuffer();
      await loadPdfJs();
      const loadingTask = window.pdfjsLib.getDocument({ data: buffer });
      const pdf = await loadingTask.promise;
      let fullText = "";
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        const pageText = content.items.map((it) => it.str).join(" ");
        fullText += `\n\n--- Page ${i} ---\n` + pageText;
      }
      return fullText.trim();
    } catch (err) {
      console.error("PDF extraction error:", err);
      return null;
    }
  };

  const secondsToTimestamp = (s) => {
    const sec = Math.floor(Number(s) || 0);
    const m = Math.floor(sec / 60);
    const ss = sec % 60;
    return `${m}:${ss.toString().padStart(2, "0")}`;
  };

  const fetchYoutubeTranscript = async (videoId) => {
    try {
      const url = `https://video.google.com/timedtext?lang=en&v=${videoId}`;
      const res = await fetch(url);
      if (!res.ok) return null;
      const xml = await res.text();
      if (!xml) return null;
      const parser = new DOMParser();
      const doc = parser.parseFromString(xml, "application/xml");
      const texts = Array.from(doc.getElementsByTagName("text"));
      if (!texts.length) return null;
      const lines = texts.map((node) => {
        const start = node.getAttribute("start") || "0";
        const txt = node.textContent || "";
        return `${secondsToTimestamp(start)} | ${txt.replace(/\s+/g, " ").trim()}`;
      });
      return lines;
    } catch (err) {
      console.error("YouTube transcript fetch error:", err);
      return null;
    }
  };

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const name = file.name || "uploaded file";
    // support plain text files
    if (file.type.startsWith("text/") || /\.(txt|md)$/i.test(name)) {
      const text = await file.text();
      const prompt = `Please make concise study notes from the following content (keep it short and in bullet points):\n\nFilename: ${name}\n\n${text}`;
      navigate("/chat", { state: { topic: prompt } });
      return;
    }

    // PDF handling
    if (file.type === "application/pdf" || /\.pdf$/i.test(name)) {
      const extracted = await extractPdfText(file);
      if (extracted) {
        const prompt = `Please make concise study notes from the following PDF content (keep it short and in bullet points):\n\nFilename: ${name}\n\n${extracted}`;
        navigate("/chat", { state: { topic: prompt } });
        return;
      }
      const prompt = `I uploaded a PDF named ${name}, but automatic extraction failed. Please paste key excerpts or use an external extractor and paste the text here.`;
      navigate("/chat", { state: { topic: prompt } });
      return;
    }

    // fallback for unsupported files (PPT, images, etc.)
    const prompt = `I uploaded a file named ${name}. I couldn't automatically extract text from it in-app — please paste the text or a shareable link. Otherwise, ask Knowji to summarise the file: Filename: ${name}`;
    navigate("/chat", { state: { topic: prompt } });
  };

  const handlePasteClick = () => {
    const pasted = window.prompt("Paste the text you want to make notes from:");
    if (!pasted) return;
    const prompt = `Please make concise study notes from the following content (keep it short and direct):\n\n${pasted}`;
    navigate("/chat", { state: { topic: prompt } });
  };

  const handleYoutubeClick = () => {
    const url = window.prompt("Paste the YouTube video URL:");
    if (!url) return;

    // Try to extract a video ID to help pre-fill an extractor link
    const idMatch = url.match(/[?&]v=([^&]+)/) || url.match(/youtu\.be\/([^?&]+)/);
    const videoId = idMatch ? idMatch[1] : null;
    const extractorLink = videoId ? `https://youtubetranscript.com/?server_vid=${videoId}` : null;

    // Try to fetch transcript automatically
    (async () => {
      if (videoId) {
        const lines = await fetchYoutubeTranscript(videoId);
        if (lines && lines.length) {
          const body = lines.slice(0, 1000).join("\n");
          const prompt = `Please condense the following timestamped excerpts into a neat table (columns: Timestamp | Key point) and add 3 short takeaways:\n\n${body}`;
          navigate("/chat", { state: { topic: prompt } });
          return;
        }
      }

      // fallback: open extractor and provide instructions
      if (extractorLink) {
        const open = window.confirm(
          "Automatic transcript fetch failed. I can open a transcript extractor in a new tab to help you get the transcript. Open it now?"
        );
        if (open) window.open(extractorLink, "_blank", "noopener,noreferrer");
      }

      const prompt = `I want study notes from a YouTube video. Extraction instructions:\n\n1) Open the video's three-dot menu and choose \"Show transcript\" OR use an external transcript extractor (example: ${extractorLink || 'use a transcript tool'}).\n2) Copy timestamped excerpts in the format \`0:45 | Key point\` (one per line).\n3) Paste those excerpts here and Knowji will condense them into a neat table with columns \"Timestamp\" and \"Key point\" and add 3–5 short takeaways.\n\nVideo URL: ${url}\n\nIf you cannot paste a transcript now, explain briefly how to obtain one and what to paste into the chat.`;

      navigate("/chat", { state: { topic: prompt } });
    })();
  };

  const handleVoiceInput = () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      return;
    }

    if (!recognitionRef.current) {
      const recognition = new SpeechRecognition();
      recognition.lang = "en-US";
      recognition.interimResults = true;
      recognition.continuous = true;

      recognition.onresult = (event) => {
        const transcript = Array.from(event.results)
          .map((result) => result[0]?.transcript || "")
          .join(" ")
          .trim();

        const baseText = voiceBaseRef.current.trim();
            setStudyText(baseText ? `${baseText} ${transcript}`.trim() : transcript);
      };

      recognition.onend = () => {
        if (listeningRef.current) {
          recognition.start();
          return;
        }

        setIsListening(false);
      };

      recognition.onerror = () => {
        setIsListening(false);
      };

      recognitionRef.current = recognition;
    }

    if (isListening) {
      listeningRef.current = false;
      setIsListening(false);
      recognitionRef.current.stop();
      return;
    }

    voiceBaseRef.current = studyInputRef.current?.value ?? studyText;
    listeningRef.current = true;
    setIsListening(true);
    recognitionRef.current.start();
  };

  useEffect(() => {
    return () => {
      listeningRef.current = false;
      recognitionRef.current?.stop?.();
    };
  }, []);

  useLayoutEffect(() => {
    resizeInput();
  }, [studyText, autoText]);

  // Auto-typing demo phrases
  useEffect(() => {
    const phrases = [
      "Concept of Photosynthesis",
      "Newton's Laws of Motion",
      "Cell Division (Mitosis)",
      "Causes of World War II",
      "Organic Chemistry Basics",
    ];

    const shouldRun = !isListening && !isFocused && !studyText;
    const af = autoRef.current;

    function tick() {
      const phrase = phrases[af.phraseIndex % phrases.length];

      if (!af.deleting) {
        // type
        af.charIndex++;
        setAutoText(phrase.slice(0, af.charIndex));
        if (af.charIndex >= phrase.length) {
          // pause then delete
          af.deleting = true;
          af.timer = setTimeout(tick, 900);
          return;
        }
        af.timer = setTimeout(tick, 80 + Math.random() * 80);
      } else {
        // deleting
        af.charIndex--;
        setAutoText(phrase.slice(0, af.charIndex));
        if (af.charIndex <= 0) {
          af.deleting = false;
          af.phraseIndex++;
          af.timer = setTimeout(tick, 400);
          return;
        }
        af.timer = setTimeout(tick, 40 + Math.random() * 40);
      }
    }

    if (shouldRun) {
      // reset indexes
      setIsAutoTyping(true);
      af.phraseIndex = 0;
      af.charIndex = 0;
      af.deleting = false;
      if (af.timer) clearTimeout(af.timer);
      af.timer = setTimeout(tick, 600);
    } else {
      if (af.timer) {
        clearTimeout(af.timer);
        af.timer = null;
      }
      setAutoText("");
      setIsAutoTyping(false);
    }

    return () => {
      if (af.timer) {
        clearTimeout(af.timer);
        af.timer = null;
      }
    };
  }, [isListening, isFocused, studyText]);

  return (
    <section className="home-hero">
      <div className="home-hero__line">
        <div className="home-hero__text">
          <div className="home-hero__headline">
            <lottie-player
  className="home-hero__emoji"
  style={{ width: 30, height: 30 }}
  src="https://fonts.gstatic.com/s/e/notoemoji/latest/1f44b/lottie.json"
  background="transparent"
  speed="0.5"
  loop
  autoplay
/>
            <h1 className="home-hero__title">{getGreeting()}</h1>
          </div>
          <p className="home-hero__label">
            <span className="home-hero__label--full">Ask any question about your curriculum or subjects...</span>
            <span className="home-hero__label--short">Ask any question about your subjects...</span>
          </p>
          <div className="study-box">
            <textarea
              className="study-box__input"
              placeholder={
                studyText
                  ? ""
                  : autoText
                  ? `I want to study ${autoText}`
                  : isAutoTyping
                  ? "I want to study"
                  : "I want to study..."
              }
              aria-label="Study topic"
              rows={2}
              ref={studyInputRef}
              value={studyText}
              onChange={handleStudyInputChange}
              onFocus={handleFocus}
              onBlur={handleBlur}
              onKeyDown={handleStudyKeyDown}
              onInput={resizeInput}
            />
            <button className="study-box__add" type="button" aria-label="Add">
              <i className="hgi hgi-stroke hgi-rounded hgi-add-01"></i>
            </button>
            <button
              className={`study-box__mic ${isListening ? "is-listening" : ""}`}
              type="button"
              aria-label="Voice input"
              aria-pressed={isListening}
              onClick={handleVoiceInput}
            >
              <HugeiconsIcon icon={Mic02Icon} />
            </button>
          </div>
          
          <div className="study-options">
            <button className="study-option" onClick={handleUploadClick}>
              <div className="study-option__icon">
                <HugeiconsIcon icon={Upload01Icon} />
              </div>
              <h3 className="study-option__title">Upload file</h3>
              <p className="study-option__desc">PDF, PPT...</p>
            </button>
            <button className="study-option" onClick={handlePasteClick}>
              <div className="study-option__icon">
                <HugeiconsIcon icon={Clipboard} />
              </div>
              <h3 className="study-option__title">Paste</h3>
              <p className="study-option__desc">Paste any text</p>
            </button>
            <button className="study-option study-option--youtube" onClick={handleYoutubeClick}>
              <div className="study-option__icon">
                <HugeiconsIcon icon={YoutubeIcon} />
              </div>
              <h3 className="study-option__title">YouTube</h3>
              <p className="study-option__desc">Paste a link</p>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              style={{ display: "none" }}
              onChange={handleFileChange}
            />
          </div>
          {!isPhone && (
            <div className="promo-box">
              <img className="promo-box__art" src="/tutor.png" alt="" aria-hidden="true" />
              <div className="promo-box__content">
                <h2 className="promo-box__title">Need a tutor? Get help that actually sticks.</h2>
                <p className="promo-box__text">
                  Book personalized tutoring sessions, clear up tough topics, and learn faster with support built around you.
                </p>
              </div>
              <button className="promo-box__cta" type="button">
              <svg viewBox="0 0 24 24" className="arr-2" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M16.1716 10.9999L10.8076 5.63589L12.2218 4.22168L20 11.9999L12.2218 19.778L10.8076 18.3638L16.1716 12.9999H4V10.9999H16.1716Z"
      ></path>
    </svg>
    <span className="text">Book Tutor</span>
    <span className="circle"></span>
    <svg viewBox="0 0 24 24" className="arr-1" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M16.1716 10.9999L10.8076 5.63589L12.2218 4.22168L20 11.9999L12.2218 19.778L10.8076 18.3638L16.1716 12.9999H4V10.9999H16.1716Z"
      ></path>
    </svg>
</button>

            </div>
          )}
          <div className="divider">
              <span className="divider__text">Study Tools</span>
            </div>
        </div>
      </div>
    </section>
  );
}