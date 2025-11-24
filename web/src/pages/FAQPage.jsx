// web/src/pages/FAQPage.jsx
import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTheme } from "../contexts/ThemeContext";
import "./FAQPage.css";

const FAQPage = () => {
  const navigate = useNavigate();
  const { theme } = useTheme();
  const isLight = theme === "light";

  const colors = {
    cardBg: isLight ? "#ffffff" : "#020617",
    cardBorder: isLight ? "#e5e7eb" : "#111827",
    heroBg: isLight
      ? "radial-gradient(circle at top left, rgba(34,197,94,0.08) 0, #f9fafb 55%, #f9fafb 100%)"
      : "radial-gradient(circle at top left, rgba(34,197,94,0.2) 0, #020617 55%, #020617 100%)",
    heroBorder: isLight
      ? "1px solid rgba(148,163,184,0.6)"
      : "1px solid rgba(34,197,94,0.35)",
    contactBg: isLight
      ? "radial-gradient(circle at top, rgba(34,197,94,0.12), #f9fafb 60%)"
      : "radial-gradient(circle at top, rgba(34,197,94,0.16), #020617 55%)",
    contactBorder: isLight
      ? "1px solid rgba(148,163,184,0.6)"
      : "1px solid rgba(34,197,94,0.35)",
    muted: isLight ? "#6b7280" : "#9ca3af",
    heading: isLight ? "#0f172a" : "#f9fafb",
  };

  const [openFAQ, setOpenFAQ] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");

  const faqData = [
    {
      category: "Getting Started",
      questions: [
        {
          id: 1,
          question: "What is Notably and how does it work?",
          answer:
            "Notably is an AI-powered transcription and meeting analysis platform. Upload your audio or video files, and our system automatically transcribes them using advanced speech-to-text technology, then generates summaries, action items, and insights to help you get the most out of your meetings.",
        },
        {
          id: 2,
          question: "What file formats does Notably support?",
          answer:
            "Notably supports most common audio and video formats including MP3, MP4, WAV, M4A, MOV, and AVI. Files must be under 1GB in size and no longer than 60 minutes in duration.",
        },
        {
          id: 3,
          question: "How accurate is the transcription?",
          answer:
            "Our transcription service uses OpenAI's Whisper technology, which provides industry-leading accuracy. Transcription quality depends on audio clarity, speaker accents, and background noise. Clear recordings typically achieve 95%+ accuracy.",
        },
      ],
    },
    {
      category: "Account & Features",
      questions: [
        {
          id: 4,
          question: "How do I create an account?",
          answer:
            'Click the "Sign Up" button on the login page and provide your email address and a secure password. You\'ll receive a confirmation email to verify your account and can start uploading files immediately.',
        },
        {
          id: 5,
          question: "Is Notably completely free to use?",
          answer:
            "Yes! Notably is currently free to use with no subscription fees or hidden costs. You can transcribe your audio files, generate summaries, and access all features at no charge.",
        },
        {
          id: 6,
          question: "Are there any usage limits?",
          answer:
            "Currently, you can upload files up to 1GB in size and 60 minutes in duration. We may introduce fair usage policies in the future, but for now, you can use Notably freely within these technical limits.",
        },
      ],
    },
    {
      category: "Features & Usage",
      questions: [
        {
          id: 7,
          question: "Can I search through my transcriptions?",
          answer:
            "Absolutely! Notably includes powerful search functionality that lets you find specific words, phrases, or topics across all your transcriptions. Use the search bar in your dashboard to quickly locate relevant content.",
        },
        {
          id: 8,
          question: "How does the AI summarization work?",
          answer:
            "Our AI analyzes your transcription content and automatically generates concise summaries, extracts key action items, and identifies important decisions. This saves you time reviewing long meetings and helps ensure nothing important is missed.",
        },
        {
          id: 9,
          question: "Can I export my transcriptions?",
          answer:
            "Yes! You can export your transcriptions and summaries as PDF documents, plain text files, or structured JSON data. All exports include timestamps, speaker labels, and generated insights.",
        },
        {
          id: 10,
          question: "Does Notably support multiple speakers?",
          answer:
            "Yes, our system can distinguish between different speakers in your audio and label them appropriately in the transcript. This makes it easy to follow conversations and attribute statements to specific participants.",
        },
      ],
    },
    {
      category: "Privacy & Security",
      questions: [
        {
          id: 11,
          question: "How secure is my data?",
          answer:
            "We take data security seriously. All files are encrypted in transit and at rest. We use enterprise-grade security measures and comply with industry standards. Your data is stored securely and is never shared with third parties.",
        },
        {
          id: 12,
          question: "How long is my data retained?",
          answer:
            "By default, uploaded files and transcriptions are retained for 90 days. You can download your data at any time before the retention period expires. Enterprise customers can configure custom retention policies.",
        },
        {
          id: 13,
          question: "Can I delete my data?",
          answer:
            "Yes, you have full control over your data. You can delete individual transcriptions, entire meetings, or request complete account deletion at any time through your account settings or by contacting support.",
        },
      ],
    },
    {
      category: "Technical Support",
      questions: [
        {
          id: 14,
          question: "What if my transcription fails?",
          answer:
            "If a transcription fails, check that your file meets our format and size requirements. Common issues include corrupted files, unsupported formats, or poor audio quality. Our support team can help troubleshoot specific issues.",
        },
        {
          id: 15,
          question: "How long does transcription take?",
          answer:
            "Transcription typically takes 10–30% of the original audio length. A 60-minute meeting usually processes in 6–18 minutes, depending on current system load and file complexity.",
        },
        {
          id: 16,
          question: "Can I get help with setup or training?",
          answer:
            "Yes! We offer onboarding support for new users and teams. Enterprise customers get dedicated success managers and custom training sessions. Check our documentation or contact support for assistance.",
        },
      ],
    },
  ];

  const filteredFAQs = faqData
    .map((category) => ({
      ...category,
      questions: category.questions.filter(
        (q) =>
          q.question.toLowerCase().includes(searchTerm.toLowerCase()) ||
          q.answer.toLowerCase().includes(searchTerm.toLowerCase())
      ),
    }))
    .filter((category) => category.questions.length > 0);

  const toggleFAQ = (id) => {
    setOpenFAQ(openFAQ === id ? null : id);
  };

  return (
    <div className="app-page" data-theme={theme}>
      <main
        className="faq-main"
        style={{
          flex: 1,
          padding: 0,
          maxWidth: "960px",
          width: "100%",
          margin: "0 auto",
        }}
      >
        {/* Hero / title */}
        <section
          style={{
            marginTop: "1.5rem",
            marginBottom: "1rem",
            padding: "1rem 1.25rem",
            borderRadius: "0.75rem",
            background: colors.heroBg,
            border: colors.heroBorder,
          }}
        >
          <div>
            <div
              style={{
                fontSize: "0.8rem",
                textTransform: "uppercase",
                letterSpacing: "0.1em",
                color: "#bbf7d0",
                marginBottom: "0.25rem",
              }}
            >
              Help
            </div>
            <h1
              style={{
                fontSize: "1.5rem",
                fontWeight: 600,
                margin: 0,
                color: colors.heading,
              }}
            >
              Frequently asked questions
            </h1>
            <p
              style={{
                fontSize: "0.85rem",
                color: colors.muted,
                marginTop: "0.3rem",
                maxWidth: "40rem",
              }}
            >
              Find quick answers about uploads, transcription, summaries, and
              how Notably handles your data.
            </p>
          </div>
        </section>

        {/* Search */}
        <section
          className="faq-search-section"
          style={{
            marginBottom: "1rem",
            padding: "0.75rem 1.25rem",
            borderRadius: "0.75rem",
            background: colors.cardBg,
            border: colors.cardBorder,
          }}
        >
          <div className="search-container">
            <div className="search-input-container">
              <svg
                className="search-icon"
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <circle cx="11" cy="11" r="8"></circle>
                <path d="m21 21-4.35-4.35"></path>
              </svg>
              <input
                type="text"
                placeholder="Search frequently asked questions..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="search-input"
              />
              {searchTerm && (
                <button
                  onClick={() => setSearchTerm("")}
                  className="search-clear"
                >
                  ×
                </button>
              )}
            </div>
          </div>
        </section>

        {/* FAQ content */}
        <section
          style={{
            marginBottom: "1rem",
            padding: "1rem 1.25rem",
            borderRadius: "0.75rem",
            background: colors.cardBg,
            border: colors.cardBorder,
          }}
        >
          <div className="faq-content">
            {filteredFAQs.length === 0 ? (
              <div className="no-results">
                <div className="no-results-icon">🔍</div>
                <h3>No results found</h3>
                <p>
                  Try adjusting your search terms or browse all categories
                  below.
                </p>
                <button
                  onClick={() => setSearchTerm("")}
                  className="clear-search-btn"
                >
                  Clear search
                </button>
              </div>
            ) : (
              filteredFAQs.map((category) => (
                <div key={category.category} className="faq-category">
                  <h2 className="category-title">{category.category}</h2>
                  <div className="faq-items">
                    {category.questions.map((faq) => (
                      <div key={faq.id} className="faq-item">
                        <button
                          className={`faq-question ${
                            openFAQ === faq.id ? "active" : ""
                          }`}
                          onClick={() => toggleFAQ(faq.id)}
                        >
                          <span className="question-text">
                            {faq.question}
                          </span>
                          <svg
                            className="expand-icon"
                            width="20"
                            height="20"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                          >
                            <polyline points="6,9 12,15 18,9"></polyline>
                          </svg>
                        </button>
                        <div
                          className={`faq-answer ${
                            openFAQ === faq.id ? "open" : ""
                          }`}
                        >
                          <div className="answer-content">
                            <p>{faq.answer}</p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        {/* Contact section */}
        <section
          className="faq-contact-section"
          style={{
            marginBottom: "1.75rem",
            padding: "1rem 1.25rem",
            borderRadius: "0.75rem",
            background: colors.contactBg,
            border: colors.contactBorder,
          }}
        >
          <div className="faq-contact">
            <div className="contact-card" style={{ border: "none", padding: 0 }}>
              <h3>Still have questions?</h3>
              <p style={{ color: colors.muted }}>
                Can&apos;t find what you&apos;re looking for? Check out our API
                documentation for deeper technical details.
              </p>
              <div className="contact-buttons">
                <button
                  className="contact-btn primary"
                  onClick={() => navigate("/api-docs")}
                >
                  View API docs
                </button>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
};

export default FAQPage;
