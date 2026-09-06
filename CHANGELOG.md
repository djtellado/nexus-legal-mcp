# Changelog — `@nexus-legal/mcp`

Every published version of the Nexus Legal MCP connector.
Follows [Keep a Changelog](https://keepachangelog.com/) and SemVer.

## 0.5.0 (2026-08-07) — a time limit is counted under the law of the forum, or it is not counted at all

### Changed — `plazos_calcular` requires `jurisdiction`, with no default value

**Until now this tool described the Spanish computation as if it were THE computation.** Its
description said "under Spanish civil procedure law (LEC)" and the forum parameter did not exist: an
agent reading it would ask for a time limit without saying which jurisdiction the case is being
litigated in, and would get back a date computed under the LEC — working days, August out of time,
CGPJ and autonomous-community court holidays — for an English claim.

🔴 **And a missed deadline cannot be recovered.** The client acts on that date, files out of time,
and there is no putting it right afterwards. It is not a worse outcome: it is harm that cannot be
undone.

`jurisdiction` is now **mandatory and has no default**. A call with no forum is rejected instead of
having one assumed on its behalf.

### Added — England and Wales (`GB-EAW`) with a rule of its own

CPR r 2.8 counts in **clear days**: neither the day of the act nor the day of expiry is counted, and
for periods of five days or less Saturdays, Sundays and bank holidays are excluded. The LEC's
working-days / calendar-days distinction does not exist there, so `GB-EAW` takes a number of days
and returns `clear_days`. **There is no August vacation** — that belongs to the LEC and has no
counterpart there.

New `acto_en_oficina` (`GB-EAW` only): where the act must be done AT THE COURT OFFICE and the period
ends on a day when the office is closed, CPR r 2.8(5) extends it to the next day it is open.

### Scotland and Northern Ireland are REJECTED, not approximated

Their rules and their bank holidays differ from those of England and Wales. Returning a
"near enough" date would be precisely the defect this version corrects, one country further on: an
answer shaped like a time limit that nobody has computed under the law that governs it.

### The break, and why it is the right one

An integration that used to call without `jurisdiction` now fails. It fails **loudly and early**,
instead of returning a Spanish date for an English claim — which is how it was failing until today.

## 0.4.1 (2026-08-04)

### Fixed — the screening report and the citation markers were not reaching the client

The 0.3.2 fix — that the ANNOTATED text of the `done` event beats the `text_delta` chunks — was
half-done, and twice over:

- It read ONLY `verifiedText`, and that key is emitted by `/api/consulta` and `/api/nodo-doctrina`.
  The analysis route, the one `nexus_analyze` uses, emits the annotated text in `analysis`. The main
  tool of all of them was still returning raw prose, and with it went the sanctions screening
  report, the OCR warning and the markers beside each citation.
- And the annotated text, even where it was collected, never made it out into the result.

Both keys are now read, the non-empty one wins, and it comes out in `text`. An `analysis: ""` does
not wipe the answer: the deltas are delivered.

### Added — structured `partyScreening` in the result

Alongside the report in prose, the result now carries `{screened, failed, failureReason, list,
entries}` so that an agent can act on `failed` without parsing text. 🔴 `screened` and `failed` are
read TOGETHER: `entries: []` with `failed > 0` means nobody looked, not that the party was clean.

### Changed — `prepublishOnly` runs the suite

It only compiled before. Publishing now requires the tests to be green: it is the gate that was
missing, and that let two versions of the TypeScript SDK go out announcing themselves under the
previous number.

## 0.4.0 (2026-08-03)

### 🔴 BREAKING — `professionalRole` is MANDATORY in `nexus_analyze`, `nexus_draft` and `nexus_adversarial`

It used to carry `.default("abogado")`. A client that omitted the field received an analysis written
from the standpoint of a practising lawyer without ever having asked for one.

This is not a matter of style. The role decides **what counts as a finding**: on the same contract
and the same law, the notary asks whether it can be executed as a public instrument, the registrar
whether it is registrable, and the judge whether the procedural requirements are made out. A defect
of form that a litigator would shrug at is THE finding for a registrar. Leaving it empty did not
avoid that decision — it handed it to the default.

Exactly the same reason for which jurisdiction stopped having a default value.

**Migration:** add `professionalRole` to your calls. `"abogado"` reproduces the previous behaviour —
but it is worth checking whether that is the one you wanted.

### Fixed — `nexus_draft` and `nexus_adversarial` accepted SIX roles, not seven

`persona` was missing from them. An integrator sending the lay-person role — valid in
`nexus_analyze` and in `POST /v1/analyze` — got an error from the validator, not from the product.

The cause: the `persona` role block for drafting did not exist in the backend, so the list of six
faithfully documented a hole. With the block written, all three tools validate against the same
catalogue, and a CI lock compares their enums against it — this package is an independent npm
package and cannot import from the core, so the only guarantee available is the comparison, and
until today it did not exist.

## 0.3.2 (2026-08-02)

### Fixed — the connector delivered RAW prose, without the citation verdict

This package has its own copy of the SSE loop (it is independent: it cannot import `aggregateSse`
from the app). On 2026-08-02 the app's copy was fixed — so that the already-annotated text beats the
concatenated `text_delta` chunks — and this one was left behind.

Effect: anyone working from an MCP client received the text without verification markers, while the
application delivered that same answer with the verdict inside it. The raw text goes as far as
asserting that we do not hold authorities that we do hold, because the model does not know what the
verifier is going to find and fills the gap with prose of its own.

The `done` event is now read in full: if it carries `verifiedText`, that replaces the deltas. An
empty `verifiedText` does NOT wipe the answer.


### Fixed — a half-matched identity came out as "✅ FOUND IN THE CORPUS"

This package's `isFlagged` is a copy of the core predicate, and the core gained a second term
(`party_check === "partial"`, API v1.40.0). A flagged row was coming out green.

Outstanding since 0.3.1; it lands here.

## 0.3.1 (2026-07-28)


### Fixed — we were saying the United Kingdom has no corpus, and it has one

`【◻ no verificable: jurisdicción sin corpus activo】` was left behind here when it was corrected in
the web annotator. This file declares itself a verbatim copy, and it drifted in exactly the same
way. Effect for the practitioner: a pleading citing "[2019] UKSC 41" received "jurisdicción sin
corpus activo" two lines above a citation checked against that very corpus. All four marker strings
and both summary lines have been carried across.

The lock that was watching over this compared KEYS and not values: the two maps had the same
pigeonholes and said different things. It now compares the TEXTS.

### Fixed — the `auto` router did not know English

The legislation lexicon was Spanish only (art/ley/real decreto/reglamento/LEC/LGSS), so
`section 214 of the Insolvency Act 1986` matched nothing, fell through by elimination to case law,
and was answered with "use an ECLI, a ROJ ('STS 1234/2023')" — a Spanish ROJ for a British statute —
while the United Kingdom legislation corpus held the answer.

⚠️ What follows is in `main` but has **not been published**. Anyone installing
`@nexus-legal/mcp` today still gets 0.3.0, without these fixes.

### Fixed

- **A rejection carrying a stable code no longer disguises itself as a fault of ours.** A
  `409 BYO_PROVIDER_REQUIRED` — the NORMAL state of an account provisioned to run only on
  its own engine — came out as
  `Error invocando nexus_analyze: Nexus backend respondió 409 Conflict …` followed by
  a raw JSON dump. It now comes out as
  `Error running nexus_analyze: BYO_PROVIDER_REQUIRED: <the backend's wording, in
  full>`, which carries the cause, the fact that retrying will not help, and the action.

- **The same rejection, when it arrives INSIDE the stream, is no longer turned into a 500.** The
  routes that resolve the engine after opening the stream send
  `{type:"error", code, message}`; the client promoted it to `NexusHttpError(500)` and
  threw the `code` away. A configuration state was being read as a server outage.
  `code` now travels with the error, and the status is not invented.

- **The declared version is the real one.** The MCP handshake announced a hardcoded `0.1.0`
  and the `User-Agent` came from `npm_package_version`, which does not exist when the
  process starts under `npx` (which is to say: always, on a real start-up). Package 0.3.0
  identified itself as 0.1.0 both to the client and to the backend.

- **`server.json` (the MCP directory entry) pointed at `@nexus-legal/mcp@0.1.5`**
  and declared itself `0.2.1` with "15 tools". Anyone installing from the directory took
  away the build PRIOR to the three verification fixes in 0.3.0 — among them the
  ✅ VIGENTE shown over a citation whose meaning veto had fired.

### Docs

- The README said "16 capabilities" and listed 16 tools; there are **27**. Missing were
  `nexus_verificacion`, `nexus_playbook`, `nexus_compare_versions`,
  `nexus_conflict_check`, `nexus_inbox`, `nexus_chat`, `nexus_normativa_search`,
  `nexus_normativa_articulo`, `nexus_normativa_pyramid`, `nexus_corpus_coverage`
  and `nexus_normativa_coverage`. The same count has been corrected in `package.json`.
- New section: exactly what a **BYO account with no registered engine** sees, with the
  list of generative tools (which return 409) and the list of read-only ones (which
  work without an engine). Each list verified against the actual gate on each route.

## 0.3.0 — 2026-07-26

This version corrects three cases in which the connector **presented as clean a
result that was not**. If you integrate against the text output of these tools,
read them: they change what you will see in situations that previously went
unnoticed.

### Fixed

- **`nexus_verificacion` displayed ✅ VIGENTE over a citation whose meaning veto
  had fired.** The field `meaning: "diverges"` — which means that the citation
  exists but the sense the document attributes to it does not add up — was not
  being rendered: the verifier's finding came out with a green tick. It is the
  worst possible case in this family, because the very mechanism that exists to
  detect the problem ended up certifying it as correct.

- **The citation cap was silent.** A document with 140 citations came back as
  «Total citas: 100 · ✅ 100 vigentes», without saying that only the first 100
  had been checked. The cap and the real total are now stated.

- **`unknown` did not distinguish between its two causes.** `unknown_reason` now
  travels with it: `not_verifiable` (there is no active corpus to check against)
  or `error` (the check fell over). Retrying only makes sense in the second, and
  "I don't know" never means "it is fine".

- **`nexus_consensus` did not say how it had ended.** `termination` and
  `secondPassRan` were being lost, so a consensus NOT reached and one that was
  reached had the same shape, and a run in which the second review never ran read
  as a two-pass one.

### Added

- `note` in verification results: the verifier's explanation of why it could not
  check a citation.
- The scope warnings of the asynchronous lane (SUBMIT + POLL) now arrive on
  polling: truncated draft, partial corpus, PII not restored, and citations not
  backed by the corpus. They used to be computed and then lost on persistence.

### Note

The tool documentation said that jurisdictions with no verifier wired in return
`not_found`. That was incorrect, and it erred on the dangerous side: `not_found`
means "checked against an active corpus and absent", which over a real citation
amounts to accusing someone of having invented it. They return `unknown`, and the
description now says so.
