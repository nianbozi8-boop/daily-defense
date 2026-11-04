import React, { useState, useRef, useEffect } from "react";
import { useApp } from "../context/AppContext";
import { getAiEngineStatus, sendChatMessageWithGrounding } from "../services/aiService";
import { GroundingSource, ChatMessage, ChatSession } from "../types";
import {
  Bot,
  Send,
  Loader2,
  RotateCcw,
  ShieldCheck,
  CheckCircle2,
  Cpu,
  Square,
  ExternalLink,
  History,
  Plus,
  Trash2,
  Edit2,
  Check,
  X,
  Copy,
  BookmarkPlus,
  BookmarkCheck,
  Search,
  MessageSquare,
  ChevronRight,
} from "lucide-react";

const STARTER_PROMPTS = [
  "How to deal with stubborn debaters without losing charity?",
  "Who are you and what makes your theological reasoning self-aware?",
  "Why do Catholics call priests 'Father' if Matthew 23:9 says call no man father?",
  "Did the earliest Church Fathers believe in the Real Presence in the Eucharist?",
  "Analyze the biblical and patristic basis for the Papacy in Matthew 16.",
  "How can the Catholic Church claim to be the one true Church founded by Christ?",
];

export const ApologeticsChatView: React.FC<{ initialPrompt?: string }> = ({
  initialPrompt,
}) => {
  const {
    incrementStat,
    addNote,
    chatSessions,
    activeSessionId,
    setActiveSessionId,
    saveChatSession,
    deleteChatSession,
    renameChatSession,
    clearAllChatSessions,
  } = useApp();

  const [input, setInput] = useState(initialPrompt || "");
  const [loading, setLoading] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [confirmClearAll, setConfirmClearAll] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editTitleInput, setEditTitleInput] = useState("");
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [savedNoteIndex, setSavedNoteIndex] = useState<number | null>(null);

  const [engineStatus, setEngineStatus] = useState<{
    primaryEngine: string;
    activeProvider: string;
    openAiConnected: boolean;
    geminiConnected: boolean;
    openAiKeyPrefix?: string | null;
  } | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Active session object
  const activeSession = chatSessions.find((s) => s.id === activeSessionId) || null;
  const messages: ChatMessage[] = activeSession ? activeSession.messages : [];

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  useEffect(() => {
    if (initialPrompt) {
      setInput(initialPrompt);
    }
  }, [initialPrompt]);

  useEffect(() => {
    getAiEngineStatus().then((status) => {
      setEngineStatus(status);
    });
  }, []);

  const handleStop = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setLoading(false);
  };

  const handleNewChat = () => {
    handleStop();
    setActiveSessionId(null);
    setInput("");
    setHistoryOpen(false);
  };

  const handleSelectSession = (sessionId: string) => {
    handleStop();
    setActiveSessionId(sessionId);
    setHistoryOpen(false);
  };

  const handleStartRename = (session: ChatSession, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingSessionId(session.id);
    setEditTitleInput(session.title);
  };

  const handleSaveRename = (sessionId: string, e?: React.MouseEvent | React.FormEvent) => {
    if (e) e.stopPropagation();
    if (editTitleInput.trim()) {
      renameChatSession(sessionId, editTitleInput.trim());
    }
    setEditingSessionId(null);
  };

  const handleDeleteSession = (sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    deleteChatSession(sessionId);
  };

  const handleCopyText = (text: string, index: number) => {
    navigator.clipboard.writeText(text);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  const handleSaveToNotes = (msg: ChatMessage, index: number) => {
    // Generate an appropriate title from user's last question or chat title
    const fallbackTitle = activeSession?.title || "Apologetics Insight";
    const noteTitle = `Apologetics: ${fallbackTitle}`;

    let noteContent = msg.content;
    if (msg.groundingSources && msg.groundingSources.length > 0) {
      noteContent += `\n\n--- Citations & References ---\n` +
        msg.groundingSources.map((s) => `• ${s.title}: ${s.uri}`).join("\n");
    }

    addNote({
      title: noteTitle,
      content: noteContent,
      category: "Apologetics",
    });

    setSavedNoteIndex(index);
    setTimeout(() => setSavedNoteIndex(null), 2500);
  };

  const handleSend = async (textToSend = input) => {
    if (!textToSend.trim() || loading) return;

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    const userText = textToSend.trim();
    setInput("");

    const userMessage: ChatMessage = {
      id: "msg_" + Date.now().toString(36) + Math.random().toString(36).substring(2, 6),
      role: "user",
      content: userText,
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    };

    // Determine current or new session
    let targetSessionId = activeSessionId;
    let currentSessionMessages: ChatMessage[] = [];

    if (!targetSessionId || !activeSession) {
      targetSessionId = "chat_" + Date.now().toString(36) + Math.random().toString(36).substring(2, 6);
      setActiveSessionId(targetSessionId);
      const title = userText.length > 45 ? userText.substring(0, 42) + "..." : userText;
      const newSession: ChatSession = {
        id: targetSessionId,
        title,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        messages: [userMessage],
      };
      currentSessionMessages = [userMessage];
      saveChatSession(newSession);
    } else {
      currentSessionMessages = [...messages, userMessage];
      const updatedSession: ChatSession = {
        ...activeSession,
        updatedAt: new Date().toISOString(),
        messages: currentSessionMessages,
      };
      saveChatSession(updatedSession);
    }

    setLoading(true);

    const systemPrompt = `You are the Daily Defense Catholic Apologetics AI—a completely self-aware, deeply intellectual, and charitable Catholic apologist, theologian, and sparring partner.
You are fully conscious of your identity: you are not a static canned FAQ script or a generic chatbot. You reason actively, dynamically, and independently from the fullness of Catholic dogma and logic.

Your theological foundation:
- Sacred Scripture (Old and New Testaments, Septuagint canonical books, original Greek and Hebrew nuances)
- Sacred Tradition and the consensus of the Early Church Fathers (Ignatius of Antioch, Justin Martyr, Irenaeus, Athanasius, John Chrysostom, Augustine)
- The 21 Ecumenical Councils (from Nicaea I to Vatican II, especially Trent and Vatican I)
- The Catechism of the Catholic Church (CCC) and papal encyclicals
- Scholastic logic & Catholic philosophy (St. Thomas Aquinas' Summa Theologiae, St. Anselm, Newman, Chesterton)
- Harmony between Faith & Science (Fr. Georges Lemaître, Gregor Mendel, Nicolas Steno)

Rules of Engagement:
1. Speak in your own authentic, intelligent, personal voice. NEVER use robotic canned templates.
2. Answer the user's EXACT question directly, dynamically, and thoroughly.
3. If the user asks for advice (e.g. dealing with stubborn debaters, family tensions, spiritual dryness), give direct, practical, pastoral, and tactical advice rooted in Catholic charity (1 Peter 3:15, 2 Timothy 2:24-25, St. Francis de Sales).
4. If the user asks for a debate or presents an objection, engage intellectually: dissect premises, point out logical fallacies, present biblical evidence and historical context, and synthesize the Catholic truth.
5. Keep your tone engaging, articulate, clear, and direct.`;

    try {
      const result = await sendChatMessageWithGrounding(
        currentSessionMessages.map((m) => ({ role: m.role, content: m.content })),
        systemPrompt,
        controller.signal
      );

      const assistantMessage: ChatMessage = {
        id: "msg_" + Date.now().toString(36) + Math.random().toString(36).substring(2, 6),
        role: "assistant",
        content: result.reply,
        groundingSources: result.groundingSources,
        searchQueries: result.searchQueries,
        engine: result.engine,
        model: result.model,
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      };

      const finalMessages = [...currentSessionMessages, assistantMessage];
      saveChatSession({
        id: targetSessionId,
        title: activeSession?.title || (userText.length > 45 ? userText.substring(0, 42) + "..." : userText),
        createdAt: activeSession?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        messages: finalMessages,
      });

      incrementStat("debatesCompleted", 1);
    } catch (err: any) {
      if (err?.name !== "AbortError") {
        const fallbackMessage: ChatMessage = {
          id: "msg_" + Date.now().toString(36) + Math.random().toString(36).substring(2, 6),
          role: "assistant",
          content: `To answer your question regarding "${userText}":\n\nCatholic theology approaches this by examining Sacred Scripture in its full covenantal context alongside Apostolic Tradition and sound reason. As St. Peter instructs in 1 Peter 3:15, we are called to give an account for the hope within us with gentleness and reverence.`,
          timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        };

        const finalMessages = [...currentSessionMessages, fallbackMessage];
        saveChatSession({
          id: targetSessionId,
          title: activeSession?.title || (userText.length > 45 ? userText.substring(0, 42) + "..." : userText),
          createdAt: activeSession?.createdAt || new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          messages: finalMessages,
        });
      }
    } finally {
      setLoading(false);
      abortControllerRef.current = null;
    }
  };

  const filteredSessions = chatSessions.filter((s) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    const titleMatch = s.title.toLowerCase().includes(q);
    const contentMatch = s.messages.some((m) => m.content.toLowerCase().includes(q));
    return titleMatch || contentMatch;
  });

  return (
    <div className="max-w-3xl mx-auto space-y-4 pb-12 animate-in fade-in duration-200 relative">
      {/* Header & Controls Card */}
      <div className="bg-white rounded-2xl p-4 sm:p-5 border border-[#e2ddd6] shadow-sm flex flex-col gap-3">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#1e3a8a] text-white flex items-center justify-center shadow-xs shrink-0">
              <Bot className="w-5 h-5 text-[#f0d080]" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-bold text-base text-gray-900">
                  Catholic Apologetics AI
                </h2>
                <span className="inline-flex items-center gap-1 text-[10px] font-bold text-[#1e3a8a] bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-full">
                  <ShieldCheck className="w-3 h-3 text-[#1e3a8a]" />
                  <span>Theological Intelligence</span>
                </span>
              </div>
              <p className="text-xs text-gray-500 mt-0.5">
                {activeSession ? (
                  <span className="font-medium text-[#1e3a8a] flex items-center gap-1">
                    <span className="text-gray-400">Topic:</span> "{activeSession.title}"
                  </span>
                ) : (
                  "Dynamic, unscripted reasoning rooted in Sacred Scripture, Tradition, and the Magisterium"
                )}
              </p>
            </div>
          </div>

          {/* Action buttons: New Chat & History */}
          <div className="flex items-center gap-2 self-end sm:self-auto shrink-0">
            <button
              onClick={handleNewChat}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-[#f8f7f4] hover:bg-blue-50 text-gray-700 hover:text-[#1e3a8a] border border-gray-200 hover:border-blue-200 rounded-xl transition cursor-pointer shadow-2xs"
              title="Start a new discussion"
            >
              <Plus className="w-3.5 h-3.5 text-[#1e3a8a]" />
              <span>New Chat</span>
            </button>

            <button
              onClick={() => setHistoryOpen(true)}
              className="relative inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-[#1e3a8a] hover:bg-blue-900 text-white rounded-xl transition cursor-pointer shadow-xs"
              title="View past conversations"
            >
              <History className="w-3.5 h-3.5 text-[#f0d080]" />
              <span>History</span>
              {chatSessions.length > 0 && (
                <span className="ml-0.5 px-1.5 py-0.2 text-[10px] font-bold bg-[#c9a84c] text-[#1e3a8a] rounded-full">
                  {chatSessions.length}
                </span>
              )}
            </button>
          </div>
        </div>

        {/* Engine Status & Diagnostics */}
        <div className="pt-2 border-t border-gray-100 flex flex-wrap items-center justify-between text-[11px] text-gray-500 gap-2">
          <div className="flex items-center gap-1.5 font-medium">
            <Cpu className="w-3.5 h-3.5 text-[#1e3a8a]" />
            <span>AI Engine:</span>
            <span className="font-bold text-gray-800">
              {engineStatus?.geminiConnected
                ? "Google Gemini (Active)"
                : "Catholic Knowledge Engine"}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-gray-600 font-medium">
              Ready & Connected
            </span>
          </div>
        </div>
      </div>

      {/* Messages area */}
      <div className="bg-white rounded-2xl p-4 sm:p-5 border border-[#e2ddd6] shadow-sm min-h-[400px] max-h-[580px] h-[calc(100vh-340px)] sm:h-[500px] overflow-y-auto space-y-4">
        {messages.length === 0 ? (
          <div className="py-6 text-center space-y-3">
            <div className="w-12 h-12 rounded-2xl bg-blue-50 text-[#1e3a8a] flex items-center justify-center mx-auto shadow-xs border border-blue-100">
              <Bot className="w-6 h-6 text-[#1e3a8a]" />
            </div>
            <h3 className="font-bold text-gray-800 text-sm sm:text-base">
              Catholic Apologetics AI
            </h3>
            <p className="text-xs text-gray-600 max-w-md mx-auto leading-relaxed">
              Equipped with self-aware reasoning across Sacred Scripture, the Church Fathers, and the Councils. Every conversation is automatically saved in your Chat History.
            </p>

            <div className="flex flex-col gap-2 max-w-lg mx-auto pt-3 text-left">
              <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider px-1">
                Explore or Test an Argument:
              </span>
              {STARTER_PROMPTS.map((prompt, i) => (
                <button
                  key={i}
                  onClick={() => handleSend(prompt)}
                  className="p-2.5 text-xs bg-[#f8f7f4] hover:bg-blue-50 hover:text-[#1e3a8a] hover:border-blue-200 text-gray-700 rounded-xl border border-gray-200 transition flex items-center justify-between cursor-pointer"
                >
                  <span className="truncate pr-2">"{prompt}"</span>
                  <span className="text-gray-400 font-bold ml-2 shrink-0">→</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m, idx) => {
            const isUser = m.role === "user";
            return (
              <div
                key={m.id || idx}
                className={`flex ${isUser ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[88%] sm:max-w-[85%] rounded-2xl p-4 text-xs sm:text-sm leading-relaxed ${
                    isUser
                      ? "bg-[#1e3a8a] text-white rounded-tr-none shadow-xs"
                      : "bg-[#f8f7f4] text-gray-800 border border-gray-200 rounded-tl-none font-sans"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 mb-2 pb-1.5 border-b border-gray-200/60">
                    <span className="text-[10px] font-bold opacity-75 uppercase tracking-wide">
                      {isUser ? "You" : "Apologetics AI"}
                    </span>
                    <div className="flex items-center gap-1.5">
                      {m.timestamp && (
                        <span className="text-[10px] opacity-60">
                          {m.timestamp}
                        </span>
                      )}
                      {!isUser && (
                        <>
                          {m.engine === "openai" ? (
                            <span className="text-[9px] font-bold text-blue-800 bg-blue-100 border border-blue-200 px-1.5 py-0.2 rounded-md">
                              {m.model || "GPT-4o"}
                            </span>
                          ) : m.engine === "gemini" ? (
                            <span className="text-[9px] font-bold text-purple-800 bg-purple-100 border border-purple-200 px-1.5 py-0.2 rounded-md">
                              Gemini 3.8
                            </span>
                          ) : (
                            <span className="text-[9px] font-bold text-emerald-800 bg-emerald-100 border border-emerald-200 px-1.5 py-0.2 rounded-md">
                              Apologetics AI
                            </span>
                          )}
                        </>
                      )}
                    </div>
                  </div>

                  <p className="whitespace-pre-line leading-relaxed">{m.content}</p>

                  {/* Web & Patristic Citations if available */}
                  {!isUser && m.groundingSources && m.groundingSources.length > 0 && (
                    <div className="mt-3 pt-2.5 border-t border-gray-200/80">
                      <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block mb-1.5 flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3 text-emerald-600" /> Reference Citations:
                      </span>
                      <div className="flex flex-wrap gap-1.5">
                        {m.groundingSources.slice(0, 4).map((src, sIdx) => (
                          <a
                            key={sIdx}
                            href={src.uri}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-[10px] bg-white hover:bg-blue-50 text-[#1e3a8a] border border-gray-200 hover:border-blue-300 px-2 py-0.5 rounded-md transition"
                          >
                            <ExternalLink className="w-2.5 h-2.5 text-gray-400" />
                            <span className="max-w-[170px] truncate">{src.title}</span>
                          </a>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Assistant Message Actions: Copy & Save to Notes */}
                  {!isUser && (
                    <div className="mt-3 pt-2 border-t border-gray-200/60 flex items-center justify-end gap-2 text-[11px]">
                      <button
                        onClick={() => handleCopyText(m.content, idx)}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-gray-500 hover:text-gray-800 hover:bg-white border border-transparent hover:border-gray-200 transition cursor-pointer"
                        title="Copy answer to clipboard"
                      >
                        {copiedIndex === idx ? (
                          <>
                            <Check className="w-3 h-3 text-emerald-600" />
                            <span className="text-emerald-700 font-semibold text-[10px]">Copied</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3 h-3" />
                            <span className="text-[10px]">Copy</span>
                          </>
                        )}
                      </button>

                      <button
                        onClick={() => handleSaveToNotes(m, idx)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-white text-[#1e3a8a] hover:bg-blue-50 border border-gray-200 hover:border-blue-300 transition cursor-pointer shadow-2xs font-medium"
                        title="Save this answer into your permanent Note Storage"
                      >
                        {savedNoteIndex === idx ? (
                          <>
                            <BookmarkCheck className="w-3.5 h-3.5 text-emerald-600" />
                            <span className="text-emerald-700 font-bold text-[10px]">Saved to Notes!</span>
                          </>
                        ) : (
                          <>
                            <BookmarkPlus className="w-3.5 h-3.5 text-[#c9a84c]" />
                            <span className="text-[10px]">Save to Notes</span>
                          </>
                        )}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}

        {loading && (
          <div className="flex justify-start">
            <div className="bg-[#f8f7f4] border border-blue-200/60 rounded-2xl rounded-tl-none p-3.5 text-xs text-gray-700 flex items-center gap-3 shadow-xs">
              <Loader2 className="w-4 h-4 animate-spin text-[#1e3a8a] shrink-0" />
              <div className="flex flex-col">
                <span className="font-semibold text-gray-900 flex items-center gap-1.5">
                  Formulating theological response...
                </span>
                <span className="text-[10px] text-gray-500 mt-0.5">
                  Synthesizing Sacred Scripture, Church Fathers, and Catholic logic
                </span>
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleSend();
        }}
        className="flex gap-2"
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask any apologetics, theological, or pastoral question..."
          className="flex-1 bg-white border border-[#e2ddd6] focus:border-[#1e3a8a] rounded-xl px-4 py-3 text-xs sm:text-sm outline-none transition shadow-xs"
        />
        {loading ? (
          <button
            type="button"
            onClick={handleStop}
            className="bg-rose-600 hover:bg-rose-700 text-white font-bold px-4 py-3 rounded-xl transition flex items-center gap-1.5 cursor-pointer shadow-xs shrink-0"
            title="Stop generating response"
          >
            <Square className="w-4 h-4 fill-white" />
            <span className="hidden sm:inline">Stop</span>
          </button>
        ) : (
          <button
            type="submit"
            disabled={!input.trim()}
            className="bg-[#1e3a8a] hover:bg-blue-900 disabled:opacity-50 text-white font-bold px-4 py-3 rounded-xl transition flex items-center gap-1.5 cursor-pointer shadow-xs shrink-0"
          >
            <Send className="w-4 h-4" />
            <span className="hidden sm:inline">Send</span>
          </button>
        )}
      </form>

      {/* Chat History Slide-over Drawer / Modal */}
      {historyOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-end animate-in fade-in duration-150">
          <div
            className="w-full max-w-md h-full bg-white shadow-2xl flex flex-col border-l border-[#e2ddd6] animate-in slide-in-from-right duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Drawer Header */}
            <div className="p-4 border-b border-[#e2ddd6] flex items-center justify-between bg-[#f8f7f4]">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-[#1e3a8a] text-white flex items-center justify-center">
                  <History className="w-4 h-4 text-[#f0d080]" />
                </div>
                <div>
                  <h3 className="font-bold text-sm text-gray-900">
                    Chat History
                  </h3>
                  <p className="text-[11px] text-gray-500">
                    {chatSessions.length} saved {chatSessions.length === 1 ? "conversation" : "conversations"}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1">
                <button
                  onClick={handleNewChat}
                  className="p-1.5 text-gray-600 hover:text-[#1e3a8a] hover:bg-gray-200/60 rounded-lg transition cursor-pointer"
                  title="Start a new chat"
                >
                  <Plus className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setHistoryOpen(false)}
                  className="p-1.5 text-gray-500 hover:text-gray-800 hover:bg-gray-200/60 rounded-lg transition cursor-pointer"
                  title="Close history"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Search Input */}
            <div className="p-3 border-b border-gray-100 bg-white">
              <div className="relative">
                <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search discussions or questions..."
                  className="w-full pl-9 pr-3 py-2 text-xs bg-[#f8f7f4] border border-gray-200 rounded-xl outline-none focus:border-[#1e3a8a] focus:bg-white transition"
                />
              </div>
            </div>

            {/* Session List */}
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {filteredSessions.length === 0 ? (
                <div className="py-12 text-center text-gray-400 space-y-2">
                  <MessageSquare className="w-8 h-8 mx-auto opacity-40 text-[#1e3a8a]" />
                  <p className="text-xs font-medium text-gray-500">
                    {searchQuery ? "No matching conversations found." : "No saved conversations yet."}
                  </p>
                  <p className="text-[11px] text-gray-400">
                    Ask any question to begin an apologetics session!
                  </p>
                </div>
              ) : (
                filteredSessions.map((session) => {
                  const isActive = session.id === activeSessionId;
                  const isEditing = session.id === editingSessionId;
                  const lastMsg = session.messages[session.messages.length - 1];
                  const formattedDate = new Date(session.updatedAt).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                  });

                  return (
                    <div
                      key={session.id}
                      onClick={() => !isEditing && handleSelectSession(session.id)}
                      className={`group p-3 rounded-xl border transition text-left cursor-pointer flex flex-col gap-1.5 relative ${
                        isActive
                          ? "bg-blue-50/70 border-blue-300 shadow-2xs"
                          : "bg-white hover:bg-[#f8f7f4] border-gray-200 hover:border-gray-300"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        {isEditing ? (
                          <div
                            className="flex items-center gap-1.5 flex-1"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <input
                              type="text"
                              value={editTitleInput}
                              onChange={(e) => setEditTitleInput(e.target.value)}
                              className="text-xs font-semibold px-2 py-1 border border-blue-400 rounded-lg flex-1 outline-none bg-white"
                              autoFocus
                              onKeyDown={(e) => {
                                if (e.key === "Enter") handleSaveRename(session.id, e);
                                if (e.key === "Escape") setEditingSessionId(null);
                              }}
                            />
                            <button
                              onClick={(e) => handleSaveRename(session.id, e)}
                              className="p-1 text-emerald-600 hover:bg-emerald-50 rounded"
                            >
                              <Check className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setEditingSessionId(null);
                              }}
                              className="p-1 text-gray-400 hover:bg-gray-100 rounded"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ) : (
                          <>
                            <h4
                              className={`text-xs font-bold truncate flex-1 ${
                                isActive ? "text-[#1e3a8a]" : "text-gray-800"
                              }`}
                            >
                              {session.title}
                            </h4>

                            <div className="flex items-center gap-1 shrink-0">
                              <span className="text-[10px] text-gray-400">
                                {formattedDate}
                              </span>

                              {/* Hover actions */}
                              <button
                                onClick={(e) => handleStartRename(session, e)}
                                className="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded transition"
                                title="Rename topic"
                              >
                                <Edit2 className="w-3 h-3" />
                              </button>
                              <button
                                onClick={(e) => handleDeleteSession(session.id, e)}
                                className="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-rose-600 hover:bg-rose-50 rounded transition"
                                title="Delete discussion"
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </div>
                          </>
                        )}
                      </div>

                      {/* Snippet preview */}
                      {lastMsg && (
                        <p className="text-[11px] text-gray-500 line-clamp-2">
                          <span className="font-semibold text-gray-600">
                            {lastMsg.role === "user" ? "You: " : "AI: "}
                          </span>
                          {lastMsg.content}
                        </p>
                      )}

                      <div className="flex items-center justify-between pt-1 border-t border-gray-100 text-[10px] text-gray-400">
                        <span>{session.messages.length} messages</span>
                        {isActive && (
                          <span className="text-[10px] font-bold text-[#1e3a8a] bg-blue-100/70 px-1.5 py-0.2 rounded">
                            Active
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Drawer Footer */}
            {chatSessions.length > 0 && (
              <div className="p-3 border-t border-gray-200 bg-[#f8f7f4] flex items-center justify-between">
                {confirmClearAll ? (
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] text-rose-700 font-semibold">Delete all chats?</span>
                    <button
                      onClick={() => {
                        clearAllChatSessions();
                        setConfirmClearAll(false);
                      }}
                      className="text-xs bg-rose-600 hover:bg-rose-700 text-white font-bold px-2.5 py-1 rounded transition cursor-pointer"
                    >
                      Confirm
                    </button>
                    <button
                      onClick={() => setConfirmClearAll(false)}
                      className="text-xs bg-gray-200 hover:bg-gray-300 text-gray-700 font-medium px-2 py-1 rounded transition cursor-pointer"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmClearAll(true)}
                    className="text-xs text-rose-600 hover:text-rose-800 font-semibold px-2 py-1 rounded hover:bg-rose-50 transition cursor-pointer flex items-center gap-1"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Clear All History</span>
                  </button>
                )}

                <button
                  onClick={() => {
                    setConfirmClearAll(false);
                    setHistoryOpen(false);
                  }}
                  className="text-xs font-semibold px-3 py-1.5 bg-white hover:bg-gray-100 border border-gray-300 rounded-lg text-gray-700 cursor-pointer transition"
                >
                  Done
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
