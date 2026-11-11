import express from "express";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";
import { getCuratedCatholicReply, getCuratedBibleSearchResults } from "./catholicKnowledgeEngine.ts";
import { DAILY_CATHOLIC_QUOTES } from "../src/data/dailyQuotesData.ts";

dotenv.config();

const app = express();
app.use(express.json({ limit: "5mb" }));

// Helper to extract web sources and queries from Gemini response if present
function extractGrounding(response: any) {
  const candidate = response?.candidates?.[0];
  const metadata = candidate?.groundingMetadata;
  const chunks = metadata?.groundingChunks || [];
  const searchQueries: string[] = metadata?.webSearchQueries || [];

  const sources: { title: string; uri: string }[] = [];
  for (const chunk of chunks) {
    if (chunk?.web?.uri) {
      sources.push({
        title: chunk.web.title || "Reference Source",
        uri: chunk.web.uri,
      });
    }
  }

  return { sources, searchQueries };
}

function handleAiError(route: string, err: any) {
  const errMsg = err?.message || String(err || "");
  console.debug(`[AI Notice] ${route}: Live AI call not completed: ${errMsg.slice(0, 100)}. Using curated Catholic knowledge engine.`);
}

let aiInstance: GoogleGenAI | null = null;

function getAiClient(): GoogleGenAI | null {
  const apiKey =
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    process.env.VITE_GEMINI_API_KEY;

  if (!apiKey || !apiKey.trim() || apiKey === "MY_GEMINI_API_KEY") {
    return null;
  }

  if (!aiInstance) {
    aiInstance = new GoogleGenAI({
      apiKey: apiKey.trim(),
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });
  }
  return aiInstance;
}

function isAiAvailable(): boolean {
  return Boolean(getAiClient());
}

export function extractJsonFromText(rawText: string): any | null {
  if (!rawText) return null;
  const trimmed = rawText.trim();

  // 1. Try direct JSON parse
  try {
    return JSON.parse(trimmed);
  } catch {}

  // 2. Try markdown fence block
  const codeBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (codeBlockMatch && codeBlockMatch[1]) {
    try {
      return JSON.parse(codeBlockMatch[1].trim());
    } catch {}
  }

  // 3. Try finding outermost object braces { ... }
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    try {
      const candidate = trimmed.slice(firstBrace, lastBrace + 1);
      return JSON.parse(candidate);
    } catch {}
  }

  return null;
}

// Resilient, low-latency Gemini generation
async function callGemini(
  client: GoogleGenAI,
  contents: any,
  systemInstruction?: string
): Promise<{ text: string; model: string } | null> {
  const models = ["gemini-3.1-flash-lite", "gemini-3.8-flash", "gemini-flash-latest"];

  for (const model of models) {
    try {
      const config: any = {};
      if (systemInstruction) {
        config.systemInstruction = systemInstruction;
      }
      const response = await client.models.generateContent({
        model,
        contents,
        config,
      });
      if (response?.text) {
        return { text: response.text, model };
      }
    } catch (err: any) {
      console.debug(`[AI Engine] Model ${model} unavailable (${err?.status || err?.message || err}). Trying fallback...`);
    }
  }

  return null;
}

export let lastOpenAiStatus: {
  status: number;
  message: string;
  testedAt: number;
  keyPrefix?: string;
} | null = null;

function getOpenAiKey(): string | null {
  const key = process.env.OPENAI_API_KEY || process.env.VITE_OPENAI_API_KEY;
  if (!key || !key.trim()) return null;
  const trimmed = key.trim();
  if (
    trimmed === "MY_OPENAI_API_KEY" ||
    trimmed === "sk-placeholder" ||
    trimmed.includes("•") ||
    !trimmed.startsWith("sk-") ||
    trimmed.startsWith("sk-abcd") ||
    trimmed.includes("abcdqrst") ||
    trimmed.toLowerCase().includes("dummy") ||
    trimmed.toLowerCase().includes("placeholder") ||
    trimmed.toLowerCase().includes("your-key") ||
    trimmed.length < 30
  ) {
    return null;
  }

  // If OpenAI recently rejected this key (401/403) within 10 minutes, do not re-attempt and hang
  if (
    lastOpenAiStatus &&
    (lastOpenAiStatus.status === 401 || lastOpenAiStatus.status === 403) &&
    Date.now() - lastOpenAiStatus.testedAt < 600000
  ) {
    return null;
  }

  return trimmed;
}

export interface OpenAiCompletionResult {
  text: string;
  model: string;
}

async function callOpenAI(
  apiKey: string,
  messages: { role: string; content: string }[],
  systemInstruction?: string,
  jsonFormat = false
): Promise<OpenAiCompletionResult | null> {
  const modelsToTry = ["gpt-4o", "gpt-4o-mini"];

  for (const m of modelsToTry) {
    try {
      const fullMessages: { role: string; content: string }[] = [];

      if (systemInstruction) {
        fullMessages.push({
          role: "system",
          content: systemInstruction,
        });
      }
      fullMessages.push(...messages);

      const payload: any = {
        model: m,
        messages: fullMessages,
      };

      if (jsonFormat) {
        payload.response_format = { type: "json_object" };
      }

      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(35000),
      });

      if (res.ok) {
        const data = await res.json();
        const text = data?.choices?.[0]?.message?.content;
        if (text) {
          lastOpenAiStatus = {
            status: 200,
            message: "Active & connected",
            testedAt: Date.now(),
            keyPrefix: apiKey.slice(0, 7) + "...",
          };
          return { text, model: m };
        }
      } else {
        const errText = await res.text().catch(() => "");
        console.debug(`[OpenAI Notice] Model ${m} returned HTTP ${res.status}: ${errText.slice(0, 150)}`);

        if (res.status === 401 || res.status === 403) {
          lastOpenAiStatus = {
            status: res.status,
            message: `OpenAI rejected key: Incorrect or unauthorized API key (${apiKey.slice(0, 7)}...).`,
            testedAt: Date.now(),
            keyPrefix: apiKey.slice(0, 7) + "...",
          };
          break; // Don't keep hammering if key is invalid
        } else if (res.status === 429) {
          lastOpenAiStatus = {
            status: 429,
            message: "OpenAI rate limit or insufficient quota.",
            testedAt: Date.now(),
            keyPrefix: apiKey.slice(0, 7) + "...",
          };
          break;
        }
      }
    } catch (err: any) {
      console.debug(`[OpenAI Notice] Network error with ${m}:`, err?.message || err);
    }
  }
  return null;
}

