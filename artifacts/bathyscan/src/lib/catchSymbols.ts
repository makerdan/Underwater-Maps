/**
 * catchSymbols.ts — searchable emoji/symbol catalog for the catch journal.
 *
 * Fish and sea-life symbols are listed first (the common case for BathyScan),
 * followed by general-purpose categories. Each symbol carries a name and
 * keywords so the picker's search box can match on either.
 *
 * Pure data module — no React, no network.
 */

export interface CatchSymbol {
  /** The emoji / glyph itself (what gets stored on the catch entry). */
  symbol: string;
  /** Human-readable name, e.g. "Salmon". */
  name: string;
  /** Lower-case search keywords (name is matched automatically). */
  keywords: string[];
  /** Category for grouped display in the picker. */
  category: CatchSymbolCategory;
}

export type CatchSymbolCategory =
  | "Fish & Sea Life"
  | "Shellfish & Crustaceans"
  | "Gear & Boats"
  | "Nature & Weather"
  | "Food & Drink"
  | "Flags & Awards"
  | "Faces & People"
  | "Symbols";

export const CATCH_SYMBOLS: CatchSymbol[] = [
  // ── Fish & sea life (most prominent) ──────────────────────────────────────
  { symbol: "🐟", name: "Fish", keywords: ["generic", "catch"], category: "Fish & Sea Life" },
  { symbol: "🐠", name: "Tropical Fish", keywords: ["reef", "colorful"], category: "Fish & Sea Life" },
  { symbol: "🐡", name: "Pufferfish", keywords: ["blowfish", "fugu"], category: "Fish & Sea Life" },
  { symbol: "🦈", name: "Shark", keywords: ["predator"], category: "Fish & Sea Life" },
  { symbol: "🐬", name: "Dolphin", keywords: ["porpoise", "mahi"], category: "Fish & Sea Life" },
  { symbol: "🐋", name: "Whale", keywords: ["humpback"], category: "Fish & Sea Life" },
  { symbol: "🐳", name: "Spouting Whale", keywords: ["blow"], category: "Fish & Sea Life" },
  { symbol: "🐙", name: "Octopus", keywords: ["cephalopod", "tentacle"], category: "Fish & Sea Life" },
  { symbol: "🦑", name: "Squid", keywords: ["calamari", "cephalopod"], category: "Fish & Sea Life" },
  { symbol: "🪼", name: "Jellyfish", keywords: ["sting"], category: "Fish & Sea Life" },
  { symbol: "🐢", name: "Sea Turtle", keywords: ["tortoise"], category: "Fish & Sea Life" },
  { symbol: "🦭", name: "Seal", keywords: ["sea lion"], category: "Fish & Sea Life" },
  { symbol: "🐊", name: "Alligator", keywords: ["crocodile", "gator"], category: "Fish & Sea Life" },
  { symbol: "🐸", name: "Frog", keywords: ["bullfrog", "amphibian"], category: "Fish & Sea Life" },
  { symbol: "🦦", name: "Otter", keywords: ["river"], category: "Fish & Sea Life" },
  { symbol: "🐍", name: "Eel", keywords: ["snake", "water snake"], category: "Fish & Sea Life" },
  { symbol: "🧜", name: "Mermaid", keywords: ["merman", "legend"], category: "Fish & Sea Life" },

  // ── Shellfish & crustaceans ───────────────────────────────────────────────
  { symbol: "🦀", name: "Crab", keywords: ["dungeness", "blue crab"], category: "Shellfish & Crustaceans" },
  { symbol: "🦞", name: "Lobster", keywords: ["crawfish", "crayfish"], category: "Shellfish & Crustaceans" },
  { symbol: "🦐", name: "Shrimp", keywords: ["prawn"], category: "Shellfish & Crustaceans" },
  { symbol: "🦪", name: "Oyster", keywords: ["shellfish", "pearl", "clam"], category: "Shellfish & Crustaceans" },
  { symbol: "🐚", name: "Shell", keywords: ["conch", "scallop", "seashell"], category: "Shellfish & Crustaceans" },
  { symbol: "🐌", name: "Snail", keywords: ["whelk", "periwinkle"], category: "Shellfish & Crustaceans" },
  { symbol: "⭐", name: "Starfish", keywords: ["sea star", "star"], category: "Shellfish & Crustaceans" },

  // ── Gear & boats ──────────────────────────────────────────────────────────
  { symbol: "🎣", name: "Fishing Rod", keywords: ["rod", "pole", "angling", "hook"], category: "Gear & Boats" },
  { symbol: "🪝", name: "Hook", keywords: ["tackle"], category: "Gear & Boats" },
  { symbol: "🕸️", name: "Net", keywords: ["cast net", "web"], category: "Gear & Boats" },
  { symbol: "🛶", name: "Canoe", keywords: ["kayak", "paddle"], category: "Gear & Boats" },
  { symbol: "🚤", name: "Speedboat", keywords: ["motorboat", "boat"], category: "Gear & Boats" },
  { symbol: "⛵", name: "Sailboat", keywords: ["sail", "yacht"], category: "Gear & Boats" },
  { symbol: "🚢", name: "Ship", keywords: ["vessel", "trawler"], category: "Gear & Boats" },
  { symbol: "⚓", name: "Anchor", keywords: ["mooring"], category: "Gear & Boats" },
  { symbol: "🛟", name: "Life Ring", keywords: ["buoy", "float", "safety"], category: "Gear & Boats" },
  { symbol: "🧊", name: "Ice", keywords: ["cooler", "ice fishing"], category: "Gear & Boats" },
  { symbol: "🔦", name: "Flashlight", keywords: ["torch", "night"], category: "Gear & Boats" },
  { symbol: "🧭", name: "Compass", keywords: ["navigation", "bearing"], category: "Gear & Boats" },

  // ── Nature & weather ──────────────────────────────────────────────────────
  { symbol: "🌊", name: "Wave", keywords: ["surf", "swell", "ocean"], category: "Nature & Weather" },
  { symbol: "🌅", name: "Sunrise", keywords: ["dawn", "morning"], category: "Nature & Weather" },
  { symbol: "🌇", name: "Sunset", keywords: ["dusk", "evening"], category: "Nature & Weather" },
  { symbol: "☀️", name: "Sun", keywords: ["sunny", "clear"], category: "Nature & Weather" },
  { symbol: "🌧️", name: "Rain", keywords: ["storm", "shower"], category: "Nature & Weather" },
  { symbol: "⛈️", name: "Thunderstorm", keywords: ["lightning", "storm"], category: "Nature & Weather" },
  { symbol: "💨", name: "Wind", keywords: ["gust", "breeze"], category: "Nature & Weather" },
  { symbol: "🌕", name: "Full Moon", keywords: ["night", "lunar"], category: "Nature & Weather" },
  { symbol: "🪸", name: "Coral", keywords: ["reef"], category: "Nature & Weather" },
  { symbol: "🌿", name: "Plant", keywords: ["weed", "vegetation", "kelp"], category: "Nature & Weather" },
  { symbol: "🪨", name: "Rock", keywords: ["boulder", "structure"], category: "Nature & Weather" },
  { symbol: "🏞️", name: "River", keywords: ["lake", "freshwater"], category: "Nature & Weather" },

  // ── Food & drink ──────────────────────────────────────────────────────────
  { symbol: "🍣", name: "Sushi", keywords: ["sashimi", "raw"], category: "Food & Drink" },
  { symbol: "🍤", name: "Fried Shrimp", keywords: ["tempura"], category: "Food & Drink" },
  { symbol: "🔥", name: "Fire", keywords: ["grill", "cook", "hot"], category: "Food & Drink" },
  { symbol: "🍺", name: "Beer", keywords: ["drink", "celebrate"], category: "Food & Drink" },
  { symbol: "☕", name: "Coffee", keywords: ["thermos", "morning"], category: "Food & Drink" },

  // ── Flags & awards ────────────────────────────────────────────────────────
  { symbol: "🏆", name: "Trophy", keywords: ["record", "biggest", "winner", "pb"], category: "Flags & Awards" },
  { symbol: "🥇", name: "Gold Medal", keywords: ["first", "best"], category: "Flags & Awards" },
  { symbol: "🎯", name: "Bullseye", keywords: ["target", "spot on"], category: "Flags & Awards" },
  { symbol: "📏", name: "Ruler", keywords: ["measure", "length", "size"], category: "Flags & Awards" },
  { symbol: "⚖️", name: "Scale", keywords: ["weight", "weigh"], category: "Flags & Awards" },
  { symbol: "🚩", name: "Red Flag", keywords: ["flag", "mark"], category: "Flags & Awards" },
  { symbol: "📍", name: "Pin", keywords: ["location", "spot"], category: "Flags & Awards" },

  // ── Faces & people ────────────────────────────────────────────────────────
  { symbol: "😀", name: "Happy Face", keywords: ["smile", "good day"], category: "Faces & People" },
  { symbol: "😎", name: "Cool Face", keywords: ["sunglasses"], category: "Faces & People" },
  { symbol: "🤩", name: "Star-Struck", keywords: ["amazing", "wow"], category: "Faces & People" },
  { symbol: "😢", name: "Sad Face", keywords: ["skunked", "got away"], category: "Faces & People" },
  { symbol: "💪", name: "Strong Arm", keywords: ["fight", "muscle"], category: "Faces & People" },
  { symbol: "👍", name: "Thumbs Up", keywords: ["good", "ok"], category: "Faces & People" },
  { symbol: "🙌", name: "Raised Hands", keywords: ["celebrate", "hooray"], category: "Faces & People" },

  // ── Symbols ───────────────────────────────────────────────────────────────
  { symbol: "❓", name: "Question", keywords: ["unknown", "mystery"], category: "Symbols" },
  { symbol: "❗", name: "Exclamation", keywords: ["important", "alert"], category: "Symbols" },
  { symbol: "💚", name: "Green Heart", keywords: ["released", "catch and release"], category: "Symbols" },
  { symbol: "❤️", name: "Heart", keywords: ["love", "favorite"], category: "Symbols" },
  { symbol: "✨", name: "Sparkles", keywords: ["new", "special"], category: "Symbols" },
  { symbol: "💤", name: "Zzz", keywords: ["slow", "nothing biting"], category: "Symbols" },
];

/** Ordered category list for grouped rendering. */
export const CATCH_SYMBOL_CATEGORIES: CatchSymbolCategory[] = [
  "Fish & Sea Life",
  "Shellfish & Crustaceans",
  "Gear & Boats",
  "Nature & Weather",
  "Food & Drink",
  "Flags & Awards",
  "Faces & People",
  "Symbols",
];

/**
 * Filter the catalog by a free-text query. Matches against name and
 * keywords, case-insensitive. Empty query returns the full catalog.
 */
export function searchCatchSymbols(query: string): CatchSymbol[] {
  const q = query.trim().toLowerCase();
  if (!q) return CATCH_SYMBOLS;
  return CATCH_SYMBOLS.filter(
    (s) =>
      s.name.toLowerCase().includes(q) ||
      s.keywords.some((k) => k.includes(q)) ||
      s.symbol === q,
  );
}

/** Look up the display name for a stored symbol glyph ("" if unknown). */
export function catchSymbolName(symbol: string): string {
  return CATCH_SYMBOLS.find((s) => s.symbol === symbol)?.name ?? "";
}
