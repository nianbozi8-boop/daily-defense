import React from "react";
import { Bot, Sparkles, Swords, ChevronRight, Zap, Globe, Shield, BookOpen, Compass, Award } from "lucide-react";
import { useApp } from "../context/AppContext";

interface PracticeTabProps {
  onOpenApologeticsChat: (starterPrompt?: string) => void;
}

const SPARRING_MODES = [
  {
    id: "general",
    title: "Open Apologetics Sparring",
    tag: "Core Arena",
    tagColor: "bg-blue-100 text-[#1e3a8a]",
    icon: Bot,
    prompt: "",
    desc: "Engage in freeform discussion, ask difficult theological questions, or test your reasoning on any Catholic topic.",
  },
  {
    id: "devils_advocate",
    title: "Devil's Advocate: The Papacy",
    tag: "High Difficulty",
    tagColor: "bg-rose-100 text-rose-700",
    icon: Swords,
    prompt: "I want to practice defending the Catholic dogma of the Papacy. Play the devil's advocate and present the strongest objection against Peter's primacy from Matthew 16 and Church history.",
    desc: "Test your defense against rigorous, skeptical objections regarding St. Peter, apostolic succession, and papal authority.",
  },
  {
    id: "sola_scriptura",
    title: "Cross-Examination: Scripture & Tradition",
    tag: "Biblical Defense",
    tagColor: "bg-amber-100 text-amber-800",
    icon: BookOpen,
    prompt: "Let's debate Sola Scriptura. Critique the Catholic belief in Sacred Tradition and the Magisterium using 2 Timothy 3:16-17.",
    desc: "Examine the canon of Scripture, apostolic oral tradition, and why the Bible alone cannot interpret itself.",
  },
  {
    id: "atheism_skepticism",
    title: "Skepticism: Existence of God & Evil",
    tag: "Philosophy",
    tagColor: "bg-purple-100 text-purple-700",
    icon: Compass,
    prompt: "Present a challenging objection against God's existence based on the problem of gratuitous suffering and evil in the world.",
    desc: "Engage with classical philosophical problems, Aquinas's Five Ways, and Christian theodicy.",
  },
  {
    id: "eucharist",
    title: "Real Presence: John 6 Cross-Exam",
    tag: "Sacraments",
    tagColor: "bg-emerald-100 text-emerald-800",
    icon: Shield,
    prompt: "Challenge me on the Real Presence in the Eucharist. Object that Jesus was speaking purely metaphorically in John 6.",
    desc: "Defend Christ's literal words in John 6, 1 Corinthians 11, and the universal witness of the early Church.",
  },
];

