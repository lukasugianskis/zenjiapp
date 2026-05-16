import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faMagnifyingGlass, faPlus, faTrash } from "@fortawesome/free-solid-svg-icons";
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { auth, db, collection, query, orderBy, onSnapshot, addDoc, serverTimestamp, onAuthStateChanged, doc, deleteDoc } from "../firebase";
import { createPortal } from "react-dom";
import { generateTags } from "../utils/generateTags";
import { showToast } from "../utils/toast.js";

export default function Packs() {
	const navigate = useNavigate();
	const [packs, setPacks] = useState([]);
	const [user, setUser] = useState(null);
	const [searchTerm, setSearchTerm] = useState("");
	const [filter, setFilter] = useState("All");
	const [showModal, setShowModal] = useState(false);
	const [formData, setFormData] = useState({ name: "", color: "#3b82f6" });

	const colors = [
		"#3b82f6", // blue
		"#8b5cf6", // purple
		"#ec4899", // pink
		"#f97316", // orange
		"#14b8a6", // teal
		"#06b6d4", // cyan
		"#84cc16", // lime
		"#f43f5e", // rose
	];

	const handleInputChange = (e) => {
		const { name, value } = e.target;
		// Enforce a max length of 12 characters for the pack name
		if (name === "name") {
			const clamped = String(value).slice(0, 20);
			setFormData((prev) => ({ ...prev, [name]: clamped }));
			return;
		}
		setFormData((prev) => ({ ...prev, [name]: value }));
	};

	const handleCreatePack = (e) => {
		e.preventDefault();
		// enforce clamp on submit as a safety net
		const name = String(formData.name || "").slice(0, 20).trim();
		if (!name) return;

		const tags = generateTags(formData.name);

		const newPack = {
			name,
			color: formData.color,
			cards: 0,
			likes: 0,
			views: 0,
			tags: tags,
			createdAt: user ? serverTimestamp() : Date.now(),
		};

		if (user) {
			// save to firestore under users/{uid}/packs
			const packsCol = collection(db, "users", user.uid, "packs");
			addDoc(packsCol, newPack);
			showToast("Pack created successfully.");
		} else {
			setPacks((prev) => [...prev, { id: Date.now(), ...newPack }]);
			showToast("Pack created successfully.");
		}
		setFormData({ name: "", color: "#3b82f6" });
		setShowModal(false);
	};

	const handleDeletePack = async (packId, e) => {
		e.stopPropagation();
		if (!user) {
			// Delete from local packs
			setPacks((prev) => prev.filter((p) => p.id !== packId));
		} else {
			// Delete from Firestore
			try {
				const packRef = doc(db, "users", user.uid, "packs", packId);
				await deleteDoc(packRef);
			} catch (err) {
				console.error("Error deleting pack:", err);
			}
		}
	};

	const tokenize = (value) =>
		String(value || "")
			.toLowerCase()
			.replace(/[^a-z0-9\s]/g, " ")
			.split(/\s+/)
			.filter(Boolean);

	const filteredPacks = searchTerm.trim()
		? packs.filter((pack) => {
			const packTokens = tokenize([pack.name, ...(pack.tags || [])].flat().join(" "));
			const queryTokens = tokenize(searchTerm);
			return queryTokens.every((token) =>
				packTokens.some((word) => word === token || word.startsWith(token) || token.startsWith(word) || packTokens.join(" ").includes(token)),
			);
		})
		: packs;

	// apply top-level filter pills (All / Packs / Notes)
	const displayPacks = (() => {
		if (filter === "All") return filteredPacks;
		if (filter === "Packs") return filteredPacks;
		// Notes: no notes datasource here yet — show empty list
		return [];
	})();

	const getCreatedMs = (pack) => {
		if (!pack || pack.createdAt == null) return 0;
		if (typeof pack.createdAt === "number") return pack.createdAt;
		if (typeof pack.createdAt.toMillis === "function") return pack.createdAt.toMillis();
		return 0;
	};

	const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
	const recentPacks = packs
		.slice()
		.filter((p) => Date.now() - getCreatedMs(p) <= ONE_WEEK_MS)
		.sort((a, b) => getCreatedMs(b) - getCreatedMs(a));

	// load saved packs from localStorage on first render (used when not signed in)
	useEffect(() => {
		try {
			const raw = localStorage.getItem("zenji:packs");
			if (raw) {
				const saved = JSON.parse(raw);
				if (Array.isArray(saved) && saved.length) {
					setPacks(saved);
				}
			}
		} catch (err) {
			// ignore
		}
	}, []);

	// ensure page is scrolled to top when opening Packs (prevents lingering scroll restore)
	useEffect(() => {
		if (typeof window !== "undefined") {
			window.scrollTo({ top: 0, left: 0, behavior: "auto" });
		}
	}, []);

	useEffect(() => {
			let unsubSnap = null;
			const unsubAuth = onAuthStateChanged(auth, (u) => {
				setUser(u);
				if (unsubSnap) {
					unsubSnap();
					unsubSnap = null;
				}
				if (u) {
					const packsCol = collection(db, "users", u.uid, "packs");
					const q = query(packsCol, orderBy("createdAt", "desc"));
					unsubSnap = onSnapshot(q, (snap) => {
						const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
						setPacks(items);
					});
				} else {
					// if signed out, keep UI packs as-is or reset to defaults
					// (we persist local packs in localStorage so they survive refresh)
				}
			});
			return () => {
				if (unsubSnap) unsubSnap();
				if (unsubAuth) unsubAuth();
			};
	}, []);

	// whenever packs change and user is not signed in, persist to localStorage
	useEffect(() => {
		if (!user) {
			try {
				localStorage.setItem("zenji:packs", JSON.stringify(packs));
			} catch (err) {
				// ignore
			}
		}
	}, [packs, user]);

	return (
		<section className={`packs-page ${packs.length === 0 ? "packs-page--empty" : ""}`}>
			<div className="packs-page__container">
				<div className="packs-page__header">
					<h1 className="packs-page__title">Personal Library</h1>
					<div className="packs-page__actions">
						<button 
							className="packs-page__icon-button packs-page__icon-button--primary" 
							type="button" 
							aria-label="Create pack"
							onClick={() => setShowModal(true)}
						>
							<FontAwesomeIcon icon={faPlus} />
							<span>Add Packs</span>
						</button>
					</div>
				</div>

				{recentPacks.length > 0 && (
					<h1 className="packs-page__sub">Recent</h1>
				)}

				{recentPacks.length > 0 && (
					<div className="packs-recent">
						<div className="packs-grid packs-grid--recent" style={{ marginBottom: 40 }}>
							{recentPacks.map((pack) => (
								<div
									key={pack.id || (pack.name + getCreatedMs(pack))}
									className="pack-card"
									role="button"
									tabIndex={0}
									aria-label={`Open pack ${pack.name}`}
									onClick={() => navigate(`/packs/${pack.id || (pack.name + getCreatedMs(pack))}`)}
									onKeyDown={(e) => {
										if (e.key === "Enter" || e.key === " ") {
											e.preventDefault();
											navigate(`/packs/${pack.id || (pack.name + getCreatedMs(pack))}`);
										}
									}}
									style={{ position: "relative" }}
								>
									<div
										className="pack-card__header"
										style={{ background: `linear-gradient(135deg, ${pack.color}cc 0%, ${pack.color} 100%)` }}
									></div>
									<div className="pack-card__content">
										<h3 className="pack-card__title">{pack.name}</h3>
										<p className="pack-card__count">{pack.cards} {pack.cards === 1 ? "card" : "cards"}</p>
									</div>
									<button
										className="pack-card__delete"
										onClick={(e) => handleDeletePack(pack.id, e)}
										aria-label={`Delete pack ${pack.name}`}
										type="button"
									>
										<FontAwesomeIcon icon={faTrash} />
									</button>
								</div>
							))}
						</div>
					</div>
				)}

						{/* Filter pills: All / Packs / Notes */}
						<div className="packs-filter">
							{["All", "Packs", "Notes"].map((p) => (
								<button
									key={p}
									type="button"
									className={`packs-filter__pill ${filter === p ? "is-active" : ""}`}
									onClick={() => setFilter(p)}
									aria-pressed={filter === p}
								>
									{p}
								</button>
							))}
						</div>

						<div className="community-packs-search" style={{ marginTop: 0, minWidth: 0 }}>
					<FontAwesomeIcon icon={faMagnifyingGlass} style={{ color: "#000000ff", fontSize: "20px" }} />
					<input
						type="text"
						placeholder="Search packs by name..."
						value={searchTerm}
						onChange={(e) => setSearchTerm(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter") e.preventDefault();
						}}
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

{packs.length === 0 ? (
					<div className="packs-grid" style={{ gridTemplateColumns: "1fr" }}>
						<div
							className="pack-card pack-card--empty"
							style={{ position: "relative" }}
							role="button"
							tabIndex={0}
							aria-label="Add your first pack"
						>
							<div className="pack-card__header" style={{ background: "transparent" }} />
							<div className="pack-card__content" style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: 120 }}>
								<div className="packs-empty-state__circle">
									<img className="packs-empty-state__icon" src="/magnifying.png" alt="Search" />
									<div className="packs-empty-state__cta">
										<span>Add your first pack</span>
										<button
											type="button"
											className="packs-empty-state__plus-button"
											onClick={() => setShowModal(true)}
											aria-label="Create your first pack"
										>
											<FontAwesomeIcon icon={faPlus} />
										</button>
									</div>
								</div>
							</div>
						</div>
					</div>
				) : (
					<div className="packs-grid" style={{ gridTemplateColumns: "1fr" }}>
						{displayPacks.map((pack, idx) => (
							<div
								key={pack.id}
								className="pack-card"
								style={{ position: "relative", ['--i']: idx }}
								role="button"
								tabIndex={0}
								aria-label={`Open pack ${pack.name}`}
								onClick={() => navigate(`/packs/${pack.id}`)}
								onKeyDown={(e) => {
									if (e.key === "Enter" || e.key === " ") {
										e.preventDefault();
										navigate(`/packs/${pack.id}`);
									}
								}}

							>
								<div 
									className="pack-card__header"
									style={{ background: `linear-gradient(135deg, ${pack.color}cc 0%, ${pack.color} 100%)` }}
								></div>
								<div className="pack-card__content">
									<h3 className="pack-card__title">{pack.name}</h3>
									<p className="pack-card__count">{pack.cards} {pack.cards === 1 ? "card" : "cards"}</p>
								</div>
								<button
									className="pack-card__delete"
									onClick={(e) => handleDeletePack(pack.id, e)}
									aria-label={`Delete pack ${pack.name}`}
									type="button"
								>
									<FontAwesomeIcon icon={faTrash} />
								</button>
							</div>
						))}
						{filteredPacks.length === 0 && searchTerm.trim() && (
							<div className="packs-empty-state" style={{ gridColumn: "1 / -1" }}>
								<div className="packs-empty-state__circle">
									<img className="packs-empty-state__icon" src="/magnifying.png" alt="Search" />
									<div className="packs-empty-state__cta" style={{ marginBottom: "15px" }}>
										<span>No packs found</span>
										
									</div>
								</div>
							</div>
						)}
					</div>
				)}
			</div>

			{showModal && createPortal(
				<div className="packs-modal-backdrop" onClick={() => setShowModal(false)}>
					<div className="packs-modal" onClick={(e) => e.stopPropagation()}>
						<h2 className="packs-modal__title">Create New Pack</h2>
						<form onSubmit={handleCreatePack}>
							<div className="packs-modal__field">
								<label htmlFor="pack-name">Pack Name</label>
								<input
									id="pack-name"
									type="text"
									name="name"
									placeholder="e.g., Spanish Vocabulary"
									value={formData.name}
											onChange={handleInputChange}
											onInput={(e) => {
												const v = String(e.currentTarget.value).slice(0, 20);
												if (v !== e.currentTarget.value) e.currentTarget.value = v;
												setFormData((p) => ({ ...p, name: v }));
											}}
											onPaste={(e) => {
												const pasted = (e.clipboardData || window.clipboardData).getData('text') || '';
												const clamped = (formData.name + pasted).slice(0, 20);
												if (clamped.length < (formData.name + pasted).length) e.preventDefault();
												setFormData((p) => ({ ...p, name: clamped }));
											}}
												maxLength={20}
									autoFocus
								/>
							</div>

							<div className="packs-modal__field">
								<label>Banner Color</label>
								<div className="packs-modal__color-picker">
									{colors.map((color) => (
										<button
											key={color}
											type="button"
											className={`packs-modal__color-option ${formData.color === color ? "is-selected" : ""}`}
											style={{
												backgroundColor: color,
												boxShadow: formData.color === color ? `0 0 0 3px ${color}33` : 'none',
												borderColor: '#ffffff'
											}}
											onClick={() => setFormData((prev) => ({ ...prev, color }))}
										/>
									))}
								</div>
							</div>

							<div className="packs-modal__actions">
								<button 
									type="button" 
									className="packs-modal__button packs-modal__button--secondary"
									onClick={() => setShowModal(false)}
								>
									Cancel
								</button>
								<button 
									type="submit" 
									className="packs-modal__button packs-modal__button--primary"
								>
									Create Pack
								</button>
							</div>
						</form>
					</div>
				</div>,
				document.body
			)}
		</section>
	);
}
