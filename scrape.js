// scrape assignment with axios adn cheerio
const axios = require("axios");
const cheerio = require("cheerio");
const fs = require("fs-extra");
// urls
const BULLETIN_URL =
  "https://bulletin.du.edu/undergraduate/majorsminorscoursedescriptions/traditionalbachelorsprogrammajorandminors/computerscience/#coursedescriptionstext";

const ATHLETICS_CAROUSEL_URL =
  "https://denverpioneers.com/services/adaptive_components.ashx?type=content-stream&start=0&count=6&sport_id=0&name=all&extra=%7B%7D";

const CALENDAR_BASE = "https://www.du.edu/calendar";

const RESULTS_DIR = "./results";

async function writeJson(path, data) {
  await fs.ensureDir(RESULTS_DIR);
  await fs.writeJson(path, data, { spaces: 2 });
  console.log("wrote:", path);
}

// part 1 bulletin 
//  COMP courses 3000+ without prerequisites
async function scrapeBulletin() {
  const res = await axios.get(BULLETIN_URL);
  const $ = cheerio.load(res.data);

  const courses = [];

  $(".courseblock").each((i, el) => {
    const titleText = $(el).find(".courseblocktitle").text().trim();
    const descText = $(el).find(".courseblockdesc").text().toLowerCase();

    if (!titleText) return;

    const match = titleText.match(/COMP\s*(\d{4})/);
    if (!match) return;

    const number = parseInt(match[1]);
    if (number < 3000) return;

    if (descText.includes("prerequisite")) return;

    const course = `COMP-${number}`;
    const title = titleText.replace(/COMP\s*\d{4}/, "").trim();

    courses.push({ course, title });
  });

  await writeJson(`${RESULTS_DIR}/bulletin.json`, { courses });
}

// athletics
// gets events from the athletics content 
async function scrapeAthletics() {

  const res = await axios.get("https://denverpioneers.com/index.aspx", {
    headers: {
      "User-Agent": "Mozilla/5.0"
    }
  });

  const $ = cheerio.load(res.data);

  const events = [];

  // grab all text that might contain schedule info
  $("body *").each((i, el) => {

    const text = $(el).text().replace(/\s+/g, " ").trim();

    if (!text) return;

    // find something that looks like a sports date
    const dateMatch = text.match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}/i);

    if (!dateMatch) return;

    const date = dateMatch[0];

    let opponent = text.replace(date, "").trim();

    opponent = opponent
      .replace(/Denver/gi, "")
      .replace(/University/gi, "")
      .replace(/\s+/g, " ")
      .trim();

    if (opponent.length > 3) {
      events.push({
        duTeam: "University of Denver",
        opponent,
        date
      });
    }

  });

  // only keep first few results so the file isn't too big
  const cleanEvents = events.slice(0, 5);

  await writeJson(`${RESULTS_DIR}/athletic_events.json`, { events: cleanEvents });

}

// calendar
// collects 2025 events and details
async function scrapeCalendar2025() {
  const events = [];

  // months of 2025
  for (let month = 0; month < 12; month++) {
    const start = new Date(Date.UTC(2025, month, 1));
    const end = new Date(Date.UTC(2025, month + 1, 1));

    // format of yyyy mm dd
    const startStr = start.toISOString().slice(0, 10);
    const endStr = end.toISOString().slice(0, 10);

    // du calendar supports start date
    const url = `${CALENDAR_BASE}?start_date=${startStr}&end_date=${endStr}`;

    const res = await axios.get(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X) AppleWebKit/537.36 (KHTML, like Gecko) Chrome Safari"
      }
    });

    const $ = cheerio.load(res.data);

    const rows = $(".views-row, article, .event, .node").toArray();

    for (const row of rows) {
      // trying to find a title link
      const link =
        $(row).find("h3 a").first().attr("href") ||
        $(row).find("h2 a").first().attr("href") ||
        $(row).find("a").first().attr("href") ||
        "";

      const title =
        $(row).find("h3").first().text().trim() ||
        $(row).find("h2").first().text().trim() ||
        $(row).find("a").first().text().trim();

      // trying to find date/time text inside the row
      const rowText = $(row).text().replace(/\s+/g, " ").trim();

      // trying to get a date
      const dateMatch = rowText.match(
        /(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\s+\d{1,2},\s+2025/i
      );

      const date = dateMatch ? dateMatch[0] : undefined;

      // trying to get a time
      const timeMatch = rowText.match(
        /\b\d{1,2}:\d{2}\s*(?:a\.m\.|p\.m\.|am|pm)\b/i
      );

      const time = timeMatch ? timeMatch[0] : undefined;

      if (!title) continue;

      // building the event object
      const eventObj = { title };
      if (date) eventObj.date = date;
      if (time) eventObj.time = time;

      if (link) {
        const fullLink = link.startsWith("http")
          ? link
          : `https://www.du.edu${link}`;

        try {
          const detailRes = await axios.get(fullLink, {
            headers: {
              "User-Agent":
                "Mozilla/5.0 (Macintosh; Intel Mac OS X) AppleWebKit/537.36 (KHTML, like Gecko) Chrome Safari"
            }
          });

          const $$ = cheerio.load(detailRes.data);

          //  common description containers
          const desc =
            $$(".field--name-body").text().trim() ||
            $$(".node__content p").first().text().trim() ||
            $$("main p").first().text().trim();

          if (desc) eventObj.description = desc;

          // try and grab time if everyhing else is missing
          if (!eventObj.time) {
            const detailText = $$("body").text().replace(/\s+/g, " ").trim();
            const t2 = detailText.match(
              /\b\d{1,2}:\d{2}\s*(?:a\.m\.|p\.m\.|am|pm)\b/i
            );
            if (t2) eventObj.time = t2[0];
          }

          // grab date if eveything else is missing 
          if (!eventObj.date) {
            const detailText = $$("body").text().replace(/\s+/g, " ").trim();
            const d2 = detailText.match(
              /(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\s+\d{1,2},\s+2025/i
            );
            if (d2) eventObj.date = d2[0];
          }
        } catch (err) {
          // if one detail page fails just skip the other info
        }
      }

      // only keep events that are in 2025
      if (eventObj.date && !/2025/.test(eventObj.date)) continue;

      events.push(eventObj);
    }
  }

  await writeJson(`${RESULTS_DIR}/calendar_events.json`, { events });
}


// run the scrapers
async function main() {
  await scrapeBulletin();
  await scrapeAthletics();
  await scrapeCalendar2025();
}

main().catch((err) => console.error("scrape failed:", err.message));