export const PracticeTab: React.FC<PracticeTabProps> = ({
  onOpenApologeticsChat,
}) => {
  const { stats } = useApp();

  return (
    <div className="space-y-5 sm:space-y-6">
      {/* Header Banner */}
      <div className="bg-[#1e3a8a] text-white -mx-3 sm:-mx-6 -mt-3 sm:-mt-6 px-4 pt-3.5 pb-5 sm:pt-5 sm:pb-6 rounded-b-2xl shadow-md">
        <div className="max-w-4xl mx-auto">
          <span className="inline-block bg-[#c9a84c] text-[#1e3a8a] text-[10px] sm:text-[11px] font-bold px-2.5 py-0.5 rounded-full uppercase tracking-wider mb-1.5 sm:mb-2">
            Apologetics Arena
          </span>
          <h2 className="text-lg sm:text-2xl font-bold tracking-tight text-white">
            Intellectual Defense in Charity
          </h2>
          <p className="text-[11px] sm:text-sm text-blue-200 mt-1 max-w-xl leading-relaxed">
            "Always be prepared to make a defense to anyone who calls you to account for the hope that is in you, yet do it with gentleness and reverence." — 1 Peter 3:15
          </p>
        </div>
      </div>

      <div className="max-w-4xl mx-auto space-y-5 sm:space-y-6 px-1">
        {/* Hero Featured Card: Catholic Apologetics AI */}
        <div
          onClick={() => onOpenApologeticsChat()}
          className="group bg-gradient-to-br from-[#1e3a8a] via-[#23449e] to-[#162a63] text-white rounded-2xl p-5 sm:p-6 shadow-md hover:shadow-xl transition-all cursor-pointer border border-blue-400/30 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4"
        >
          <div className="space-y-2 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="bg-[#c9a84c] text-[#1e3a8a] text-[10px] font-bold px-2.5 py-0.5 rounded-full uppercase tracking-wider">
                Self-Aware AI Theologian
              </span>
              <span className="bg-blue-500/40 text-blue-200 text-[10px] font-medium px-2 py-0.5 rounded-full flex items-center gap-1 border border-blue-400/20">
                <Zap className="w-3 h-3 text-[#f0d080]" /> DeepThink Enabled
              </span>
              <span className="bg-emerald-500/30 text-emerald-200 text-[10px] font-medium px-2 py-0.5 rounded-full flex items-center gap-1 border border-emerald-400/20">
                <Globe className="w-3 h-3 text-emerald-300" /> Optional Web Scraping
              </span>
            </div>
            <h3 className="text-lg sm:text-xl font-bold text-white group-hover:text-[#f0d080] transition flex items-center gap-2">
              <Bot className="w-6 h-6 text-[#f0d080] shrink-0" />
              <span>Launch Apologetics AI</span>
            </h3>
            <p className="text-xs sm:text-sm text-blue-100 leading-relaxed max-w-xl">
              Equipped with encyclopedic mastery of Sacred Scripture, the Catechism, early Church Fathers, and philosophy. Formulates its own dynamic, nuanced arguments without scripted fallbacks.
            </p>
          </div>

          <button className="px-5 py-3 bg-[#c9a84c] text-[#1e3a8a] font-bold text-xs rounded-xl shadow hover:bg-amber-300 transition flex items-center gap-2 shrink-0 group-hover:scale-105">
            <span>Enter Sparring Arena</span>
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        {/* Practice Stats Summary */}
        <div className="grid grid-cols-2 sm:grid-cols-2 gap-3">
          <div className="bg-white p-3.5 sm:p-4 rounded-xl border border-gray-200 shadow-xs flex items-center gap-3">
            <div className="p-2.5 bg-blue-50 text-[#1e3a8a] rounded-lg">
              <Swords className="w-5 h-5" />
            </div>
            <div>
              <div className="text-xs text-gray-500 font-medium">Debates Completed</div>
              <div className="text-lg font-bold text-[#1e3a8a]">
                {stats.debatesCompleted}
              </div>
            </div>
          </div>

          <div className="bg-white p-3.5 sm:p-4 rounded-xl border border-gray-200 shadow-xs flex items-center gap-3">
            <div className="p-2.5 bg-amber-50 text-amber-700 rounded-lg">
              <Award className="w-5 h-5" />
            </div>
            <div>
              <div className="text-xs text-gray-500 font-medium">Topics Studied</div>
              <div className="text-lg font-bold text-gray-900">
                {stats.topicsStudied}
              </div>
            </div>
          </div>
        </div>

        {/* Sparring Modes Grid */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-sm sm:text-base text-gray-900 flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-[#c9a84c]" />
              <span>Targeted Sparring Scenarios</span>
            </h3>
            <span className="text-xs text-gray-400">Launches Apologetics AI</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            {SPARRING_MODES.slice(1).map((mode) => {
              const Icon = mode.icon;
              return (
                <div
                  key={mode.id}
                  onClick={() => onOpenApologeticsChat(mode.prompt)}
                  className="group bg-white hover:bg-[#fcfaf7] border border-[#e2ddd6] hover:border-[#1e3a8a] rounded-2xl p-4 sm:p-5 shadow-xs hover:shadow-md transition cursor-pointer flex flex-col justify-between"
                >
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="w-9 h-9 rounded-xl bg-blue-50 text-[#1e3a8a] flex items-center justify-center group-hover:scale-105 transition">
                        <Icon className="w-4 h-4" />
                      </div>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wide ${mode.tagColor}`}>
                        {mode.tag}
                      </span>
                    </div>

                    <h4 className="font-bold text-sm text-gray-900 group-hover:text-[#1e3a8a] transition">
                      {mode.title}
                    </h4>
                    <p className="text-xs text-gray-600 leading-relaxed line-clamp-2">
                      {mode.desc}
                    </p>
                  </div>

                  <div className="pt-3 mt-2 border-t border-gray-100 flex items-center justify-between text-xs font-bold text-[#1e3a8a]">
                    <span>Begin scenario</span>
                    <ChevronRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition" />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