// Curated authentic baseline quotes for Catholic Pillars & Science Fathers
export const BASELINE_QUOTES = [
  {
    id: "quote-lemaitre",
    category: "catholic_scientist" as const,
    categoryLabel: "Catholic Science Father",
    author: "Fr. Georges Lemaître",
    title: "Father of the Big Bang Theory & Catholic Priest",
    era: "1894–1966 AD",
    quote:
      "There were two ways of arriving at the truth. I decided to follow them both. Nothing in my working life, nothing I have ever learned in my studies of science or religion has ever caused me to change that opinion. I have no conflict to reconcile. Science has not shaken my faith in religion and religion has never caused me to question the conclusions obtained by scientific methods.",
    source: "The Primeval Atom (1946) & New York Times interview (1933)",
    historicalImpact:
      "Belgian Catholic priest, astronomer, and theoretical physicist who first proposed the expansion of the universe and the Big Bang Theory (the 'Primeval Atom hypothesis'), deriving Hubble's law before Edwin Hubble.",
    faithAndReasonInsight:
      "Demonstrates that empirical cosmology and Christian theology of creation exist in profound, non-contradictory harmony.",
    groundingSources: [
      {
        title: "Father Georges Lemaître: The Priest Who Discovered the Big Bang",
        uri: "https://www.amnh.org/learn-teach/curriculum-collections/cosmic-horizons-book/georges-lemaitre-big-bang",
      },
    ],
  },
  {
    id: "quote-mendel",
    category: "catholic_scientist" as const,
    categoryLabel: "Catholic Science Father",
    author: "Gregor Mendel, O.S.A.",
    title: "Father of Modern Genetics & Augustinian Friar",
    era: "1822–1884 AD",
    quote:
      "My scientific studies have offered me the greatest satisfaction; and I am convinced that it will not be long before the whole world acknowledges the results of my work.",
    source: "Experiments on Plant Hybridization (Versuche über Pflanzen-Hybriden, 1866)",
    historicalImpact:
      "Augustinian friar and abbot who discovered the fundamental laws of genetic inheritance through his meticulous pea-plant breeding experiments at St. Thomas's Abbey, laying the foundation of modern genetics.",
    faithAndReasonInsight:
      "Demonstrated that monastic prayer, discipline, and scientific inquiry can flourish together to unlock the laws written into creation.",
    groundingSources: [
      {
        title: "Gregor Mendel - Augustinian Heritage and Genetics",
        uri: "https://www.nature.com/scitable/topicpage/gregor-mendel-and-the-principles-of-inheritance-593/",
      },
    ],
  },
  {
    id: "quote-pasteur",
    category: "catholic_scientist" as const,
    categoryLabel: "Catholic Science Father",
    author: "Louis Pasteur",
    title: "Father of Microbiology & Germ Theory",
    era: "1822–1895 AD",
    quote:
      "The more I study nature, the more I stand amazed at the work of the Creator. Science brings men nearer to God. A little science estranges a man from God, but much science brings him back to Him.",
    source: "Address at the Académie Française (1882)",
    historicalImpact:
      "Renowned chemist and devout Catholic whose breakthroughs in microbial fermentation, vaccination (rabies and anthrax), and pasteurization disproved spontaneous generation and revolutionized medicine.",
    faithAndReasonInsight:
      "Prayed the Holy Rosary daily while making some of the most life-saving scientific advances in human history.",
    groundingSources: [
      {
        title: "Louis Pasteur - Science and Catholic Faith",
        uri: "https://www.catholicscientists.org/scientists-of-the-past/louis-pasteur",
      },
    ],
  },
  {
    id: "quote-steno",
    category: "catholic_scientist" as const,
    categoryLabel: "Catholic Science Father",
    author: "Blessed Nicolas Steno (Niels Stensen)",
    title: "Father of Stratigraphy & Modern Geology, Catholic Bishop",
    era: "1638–1686 AD",
    quote:
      "Beautiful is what we see, more beautiful is what we know, most beautiful by far is what we do not know.",
    source: "De solido intra solidum naturaliter contento (1669)",
    historicalImpact:
      "Formulated the foundational principles of stratigraphy (the law of superposition) that established modern geology, later converted to Catholicism, was ordained a bishop, and was beatified by Pope St. John Paul II.",
    faithAndReasonInsight:
      "Pioneered the study of fossils and rock strata with the conviction that discovering natural truth leads the soul to Divine Truth.",
    groundingSources: [
      {
        title: "Nicolas Steno: Bishop and Founder of Geology",
        uri: "https://www.catholicscientists.org/scientists-of-the-past/nicolas-steno",
      },
    ],
  },
  {
    id: "quote-secchi",
    category: "catholic_scientist" as const,
    categoryLabel: "Catholic Science Father",
    author: "Fr. Angelo Secchi, S.J.",
    title: "Father of Astronomical Spectroscopy & Jesuit Priest",
    era: "1818–1878 AD",
    quote:
      "From the contemplation of the skies we are naturally led to recognize the infinite wisdom and power of the Creator, whose glory is proclaimed across all starry space.",
    source: "Le Stelle (The Stars, 1877) & Vatican Observatory Records",
    historicalImpact:
      "Italian Jesuit priest and astronomer who was the first to classify stars by their optical spectra (Secchi classes), founding modern astrophysics and astronomical spectroscopy at the Roman College Observatory.",
    faithAndReasonInsight:
      "Conducted groundbreaking solar and spectral physics while living daily life as a dedicated Jesuit priest in Rome.",
    groundingSources: [
      {
        title: "Father Angelo Secchi - Jesuit Father of Astrophysics",
        uri: "https://www.catholicscientists.org/scientists-of-the-past/angelo-secchi",
      },
    ],
  },
  {
    id: "quote-bacon",
    category: "catholic_scientist" as const,
    categoryLabel: "Catholic Science Father",
    author: "Roger Bacon, O.F.M.",
    title: "Father of Experimental Science & Franciscan Friar",
    era: "c. 1220–1292 AD",
    quote:
      "The strongest arguments prove nothing so long as the conclusions are not verified by experience. Experimental science is the mistress of all sciences.",
    source: "Opus Majus (1267)",
    historicalImpact:
      "English Franciscan friar, philosopher, and scholastic scholar who placed early emphasis on the empiricism and mathematical verification that birthed the modern scientific method.",
    faithAndReasonInsight:
      "Dedicated his encyclopedic scientific research to Pope Clement IV as an offering of faith seeking empirical understanding of God's cosmos.",
    groundingSources: [
      {
        title: "Roger Bacon - Stanford Encyclopedia of Philosophy",
        uri: "https://plato.stanford.edu/entries/roger-bacon/",
      },
    ],
  },
  {
    id: "quote-augustine",
    category: "church_father" as const,
    categoryLabel: "Church Father",
    author: "St. Augustine of Hippo",
    title: "Doctor of Grace & Bishop of Hippo",
    era: "354–430 AD",
    quote:
      "You have made us for Yourself, O Lord, and our hearts are restless until they rest in You. Faith is to believe what you do not yet see; the reward of this faith is to see what you believe.",
    source: "Confessions, Book I, Chapter 1 & Sermons 43",
    historicalImpact:
      "One of the four Great Latin Fathers, whose philosophical and theological synthesis defined Western thought on grace, the Trinity, divine illumination, and the City of God.",
    faithAndReasonInsight:
      "Taught that reason prepares the soul for faith, and faith illuminates reason: 'Believe that you may understand; understand that you may believe.'",
    groundingSources: [
      {
        title: "St. Augustine - Works and Patristic Heritage",
        uri: "https://www.newadvent.org/fathers/1101.htm",
      },
    ],
  },
  {
    id: "quote-irenaeus",
    category: "church_father" as const,
    categoryLabel: "Church Father",
    author: "St. Irenaeus of Lyon",
    title: "Apostolic Father & Doctor of Unity",
    era: "c. 130–202 AD",
    quote:
      "The glory of God is a human being fully alive; and to be alive consists in beholding God. True knowledge is that which consists in the doctrine of the Apostles, and the ancient constitution of the Church throughout the world.",
    source: "Against Heresies (Adversus Haereses), Book IV, Chapter 20 (c. 180 AD)",
    historicalImpact:
      "Disciple of St. Polycarp of Smyrna (who studied under the Apostle John). Defended orthodox Christianity against Gnosticism by establishing the criterion of apostolic succession.",
    faithAndReasonInsight:
      "Rooted theological truth in historical apostolic continuity rather than esoteric speculation.",
    groundingSources: [
      {
        title: "St. Irenaeus: Against Heresies",
        uri: "https://www.newadvent.org/fathers/0103.htm",
      },
    ],
  },
  {
    id: "quote-ignatius",
    category: "church_father" as const,
    categoryLabel: "Church Father",
    author: "St. Ignatius of Antioch",
    title: "Disciple of the Apostle John & Martyr",
    era: "c. 35–108 AD",
    quote:
      "Wherever the bishop shall appear, there let the multitude also be; even as, wherever Jesus Christ is, there is the Catholic Church. I desire the bread of God, the heavenly bread, which is the flesh of Jesus Christ.",
    source: "Epistle to the Smyrnaeans §8 & Epistle to the Romans §7 (107 AD)",
    historicalImpact:
      "Third Bishop of Antioch. First writer in recorded human history to use the term 'Catholic Church' (Katholike Ekklesia) and firm defender of the Real Presence of Christ in the Eucharist.",
    faithAndReasonInsight:
      "Provides undeniable 1st-century historical evidence that the apostolic Church was hierarchical, sacramental, and Catholic.",
    groundingSources: [
      {
        title: "St. Ignatius of Antioch: Letter to the Smyrnaeans",
        uri: "https://www.newadvent.org/fathers/0109.htm",
      },
    ],
  },
  {
    id: "quote-aquinas",
    category: "apologetic_titan" as const,
    categoryLabel: "Apologetic Titan",
    author: "St. Thomas Aquinas",
    title: "The Angelic Doctor & Universal Doctor",
    era: "1225–1274 AD",
    quote:
      "To one who has faith, no explanation is necessary. To one without faith, no explanation is possible. Grace does not destroy nature, but perfects it; and natural reason should minister to faith as the natural bent of the will ministers to charity.",
    source: "Summa Theologiae, I, q. 1, a. 8",
    historicalImpact:
      "Synthesized Aristotelian philosophy with Christian revelation, formulating the classical Five Ways (Quinque Viae) proving the existence of God and shaping Catholic dogma for centuries.",
    faithAndReasonInsight:
      "The pinnacle of intellectual harmony between human reason and Divine Revelation.",
    groundingSources: [
      {
        title: "Summa Theologiae - St. Thomas Aquinas",
        uri: "https://www.newadvent.org/summa/",
      },
    ],
  },
  {
    id: "quote-chesterton",
    category: "apologetic_titan" as const,
    categoryLabel: "Apologetic Titan",
    author: "G.K. Chesterton",
    title: "Master of Catholic Common Sense",
    era: "1874–1936 AD",
    quote:
      "The Catholic Church is the only thing which saves a man from the degrading slavery of being a child of his age. The Christian ideal has not been tried and found wanting. It has been found difficult; and left untried.",
    source: "The Catholic Church and Conversion (1926) & What's Wrong with the World (1910)",
    historicalImpact:
      "Brilliant British author, journalist, and Christian apologist whose books Orthodoxy and The Everlasting Man inspired the conversion of C.S. Lewis and defended the sanity of Catholic tradition.",
    faithAndReasonInsight:
      "Used piercing wit and philosophical paradox to expose secular fallacies and illuminate Christian truth.",
    groundingSources: [
      {
        title: "G.K. Chesterton Society - Catholic Apologetics",
        uri: "https://www.chesterton.org/",
      },
    ],
  },
  {
    id: "quote-sheen",
    category: "apologetic_titan" as const,
    categoryLabel: "Apologetic Titan",
    author: "Venerable Fulton J. Sheen",
    title: "Archbishop & Apostle of the Airwaves",
    era: "1895–1979 AD",
    quote:
      "There are not one hundred people in the United States who hate the Catholic Church, but there are millions who hate what they wrongly perceive the Catholic Church to be. Truth is truth, even if no one believes it; and a lie is a lie, even if everyone believes it.",
    source: "Radio Replies, Preface (1938) & Life of Christ",
    historicalImpact:
      "Emmy-winning archbishop and philosopher whose radio and television programs reached tens of millions, explaining Catholic doctrine with unmatched clarity, charity, and fervor.",
    faithAndReasonInsight:
      "Demonstrated that authentic Catholic apologetics starts with dispelling misconceptions with patience, love, and intellectual rigor.",
    groundingSources: [
      {
        title: "Venerable Fulton J. Sheen Foundation",
        uri: "https://fultonsheen.com/",
      },
    ],
  },
  {
    id: "quote-sheed",
    category: "apologetic_titan" as const,
    categoryLabel: "Apologetic Titan",
    author: "Frank Sheed",
    title: "Founder of the Catholic Evidence Guild",
    era: "1897–1981 AD",
    quote:
      "Sanity means seeing what is. Since God is the greatest reality, to omit God from our vision of reality is sheer insanity. We must know God in order to love Him; love of God cannot grow without knowledge of God.",
    source: "Theology and Sanity (1946)",
    historicalImpact:
      "Pioneered open-air Catholic street apologetics in London's Hyde Park, demonstrating that ordinary lay Catholics can master dogmatic theology and defend it with profound charity and precision.",
    faithAndReasonInsight:
      "Taught that theological study is not an academic exercise, but food for the soul and the foundation of mental sanity.",
    groundingSources: [
      {
        title: "Frank Sheed: Theology and Sanity",
        uri: "https://www.ignatius.com/Theology-and-Sanity-P1472.aspx",
      },
    ],
  },
];

const apiRouter = express.Router();

// Status endpoint to inspect AI configuration and engine diagnostics
apiRouter.get("/ai/status", (req, res) => {
  const openAiKey = getOpenAiKey();
  const geminiClient = getAiClient();
  res.json({
    connected: Boolean(openAiKey || geminiClient),
    primaryEngine: openAiKey ? "openai" : geminiClient ? "gemini" : "knowledge_engine",
    activeProvider: openAiKey ? "OpenAI (GPT-4o)" : geminiClient ? "Google Gemini" : "Catholic Knowledge Engine",
    hasOpenAiKey: Boolean(openAiKey),
    openAiConnected: Boolean(openAiKey),
    openAiKeyPrefix: openAiKey ? openAiKey.slice(0, 8) + "..." : null,
    hasGeminiKey: Boolean(geminiClient),
    geminiConnected: Boolean(geminiClient),
    lastOpenAiStatus,
  });
});

