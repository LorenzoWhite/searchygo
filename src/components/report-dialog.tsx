"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

/** What a report is about: a card shown that cannot work, or a card that does and is missing. */
export type ReportSubject = { kind: "mismatch"; card: { id: number; name: string } } | { kind: "suggestion" };

const MIN_NOTE = 15;
const MAX_NOTE = 500;

/**
 * The form for reporting a synergy or counter result. It asks how a card fails to work (or how a
 * suggested one does), because only cards that cannot work are taken out: weak or unpopular picks stay.
 */
export function ReportDialog({ subject, search, deck, onClose }: { subject: ReportSubject | null; search: string; deck?: string; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [note, setNote] = useState("");
  const [cardName, setCardName] = useState("");
  const [state, setState] = useState<{ status: "idle" | "sending" | "sent" | "error"; message?: string }>({ status: "idle" });

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (subject && !dialog.open) {
      setNote("");
      setCardName("");
      setState({ status: "idle" });
      dialog.showModal();
    }
    if (!subject && dialog.open) dialog.close();
  }, [subject]);

  const forDeck = deck ? `for ${deck}` : "for this search";

  const send = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!subject) return;
    setState({ status: "sending" });
    const website = (new FormData(event.currentTarget).get("website") as string | null) ?? "";
    try {
      const response = await fetch("/api/report", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: subject.kind,
          search,
          deck,
          ...(subject.kind === "mismatch" ? { card: subject.card.id } : { cardName }),
          note,
          website,
        }),
      });
      const body = (await response.json().catch(() => ({}))) as { message?: string };
      setState(response.ok ? { status: "sent", message: body.message } : { status: "error", message: body.message ?? "That didn't go through." });
    } catch {
      setState({ status: "error", message: "The report couldn't be sent. Check the connection and try again." });
    }
  };

  return (
    <dialog
      ref={ref}
      className="reportdialog"
      aria-labelledby="report-title"
      onClose={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      {subject && (
        <form className="reportdialog__form zone" onSubmit={send}>
          <h2 id="report-title">{subject.kind === "mismatch" ? "Report a mismatch" : "Suggest a card"}</h2>
          {state.status === "sent" ? (
            <>
              <p>{state.message ?? "Thanks, it will be looked at."}</p>
              <button type="button" className="button" onClick={onClose}>
                Close
              </button>
            </>
          ) : (
            <>
              <p className="reportdialog__about">
                {subject.kind === "mismatch" ? (
                  <>
                    <strong>{subject.card.name}</strong>, shown {forDeck}. Tell us how it fails to work with the deck. Cards that can't work
                    are taken out; weak or unpopular picks stay, since someone may build around them.
                  </>
                ) : (
                  <>A card that works {forDeck} and is missing from the results. It is added once someone has checked how it works.</>
                )}
              </p>
              {subject.kind === "suggestion" && (
                <div className="field">
                  <label htmlFor="report-card">Card name</label>
                  <input
                    id="report-card"
                    type="text"
                    required
                    maxLength={100}
                    autoComplete="off"
                    spellCheck={false}
                    value={cardName}
                    onChange={(event) => setCardName(event.target.value)}
                  />
                </div>
              )}
              <div className="field">
                <label htmlFor="report-note">{subject.kind === "mismatch" ? "How does it fail to work?" : "How does it work with the deck?"}</label>
                <textarea
                  id="report-note"
                  required
                  rows={4}
                  minLength={MIN_NOTE}
                  maxLength={MAX_NOTE}
                  placeholder={subject.kind === "mismatch" ? "It only searches Spellcasters, and the deck has none." : "Its effect sends a LIGHT Beast-Warrior from the Deck, which…"}
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                />
              </div>
              {/* Left empty by people, who never see it; filled in by bots. */}
              <div className="visually-hidden" aria-hidden="true">
                <label htmlFor="report-website">Website</label>
                <input id="report-website" name="website" type="text" tabIndex={-1} autoComplete="off" />
              </div>
              {state.status === "error" && (
                <p className="reportdialog__error" role="alert">
                  {state.message}
                </p>
              )}
              <div className="reportdialog__actions">
                <button type="submit" className="button" disabled={state.status === "sending" || note.trim().length < MIN_NOTE}>
                  {state.status === "sending" ? "Sending…" : "Send"}
                </button>
                <button type="button" className="button button--quiet" onClick={onClose}>
                  Cancel
                </button>
              </div>
            </>
          )}
        </form>
      )}
    </dialog>
  );
}
