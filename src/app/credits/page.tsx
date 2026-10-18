import type { Metadata } from "next";
import { CREDITS, CREDIT_STATUSES, FEEDBACK_VIDEO, type CreditStatus } from "@/lib/credits";

export const metadata: Metadata = {
  title: "Credits · Search YGO",
  description: "The people who found bugs in Search YGO and suggested changes to it.",
  alternates: { canonical: "/credits" },
};

const HEADINGS: Record<CreditStatus, string> = {
  added: "Added",
  fixed: "Fixed",
  coming: "On the way",
  planned: "Planned",
};

export default function CreditsPage() {
  const people = new Set(CREDITS.flatMap((credit) => credit.by)).size;
  return (
    <div className="page">
      <header className="mast mast--still">
        <a className="mast__name" href="/">
          <span className="mast__rule" aria-hidden="true" />
          <span className="mast__title">Search YGO</span>
          <span className="mast__rule" aria-hidden="true" />
        </a>
        <h1 className="mast__line">Credits</h1>
      </header>

      <main className="main credits">
        <section className="credits__intro zone">
          <p>
            Search YGO gets better because people say what is broken and what is missing. These {people} people found a bug or
            suggested a change; their names are as they appear in the comments on{" "}
            <a href={FEEDBACK_VIDEO} target="_blank" rel="noreferrer">
              the video about the site
            </a>
            . Thank you.
          </p>
        </section>

        {CREDIT_STATUSES.map((status) => {
          const credits = CREDITS.filter((credit) => credit.status === status);
          if (!credits.length) return null;
          return (
            <section className="credits__group" key={status} aria-labelledby={`credits-${status}`}>
              <h2 id={`credits-${status}`}>{HEADINGS[status]}</h2>
              <ul className="credits__list">
                {credits.map((credit) => (
                  <li key={credit.what}>
                    <span className="credits__kind" data-kind={credit.kind}>
                      {credit.kind === "bug" ? "Bug" : "Idea"}
                    </span>
                    <p className="credits__what">{credit.what}</p>
                    <p className="credits__by">{credit.by.join(", ")}</p>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}

        <section className="credits__group" aria-labelledby="credits-sources">
          <h2 id="credits-sources">Made with</h2>
          <ul className="credits__list credits__list--plain">
            <li>
              Card data and images from{" "}
              <a href="https://ygoprodeck.com/" target="_blank" rel="noreferrer">
                YGOPRODeck
              </a>
            </li>
            <li>
              Paper textures prepared from{" "}
              <a href="https://texturelabs.org" target="_blank" rel="noreferrer">
                Texturelabs
              </a>{" "}
              photographs
            </li>
            <li>
              Animation with{" "}
              <a href="https://animejs.com" target="_blank" rel="noreferrer">
                anime.js
              </a>
              ; type set in Vollkorn
            </li>
          </ul>
        </section>

        <p className="credits__back">
          <a href="/">Back to the search</a>
        </p>
      </main>

      <footer className="foot">
        <p>
          An unofficial fan project, not affiliated with or endorsed by Konami. Card text and artwork belong to their owners.
        </p>
      </footer>
    </div>
  );
}