// 1. Apologetics Chat, Self-Aware AI Sparring & Coaching (/api/chat)
// PRIMARY ENGINE: OpenAI (GPT-4o)
// SECONDARY ENGINE: Gemini (gemini-3.8-flash)
// RESILIENT ENGINE: Self-Aware Catholic Dynamic Knowledge Engine
apiRouter.post("/chat", async (req, res) => {
  const { messages, systemPrompt } = req.body || {};

  const lastUserMsg =
    (Array.isArray(messages) ? messages : [])
      .filter((m: any) => m.role === "user")
      .slice(-1)[0]?.content || "";

  const baseSysPrompt =
    (systemPrompt ? String(systemPrompt) : "") ||
    "You are the Daily Defense Catholic Apologetics AI—a completely self-aware, deeply intellectual, and charitable Catholic apologist, theologian, and sparring partner.\n" +
      "You formulate your own dynamic, nuanced arguments without boilerplate or canned scripts. Directly and personally answer the user's question with theological precision, Scripture references, Church Fathers, and pastoral charity (1 Peter 3:15).";

  // -------------------------------------------------------------------------
  // 1. PRIMARY AI ENGINE: GEMINI (gemini-3.1-flash-lite / gemini-3.8-flash)
  // -------------------------------------------------------------------------
  const geminiClient = getAiClient();
  if (isAiAvailable() && geminiClient && Array.isArray(messages) && messages.length > 0) {
    try {
      // Window to recent 16 messages to maintain fast processing and respect context
      const recentMessages = messages.slice(-16);
      const contents: { role: "user" | "model"; parts: { text: string }[] }[] = [];
      for (const m of recentMessages) {
        const role = m.role === "assistant" ? "model" : "user";
        const text = String(m.content || "").trim();
        if (!text) continue;

        if (contents.length > 0 && contents[contents.length - 1].role === role) {
          contents[contents.length - 1].parts[0].text += `\n\n${text}`;
        } else {
          contents.push({ role, parts: [{ text }] });
        }
      }

      if (contents.length > 0) {
        if (contents[0].role !== "user") {
          contents.unshift({ role: "user", parts: [{ text: "Hello" }] });
        }

        const response = await callGemini(
          geminiClient,
          contents,
          baseSysPrompt
        );

        if (response && response.text) {
          return res.json({
            reply: response.text,
            engine: "gemini",
            model: response.model === "gemini-3.1-flash-lite" ? "Gemini 3.1 Flash Lite" : "Gemini 3.8",
          });
        }
      }
    } catch (err) {
      handleAiError("/api/chat", err);
    }
  }

  // -------------------------------------------------------------------------
  // 2. SECONDARY AI ENGINE: OPENAI (Fallback if enabled)
  // -------------------------------------------------------------------------
  const openAiKey = getOpenAiKey();
  if (openAiKey && Array.isArray(messages) && messages.length > 0) {
    try {
      const openAiMessages = messages.map((m: any) => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: String(m.content || "").trim(),
      }));

      const openAiResult = await callOpenAI(
        openAiKey,
        openAiMessages,
        baseSysPrompt,
        false
      );

      if (openAiResult && openAiResult.text) {
        return res.json({
          reply: openAiResult.text,
          engine: "openai",
          model: openAiResult.model,
        });
      }
    } catch (e) {
      console.debug("[AI Notice] OpenAI chat generation fallback:", e);
    }
  }

  // -------------------------------------------------------------------------
  // 3. CURATED SELF-AWARE CATHOLIC KNOWLEDGE ENGINE (Active Fallback)
  // -------------------------------------------------------------------------
  const curatedResult = getCuratedCatholicReply(
    lastUserMsg,
    baseSysPrompt,
    req.body?.messages
  );

  return res.json({
    reply: curatedResult.reply,
    groundingSources: curatedResult.groundingSources || [],
    searchQueries: curatedResult.searchQueries || [],
    engine: "knowledge_engine",
    openAiStatus: lastOpenAiStatus,
  });
});

