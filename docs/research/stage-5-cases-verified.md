# Stage 5 — real-world rulers, checked against the sources

Verification date: 2026-11-21. Input: `stage-5-cases.md` (16 candidates, none of which had been opened). This file records what could be opened and read in this session, and what could not. Nothing here is filled in from memory.

## Method note

**Rule applied.** A case counts as verified only where text of the source itself (or the publisher's abstract of that exact work, or another scholarly work that states the figure) was fetched and read in this session. Every quotation below is copied from fetched text.

**Three levels of access were reached, and they are not equal.** Each block says which applies.

- **Full text read.** The whole article or chapter was downloaded and the passage read in context: Wang et al. 2023 and Borreggine et al. 2023 (Europe PMC full-text XML); Lazaridis et al. 2025 (same); Assmann 1995 (archive.org OCR of the JSTOR scan); Jamison and Brereton 2014, vol. 1 (archive.org OCR); Vidaković-Petrov 2020 (archive.org OCR).
- **Publisher's abstract read.** Via the Crossref API (`api.crossref.org/works/DOI`) or Europe PMC: Sherratt 2003, Henrich 2004, Read 2006, Egan et al. 2015, Wilmshurst et al. 2011, Rolett 2002, Mendizabal et al. 2012, Fenner 2005 (the abstract has no numbers).
- **Passage only.** For books that archive.org holds as lending-only scans, the book cannot be downloaded, but archive.org's own full-text search (`archive.org/services/search/beta/page_production/?service_backend=fts&user_query=...`) returns lines of the book's OCR text around a matched phrase. This is the book's text, not a web search extract, but only a line or two at a time, without page numbers, and with OCR errors. Sentences were rebuilt by running several overlapping phrase queries; where a quotation was assembled that way it is marked "assembled from overlapping fragments". Used for: Vansina 1985, Ward-Perkins 2005, Sáenz-Badillos 1993/1996, Kutscher 1982/1984, Rabin 1973, Watanabe 1974, Picken 2006, Fraser 1992, Krogh 1967, Clark 1953. If the strict reading of "opened the source" excludes this, these cases drop to "not verified" — the caller should decide. I think the passages are reliable for the specific words quoted and weak for context.

**Could not be opened.**

- `archiv.ub.uni-heidelberg.de` (Assmann 2008 PDF; Witzel 1997): the server answers every request with an "Anubis" proof-of-work bot check. Not bypassed.
- `pmc.ncbi.nlm.nih.gov`: reCAPTCHA page. Europe PMC was used instead; it serves full text only for open-access papers, so PMC3465451 (Langergraber 2012) and PMC3309771 (Dugmore 2012) were not read.
- `www.pnas.org`, `onlinelibrary.wiley.com`, `www.tandfonline.com`: HTTP 403. So Fenner's own paper, Sherratt's full text and Nunn and Reid 2016 were not read.
- `archive.org/download/...` redirects to data-node hosts that are not on the allow-list; `archive.org/stream/...` works for freely readable items only.
- Not on the allow-list at all: tms.org (Verhoeven 1998), blog.oup.com, britannica.com, kokugakuin.ac.jp, rm.coe.int.

**Page numbers.** Given only where the fetched text shows them. Most "passage only" quotations have no confirmed page.

## Summary

| # | Case | Low–high (years) | Counted from → to | Source actually read | Verdict |
|---|---|---|---|---|---|
| 1 | One human generation | 25–32 | birth of a parent → birth of that parent's child | Wang et al. 2023 (full text); Fenner's figures as stated in Lazaridis et al. 2025 (full text) | VERIFIED |
| 2 | Communicative memory | 80–100 | an event → the end of informal living memory of it | Assmann 1995, p. 127 (full text); Assmann 2008, p. 111 as quoted in Vidaković-Petrov 2020 | VERIFIED |
| 3 | Floating gap | 80 (one worked example); no general figure | the present of an oral society → the edge of its gap | Vansina 1985 (passages only) | VERIFIED WITH CHANGES |
| 4a | Roma: leaving India → "Little Egypt" | about 900 (low end unsupported) | c. 500 CE → 1417 | Mendizabal 2012 (abstract); Fraser 1992 (passages) | VERIFIED WITH CHANGES — dates only; "forgotten" is not supported |
| 4b | Roma: leaving India → linguists recover origin | about 1,280 (low end unsupported) | c. 500 CE → 1782 | Mendizabal 2012 (abstract); Fraser 1992 (passages) | VERIFIED WITH CHANGES |
| 5 | Norse Greenland | 420–470 | 985 → 1408 / mid-15th century | Borreggine et al. 2023 (full text); Krogh 1967 (passage) | VERIFIED WITH CHANGES (high 480 → 470) |
| 6 | Greece without writing | 400–450 | end of Linear B → alphabet, mid-8th c. BC | Sherratt 2003 (abstract) | VERIFIED WITH CHANGES (different quotation) |
| 7 | Potter's wheel in Britain | 250–300 | early 5th century → reintroduction | Ward-Perkins 2005 (passage) | VERIFIED |
| 8 | Tasmania | about 8,000 (loss period); 10,000 (isolation) | isolation → European arrival | Henrich 2004, Read 2006 (abstracts) | VERIFIED WITH CHANGES |
| 9 | East Polynesian voyaging | 160–425 | colonisation → decline after AD 1450 | Wilmshurst 2011, Rolett 2002 (abstracts) | VERIFIED |
| 10 | Wootz Damascus steel | 200–250 | c. 1750 → 1998 | none | NOT VERIFIED (source unreachable) |
| 11 | Aboriginal sea-rise stories | 7,250–13,070 | — | none | NOT VERIFIED (source unreachable) |
| 12 | Klamath and Mount Mazama | 7,500–7,600 | eruption → story told in 1865 | Egan 2015 (abstract); Clark 1953 (passages) | VERIFIED WITH CHANGES — dates only; the link is not verified |
| 13 | Rigveda carried by voice | 2,000–2,400 | composition 1400–1000 BCE → about 1000 CE | Jamison and Brereton 2014 (full text) | VERIFIED WITH CHANGES |
| 14 | Hebrew without native speakers | 1,650–1,700 | about 200 CE → 1881–82 | Sáenz-Badillos, Kutscher, Rabin (passages) | VERIFIED WITH CHANGES (low 1,480 not supported) |
| 15 | Ise rebuilding | 1,300–1,325 | 690 → 1993 (held) / 2013 (as scheduled) | Watanabe 1974, Picken 2006, Bernard 2001, Serageldin et al. 2001 (passages) | VERIFIED WITH CHANGES |

---

## Rulers

### 1. One human generation — VERIFIED

- **Opened:**
  - `https://www.ebi.ac.uk/europepmc/webservices/rest/PMC9821931/fullTextXML` — Wang, Al-Saffar, Rogers, Hahn, "Human generation times across the past 250,000 years", *Science Advances* 9(1), 2023. Full text read.
  - `https://api.crossref.org/works/10.1126/sciadv.abm7047` — confirms title, journal, volume 9, issue 1, authors. The DOI in the candidate file is correct.
  - `https://api.crossref.org/works/10.1002/ajpa.20188` and Europe PMC record PMID 15795887 — Fenner 2005, *Am. J. Phys. Anthropol.* 128(2), 415–423 confirmed. The abstract contains no numbers.
  - `https://www.ebi.ac.uk/europepmc/webservices/rest/PMC11922553/fullTextXML` — Lazaridis et al., "The genetic origin of the Indo-Europeans", *Nature* 639, 132–142, 2025. Full text read; its reference 97 is Fenner 2005.
- **Quotations:**
  - Wang et al., Results: "Within this time frame, we find the average human generation interval to be 26.9 ± 3.4 years (SE) with an average for males of 30.7 ± 4.8 years and an average for females of 23.2 ± 3.0 years."
  - Wang et al., Results: "The average human generation interval was at a recent minimum of 24.9 ± 3.5 years at ~250 generations ago (6.4 ka ago), roughly concurrent with the historic rise of early civilizations."
  - Lazaridis et al., Methods, citing Fenner (ref. 97): "We converted the results into years by assuming 28.6 years per generation for the median minimum location and 25.6 and 31.5 years per generation for the lower and upper bounds, respectively. We used these values, corresponding to the estimated number of years per generation for males (31.5) and females (25.6) to account for uncertainty in the conversion factor."
- **Low/high, from, to:** supported as written. 25 and 32 are Fenner's female-line (25.6) and male-line (31.5) figures rounded outward; the sex-averaged figures are 26.9 (Wang) and 28.6 (Fenner).
- **Not confirmed:** Fenner's own paper was not opened (Wiley 403), so his figures are verified at second hand, from a 2025 *Nature* paper that uses them. The breakdown in the candidate file (hunter-gatherers 157 societies; nation states 360; 27.3/30.8/29.1) was not seen; PMC3465451 is not open access. Do not print those sub-figures.
- **Caveat to keep:** Wang's mother-line average is 23.2, below the low end. Wang also reports 20–21 years for non-African populations over the last 10,000 generations ("20.1 ± 3.9, 20.6 ± 3.8, and 21.0 ± 3.7 years"), so "25–32" is the cross-cultural, both-sexes range, not a floor.

### 2. Communicative memory (Assmann) — VERIFIED

- **Opened:**
  - `https://archive.org/stream/CollectiveMemoryAndCulturalIdentity/Collective%20Memory%20and%20Cultural%20Identity_djvu.txt` — OCR of the JSTOR scan of Jan Assmann and John Czaplicka, "Collective Memory and Cultural Identity", *New German Critique* No. 65 (Spring–Summer 1995), pp. 125–133. The scan's own cover sheet gives these details. Full text read. This is a user-uploaded copy of the JSTOR PDF, not JSTOR itself.
  - `https://api.crossref.org/works/10.2307/488538` — confirms title, journal, issue 65, first page 125, 1995.
  - `https://archive.org/stream/ch.2020.004/ch.2020.004_djvu.txt` — Krinka Vidaković-Petrov, "Transgenerational Memory: From Pre-Holocaust to Post-Yugoslavia", *Colloquia Humanistica*, 2020 (open access), which quotes Assmann 2008 with a page number.
  - The Heidelberg PDF of the 2008 chapter could not be opened (bot check).
- **Quotations:**
  - Assmann 1995, p. 127 (the passage falls between the running heads "Jan Assman 127" and "128 Collective Memory and Cultural Identity"; OCR "histoiy" corrected): "Its most important characteristic is its limited temporal horizon. As all oral history studies suggest, this horizon does not extend more than eighty to (at the very most) one hundred years into the past, which equals three or four generations or the Latin saeculum."
  - Assmann 2008, p. 111, as quoted by Vidaković-Petrov: "it lives in everyday interaction and communication and, for this very reason, has only a limited time depth which normally reaches no farther back than eighty years, the time span of three interacting generations. (Assmann, 2008, p. 111)"
- **Low/high, from, to:** supported as written (80–100). Page 127 for the 1995 article is confirmed. Page 111 for the 2008 chapter is confirmed only through a later author's citation (two independent works on archive.org give the same page).
- **Caveat to keep:** a generalisation from oral-history studies, not a measurement; it bounds informal memory only.

### 3. Floating gap (Vansina) — VERIFIED WITH CHANGES

- **Opened:** archive.org full-text search restricted to `identifier:oraltraditionash0000vans_g5z0` — Jan Vansina, *Oral Tradition as History*, 1985 (lending-only scan). **Passages only.** The book's index (seen in the same way) reads "Floating gap, 23-24, 168-69, 226 n10" and "Aka, people, 24".
- **Quotations (assembled from overlapping fragments):**
  - pp. 23–24 per the index: "There is a gap in the accounts, which I will call the floating gap."
  - Same passage: "… limit one reaches in time reckoning moves with the passage of generations, I have called the gap a floating gap. For the Tio (Congo), c. 1880, the limit lay c. 1800, while in 1960 it had moved to c. 1880." (The opening word of the sentence was not returned; the candidate file's "Because the" is not confirmed.)
  - Same passage: "Beyond a certain time depth, which differs for each type of social structure because time is reckoned by …" and "The shortest such time depth I know of is that of the Aka of Lobaye (Central African Republic), where it does not exceed one generation of adults"
  - pp. 168–69 (running head "Time 169" appears in the fragment): "This profile has been compared to an hourglass. At the junction of times of origin and the very sparse subsequent records, there usually is a chronological gap."
- **Changes:** the candidate file said Vansina gives no number and that the Tio example was unconfirmed. Both are now settled: Vansina gives **no general figure** (the depth "differs for each type of social structure", down to one generation among the Aka), **but his worked example is 80 years** — for the Tio the limit lay about 80 years back in 1880 and again in 1960. So `low` 80 / `high` 100 is not Vansina's range; "80" is his example and "100" is Assmann's.
- **Recommendation:** merge into case 2, adding the Tio example as an observed instance (80 years, measured twice, 80 years apart).

---

## Origin forgotten

### 4a. Roma: leaving India → "Little Egypt" — VERIFIED WITH CHANGES (dates only)

- **Opened:**
  - Europe PMC record for PMID 23219723 (`https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=EXT_ID:23219723&format=json&resultType=core`) — abstract of Mendizabal et al., *Current Biology* 22(24), 2012, 2342–2349 (details confirmed at `https://api.crossref.org/works/10.1016/j.cub.2012.10.039`).
  - archive.org full-text search in `identifier:gypsies0000fras_v7f9` — Angus Fraser, *The Gypsies*, 1992. Passages only.
- **Quotations:**
  - Mendizabal et al., abstract: "the Romani diaspora constitutes a single initial founder population that originated in north/northwestern India ~1.5 thousand years ago (kya)." and "the European spread of the Romani people was via the Balkans starting ~0.9 kya."
  - Fraser (fragments): "When this happened, from 1417 onwards, there was such a stir that it is tempting"; "this day wander about these lands and claim to be from Little Egypt. But this is false, since their parents were" (a contemporary chronicler, quoted by Fraser).
- **Changes:** `from` c. 500 CE and `to` 1417 are supported, giving about **900** years. The `low` of 400 rests on a later departure date for which no source was found; drop it or mark it unsourced. Note the candidate's quotation said "descends from"; the abstract says "constitutes".
- **Not supported:** that the Roma had forgotten India by 1417. The sources read say only that they claimed Egypt. The candidate's 1422 Bologna "Indians" remark was not found. Council of Europe factsheet not reachable.
- **Would not ship**: the span is a date subtraction, not a statement about memory.

### 4b. Roma: leaving India → linguists recover the origin — VERIFIED WITH CHANGES

- **Opened:** as 4a.
- **Quotation:** Fraser (fragment; OCR "Ridiger" for "Rüdiger"): "Rüdiger's findings were published in 1782." Fraser's bibliography entry was also seen: "Rudiger, J. C. C. Neuster Zuwachs der teutschen fremden und allgemeinen Sprachkunde, Part 1 (Leipzig, 1782)".
- **Changes:** c. 500 CE → 1782 gives about **1,280** (the candidate's `high`). The `low` of 780 has no source. Grellmann 1783 was not confirmed. Hancock's chapter was not opened; cite Fraser instead.

### 5. Norse Greenland — VERIFIED WITH CHANGES

- **Opened:**
  - `https://www.ebi.ac.uk/europepmc/webservices/rest/PMC10151458/fullTextXML` — Borreggine et al., *PNAS* 120(17), e2209615120, 2023. Full text read; volume and issue confirmed.
  - archive.org full-text search, Knud J. Krogh, *Viking Greenland*, 1967 (`bwb_T4-ALF-715`). Passages only.
- **Quotations:**
  - Borreggine, Significance statement: "Vikings occupied Greenland from 985 CE to the mid-15th century."
  - Borreggine, section A: "This settlement was established ~985 CE and was likely abandoned in the mid-15th century, ~100 y later than the abandonment of the Western Settlement farther North at ~1350 CE."
  - Krogh (fragments): "Our last reliable account of the Norsemen in Greenland comes from Hvalsey and tells us of … a wedding in Hvalsey church in 1408." and "On the 16th of September, 1408, a wedding was celebrated in Hvalsey church."
- **Changes:** `from` 985 and `low` 420 (985 → 1408 = 423) are supported. `high` 480 implies about 1465; the source says only "mid-15th century", so **470** (to about 1450–1455) is the most the text supports. The candidate's statement that radiocarbon dates indicate about half a century of occupation after 1408 was **not found** in Borreggine; remove it. Dugmore 2012 not opened.
- **Useful extra from the full text:** the Eastern Settlement had "~500 Norse sites and an average population of ~2000 inhabitants".

---

## Skill lost

### 6. Greece without writing — VERIFIED WITH CHANGES (use a different quotation)

- **Opened:** `https://api.crossref.org/works/10.1111/1468-0092.00185` — publisher's abstract of Susan Sherratt, "Visible writing: questions of script and identity in Early Iron Age Greece and Cyprus", *Oxford Journal of Archaeology* 22(3), 2003, 225–242. Abstract only; details confirmed.
- **Quotation (abstract):** "A number of seemingly intractable problems still surround the introduction of the Greek alphabet some time around the middle of the eighth century BC, after more than four centuries of Greek illiteracy."
- **Changes:** the candidate's quotation ("the parallel, but rather longer, gap in Greece between the Linear B script which dies with the palaces …") was **not confirmed** — it is not in the abstract and the full text could not be opened; its attribution to Sherratt remains unchecked. Replace it with the abstract sentence above. `low` 400 / `high` 450 are consistent with "more than four centuries" ending about 750 BC. `from` "c. 1200 BC, end of Linear B" is not stated in the abstract: the abstract supports "more than four centuries before c. 750 BC", which implies a start before c. 1150 BC.
- **Also in the abstract, worth keeping:** on Cyprus "there is every reason to suppose that an indigenous syllabic script continued in use"; and the date of the alphabet "though debated, seems still more or less a matter of consensus".

### 7. The potter's wheel in Britain — VERIFIED

- **Opened:** archive.org full-text search in `identifier:fallofromeendofc0000brya` — Bryan Ward-Perkins, *The Fall of Rome and the End of Civilization* (the scan is the 2006 paperback). Passages only. The OUP blog is not on the allow-list.
- **Quotation (assembled from overlapping fragments; the book has no comma after "Britain"):** "All over Britain the art of making pottery on a wheel disappeared in the early fifth century, and was not reintroduced for almost 300 years. The potter's wheel is not an instrument of cultural identity."
- **Low/high, from, to:** supported. "Almost 300 years" from the early fifth century; `to` "around 700" is arithmetic, not the book's words. Page not confirmed.
- **Related passage seen in the same book (fragment), on writing:** "… Anglo-Saxon Britain during the fifth century, to be reintroduced by Christian missionaries only around AD 600".

### 8. Tasmania — VERIFIED WITH CHANGES (abstracts only)

- **Opened:** `https://api.crossref.org/works/10.2307/4128416` (Henrich, *American Antiquity* 69(2), 2004, 197–214) and `https://api.crossref.org/works/10.2307/40035327` (Read, *American Antiquity* 71(1), 2006, 164–184 — page range now confirmed). Abstracts only.
- **Quotations:**
  - Henrich: "over an approximately 8,000-year period, from the beginning of the Holocene until European explorers began arriving in the eighteenth century, the societies of Tasmania lost a series of valuable skills and technologies." and "the rising ocean levels at the end of the last glacial epoch, which cut Tasmania off from the rest of Australia for the ensuing ten millennia".
  - Read: "Loss of skills more likely relates to change in the mode of resource procurement or change in technology rather than a shortage of skilled, target individuals due to decrease in population size."
- **Changes:** what the sources support is "isolated for about 10,000 years; losses spread over about 8,000 years". The candidate's `to` (bone points gone about 3,500 years ago; fish dropped 3,800–3,500 years ago) and so its 4,500–8,500 range were **not confirmed** by anything opened.

### 9. East Polynesian voyaging — VERIFIED (abstracts)

- **Opened:** `https://api.crossref.org/works/10.1073/pnas.1015876108` (Wilmshurst et al., *PNAS* 108(5), 1815–1820) and `https://api.crossref.org/works/10.1353/asi.2003.0009` (Rolett, *Asian Perspectives* 41(2), 2002, 182–194). Abstracts only.
- **Quotations:**
  - Wilmshurst: "earliest in the Society Islands A.D. ∼1025–1120, four centuries later than previously assumed; then after 70–265 y, dispersal continued in one major pulse to all remaining islands A.D. ∼1190–1290."
  - Rolett: "Archaeological evidence suggests a fall-off through time in the frequency of open-sea voyaging within this homeland, with marked declines in voyaging and interaction after A.D. 1450." (OCR "opensea", "a.d." normalised.)
- **Low/high:** supported as arithmetic (1290 → 1450 = 160; 1025 → 1450 = 425). Weisler 2016 not checked.

### 10. Wootz Damascus steel — NOT VERIFIED

- `https://api.crossref.org/works/10.1007/s11837-998-0419-y` confirms only the bibliographic record (Verhoeven, Pendray, Dauksch, *JOM* 50(9), 1998, 58–64); no abstract. tms.org is not on the allow-list and no copy was found on archive.org. Neither quotation was seen. Do not ship.

---

## Memory or skill kept

### 11. Aboriginal sea-rise stories — NOT VERIFIED

- `https://api.crossref.org/works/10.1080/00049182.2015.1077539` confirms the record (Nunn and Reid, *Australian Geographer* 47(1), 11–47); no abstract. `www.tandfonline.com` returned 403; not in Europe PMC; nothing on archive.org. The 7,250–13,070 figure was not seen. Do not ship.

### 12. Klamath and Mount Mazama — VERIFIED WITH CHANGES (dates only; link not verified)

- **Opened:** `https://api.crossref.org/works/10.1177/0959683615576230` (Egan, Staff, Blackford, *The Holocene* 25(7), 2015, 1054–1067; abstract); archive.org full-text search in `identifier:indianlegendsofp00clar` (Ella E. Clark, *Indian Legends of the Pacific Northwest*, 1953; passages only).
- **Quotations:**
  - Egan et al.: "to provide a refined age of 7682–7584 cal. yr BP (95.4% probability range)."
  - Clark (fragments): "In the autumn of 1865, a nineteen-year-old soldier stationed at …"; "'The Origin of Crater Lake,' a myth related in 1865 by an old Klamath chief, have striking parallels"; "Then Chief Lalek told the following legend".
- **Changes:** 7682–7584 years before 1950, counted to 1865, is 7,499–7,597, so the range is **7,500–7,600**, not 7,500–7,700. That the story records the eruption is the interpretation; nothing opened tests it. Vitaliano 2007 and the "250 generations" line were not seen. Would not ship as a "memory kept" figure.

### 13. The Rigveda carried by voice — VERIFIED WITH CHANGES

- **Opened:** `https://archive.org/stream/the-rigveda-1/The%20Rigveda%201_djvu.txt` — OCR of Stephanie W. Jamison and Joel P. Brereton, *The Rigveda: The Earliest Religious Poetry of India*, Oxford University Press, 2014, vol. 1. Full text of the Introduction read. This is a user-uploaded scan. (OCR renders small capitals as "BcE"/"ce" and "Ṛgveda" variously as "Rgveda", "Reveda"; normalised below.)
- **Quotations:**
  - Introduction, I.B "Date and cultural context of the Ṛgveda": "Generously rounding these numbers, we can then place the period of the composition of the Rgvedic hymns sometime within the period 1400-1000 BCE or, even more approximately, within the second half of the second millennium BCE."
  - Introduction, II "History of the Rgvedic Text": "It is difficult to say when this occurred, but the transmission of the text likely remained exclusively oral at least until around 1000 CE."
  - Same section: "The oldest manuscript in the collection of the Bhandarkar Oriental Research Institute collection dates only to 1464; the Sampurnanand Sanskrit University in Varanasi has an older Rgveda manuscript from the fourteenth century—thus a gap of considerably over two millennia between the fixation of the text and our earliest written evidence for it."
  - II.A: "The Rigveda was composed entirely orally and transmitted entirely orally for a very long time, probably several millennia."
- **Changes:** `from` becomes **1400–1000 BCE** (not 1500–1000); `to` becomes **"about 1000 CE, the earliest the text is likely to have been written down"**; so **2,000–2,400** (not 2,000–2,500). The candidate's "oldest manuscripts c. 1040 CE (Nepal)" and both Witzel fragments ("tape recordings", "without the change of a single word") were **not confirmed**: Witzel 1997 is on the Heidelberg server. Jamison and Brereton give the oldest Rigveda manuscript as fourteenth century. Cite Jamison and Brereton, not Witzel.
- **Caveat to keep:** the composition date is inferred (no iron in the text; five or six generations of poets), and the authors call it "a matter of contention and reconsideration".

### 14. Hebrew without native speakers — VERIFIED WITH CHANGES

- **Opened (all passages only, archive.org full-text search):** Angel Sáenz-Badillos, *A History of the Hebrew Language* (`historyofhebrewl0000senz`, the 1996 printing); E. Y. Kutscher, *A History of the Hebrew Language* (`historyofhebrewl0000kuts`, 1984 printing); Chaim Rabin, *A Short History of the Hebrew Language*, 1973 (`shorthistoryofhe0000rabi`).
- **Quotations:**
  - Sáenz-Badillos, ch. 6 (fragments): "The first, which lasted until the close of the Tannaitic era (around 200 CE), is characterized by RH as a spoken language gradually developing into a literary …"
  - Kutscher, §254 (fragments): "It is generally assumed that MH died out as a spoken language at the end of the second century C.E."
  - Rabin (fragments): "As far as our information goes, Hebrew ceased to be spoken about two generations later, around 200 C.E., after the completion of the Mishnah"; and "when his son was born in 1882, he brought him up in Hebrew, and Hebrew became the child's first language. Itamar Ben-Avi, as he was later called, became the first Hebrew child."
  - Sáenz-Badillos on the revival (fragments): "From 1881 Ben-Yehuda lived in Jerusalem, and, starting with his own family, forged ahead with his objective of changing Hebrew into a language …"
- **Changes:** three standard histories put the end of spoken Hebrew at **about 200 CE**; the revival is **1881–82**. That is about 1,680 years: use **1,650–1,700**. The candidate's `low` of 1,480 (a 4th-century end) has **no support** in anything read. The secondary claim about pp. 170–171 ("less than a century after the Mishnah …") was not found. One trap avoided: a Sáenz-Badillos sentence about a language "surviving a few more centuries as a spoken dialect" is about Punic in North Africa, not Hebrew.
- **Shaky:** Sáenz-Badillos also has the fragment "many indications that it had never completely died out as a spoken language", in the revival chapter; I could not read enough around it to say what "it" covers. Publisher of Sáenz-Badillos (CUP 1993) still not confirmed from the book itself.

### 15. Ise rebuilding — VERIFIED WITH CHANGES

- **Opened (all passages only, archive.org full-text search):** Yasutada Watanabe, *Shinto Art: Ise and Izumo Shrines*, 1974 (`shintoartiseizum00wata`); Stuart D. B. Picken, *The A to Z of Shinto*, 2006 (`atozofshinto0000pick`); Rosemarie Bernard, "… Photographic and Televised Mediations of Ise's Shikinen Sengu", in *Religion and Media*, 2001 (`religionmedia0000unse`); *Historic Cities and Sacred Sites: Cultural Roots for Urban Futures*, 2001 (`historiccitiessa0000unse`). Britannica and the Kokugakuin encyclopedia are not on the allow-list.
- **Quotations:**
  - Watanabe (assembled from overlapping fragments; OCR "fust" for "first"): "This system began at Ise when the Naiku was rebuilt for the first time in 690 during the early Nara period, followed by the reconstruction of the Geku in 692."
  - Watanabe (fragments): "… have been faithfully rebuilt every twenty years since the late seventh century with only one significant hiatus. The sixtieth rebuilding was completed in the fall of 1973, when the shrine was rededicated."
  - Picken, chronology (fragments): "The rebuilding of the Inner Shrines at Ise (shikinen sengu), which was discontinued in 1462, resumes." (entry for 1585).
  - *Historic Cities and Sacred Sites* (fragments): "The sixty-first Shikinen Sengu ceremony … was held in 1993. The sixty-second ceremony will be held in 2013."
- **Changes:** `from` 690 is supported. The 62nd rebuilding in 2013 is confirmed only as a forecast written in 2001; no post-2013 source could be opened. So: **low 1,300** (690 → 1993, the 61st, confirmed held) and **high 1,325** (690 → 2013, as scheduled). The candidate's `high` of 1,345 points to 2033, which has not happened. The break: Picken gives 1462–1585, i.e. about 123 years, which matches the candidate's "more than 120 years" (that exact phrase was not found). Watanabe describes "one hiatus" and says the system "was finally revived in 1585" (heavy OCR damage on that line).
- **Shaky:** Picken's chronology numbers the rebuildings differently ("rebuilt for the 64th time" in 1953, "66th" in 1993), against Watanabe (60th in 1973) and Bernard (61st in 1993). Use the Watanabe/Bernard count or print no count. All four are passages only.

---

## What I would ship

Eight, of which three are things kept: **1** generation, **2** communicative memory (with Vansina's Tio example folded in from 3), **7** potter's wheel, **6** Greece without writing, **5** Norse Greenland, **13** Rigveda, **14** Hebrew, **15** Ise. Case 9 (Polynesia) is clean but is two abstracts joined by subtraction. Cases 10 and 11 are not verified. Cases 4a, 4b, 8 and 12 have verified dates but the thing the tool would claim (a forgetting, a loss, a memory) is the part the sources do not establish.
