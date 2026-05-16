// Generate AI-like tags from pack name using keyword matching
export function generateTags(packName) {
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

  // Extract year if present (e.g., 2024, 2025)
  const yearMatch = packName.match(/\b(20\d{2}|19\d{2})\b/);
  if (yearMatch) {
    const year = yearMatch[1];
    if (!foundTags.includes(year) && foundTags.length < 2) {
      foundTags.push(year);
    }
  }

  return foundTags;
}