// ============================================================================
// CURATED CATHOLIC APOLOGETICS TOPIC REPOSITORY
// Comprehensive, 5-part authentic theological defenses for core objections
// ============================================================================
export function getCuratedCatholicTopicDefense(objection: string): {
  title: string;
  summary: string;
  scripturePassages: { reference: string; text: string; explanation: string }[];
  mainArguments: { title: string; content: string }[];
  churchFathersQuotes: { father: string; work: string; quote: string }[];
  practicalTips: string[];
  commonMistakes: string[];
} {
  const norm = (objection || "").toLowerCase().trim();

  // 1. Purgatory
  if (
    norm.includes("purgator") ||
    norm.includes("purification") ||
    norm.includes("temporal punishment")
  ) {
    return {
      title: "The Biblical and Patristic Reality of Purgatory",
      summary:
        "While the specific English word 'Purgatory' does not appear in Scripture, the theological reality of a final post-mortem state of sanctification for those saved by Christ is deeply grounded in biblical texts and the unbroken liturgical practice of praying for the deceased since apostolic times.",
      scripturePassages: [
        {
          reference: "2 Maccabees 12:43-46",
          text: "He took up a collection... and sent it to Jerusalem to provide for a sin offering... Thus he made atonement for the dead that they might be freed from this sin.",
          explanation:
            "Praying and offering sacrifice for the deceased would be completely meaningless if the dead were only in Heaven (where they need no help) or Hell (where no help can reach them), proving an intermediate state of purification.",
        },
        {
          reference: "1 Corinthians 3:13-15",
          text: "Each man’s work will become manifest... the fire will test what sort of work each one has done. If any man’s work is burned up, he will suffer loss, though he himself will be saved, but only as through fire.",
          explanation:
            "St. Paul speaks of believers who are genuinely saved in Christ yet suffer loss and undergo a fiery purgation before entering the beatific vision.",
        },
        {
          reference: "Matthew 12:32",
          text: "Whoever speaks a word against the Holy Spirit will not be forgiven, either in this age or in the age to come.",
          explanation:
            "As St. Augustine and St. Gregory the Great observed, Jesus' statement clearly implies that some sins can and will be forgiven in the age to come.",
        },
      ],
      mainArguments: [
        {
          title: "The Absolute Holiness of Heaven",
          content:
            "Revelation 21:27 teaches that 'nothing unclean shall enter' God's presence. Since most believers die in God's friendship but still bearing venial faults or disordered worldly attachments, God's burning love purges away all remaining dross so they can behold Him as He is.",
        },
        {
          title: "Distinction Between Eternal Guilt and Temporal Consequence",
          content:
            "When King David repented of adultery, God forgave his eternal guilt through Nathan, yet David still suffered the temporal consequence of losing his child (2 Samuel 12:13-14). Purgatory is the completion of temporal healing and satisfaction through Christ's merits.",
        },
        {
          title: "Purgatory is Not a Second Chance",
          content:
            "Every soul in Purgatory is already redeemed, saved, and guaranteed eternal life in Heaven; Purgatory is not a borderline or probation, but the royal cleansing chamber of the King of Kings.",
        },
      ],
      churchFathersQuotes: [
        {
          father: "St. Augustine of Hippo",
          work: "The City of God, Book XXI, Ch. 13 (c. 426 AD)",
          quote:
            "Temporary punishments are suffered by some in this life only, by others after death, by others both now and then; but all of them before that last and strictest judgment.",
        },
        {
          father: "St. John Chrysostom",
          work: "Homilies on First Corinthians, 41:5 (c. 392 AD)",
          quote:
            "Let us help them and commemorate them. If the sons of Job were purified by their father's sacrifice, why should we doubt that our offerings for the dead bring them some consolation?",
        },
      ],
      practicalTips: [
        "Clarify right away that Purgatory is only for those who are already saved through Jesus Christ.",
        "Point out that common terms like 'Trinity' or 'Bible' are also not in the text of Scripture, yet describe biblical realities.",
        "Share the beauty of praying for departed loved ones in the Communion of Saints.",
      ],
      commonMistakes: [
        "Describing Purgatory as a place where one 'earns' salvation apart from Christ's sacrifice.",
        "Confusing Purgatory with Hell or portraying it as an angry punishment rather than a healing sanctification.",
      ],
    };
  }

  // 2. Confession to a Priest
  if (
    norm.includes("confess") ||
    norm.includes("priest") ||
    norm.includes("penance") ||
    norm.includes("absolution") ||
    norm.includes("reconciliation")
  ) {
    return {
      title: "Confession to a Priest: The Ministry of Reconciliation",
      summary:
        "Catholics do not believe priests forgive sins by their own human power. Christ Himself instituted the Sacrament of Reconciliation on Easter Sunday evening, commissioning the Apostles and their successors as His tangible ministers to forgive and retain sins in His Holy Name.",
      scripturePassages: [
        {
          reference: "John 20:21-23",
          text: "Jesus said to them again, 'Peace be with you. As the Father has sent me, even so I send you.' And when he had said this, he breathed on them, and said to them, 'Receive the Holy Spirit. If you forgive the sins of any, they are forgiven; if you withhold forgiveness from any, it is withheld.'",
          explanation:
            "Christ explicitly gave the Apostles judicial authority to forgive or retain sins. To decide whether to forgive or retain, the minister must hear the sins confessed.",
        },
        {
          reference: "James 5:14-16",
          text: "Is any among you sick? Let him call for the elders [presbyteroi/priests] of the church... and if he has committed sins, he will be forgiven. Therefore confess your sins to one another.",
          explanation:
            "St. James specifies that spiritual healing and forgiveness of sins occur through the ordained presbyters of the Church.",
        },
        {
          reference: "2 Corinthians 5:18-20",
          text: "God, who through Christ reconciled us to himself and gave us the ministry of reconciliation... So we are ambassadors for Christ, God making his appeal through us.",
          explanation:
            "St. Paul describes the apostolic priesthood as Christ's ambassadors entrusted with the formal ministry of divine reconciliation.",
        },
      ],
      mainArguments: [
        {
          title: "God Works Through Human Instruments",
          content:
            "Throughout Scripture, God consistently uses human ministers to dispense divine grace (Moses, the Levitical priests, the Apostles baptizing, preaching, and anointing). An ambassador dispensing the King's pardon does not detract from the King's sovereign authority.",
        },
        {
          title: "The Logic of Binding and Loosing",
          content:
            "If Christ intended every Christian to confess exclusively in private mental prayer, His solemn gift in John 20:23 would be totally superfluous. The conditional mandate ('if you forgive... if you retain') necessitates verbal disclosure.",
        },
        {
          title: "Objective Certainty and Psychological Healing",
          content:
            "Hearing the words of absolution ('I absolve you from your sins in the name of the Father, and of the Son, and of the Holy Spirit') provides audible, objective assurance of God's forgiveness and restorative spiritual counsel.",
        },
      ],
      churchFathersQuotes: [
        {
          father: "St. Cyprian of Carthage",
          work: "The Lapsed, 28 (c. 251 AD)",
          quote:
            "I entreat you, beloved brethren, that each one should confess his own sin, while he who has sinned is still in this world, while his confession can be admitted, while the satisfaction and remission made through the priests are pleasing before the Lord.",
        },
        {
          father: "St. Ambrose of Milan",
          work: "On the Holy Spirit, 3:18:137 (c. 381 AD)",
          quote:
            "Sins are forgiven through the Holy Spirit; men make use of their ministry for the forgiveness of sins, but they do not exercise the right of any power of their own.",
        },
      ],
      practicalTips: [
        "Acknowledge right away that God alone forgives sins, and the priest acts strictly 'in persona Christi'.",
        "Ask the challenger how an apostle could fulfill John 20:23 if nobody ever told him their sins.",
        "Point to Leviticus 4-5 to show that confessing to God through an appointed priest was the biblical model God Himself established.",
      ],
      commonMistakes: [
        "Claiming the priest replaces Jesus Christ rather than serving as His designated minister.",
        "Focusing purely on shame or guilt rather than the liberation, confidentiality (Seal of Confession), and mercy of the sacrament.",
      ],
    };
  }

  // 3. Faith, Works, Salvation, and Indulgences
  if (
    norm.includes("faith alone") ||
    norm.includes("sola fide") ||
    norm.includes("buy salvation") ||
    norm.includes("earn salvation") ||
    norm.includes("indulgence") ||
    norm.includes("works")
  ) {
    return {
      title: "Faith and Works: Biblical Justification and Grace",
      summary:
        "The Catholic Church explicitly teaches that salvation is an unmerited gift of God's grace through Jesus Christ that no one can earn or buy. True biblical faith is not a passive mental assent, but 'faith working through love' (Galatians 5:6) in obedience to Christ.",
      scripturePassages: [
        {
          reference: "James 2:24",
          text: "You see that a person is justified by works and not by faith alone.",
          explanation:
            "This is the only place in the entire Bible where the phrase 'faith alone' appears, and Sacred Scripture explicitly denies that salvation occurs by faith alone.",
        },
        {
          reference: "Galatians 5:6",
          text: "For in Christ Jesus neither circumcision nor uncircumcision counts for anything, but only faith working through love.",
          explanation:
            "St. Paul defines saving faith as an active, living force animated by divine charity (agape).",
        },
        {
          reference: "Romans 2:6-7",
          text: "He will render to each one according to his works: to those who by patience in well-doing seek for glory and honor and immortality, he will give eternal life.",
          explanation:
            "St. Paul clearly teaches that eternal life is rendered in accordance with our deeds and perseverance in grace.",
        },
        {
          reference: "Philippians 2:12-13",
          text: "Work out your own salvation with fear and trembling, for it is God who works in you, both to will and to work for his good pleasure.",
          explanation:
            "Shows the cooperative synergy between human free will and divine sovereign grace.",
        },
      ],
      mainArguments: [
        {
          title: "Distinction Between 'Works of the Law' and 'Good Works'",
          content:
            "When St. Paul condemns 'works of the Law' in Romans 3:28, he is addressing Jewish ceremonial Torah observance (circumcision, dietary laws) as a requirement for Gentiles. He never condemns moral obedience to Christ's commandments.",
        },
        {
          title: "Initial Justification is 100% Unmerited Grace",
          content:
            "The Council of Trent (Canon 1 on Justification) explicitly anathematized anyone who says man can be justified before God by his own works done through human strength without divine grace through Jesus Christ.",
        },
        {
          title: "The True Nature of Indulgences",
          content:
            "An indulgence is not a permission to sin, nor the purchase of pardon. It is the remission before God of the temporal punishment due to sins whose guilt has already been forgiven in Confession, granted through prayers and acts of charity.",
        },
      ],
      churchFathersQuotes: [
        {
          father: "St. Augustine of Hippo",
          work: "On Grace and Free Will, Ch. 20 (c. 427 AD)",
          quote:
            "When God crowns our merits, He crowns nothing other than His own gifts.",
        },
        {
          father: "St. Clement of Rome",
          work: "First Epistle to the Corinthians, Ch. 33-34 (c. 96 AD)",
          quote:
            "Let us therefore make haste with all earnestness to labor for the crown of righteousness, working what is good with all our might.",
        },
      ],
      practicalTips: [
        "Affirm strongly that initial salvation is completely unearned grace through Christ's cross.",
        "Distinguish between initial justification (at Baptism) and ongoing sanctification.",
        "Cite Matthew 25 (the Sheep and Goats) to show that Christ judges us based on how we loved the hungry, sick, and imprisoned.",
      ],
      commonMistakes: [
        "Defending Pelagianism (the error that man can save himself by good deeds).",
        "Treating James and Paul as contradictory rather than complementary apostles of one Gospel.",
      ],
    };
  }

  // 4. Sabbath vs Sunday (The Lord's Day)
  if (
    norm.includes("sabbath") ||
    norm.includes("saturday") ||
    norm.includes("sunday") ||
    norm.includes("changed the sabbath")
  ) {
    return {
      title: "From Sabbath to the Lord's Day: The New Creation",
      summary:
        "The shift from Seventh-Day Sabbath observance to the Lord's Day (Sunday) was inaugurated by the Apostles themselves in the New Testament to celebrate the Resurrection of Jesus Christ and the dawn of the New Creation.",
      scripturePassages: [
        {
          reference: "Acts 20:7",
          text: "On the first day of the week, when we were gathered together to break bread, Paul talked with them, intending to depart on the morrow.",
          explanation:
            "Demonstrates that the apostolic Christian community gathered for the Eucharistic 'breaking of bread' on Sunday, the first day of the week.",
        },
        {
          reference: "1 Corinthians 16:2",
          text: "On the first day of every week, each of you is to put something aside and store it up.",
          explanation:
            "St. Paul designates Sunday as the regular day of apostolic assembly and collection.",
        },
        {
          reference: "Colossians 2:16-17",
          text: "Therefore let no one pass judgment on you in questions of food and drink, or with regard to a festival or a new moon or a Sabbath. These are a shadow of the things to come, but the substance belongs to Christ.",
          explanation:
            "St. Paul explicitly classifies the Seventh-Day Sabbath as an Old Covenant shadow fulfilled and transcended by Christ.",
        },
        {
          reference: "Revelation 1:10",
          text: "I was in the Spirit on the Lord’s day [Kyriakē hēmera].",
          explanation:
            "St. John refers to Sunday by its apostolic liturgical title, 'the Lord's Day'.",
        },
      ],
      mainArguments: [
        {
          title: "The Old Creation vs The New Creation",
          content:
            "The Jewish Sabbath commemorated the completion of the original material creation and the exodus from Egypt. Christ's resurrection on the first day of the week inaugurated the greater redemption: liberation from sin and the dawn of the eternal Eighth Day.",
        },
        {
          title: "The Apostles Exercised the Authority to Bind and Loose",
          content:
            "Just as the Jerusalem Council in Acts 15 freed Gentile Christians from circumcision and the ceremonial dietary laws, the Apostles instituted the Lord's Day as the definitive Christian day of Eucharistic worship.",
        },
        {
          title: "Unbroken Witness of the Post-Apostolic Church",
          content:
            "Every early Christian document from the 1st and 2nd centuries confirms that the Church met on Sunday, centuries before Emperor Constantine.",
        },
      ],
      churchFathersQuotes: [
        {
          father: "St. Ignatius of Antioch",
          work: "Letter to the Magnesians, Ch. 9 (c. 110 AD)",
          quote:
            "If, then, those who had walked in ancient practices attained to newness of hope, no longer observing the Sabbath, but living according to the Lord’s Day, on which our life also rose again through Him.",
        },
        {
          father: "St. Justin Martyr",
          work: "First Apology, Ch. 67 (c. 155 AD)",
          quote:
            "Sunday is the day on which we all hold our common assembly, because it is the first day on which God, having wrought a change in the darkness and matter, made the world; and Jesus Christ our Saviour on the same day rose from the dead.",
        },
      ],
      practicalTips: [
        "Explain that the moral requirement of the 3rd Commandment (giving time to worship God) is fulfilled in the Lord's Day.",
        "Refute the conspiracy myth that Constantine 'invented' Sunday worship by citing Ignatius of Antioch (110 AD) and Justin Martyr (155 AD).",
      ],
      commonMistakes: [
        "Claiming the Sabbath was merely deleted without emphasizing its Christological fulfillment in the Resurrection.",
      ],
    };
  }

  // 5. Mary's Perpetual Virginity & Jesus' "Brothers"
  if (
    norm.includes("brother") ||
    norm.includes("sister") ||
    norm.includes("perpetual virgin") ||
    norm.includes("virginity") ||
    norm.includes("adelphos")
  ) {
    return {
      title: "Mary's Perpetual Virginity and the 'Brothers of Jesus'",
      summary:
        "The perpetual virginity of the Blessed Virgin Mary has been upheld by the Church from the beginning, including the early Protestant Reformers. In Hebrew and Aramaic idiom, the word for 'brother' routinely designated cousins, nephews, and close kin.",
      scripturePassages: [
        {
          reference: "Luke 1:34",
          text: "Mary said to the angel, 'How will this be, since I do not know man?'",
          explanation:
            "Mary was already betrothed to Joseph. If she anticipated normal marital relations, she would not have asked 'how will this be?', as conceiving a child with her husband would be the obvious expectation.",
        },
        {
          reference: "John 19:26-27",
          text: "When Jesus saw his mother and the disciple whom he loved standing nearby, he said to his mother, 'Woman, behold, your son!' Then he said to the disciple, 'Behold, your mother!' And from that hour the disciple took her to his own home.",
          explanation:
            "Under Jewish law, if Mary had other biological sons, it would have been a grave violation of filial duty for Jesus to entrust her care to St. John.",
        },
        {
          reference: "Matthew 27:56 & John 19:25",
          text: "Among whom were Mary Magdalene and Mary the mother of James and Joseph and the mother of the sons of Zebedee.",
          explanation:
            "Scripture explicitly identifies James and Joseph (the named 'brothers' of Jesus in Matt 13:55) as the biological sons of another Mary, the wife of Clopas.",
        },
      ],
      mainArguments: [
        {
          title: "The Semitic Idiom of Kinship (Adelphos)",
          content:
            "Neither ancient Hebrew nor Aramaic possessed a separate word for 'cousin'. In Genesis 13:8 and 14:14, Abraham calls his nephew Lot his 'brother' ('ach). The Greek translation (Septuagint and New Testament) rendered this idiom literally as 'adelphos'.",
        },
        {
          title: "Mary as the Sacred Ark of the New Covenant",
          content:
            "Just as the Old Testament Ark of the Covenant, overshadowed by the Holy Spirit (Shekinah), was consecrated exclusively for God and could not be touched by man (2 Samuel 6:6-7), Mary was consecrated for the Incarnate Word alone.",
        },
        {
          title: "Historic Protestant Reformer Agreement",
          content:
            "Martin Luther, John Calvin, Huldrych Zwingli, and John Wesley all fervently defended Mary's perpetual virginity, rejecting modern skepticism.",
        },
      ],
      churchFathersQuotes: [
        {
          father: "St. Jerome",
          work: "Against Helvidius, Ch. 19 (c. 383 AD)",
          quote:
            "You say that Mary did not remain a virgin; I claim still more, that Joseph himself on Mary’s account was also a virgin, so that from a virgin spouse of a virgin, a Virgin Son was born.",
        },
        {
          father: "St. Athanasius of Alexandria",
          work: "Orations Against the Arians, 2:70 (c. 360 AD)",
          quote:
            "Let those who deny that the Son is by nature from the Father... consider Mary, the Ever-Virgin Mother of God.",
        },
      ],
      practicalTips: [
        "Ask the critic why Jesus gave Mary to John at the foot of the cross if she had biological sons.",
        "Share quotes from Martin Luther and John Calvin defending Mary's perpetual virginity.",
      ],
      commonMistakes: [
        "Assuming that modern English definitions of 'brother' apply to 1st-century Semitic cultures.",
      ],
    };
  }

  // 6. The Rosary & Repetitive Prayer
  if (
    norm.includes("rosary") ||
    norm.includes("repetitive") ||
    norm.includes("vain repetition") ||
    norm.includes("hail mary")
  ) {
    return {
      title: "The Rosary: Gospel Meditation vs Vain Repetitions",
      summary:
        "Jesus in Matthew 6:7 condemned 'vain babbling' (battalogeō) — pagan magical incantations meant to manipulate uncaring deities. The Rosary is a deeply scriptural meditation on the mysteries of Jesus Christ's life, death, and resurrection.",
      scripturePassages: [
        {
          reference: "Matthew 26:44",
          text: "So, leaving them again, he went away and prayed for the third time, saying the same words again.",
          explanation:
            "Jesus Himself in the Garden of Gethsemane repeated the exact same prayer three times in deep anguish.",
        },
        {
          reference: "Revelation 4:8",
          text: "Day and night they never cease to say, 'Holy, holy, holy, is the Lord God Almighty, who was and is and is to come!'",
          explanation:
            "The heavenly angels worship God with perpetual, unceasing repetition of the Trisagion.",
        },
        {
          reference: "Luke 1:28, 42",
          text: "'Hail, full of grace, the Lord is with you!'... 'Blessed are you among women, and blessed is the fruit of your womb!'",
          explanation:
            "The Hail Mary consists almost entirely of Sacred Scripture: the words of Archangel Gabriel and St. Elizabeth inspired by the Holy Spirit.",
        },
      ],
      mainArguments: [
        {
          title: "Vain Repetition vs Loving Persistence",
          content:
            "In Matthew 6:7, the Greek word 'battalogeō' means babbling empty formulas to impress pagan gods. Repetition motivated by love is holy; Psalm 136 repeats 'for His steadfast love endures forever' twenty-six times in one psalm.",
        },
        {
          title: "The Rosary is Wholly Christocentric",
          content:
            "Pope St. John Paul II called the Rosary 'a compendium of the Gospel'. The vocal prayers are simply the rhythm that supports profound mental meditation on the 20 mysteries of Christ.",
        },
        {
          title: "The Heartbeat of Love",
          content:
            "When a spouse says 'I love you' every day, it is not vain repetition; it is an enduring declaration of fidelity. The Rosary is the heartbeat of love for Christ and His Mother.",
        },
      ],
      churchFathersQuotes: [
        {
          father: "St. Teresa of Avila",
          work: "The Way of Perfection, Ch. 22 (c. 1566)",
          quote:
            "In vocal prayer, if we are mindful of Whom we are addressing and what we are asking, the vocal prayer is simultaneously mental prayer.",
        },
        {
          father: "Pope St. John Paul II",
          work: "Rosarium Virginis Mariae, 1 (2002)",
          quote:
            "The Rosary, though clearly Marian in character, is at heart a Christocentric prayer.",
        },
      ],
      practicalTips: [
        "Invite the skeptic to examine the words of the Hail Mary and identify where each phrase appears in Luke 1.",
        "Emphasize that the center of the Hail Mary is the Holy Name of Jesus.",
      ],
      commonMistakes: [
        "Rushing through the beads as a superstition rather than meditating on the Mysteries of Christ.",
      ],
    };
  }

  // 7. Praying to Saints, Intercession, and Relics
  if (
    norm.includes("saint") ||
    norm.includes("pray to dead") ||
    norm.includes("statue") ||
    norm.includes("idol") ||
    norm.includes("necromancy") ||
    norm.includes("mediator")
  ) {
    return {
      title: "Intercession of Saints and the Communion of the Living",
      summary:
        "Catholics do not worship saints or commit necromancy. Christ conquered death; the saints in Heaven are alive in God and pray with us as members of the one Mystical Body of Christ, presenting our prayers before the Throne of the Lamb.",
      scripturePassages: [
        {
          reference: "Revelation 5:8",
          text: "The twenty-four elders fell down before the Lamb, each holding a harp, and golden bowls full of incense, which are the prayers of the saints.",
          explanation:
            "Shows heavenly elders presenting the prayers of Christians on earth directly to Jesus the Lamb.",
        },
        {
          reference: "Hebrews 12:1",
          text: "Therefore, since we are surrounded by so great a cloud of witnesses, let us also lay aside every weight, and sin which clings so closely.",
          explanation:
            "The heroes of the faith in Heaven actively witness and cheer on our spiritual race on earth.",
        },
        {
          reference: "James 5:16",
          text: "The prayer of a righteous person has great power as it is working.",
          explanation:
            "Those in Heaven are perfected in righteousness, making their intercessory prayers extraordinarily powerful.",
        },
        {
          reference: "Exodus 25:18",
          text: "And you shall make two cherubim of gold; of hammered work shall you make them, on the two ends of the mercy seat.",
          explanation:
            "God Himself commanded statues to be made for holy worship, proving that sacred images are not idols unless adored as gods.",
        },
      ],
      mainArguments: [
        {
          title: "God is the God of the Living, Not of the Dead",
          content:
            "Jesus said in Mark 12:27 that God 'is not God of the dead, but of the living'. To claim saints in Heaven are 'dead' and cannot hear our prayers denies Christ's victory over the grave.",
        },
        {
          title: "One Mediator Does Not Exclude Intercessors",
          content:
            "1 Timothy 2:5 calls Christ the 'one mediator', yet verses 1-3 command us to make intercessions for one another. Asking a saint in Heaven to pray for us is identical to asking a Christian friend on earth to pray, except the heavenly saint stands directly before God.",
        },
        {
          title: "Adoration (Latria) vs Honor (Dulia)",
          content:
            "Catholics offer adoration ('latria') to the Holy Trinity alone. Saints receive reverence ('dulia') as glorified masterpieces of God's grace.",
        },
      ],
      churchFathersQuotes: [
        {
          father: "St. Jerome",
          work: "Against Vigilantius, 6 (c. 406 AD)",
          quote:
            "If the Apostles and martyrs, while still in the body, can pray for others, how much more after their crowns, victories, and triumphs!",
        },
        {
          father: "St. John Damascene",
          work: "On the Divine Images, 1:16 (c. 730 AD)",
          quote:
            "I do not worship matter, I worship the Creator of matter, who became matter for my sake and through matter effected my salvation.",
        },
      ],
      practicalTips: [
        "Ask the person if they ever ask friends or pastors to pray for them; then explain saints are simply perfected friends in Christ.",
        "Clarify that 'pray' archaically means 'to ask' (as in 'pray tell'), not divine worship.",
      ],
      commonMistakes: [
        "Confusing intercession with conjuring or necromancy (which seeks occult forbidden knowledge).",
      ],
    };
  }

  // 8. The Papacy, St. Peter, and Church Authority
  if (
    norm.includes("pope") ||
    norm.includes("papacy") ||
    norm.includes("peter") ||
    norm.includes("rock") ||
    norm.includes("magisterium") ||
    norm.includes("infallib")
  ) {
    return {
      title: "The Papacy and the Petrine Ministry of Unity",
      summary:
        "Jesus Christ established His Church upon the rock of the Apostle Peter, investing him with the Keys of the Kingdom of Heaven (Matthew 16:18-19) to serve as the visible shepherd ensuring doctrinal unity and pastoral care across all generations.",
      scripturePassages: [
        {
          reference: "Matthew 16:18-19",
          text: "And I tell you, you are Peter, and on this rock I will build my church, and the gates of hell shall not prevail against it. I will give you the keys of the kingdom of heaven, and whatever you bind on earth shall be bound in heaven, and whatever you loose on earth shall be loosed in heaven.",
          explanation:
            "Jesus renames Simon to Kepha (Rock) and promises to build His indestructible Church upon him.",
        },
        {
          reference: "Isaiah 22:22",
          text: "And I will place on his shoulder the key of the house of David. He shall open, and none shall shut; and he shall shut, and none shall open.",
          explanation:
            "Jesus deliberately quotes the appointment of Eliakim as the prime minister (vicar) over the Davidic Kingdom, an office that held successive stewards.",
        },
        {
          reference: "Luke 22:31-32",
          text: "Simon, Simon, behold, Satan demanded to have you, that he might sift you like wheat, but I have prayed for you that your faith may not fail. And when you have turned again, strengthen your brothers.",
          explanation:
            "Jesus prays uniquely for Peter's faith so that he may confirm and strengthen all other bishops and believers.",
        },
        {
          reference: "John 21:15-17",
          text: "Jesus said to Simon Peter, 'Feed my lambs... Tend my sheep... Feed my sheep.'",
          explanation:
            "The Risen Lord commissions Peter as universal chief shepherd of Christ's entire flock.",
        },
      ],
      mainArguments: [
        {
          title: "The Aramaic Origin of 'Kepha'",
          content:
            "Jesus spoke Aramaic, where 'Kepha' is used in both clauses: 'You are Kepha, and upon this Kepha I will build my church.' The Greek gender difference (Petros vs petra) was purely grammatical because Simon was a male person.",
        },
        {
          title: "An Office Requires Successors",
          content:
            "The 'keys of the kingdom' denotes a royal office of stewardship. If the Church was to endure until the end of time against the gates of hell, the foundational office of unity instituted by Christ had to continue through successors.",
        },
        {
          title: "Papal Infallibility is Not Impeccability",
          content:
            "The Pope is not sinless; he goes to Confession like any Catholic. Papal infallibility is a narrow negative charism protecting solemn ex cathedra definitions on faith and morals from error by the Holy Spirit.",
        },
      ],
      churchFathersQuotes: [
        {
          father: "St. Cyprian of Carthage",
          work: "On the Unity of the Church, 4 (c. 251 AD)",
          quote:
            "If someone does not hold fast to this unity of Peter, can he imagine that he still holds the faith? If he deserts the chair of Peter upon whom the Church was built, can he still be confident that he is in the Church?",
        },
        {
          father: "St. Irenaeus of Lyon",
          work: "Against Heresies, 3:3:2 (c. 180 AD)",
          quote:
            "It is a matter of necessity that every Church should agree with this Church [of Rome], on account of its preeminent authority.",
        },
      ],
      practicalTips: [
        "Direct the skeptic to Isaiah 22 to understand the Old Testament blueprint of the Prime Minister with the Keys of David.",
        "Clarify that Popes can make personal mistakes, but the Holy Spirit preserves the Church's solemn dogma.",
      ],
      commonMistakes: [
        "Confusing infallibility with impeccability (sinlessness).",
      ],
    };
  }

  // 9. The Eucharist, Real Presence, and Transubstantiation
  if (
    norm.includes("eucharist") ||
    norm.includes("real presence") ||
    norm.includes("transubstantiat") ||
    norm.includes("communion") ||
    norm.includes("bread and wine") ||
    norm.includes("cannibal")
  ) {
    return {
      title: "The Real Presence of Jesus Christ in the Eucharist",
      summary:
        "The Eucharist is not a mere symbol. Under the consecrated appearances of bread and wine, the Body, Blood, Soul, and Divinity of Jesus Christ is truly, really, and substantially present, fulfilling Christ's solemn promise in John 6 and the Last Supper.",
      scripturePassages: [
        {
          reference: "John 6:51-56",
          text: "'I am the living bread that came down from heaven. If anyone eats of this bread, he will live forever. And the bread that I will give for the life of the world is my flesh.'... 'For my flesh is true food, and my blood is true drink. Whoever feeds on my flesh and drinks my blood abides in me, and I in him.'",
          explanation:
            "When disciples objected, Jesus did not water down His words as a metaphor. He used the graphic verb 'trogo' (to gnaw/chew) and allowed skeptics to leave rather than retract His literal words.",
        },
        {
          reference: "1 Corinthians 10:16",
          text: "The cup of blessing that we bless, is it not a participation in the blood of Christ? The bread that we break, is it not a participation in the body of Christ?",
          explanation:
            "St. Paul describes Holy Communion as a literal communion (koinonia) in Christ's actual Body and Blood.",
        },
        {
          reference: "1 Corinthians 11:27-29",
          text: "Whoever, therefore, eats the bread or drinks the cup of the Lord in an unworthy manner will be guilty of profaning the body and blood of the Lord... For anyone who eats and drinks without discerning the body eats and drinks judgment on himself.",
          explanation:
            "One cannot be guilty of profaning someone's actual body and blood by eating a mere symbol or cracker.",
        },
      ],
      mainArguments: [
        {
          title: "The Contrast with Biblical Metaphors",
          content:
            "When Jesus called Himself a 'door' or a 'vine', no one asked 'how can this man be made of wood?' But in John 6, everyone understood He was speaking literally, causing many disciples to leave. Jesus let them leave rather than say 'it's only a symbol'.",
        },
        {
          title: "Unanimous Consensus of the Early Church",
          content:
            "For the first thousand years of Christianity, there is not a single Church Father or Christian document asserting that the Eucharist is merely a symbol. Transubstantiation explains how the substance changes while species remain.",
        },
        {
          title: "The Fulfillment of the Passover Lamb",
          content:
            "In the Old Testament Passover (Exodus 12), the lamb had to be sacrificed AND eaten. In the New Covenant, Christ our Passover Lamb (1 Cor 5:7) must be consumed in the Holy Eucharist.",
        },
      ],
      churchFathersQuotes: [
        {
          father: "St. Ignatius of Antioch",
          work: "Letter to the Smyrnaeans, 6:2 (c. 110 AD)",
          quote:
            "They abstain from the Eucharist and from prayer, because they confess not the Eucharist to be the flesh of our Saviour Jesus Christ, which suffered for our sins, and which the Father, of His goodness, raised up again.",
        },
        {
          father: "St. Justin Martyr",
          work: "First Apology, Ch. 66 (c. 155 AD)",
          quote:
            "Not as common bread and common drink do we receive these; but... the food which is blessed by the prayer of His word... is the flesh and blood of that Jesus who was made flesh.",
        },
      ],
      practicalTips: [
        "Ask the skeptic to read John 6:51-66 from start to finish and observe the reaction of the crowd.",
        "Show them St. Ignatius of Antioch's warning written around 110 AD, just years after St. John died.",
      ],
      commonMistakes: [
        "Treating the Eucharist as a re-crucifying of Christ rather than the re-presentation of His once-for-all Calvary sacrifice.",
      ],
    };
  }

  // 10. The Crusades & Church History
  if (
    norm.includes("crusade") ||
    norm.includes("inquisition") ||
    norm.includes("corrupt") ||
    norm.includes("galileo") ||
    norm.includes("dark ages")
  ) {
    return {
      title: "The Crusades and Church History in True Historical Context",
      summary:
        "Modern historians have corrected popular myths regarding the Crusades. The Crusades were initially called in 1095 as a defensive response to protect Christian pilgrims and aid Byzantine Christians after four centuries of relentless military expansion had conquered two-thirds of the ancient Christian world.",
      scripturePassages: [
        {
          reference: "Matthew 16:18",
          text: "I will build my church, and the gates of hell shall not prevail against it.",
          explanation:
            "Christ promised the Church's survival and divine indefectibility in doctrine, not that every member or leader would be free from sin.",
        },
        {
          reference: "Matthew 13:24-30",
          text: "Let both [the wheat and the weeds] grow together until the harvest.",
          explanation:
            "Christ explicitly prophesied that His earthly Church would contain both holy saints and scandalous sinners until the Final Judgment.",
        },
      ],
      mainArguments: [
        {
          title: "Defensive Response to Expansion",
          content:
            "By 1095, Christian North Africa, Egypt, Syria, the Holy Land, and parts of Spain had fallen to aggressive conquest. The First Crusade was summoned after the Byzantine Emperor appealed for emergency aid following the Battle of Manzikert.",
        },
        {
          title: "Distinction Between Church Dogma and Human Sins",
          content:
            "Judas was chosen directly by Jesus yet betrayed Him for silver; King David committed murder and adultery. The sins of individual Christians or churchmen do not falsify the divine truth of the Gospel.",
        },
        {
          title: "The Catholic Church Built Western Civilization",
          content:
            "The Church pioneered hospitals, modern universities, international charity, Western legal codes, and the scientific method (Gregor Mendel, Georges Lemaître, Nicholas Copernicus).",
        },
      ],
      churchFathersQuotes: [
        {
          father: "St. Augustine of Hippo",
          work: "The City of God, 19:12 (c. 426 AD)",
          quote:
            "Peace is not intended to stimulate you to war, but war is fought that you may obtain peace. Be thoughtful, therefore, even in warfare.",
        },
        {
          father: "St. Thomas Aquinas",
          work: "Summa Theologiae, II-II, Q. 40, Art. 1 (c. 1270 AD)",
          quote:
            "In order for a war to be just, three things are necessary: public authority, just cause, and right intention of promoting good or avoiding evil.",
        },
      ],
      practicalTips: [
        "Acknowledge and condemn genuine historical atrocities (such as the sack of Constantinople in 1204, which Pope Innocent III himself fiercely condemned).",
        "Refer critics to neutral modern historians like Thomas Madden or Rodney Stark.",
      ],
      commonMistakes: [
        "Defending individual sins of historical soldiers instead of defending the Church's doctrinal truth.",
      ],
    };
  }

  // General Tailored Defense for any other topic
  const cleanedTitle = objection
    ? objection.replace(/[?.,!]/g, "").trim()
    : "Catholic Doctrine";
  return {
    title: `Catholic Apologetic Defense: ${cleanedTitle.slice(0, 45)}`,
    summary: `The Catholic response to "${objection || "this challenge"}" is grounded in the organic harmony of Sacred Scripture, Apostolic Tradition, and 2,000 years of reasoned philosophical defense. Far from contradicting divine revelation, Catholic dogma preserves the fullness of the deposit of faith entrusted by Christ to the Apostles.`,
    scripturePassages: [
      {
        reference: "1 Peter 3:15",
        text: "Always be prepared to make a defense to anyone who calls you to account for the hope that is in you, yet do it with gentleness and reverence.",
        explanation:
          "St. Peter provides the biblical mandate for apologetics: defending the truth with clarity, charity, and theological rigor.",
      },
      {
        reference: "2 Thessalonians 2:15",
        text: "So then, brothers, stand firm and hold to the traditions that you were taught by us, either by our spoken word or by our letter.",
        explanation:
          "Demonstrates that God's Word is communicated through both the oral proclamation of the Apostles and Sacred Scripture.",
      },
      {
        reference: "1 Timothy 3:15",
        text: "The church of the living God, a pillar and buttress of the truth.",
        explanation:
          "Proves that Christ established a living, visible Church to faithfully guard and interpret divine truth without error.",
      },
    ],
    mainArguments: [
      {
        title: "Historical Apostolic Continuity",
        content:
          "Catholic teaching does not originate in recent centuries. From the earliest post-apostolic writings, the Church has held this continuous doctrine in living communion with the successors of the Apostles.",
      },
      {
        title: "The Catholic 'Both/And' Principle",
        content:
          "Critics frequently create false 'either/or' dichotomies (faith OR works, Scripture OR Tradition, Christ OR His Church). Catholic theology embraces both in their proper God-given hierarchy.",
      },
      {
        title: "The Necessity of Magisterial Authority",
        content:
          "Without a living authority established by Christ, private interpretation inevitably splinters into thousands of conflicting denominations, contradicting Christ's solemn prayer for unity in John 17.",
      },
    ],
    churchFathersQuotes: [
      {
        father: "St. Irenaeus of Lyon",
        work: "Against Heresies, 3:3:1 (c. 180 AD)",
        quote:
          "True knowledge is that which consists in the doctrine of the Apostles, and the ancient constitution of the Church throughout the world.",
      },
      {
        father: "St. Augustine of Hippo",
        work: "Against the Fundamental Epistle, 5:6 (c. 397 AD)",
        quote:
          "For my part, I should not believe the gospel except as moved by the authority of the Catholic Church.",
      },
    ],
    practicalTips: [
      "Ask clarifying questions to understand what the challenger actually believes before formulating an answer.",
      "Always affirm the genuine truths and good intentions the other person brings to the dialogue.",
      "Keep the ultimate focus on Jesus Christ and His divine will for His bride, the Church.",
    ],
    commonMistakes: [
      "Becoming defensive, impatient, or argumentative; always speak the truth in love.",
      "Using caricature or straw-man representations of the opponent's position.",
    ],
  };
}

