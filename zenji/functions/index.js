const functions = require("firebase-functions");
const admin = require("firebase-admin");
const cors = require("cors");

if (!admin.apps.length) {
  admin.initializeApp();
}

const API_KEY = "apf_cif2rypnmzwvffbs29ddvdng";
const API_ENDPOINT = "https://apifreellm.com/api/v1/chat";

// Fallback: Keyword-based tag generation
function generateTagsKeywordBased(packName) {
  const name = packName.toLowerCase();
  const keywords = {
    // Exam systems
    "igcse": "IGCSE",
    "cie": "IGCSE",
    "gcse": "GCSE",
    "a-level": "A-Level",
    "ib": "IB",
    "ap": "AP",
    "sat": "SAT",
    "act": "ACT",

    // Subjects
    "biology": "Biology",
    "chemistry": "Chemistry",
    "physics": "Physics",
    "math": "Math",
    "mathematics": "Math",
    "english": "English",
    "spanish": "Spanish",
    "french": "French",
    "german": "German",
    "history": "History",
    "geography": "Geography",
    "economics": "Economics",
    "computer": "Computer Science",
    "programming": "Programming",
    "science": "Science",
    "literature": "Literature",

    // Levels
    "grade 7": "Grade 7",
    "grade 8": "Grade 8",
    "grade 9": "Grade 9",
    "grade 10": "Grade 10",
    "grade 11": "Grade 11",
    "grade 12": "Grade 12",
  };

  const foundTags = [];
  for (const [keyword, tag] of Object.entries(keywords)) {
    if (name.includes(keyword) && !foundTags.includes(tag)) {
      foundTags.push(tag);
      if (foundTags.length >= 2) break;
    }
  }

  return foundTags;
}

const corsHandler = cors({ origin: true });

function applyCors(res) {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.set("Access-Control-Max-Age", "3600");
}

