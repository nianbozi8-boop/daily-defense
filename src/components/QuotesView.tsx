import React, { useState, useEffect, useMemo } from "react";
import { DailyCatholicQuote } from "../types";
import { fetchDailyQuotes } from "../services/aiService";
import { useApp } from "../context/AppContext";
import {
  Quote,
  Copy,
  Check,
  BookmarkPlus,
  Atom,
  Building2,
  ShieldAlert,
  Calendar,
  Sparkles,
  RefreshCw,
  Info,
  ChevronDown,
  CheckCircle2,
  MessageSquare,
  BookOpen,
} from "lucide-react";

interface QuotesViewProps {
  onOpenNotes?: () => void;
  onOpenChat?: (prompt: string) => void;
}

export const QuotesView: React.FC<QuotesViewProps> = ({ onOpenNotes, onOpenChat }) => {
  const { addNote } = useApp();

  const [quotes, setQuotes] = useState<DailyCatholicQuote[]>([]);
  const [loading, setLoading] = useState(true);

  // UI interaction states
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [noteSavedId, setNoteSavedId] = useState<string | null>(null);
  const [expandedInsightId, setExpandedInsightId] = useState<string | null>(null);

  // Formatted current date for "Quotes of the Day"
  const today = useMemo(() => new Date(), []);
  const todayFormatted = useMemo(() => {
    return today.toLocaleDateString("en-US", {
      weekday: "long",
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }, [today]);

  // Load quotes from backend / curated dataset
  const loadQuotes = async () => {
    setLoading(true);

    try {
      const res = await fetchDailyQuotes("all", false);
      if (res.quotes && res.quotes.length > 0) {
        setQuotes(res.quotes);
      }
    } catch (e) {
      console.debug("Failed to fetch daily quotes:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadQuotes();
  }, []);

  // Compute deterministic seed based on year and day of year
  const dayOfYear = useMemo(() => {
    const startOfYear = new Date(today.getFullYear(), 0, 0);
    const diff = today.getTime() - startOfYear.getTime();
    return Math.floor(diff / (1000 * 60 * 60 * 24));
  }, [today]);

  // Daily Primary Spotlight Quote
  const spotlightQuote = useMemo(() => {
    if (!quotes || quotes.length === 0) return null;
    const seed = today.getFullYear() * 366 + dayOfYear;
    const idx = Math.abs(seed) % quotes.length;
    return quotes[idx];
  }, [quotes, today, dayOfYear]);

  // Today's Catholic Scientist Quote
  const todayScientist = useMemo(() => {
    const pool = quotes.filter((q) => q.category === "catholic_scientist");
    if (pool.length === 0) return null;
    const seed = today.getFullYear() * 366 + dayOfYear + 7;
    return pool[Math.abs(seed) % pool.length];
  }, [quotes, today, dayOfYear]);

  // Today's Church Father Quote
  const todayFather = useMemo(() => {
    const pool = quotes.filter((q) => q.category === "church_father");
    if (pool.length === 0) return null;
    const seed = today.getFullYear() * 366 + dayOfYear + 19;
    return pool[Math.abs(seed) % pool.length];
  }, [quotes, today, dayOfYear]);

  // Today's Apologetics Titan Quote
  const todayApologist = useMemo(() => {
    const pool = quotes.filter((q) => q.category === "apologetic_titan");
    if (pool.length === 0) return null;
    const seed = today.getFullYear() * 366 + dayOfYear + 31;
    return pool[Math.abs(seed) % pool.length];
  }, [quotes, today, dayOfYear]);

  const handleCopyQuote = (q: DailyCatholicQuote) => {
    const text = `"${q.quote}"\n\n— ${q.author}\n${q.title} (${q.era})\nSource: ${q.source}\n\nVia Daily Defense Catholic Apologetics`;
    navigator.clipboard?.writeText(text);
    setCopiedId(q.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleSaveToNotes = (q: DailyCatholicQuote) => {
    addNote({
      title: `${q.author}: ${q.title}`,
      content: `"${q.quote}"\n\nSource: ${q.source}\nEra: ${q.era}\n\nHistorical Impact:\n${q.historicalImpact}\n\nFaith & Reason Insight:\n${q.faithAndReasonInsight}`,
      category: q.category === "catholic_scientist" ? "Science & Faith" : "Church History",
    });
    setNoteSavedId(q.id);
    setTimeout(() => setNoteSavedId(null), 2500);
  };

  const getPillarBadge = (category: string) => {
    switch (category) {
      case "catholic_scientist":
        return {
          label: "Catholic Scientist of the Day",
          icon: Atom,
          bg: "bg-emerald-50 text-emerald-800 border-emerald-200",
          headerBg: "bg-emerald-700",
        };
      case "church_father":
        return {
          label: "Church Father of the Day",
          icon: Building2,
          bg: "bg-amber-50 text-amber-800 border-amber-200",
          headerBg: "bg-amber-700",
        };
      case "apologetic_titan":
        return {
          label: "Apologetics Titan of the Day",
          icon: ShieldAlert,
          bg: "bg-blue-50 text-blue-800 border-blue-200",
          headerBg: "bg-blue-700",
        };
      default:
        return {
          label: "Catholic Pillar of the Day",
          icon: Quote,
          bg: "bg-gray-100 text-gray-800 border-gray-200",
          headerBg: "bg-[#1e3a8a]",
        };
    }
  };

  const todayPillars = useMemo(() => {
    const list: DailyCatholicQuote[] = [];
    if (todayFather) list.push(todayFather);
    if (todayScientist) list.push(todayScientist);
    if (todayApologist) list.push(todayApologist);
    return list;
  }, [todayFather, todayScientist, todayApologist]);

  return (
    <div className="space-y-6">
      {/* Hero Header Banner */}
      <div className="bg-[#1e3a8a] text-white -mx-3 sm:-mx-6 -mt-3 sm:-mt-6 px-4 pt-5 pb-6 sm:pt-6 sm:pb-7 shadow-md rounded-b-3xl">
        <div className="max-w-4xl mx-auto space-y-3">
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <span className="bg-[#c9a84c] text-[#1e3a8a] text-[10px] sm:text-xs font-black uppercase tracking-wider px-2.5 py-0.5 rounded-full shadow-xs">
                Fides et Ratio
              </span>
              <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-200 bg-amber-950/50 border border-amber-400/30 px-2.5 py-0.5 rounded-full">
                <Calendar className="w-2.5 h-2.5 text-amber-300" />
                <span>{todayFormatted}</span>
              </span>
            </div>
            <h2 className="text-xl sm:text-2xl md:text-3xl font-extrabold tracking-tight text-white flex items-center gap-2.5">
              <span>Catholic Pillars & Science</span>
            </h2>
            <p className="text-xs sm:text-sm text-blue-200/90 mt-1 max-w-2xl leading-relaxed">
              Daily curated wisdom from early Church Fathers, Catholic priest-scientists who founded modern astronomy and genetics, and historic apologists defending the faith with reason and charity.
            </p>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto space-y-6 px-1">
        {loading ? (
          <div className="bg-white rounded-2xl p-12 text-center border border-[#e2ddd6] space-y-3">
            <RefreshCw className="w-8 h-8 animate-spin mx-auto text-[#1e3a8a]" />
            <p className="text-sm font-bold text-gray-800">
              Gathering Today's Catholic Quotes...
            </p>
            <p className="text-xs text-gray-500">
              Loading today's reflections from Church Fathers and Catholic scientists
            </p>
          </div>
        ) : (
          <>
            {/* Primary Quote of the Day Spotlight */}
            {spotlightQuote && (
              <div className="bg-gradient-to-br from-amber-50/80 via-white to-amber-100/40 border-2 border-[#c9a84c]/60 rounded-2xl p-5 sm:p-6 shadow-sm space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-200/70 pb-3">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-[#c9a84c] animate-pulse" />
                    <span className="font-extrabold text-xs uppercase tracking-wider text-[#1e3a8a]">
                      Quote of the Day
                    </span>
                    <span className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-900 bg-amber-100 px-2.5 py-0.5 rounded-full border border-amber-300">
                      <Calendar className="w-3 h-3 text-amber-700" />
                      <span>{todayFormatted}</span>
                    </span>
                  </div>
                  <span className="text-[11px] font-semibold text-gray-500">
                    Rotates daily at midnight
                  </span>
                </div>

                <div className="relative pl-4 border-l-4 border-[#c9a84c]">
                  <p className="text-gray-950 text-base sm:text-lg font-serif italic leading-relaxed">
                    "{spotlightQuote.quote}"
                  </p>
                </div>

                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-gray-600 pt-1">
                  <div>
                    <h3 className="font-extrabold text-[#1e3a8a] text-base">
                      {spotlightQuote.author}
                    </h3>
                    <p className="text-xs text-gray-600 font-medium">{spotlightQuote.title} ({spotlightQuote.era})</p>
                  </div>
                  <div className="text-xs text-gray-500 sm:text-right">
                    <span className="font-semibold text-gray-700">Source: </span>
                    <span className="italic">{spotlightQuote.source}</span>
                  </div>
                </div>

                {/* Spotlight Actions */}
                <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-amber-200/50 text-xs">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleCopyQuote(spotlightQuote)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white hover:bg-gray-50 border border-gray-200 text-gray-700 font-medium transition cursor-pointer shadow-2xs"
                    >
                      {copiedId === spotlightQuote.id ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-emerald-600" />
                          <span className="text-emerald-700 font-bold">Copied!</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5 text-gray-500" />
                          <span>Copy Quote</span>
                        </>
                      )}
                    </button>

                    <button
                      onClick={() => handleSaveToNotes(spotlightQuote)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white hover:bg-gray-50 border border-gray-200 text-gray-700 font-medium transition cursor-pointer shadow-2xs"
                    >
                      {noteSavedId === spotlightQuote.id ? (
                        <>
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                          <span className="text-emerald-700 font-bold">Saved to Notes!</span>
                        </>
                      ) : (
                        <>
                          <BookmarkPlus className="w-3.5 h-3.5 text-[#1e3a8a]" />
                          <span>Save to Notes</span>
                        </>
                      )}
                    </button>
                  </div>

                  {onOpenChat && (
                    <button
                      onClick={() =>
                        onOpenChat(
                          `Can you explain the historical and theological significance of ${spotlightQuote.author}'s quote: "${spotlightQuote.quote}"?`
                        )
                      }
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-50 hover:bg-blue-100 text-[#1e3a8a] font-bold transition cursor-pointer"
                    >
                      <MessageSquare className="w-3.5 h-3.5" />
                      <span>Discuss with Apologetics AI</span>
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Section: Today's 3 Pillars */}
            <div className="space-y-4 pt-2">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-extrabold text-base sm:text-lg text-[#1e3a8a] tracking-tight flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-[#c9a84c]" />
                    <span>Today's 3 Pillars of Catholic Wisdom</span>
                  </h3>
                  <p className="text-xs text-gray-500">
                    A daily selection spanning Church Fathers, scientific pioneers, and apologetic giants
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {todayPillars.map((q) => {
                  const badge = getPillarBadge(q.category);
                  const BadgeIcon = badge.icon;
                  const isExpanded = expandedInsightId === q.id;

                  return (
                    <article
                      key={q.id}
                      className="bg-white rounded-2xl border border-[#e2ddd6] shadow-xs hover:shadow-md transition flex flex-col justify-between overflow-hidden"
                    >
                      <div className="p-4 sm:p-5 space-y-3">
                        {/* Category Row */}
                        <div className="flex items-center justify-between gap-1">
                          <span
                            className={`inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-0.5 rounded-md border ${badge.bg}`}
                          >
                            <BadgeIcon className="w-3 h-3" />
                            <span>{badge.label}</span>
                          </span>
                          <span className="text-[10px] text-gray-400 font-medium">
                            {q.era}
                          </span>
                        </div>

                        {/* Author & Title */}
                        <div>
                          <h4 className="font-extrabold text-base text-[#1e3a8a]">
                            {q.author}
                          </h4>
                          <p className="text-xs text-gray-600 font-medium leading-snug mt-0.5">
                            {q.title}
                          </p>
                        </div>

                        {/* Quote Text */}
                        <div className="relative bg-[#fcfaf7] border border-[#ece4d8] rounded-xl p-3">
                          <Quote className="w-4 h-4 text-[#c9a84c]/40 absolute top-2 left-2 -scale-x-100 pointer-events-none" />
                          <p className="font-serif italic text-xs text-gray-800 leading-relaxed pl-2.5">
                            "{q.quote}"
                          </p>
                          <p className="text-[10px] font-semibold text-gray-500 mt-2 text-right">
                            — {q.source}
                          </p>
                        </div>

                        {/* Expandable Insight Drawer */}
                        <div className="pt-1">
                          <button
                            onClick={() =>
                              setExpandedInsightId(isExpanded ? null : q.id)
                            }
                            className="w-full flex items-center justify-between text-xs font-semibold text-[#1e3a8a] hover:text-blue-900 py-1 cursor-pointer transition"
                          >
                            <span className="flex items-center gap-1.5">
                              <Info className="w-3.5 h-3.5 text-[#c9a84c]" />
                              <span>Historical Contribution</span>
                            </span>
                            <ChevronDown
                              className={`w-3.5 h-3.5 transition-transform duration-200 ${
                                isExpanded ? "rotate-180" : ""
                              }`}
                            />
                          </button>

                          {isExpanded && (
                            <div className="bg-[#f8f7f4] rounded-xl p-3 border border-gray-200 text-xs space-y-2 mt-1 animate-in fade-in duration-150">
                              <div>
                                <span className="font-bold text-gray-900 block text-[10px] uppercase tracking-wide text-emerald-800">
                                  Historical Legacy:
                                </span>
                                <p className="text-gray-700 leading-relaxed mt-0.5 text-[11px]">
                                  {q.historicalImpact}
                                </p>
                              </div>

                              <div>
                                <span className="font-bold text-gray-900 block text-[10px] uppercase tracking-wide text-blue-900">
                                  Faith & Reason:
                                </span>
                                <p className="text-gray-700 leading-relaxed mt-0.5 text-[11px]">
                                  {q.faithAndReasonInsight}
                                </p>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Card Action Footer */}
                      <div className="bg-[#faf8f5] border-t border-[#ece6dc] px-3.5 py-2.5 flex items-center justify-between text-xs">
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => handleCopyQuote(q)}
                            className="flex items-center gap-1 px-2 py-1 rounded-md bg-white hover:bg-gray-50 border border-gray-200 text-gray-700 text-xs font-medium transition cursor-pointer"
                            title="Copy quote"
                          >
                            {copiedId === q.id ? (
                              <Check className="w-3 h-3 text-emerald-600" />
                            ) : (
                              <Copy className="w-3 h-3 text-gray-500" />
                            )}
                            <span>{copiedId === q.id ? "Copied" : "Copy"}</span>
                          </button>

                          <button
                            onClick={() => handleSaveToNotes(q)}
                            className="flex items-center gap-1 px-2 py-1 rounded-md bg-white hover:bg-gray-50 border border-gray-200 text-gray-700 text-xs font-medium transition cursor-pointer"
                            title="Save to study notes"
                          >
                            {noteSavedId === q.id ? (
                              <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                            ) : (
                              <BookmarkPlus className="w-3 h-3 text-[#1e3a8a]" />
                            )}
                            <span>{noteSavedId === q.id ? "Saved" : "Notes"}</span>
                          </button>
                        </div>

                        {onOpenChat && (
                          <button
                            onClick={() =>
                              onOpenChat(
                                `Tell me more about ${q.author} and their theological/scientific quote: "${q.quote}"`
                              )
                            }
                            className="flex items-center gap-1 px-2 py-1 rounded-md bg-blue-50 hover:bg-blue-100 text-[#1e3a8a] font-bold text-xs transition cursor-pointer"
                            title="Discuss with AI"
                          >
                            <MessageSquare className="w-3 h-3" />
                            <span>Discuss</span>
                          </button>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            </div>

            {/* Catholic Contribution to Science & University Infographic Banner */}
            <div className="bg-white rounded-2xl p-5 border border-[#e2ddd6] shadow-xs space-y-3">
              <div className="flex items-center gap-2 text-[#1e3a8a]">
                <Atom className="w-5 h-5 text-emerald-600" />
                <h4 className="font-extrabold text-sm sm:text-base">
                  Did You Know? The Catholic Church & The Scientific Revolution
                </h4>
              </div>
              <p className="text-xs text-gray-600 leading-relaxed">
                Contrary to the modern myth of a conflict between faith and science, the Catholic Church was the single greatest historical patron of scientific inquiry. Catholic priests and devout scholars founded fundamental scientific disciplines:
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1 text-xs">
                <div className="bg-emerald-50/60 border border-emerald-200 rounded-xl p-3">
                  <span className="font-bold text-emerald-900 block mb-0.5">
                    The Big Bang Theory
                  </span>
                  <p className="text-gray-700 text-[11px]">
                    Discovered in 1927 by <strong>Fr. Georges Lemaître</strong>, Belgian Catholic priest and theoretical physicist.
                  </p>
                </div>
                <div className="bg-amber-50/60 border border-amber-200 rounded-xl p-3">
                  <span className="font-bold text-amber-900 block mb-0.5">
                    Modern Genetics
                  </span>
                  <p className="text-gray-700 text-[11px]">
                    Founded by <strong>Gregor Mendel</strong>, Augustinian friar and abbot, studying pea plants at his monastery.
                  </p>
                </div>
                <div className="bg-blue-50/60 border border-blue-200 rounded-xl p-3">
                  <span className="font-bold text-blue-900 block mb-0.5">
                    Astrophysics & Geology
                  </span>
                  <p className="text-gray-700 text-[11px]">
                    Astronomical spectroscopy was founded by Jesuit <strong>Fr. Angelo Secchi</strong>, and stratigraphy by <strong>Blessed Nicolas Steno</strong>.
                  </p>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