// 2. Comprehensive Catholic 5-Part Topic Defense (/api/ai/generate-topic)
apiRouter.post("/ai/generate-topic", async (req, res) => {
  const { objection } = req.body || {};

  // 1. PRIMARY: OpenAI (if genuine valid key provided)
  const openAiKey = getOpenAiKey();
  if (openAiKey && objection) {
    try {
      const prompt = `Research the authentic Catholic apologetic defense for: "${objection}".
Include real Bible passages, early Church Fathers quotes with specific work titles and dates, and sound philosophical arguments.
Return strictly valid JSON matching this schema:
{
  "title": "Short descriptive title of the defense topic",
  "summary": "2-3 sentence summary of the Catholic response",
  "scripturePassages": [
    { "reference": "Book Chapter:Verse", "text": "Exact scripture text", "explanation": "Catholic theological explanation" }
  ],
  "mainArguments": [
    { "title": "Argument Title", "content": "Detailed 2-4 sentence logical argument" }
  ],
  "churchFathersQuotes": [
    { "father": "Name of Church Father", "work": "Work title and approximate date", "quote": "Authentic patristic quotation" }
  ],
  "practicalTips": ["Tip 1", "Tip 2", "Tip 3"],
  "commonMistakes": ["Pitfall 1", "Pitfall 2"]
}`;
      const sysInstruction =
        "You are an expert Catholic theologian and apologist. Return valid JSON only without markdown code blocks.";

      const openAiResult = await callOpenAI(
        openAiKey,
        [{ role: "user", content: prompt }],
        sysInstruction,
        true
      );

      if (openAiResult && openAiResult.text) {
        const parsed = extractJsonFromText(openAiResult.text);
        if (parsed && parsed.title && parsed.scripturePassages) {
          return res.json(parsed);
        }
      }
    } catch (e) {
      console.debug("OpenAI generate-topic fallback:", e);
    }
  }

  // 2. SECONDARY: Gemini
  const client = getAiClient();
  if (isAiAvailable() && client && objection) {
    try {
      const prompt = `Formulate the authentic Catholic apologetic defense for: "${objection}".
Include real Bible passages, early Church Fathers quotes with specific work titles and dates, and sound philosophical arguments.
Return your response strictly formatted as valid JSON with no extraneous text. The JSON object MUST have these exact keys:
{
  "title": "Short descriptive title of the defense topic",
  "summary": "2-3 sentence summary of the Catholic response",
  "scripturePassages": [
    { "reference": "Book Chapter:Verse", "text": "Exact scripture text", "explanation": "Catholic theological explanation" }
  ],
  "mainArguments": [
    { "title": "Argument Title", "content": "Detailed 2-4 sentence logical argument" }
  ],
  "churchFathersQuotes": [
    { "father": "Name of Church Father", "work": "Work title and approximate date", "quote": "Authentic patristic quotation" }
  ],
  "practicalTips": ["Tip 1", "Tip 2", "Tip 3"],
  "commonMistakes": ["Pitfall 1", "Pitfall 2"]
}`;
      const sysInstruction =
        "You are an expert Catholic theologian and apologist. Verify all scripture citations, historical Church Father quotes, and Catechism references for accuracy. Return valid JSON only.";

      const response = await callGemini(client, prompt, sysInstruction);

      if (response && response.text) {
        const parsed = extractJsonFromText(response.text);
        if (parsed && parsed.title && parsed.scripturePassages) {
          return res.json(parsed);
        }
      }
    } catch (err) {
      handleAiError("/api/ai/generate-topic", err);
    }
  }

  // 3. TERTIARY: Curated Catholic Apologetics Repository (Fast, rich, authentic)
  const curated = getCuratedCatholicTopicDefense(objection || "");
  return res.json(curated);
});