async function likeCommunityPackCore({ packOwnerUid, packId, likerUid }) {
  if (!packOwnerUid || !packId || !likerUid) {
    const error = new Error("packOwnerUid, packId, and likerUid are required");
    error.status = 400;
    throw error;
  }

  const firestore = admin.firestore();
  const packRef = firestore.doc(`users/${packOwnerUid}/packs/${packId}`);
  const likeRef = packRef.collection("likes").doc(likerUid);

  return firestore.runTransaction(async (tx) => {
    const [packSnap, likeSnap] = await Promise.all([
      tx.get(packRef),
      tx.get(likeRef),
    ]);

    if (!packSnap.exists) {
      const error = new Error("Pack not found");
      error.status = 404;
      throw error;
    }

    const packData = packSnap.data() || {};
    const currentLikes = Number(packData.likes ?? packData.hearts ?? 0);

    if (likeSnap.exists) {
      return {
        alreadyLiked: true,
        likes: currentLikes,
      };
    }

    tx.set(likeRef, {
      likerUid,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    tx.update(packRef, {
      likes: admin.firestore.FieldValue.increment(1),
    });

    return {
      alreadyLiked: false,
      likes: currentLikes + 1,
    };
  });
}

exports.likeCommunityPack = functions.region("us-central1").https.onCall(async (data, context) => {
  try {
    if (!context.auth || !context.auth.uid) {
      throw new functions.https.HttpsError("unauthenticated", "Sign in required");
    }

    const result = await likeCommunityPackCore({
      packOwnerUid: data?.packOwnerUid,
      packId: data?.packId,
      likerUid: context.auth.uid,
    });

    return result;
  } catch (err) {
    console.error("Error liking community pack (callable):", err);

    if (err instanceof functions.https.HttpsError) {
      throw err;
    }

    const status = err && err.status ? err.status : 500;
    throw new functions.https.HttpsError(
      status === 404 ? "not-found" : status === 400 ? "invalid-argument" : "internal",
      err.message || "Failed to like pack"
    );
  }
});

exports.onCommunityPackLikeCreated = functions.firestore
  .document("users/{userId}/packs/{packId}/likes/{likerId}")
  .onCreate(async (_snap, context) => {
    const { userId, packId } = context.params;
    const packRef = admin.firestore().doc(`users/${userId}/packs/${packId}`);

    await admin.firestore().runTransaction(async (tx) => {
      const packSnap = await tx.get(packRef);
      if (!packSnap.exists) return;

      tx.set(
        packRef,
        {
          likes: admin.firestore.FieldValue.increment(1),
        },
        { merge: true }
      );
    });
  });

exports.onCommunityPackLikeDeleted = functions.firestore
  .document("users/{userId}/packs/{packId}/likes/{likerId}")
  .onDelete(async (_snap, context) => {
    const { userId, packId } = context.params;
    const packRef = admin.firestore().doc(`users/${userId}/packs/${packId}`);

    await admin.firestore().runTransaction(async (tx) => {
      const packSnap = await tx.get(packRef);
      if (!packSnap.exists) return;

      const packData = packSnap.data() || {};
      const currentLikes = Number(packData.likes ?? packData.hearts ?? 0);

      tx.set(
        packRef,
        {
          likes: Math.max(0, currentLikes - 1),
        },
        { merge: true }
      );
    });
  });

exports.onCommunityPackViewCreated = functions.firestore
  .document("users/{userId}/packs/{packId}/views/{viewId}")
  .onCreate(async (_snap, context) => {
    const { userId, packId } = context.params;
    const packRef = admin.firestore().doc(`users/${userId}/packs/${packId}`);

    await admin.firestore().runTransaction(async (tx) => {
      const packSnap = await tx.get(packRef);
      if (!packSnap.exists) return;

      tx.set(
        packRef,
        {
          views: admin.firestore.FieldValue.increment(1),
        },
        { merge: true }
      );
    });
  });

// Secure server-side like counter for community packs.
exports.likeCommunityPackHttp = functions.region("us-central1").https.onRequest((req, res) => {
  applyCors(res);

  if (req.method === "OPTIONS") {
    return res.status(204).send("");
  }

  return corsHandler(req, res, async () => {
    try {
      if (req.method !== "POST") {
        return res.status(405).json({ error: "Method not allowed" });
      }

      const { packOwnerUid, packId } = req.body || {};
      const authHeader = req.headers.authorization || "";
      if (!authHeader.startsWith("Bearer ")) {
        return res.status(401).json({ error: "Authorization required" });
      }

      const idToken = authHeader.slice("Bearer ".length);
      const decodedToken = await admin.auth().verifyIdToken(idToken);

      const result = await likeCommunityPackCore({
        packOwnerUid,
        packId,
        likerUid: decodedToken.uid,
      });

      return res.json({
        success: true,
        ...result,
      });
    } catch (err) {
      console.error("Error liking community pack:", err);

      if (err && err.code === 7) {
        return res.status(403).json({ error: "Permission denied" });
      }

      const status = err && err.message === "Pack not found" ? 404 : 500;
      return res.status(status).json({ error: err.message || "Failed to like pack" });
    }
  });
});

// HTTP Cloud Function to generate tags
exports.generateTags = functions.https.onRequest((req, res) => {
  return corsHandler(req, res, async () => {
    try {
      const packName = req.body.packName;

      if (!packName) {
        return res.status(400).json({ error: "packName is required" });
      }

      const prompt = `Generate 1-2 relevant educational tags for this study pack name: "${packName}". 
Tags should be from categories like: exam systems (IGCSE, AP, IB, GCSE, A-Level, SAT, ACT), subjects (Biology, Chemistry, Physics, Math, English, Spanish, etc.), or grade levels (Grade 7-12).
Return ONLY a comma-separated list of tags, nothing else. Example: "IGCSE, Biology" or "AP" or "Grade 9, Chemistry"`;

      const response = await fetch(API_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${API_KEY}`,
        },
        body: JSON.stringify({ message: prompt }),
      });

      if (response.status === 429) {
        console.warn("API rate limited, using keyword-based tags");
        return res.json({
          tags: generateTagsKeywordBased(packName),
          source: "keyword",
        });
      }

      if (!response.ok) {
        console.warn(`API error (${response.status}), using keyword-based tags`);
        return res.json({
          tags: generateTagsKeywordBased(packName),
          source: "keyword",
        });
      }

      const apiData = await response.json();

      if (apiData.success && apiData.response) {
        const tagsStr = apiData.response.trim();
        const tags = tagsStr
          .split(",")
          .map((tag) => tag.trim())
          .filter((tag) => tag.length > 0)
          .slice(0, 2);

        return res.json({
          tags: tags.length > 0 ? tags : generateTagsKeywordBased(packName),
          source: "api",
        });
      }

      return res.json({
        tags: generateTagsKeywordBased(packName),
        source: "keyword",
      });
    } catch (err) {
      console.warn("Tag generation error, using keyword-based tags:", err);
      return res.json({
        tags: generateTagsKeywordBased(req.body.packName || ""),
        source: "keyword",
      });
    }
  });
});