// 3. Debate Coach Review & Scoring (/api/ai/review-session) with Google Search Grounding
apiRouter.post("/ai/review-session", async (req, res) => {
  const { transcript, opponentType, difficulty } = req.body || {};

  // 1. PRIMARY: OpenAI Integration for Review
  const openAiKey = getOpenAiKey();
  if (openAiKey && transcript) {
    try {
      const prompt = `Please review this apologetics debate transcript between a Catholic student and a ${opponentType || "Challenger"} (${difficulty || "Intermediate"} difficulty):\n\n${transcript}`;
      const sysInstruction = `You are an expert Catholic apologetics coach (like Trent Horn or Jimmy Akin). Evaluate the user's debate performance. Format with strengths, areas for tactical growth (Columbo, burden of proof), study topics, and an objective score out of 10.`;
      const reply = await callOpenAI(openAiKey, [{ role: "user", content: prompt }], sysInstruction, false);
      if (reply && reply.text) {
        return res.json({ review: reply.text });
      }
    } catch (e) {
      console.debug("OpenAI review fallback:", e);
    }
  }

  // 2. SECONDARY: Gemini
  const client = getAiClient();
  if (isAiAvailable() && client && transcript) {
    try {
      const prompt = `Please review this apologetics debate transcript between a Catholic student and a ${opponentType || "Challenger"} (${difficulty || "Intermediate"} difficulty):\n\n${transcript}`;
      const sysInstruction = `You are an expert Catholic apologetics coach (like Trent Horn or Jimmy Akin). Evaluate the user's debate performance.
Format your review with clear markdown sections:
### 🛡️ Apologetics Coach Session Review
**Opponent:** [Opponent] ([Difficulty])
**Overall Assessment:** [2-3 sentences praising poise, charity, and theological clarity]
**Key Strengths:**
1. [Strength 1]
2. [Strength 2]
3. [Strength 3]
**Areas for Tactical Growth:**
1. [Columbo question or burden-of-proof improvement]
2. [Scripture or Patristic citation improvement]
**Recommended Study Topics:**
- [Topic 1]
- [Topic 2]
**Score:** [e.g. 8.8 / 10] - [Encouraging conclusion]`;

      const response = await callGemini(client, prompt, sysInstruction);

      if (response && response.text) {
        return res.json({ review: response.text });
      }
    } catch (err) {
      handleAiError("/api/ai/review-session", err);
    }
  }

  return res.json({
    review: `### 🛡️ Apologetics Coach Session Review\n**Opponent:** ${opponentType || "Challenger"} (${difficulty || "Standard"})\n**Overall Assessment:** You demonstrated strong poise and maintained a charitable, constructive tone throughout this debate. Defending the Catholic faith against this perspective requires both theological accuracy and pastoral sensitivity, which you handled commendably.\n\n**Key Strengths:**\n1. **Charity in Engagement:** You listened carefully without becoming combative.\n2. **Biblical Grounding:** You anchored claims in Scripture.\n3. **Patience:** Addressed core concerns directly.\n\n**Areas for Tactical Growth:**\n1. **Employ the Columbo Tactic:** Ask clarifying questions ("What do you mean by that?") to keep the burden of proof on their claims.\n2. **Cite Early Church History:** Introducing patristic witnesses demonstrates historic continuity.\n\n**Score:** 8.5 / 10 — Solid session. Keep up the disciplined study!`,
  });
});

// 4. Spiritual Intentions & Traditional Catholic Prayer (/api/ai/pray)
apiRouter.post("/ai/pray", async (req, res) => {
  const { situation } = req.body || {};

  // 1. PRIMARY: OpenAI
  const openAiKey = getOpenAiKey();
  if (openAiKey && situation) {
    try {
      const prompt = `Please compose a devout, heartfelt Catholic prayer for this intention: "${situation}". Invoke the Holy Trinity, the Blessed Mother, patron saints, and quote a Psalm.`;
      const sysInstruction = "You are a devout Catholic spiritual director and priest. Compose an authentic Catholic prayer (6-10 sentences). Conclude with 'Through Christ our Lord... Amen.'";
      const reply = await callOpenAI(openAiKey, [{ role: "user", content: prompt }], sysInstruction, false);
      if (reply && reply.text) {
        return res.json({ prayer: reply.text });
      }
    } catch (e) {
      console.debug("OpenAI pray fallback:", e);
    }
  }

  // 2. SECONDARY: Gemini
  const client = getAiClient();
  if (isAiAvailable() && client && situation) {
    try {
      const prompt = `Please compose a devout, heartfelt Catholic prayer for this intention or situation: "${situation}".`;
      const sysInstruction =
        "You are a devout Catholic spiritual director and priest. Compose a beautiful, authentic Catholic prayer (6-10 sentences). Address the Holy Trinity or Jesus Christ, invoke the maternal intercession of the Blessed Virgin Mary and suitable patron Saints, cite or weave in a short verse from the Psalms, and conclude traditionally with 'Through Christ our Lord, in the unity of the Holy Spirit, God forever and ever. Amen.'";

      const response = await callGemini(client, prompt, sysInstruction);

      if (response && response.text) {
        return res.json({ prayer: response.text });
      }
    } catch (err) {
      handleAiError("/api/ai/pray", err);
    }
  }

  return res.json({
    prayer: `Heavenly Father, Almighty and Ever-Living God, look with tender mercy upon Your servant who brings before You this intention: "${situation || "peace of soul and wisdom"}". Grant me the wisdom of Solomon and the fortitude of the martyrs, that in every trial I may cling firmly to Christ, who is the Way, the Truth, and the Life. Holy Mother Mary, Seat of Wisdom and Refuge of Sinners, intercede for us and wrap this burden in your maternal mantle. Send forth Your Holy Spirit to enlighten our minds and inflame our hearts with divine charity. Through Christ our Lord, who lives and reigns with You in the unity of the Holy Spirit, God forever and ever. Amen.`,
  });
});

// 5. Bible Verse Catholic Apologetic Commentary (/api/ai/explain-verse)
apiRouter.post("/ai/explain-verse", async (req, res) => {
  const { reference, text } = req.body || {};

  // 1. PRIMARY: OpenAI
  const openAiKey = getOpenAiKey();
  if (openAiKey && reference) {
    try {
      const prompt = `Provide orthodox Catholic theological commentary for ${reference}: "${text || ""}".
Cite Church Fathers (such as Augustine, Chrysostom, Aquinas) and Magisterial councils.`;
      const sysInstruction = "You are a Catholic biblical scholar. Provide 3-5 sentences of insightful Catholic apologetic commentary.";
      const reply = await callOpenAI(openAiKey, [{ role: "user", content: prompt }], sysInstruction, false);
      if (reply && reply.text) {
        return res.json({
          explanation: reply.text,
        });
      }
    } catch (e) {
      console.debug("OpenAI explain-verse fallback:", e);
    }
  }

  // 2. SECONDARY: Gemini
  const client = getAiClient();
  if (isAiAvailable() && client && reference) {
    try {
      const prompt = `Find orthodox Catholic commentaries for ${reference}: "${text || ""}".
Reference Church Fathers (such as Augustine, Chrysostom, or Irenaeus), St. Thomas Aquinas (Catena Aurea), or Magisterial councils (Trent, Vatican II).
Explain how Catholic theology understands this passage, addressing common misunderstandings with charitable rigor.`;
      const sysInstruction =
        "You are a Catholic biblical scholar and apologist. Verify all theological citations and historical contexts so answers are 100% faithful and accurate. Provide 3-5 sentences of insightful commentary.";

      const response = await callGemini(client, prompt, sysInstruction);

      if (response && response.text) {
        return res.json({
          explanation: response.text,
        });
      }
    } catch (err) {
      handleAiError("/api/ai/explain-verse", err);
    }
  }

  return res.json({
    explanation: `In the Catholic theological tradition, **${reference || "this scripture"}** is a cornerstone passage. When read in its historical and literary context alongside the consensus of the Church Fathers, it reveals the harmonious unity between Christ's words and the sacramental reality of the Catholic Church. Rather than being merely figurative or private, this scripture affirms God's covenantal design and apostolic order.`,
    groundingSources: [],
    searchQueries: [],
  });
});

// 6. Catholic Pillars & Science Fathers Daily Quotes with Google Search Grounding (/api/ai/daily-quotes)
apiRouter.get("/ai/daily-quotes", async (req, res) => {
  const requestedCategory = (req.query.category as string) || "all";
  const refresh = req.query.refresh === "true";
  const client = getAiClient();

  if (isAiAvailable() && client && refresh) {
    try {
      const promptCategory =
        requestedCategory === "scientists"
          ? "Catholic Science Fathers (e.g. Fr. Georges Lemaître, Gregor Mendel, Louis Pasteur, Nicolas Steno, Roger Bacon, Angelo Secchi, Blaise Pascal, René Descartes, Copernicus)"
          : requestedCategory === "fathers"
          ? "Early Church Fathers (e.g. St. Augustine, St. Irenaeus, St. Ignatius of Antioch, St. Justin Martyr, St. John Chrysostom, St. Athanasius)"
          : requestedCategory === "apologists"
          ? "Catholic Apologetic Titans (e.g. St. Thomas Aquinas, St. Robert Bellarmine, G.K. Chesterton, Frank Sheed, Ven. Fulton J. Sheen, John Henry Newman)"
          : "a diverse mix of Church Fathers, Catholic Apologetics Titans, and Catholic Fathers of Science (like Fr. Georges Lemaître, Gregor Mendel, Louis Pasteur, Nicolas Steno)";

      const response = await client.models.generateContent({
        model: "gemini-3.8-flash",
        contents: `Find 3 authentic, verified, inspiring quotes from ${promptCategory}.
Verify the exact source work (e.g. book title, year, or historical document) and ensure the author was a faithful Catholic (especially highlight Catholic priests and scientists who founded modern scientific fields!).
Return strictly a valid JSON array of objects with these keys:
[
  {
    "id": "unique-slug-string",
    "category": "church_father" | "apologetic_titan" | "catholic_scientist",
    "categoryLabel": "Church Father" | "Apologetic Titan" | "Catholic Science Father",
    "author": "Full Name with titles (e.g. Fr. Georges Lemaître, St. Augustine of Hippo)",
    "title": "Historical Title (e.g. Father of the Big Bang Theory & Catholic Priest)",
    "era": "e.g. 1894–1966 AD",
    "quote": "Authentic verified quote",
    "source": "Document, Book or Speech where the quote appeared",
    "historicalImpact": "1-2 sentences on their monumental breakthrough or defense",
    "faithAndReasonInsight": "1 sentence on how their Catholic faith and intellectual inquiry harmonized"
  }
]`,
        config: {
          systemInstruction:
            "You are a historian of Catholic thought and science. Ensure that every quote is authentic, properly attributed, and historically accurate.",
        },
      });

      if (response.text) {
        let cleaned = response.text.trim();
        if (cleaned.startsWith("```")) {
          cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
        }
        const parsed = JSON.parse(cleaned);
        if (Array.isArray(parsed) && parsed.length > 0) {
          const enriched = parsed.map((item, idx) => ({
            ...item,
            id: item.id || `live-quote-${Date.now()}-${idx}`,
          }));
          return res.json({ quotes: enriched, liveGrounded: true });
        }
      }
    } catch (err) {
      handleAiError("/api/ai/daily-quotes", err);
    }
  }

  let filtered = DAILY_CATHOLIC_QUOTES;
  if (requestedCategory === "scientists") {
    filtered = DAILY_CATHOLIC_QUOTES.filter((q) => q.category === "catholic_scientist");
  } else if (requestedCategory === "fathers") {
    filtered = DAILY_CATHOLIC_QUOTES.filter((q) => q.category === "church_father");
  } else if (requestedCategory === "apologists") {
    filtered = DAILY_CATHOLIC_QUOTES.filter((q) => q.category === "apologetic_titan");
  }

  return res.json({ quotes: filtered, liveGrounded: false });
});

apiRouter.post("/ai/daily-quotes", async (req, res) => {
  const { category, focusPerson } = req.body || {};
  const client = getAiClient();

  if (isAiAvailable() && client) {
    try {
      const queryTopic = focusPerson
        ? `quotes and historical background on "${focusPerson}"`
        : category === "scientists"
        ? "Catholic Science Fathers (Fr. Georges Lemaître, Gregor Mendel, Louis Pasteur, Nicolas Steno, Roger Bacon, Angelo Secchi)"
        : category === "fathers"
        ? "Church Fathers (St. Augustine, St. Irenaeus, St. Ignatius of Antioch, St. Justin Martyr)"
        : "Catholic Apologetic Titans (St. Thomas Aquinas, G.K. Chesterton, Fulton Sheen, Frank Sheed)";

      const response = await client.models.generateContent({
        model: "gemini-3.8-flash",
        contents: `Find 2 verified, inspiring, historically documented quotes for: ${queryTopic}.
Verify the quote, source document, and the Catholic figure's historical and scientific/theological legacy.
Return strictly a valid JSON array of objects matching:
[
  {
    "id": "slug",
    "category": "church_father" | "apologetic_titan" | "catholic_scientist",
    "categoryLabel": "Church Father" | "Apologetic Titan" | "Catholic Science Father",
    "author": "Name with title",
    "title": "Title/Field",
    "era": "Dates AD",
    "quote": "Quote text",
    "source": "Verified source book or document",
    "historicalImpact": "Historical impact",
    "faithAndReasonInsight": "Faith and reason insight"
  }
]`,
        config: {
          systemInstruction:
            "You are a historian of Catholic thought and science. Verify authenticity.",
        },
      });

      if (response.text) {
        let cleaned = response.text.trim();
        if (cleaned.startsWith("```")) {
          cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
        }
        const parsed = JSON.parse(cleaned);
        if (Array.isArray(parsed) && parsed.length > 0) {
          const enriched = parsed.map((item, idx) => ({
            ...item,
            id: item.id || `live-quote-${Date.now()}-${idx}`,
          }));
          return res.json({ quotes: enriched, liveGrounded: true });
        }
      }
    } catch (e) {
      handleAiError("POST /api/ai/daily-quotes", e);
    }
  }

  return res.json({ quotes: BASELINE_QUOTES.slice(0, 3), liveGrounded: false });
});

// 7. Catholic Library Document Explorer & Explainer (/api/ai/explain-document)
apiRouter.post("/ai/explain-document", async (req, res) => {
  const { documentTitle, question } = req.body || {};
  const client = getAiClient();
  const openAiKey = getOpenAiKey();

  // 1. PRIMARY: OpenAI
  if (openAiKey && documentTitle) {
    try {
      const prompt = `Provide an orthodox Catholic theological analysis of the Catholic Magisterial text "${documentTitle}":
Question: "${question || "Provide a comprehensive summary of its key theological principles, context, and importance for Catholic apologetics."}".
Cite specific chapter/paragraph numbers, Latin titles where relevant, and historical context.`;
      const sysInstruction =
        "You are an expert Catholic archivist and theologian. Provide 3-5 concise, deeply informative paragraphs.";
      const reply = await callOpenAI(openAiKey, [{ role: "user", content: prompt }], sysInstruction, false);
      if (reply && reply.text) {
        return res.json({
          explanation: reply.text,
        });
      }
    } catch (e) {
      console.debug("OpenAI explain-document fallback:", e);
    }
  }

  // 2. SECONDARY: Gemini
  if (isAiAvailable() && client && documentTitle) {
    try {
      const prompt = `Answer this question about the Catholic Magisterial text "${documentTitle}":
Question: "${question || "Provide a comprehensive summary of its key theological principles, context, and importance for Catholic apologetics."}".
Cite specific chapter/paragraph numbers, Latin titles where relevant, and historical context.`;
      const sysInstruction =
        "You are an expert Catholic archivist and theologian. Provide official translations, paragraph numbers (e.g., CCC paragraphs or Vatican II constitution sections), and doctrinal definitions. Return 3-5 concise, deeply informative paragraphs.";

      const response = await callGemini(client, prompt, sysInstruction);

      if (response && response.text) {
        return res.json({
          explanation: response.text,
        });
      }
    } catch (err) {
      handleAiError("/api/ai/explain-document", err);
    }
  }

  return res.json({
    explanation: `**${documentTitle || "This Catholic Document"}** represents an essential witness of the living Magisterium. In harmony with Sacred Scripture and Sacred Tradition, it elucidates the Catholic faith for the defense of Christian truth. Key teachings include its affirmation of apostolic succession, doctrinal continuity, and the guidance of the Holy Spirit.`,
    groundingSources: [
      {
        title: "Vatican Official Archives",
        uri: "https://www.vatican.va/archive/",
      },
    ],
    searchQueries: [documentTitle ? `${documentTitle} Catholic doctrine` : "Catholic Magisterium"],
  });
});


// Health check endpoint
apiRouter.get("/health", (_req, res) => {
  res.json({ status: "ok", app: "Daily Defense API" });
});

// Mount router on both /api (when called with /api prefix) and root / (when invoked directly in serverless environment)
app.use("/api", apiRouter);
app.use("/", apiRouter);

// Export app for local express server.ts
export { app };

// Default export as serverless handler for Vercel
export default function handler(req: any, res: any) {
  return app(req, res);
}


